use std::num::NonZeroUsize;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, TrySendError, sync_channel};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rubato::{FftFixedIn, Resampler};
use sha2::{Digest, Sha256};

use super::local_host::{HOST_CHUNK_SAMPLES, LocalClock, sample_duration};
use crate::adapters::{AdapterError, AudioCapture, CaptureEvent};
use crate::domain::{
    AudioFormat, AudioFrame, CaptureReady, CaptureTime, Discontinuity, FailureReason, FrameStamp,
    InputError, ProfileId, UnavailableReason,
};
use crate::runtime::WorkContext;

/// Bounded mono conversion and resampling shared by CoreAudio and local replay.
/// Accepts 16, 44.1, and 48 kHz float input with up to eight source channels.
/// Initial filter delay is discarded. Output timestamps retain source time.
pub struct CaptureNormalizer {
    ready: CaptureReady<AudioFormat>,
    source: AudioFormat,
    resampler: FftFixedIn<f32>,
    input: [Vec<f32>; 1],
    output: Vec<Vec<f32>>,
    filter_delay: usize,
    pending: Vec<f32>,
    timeline: Timeline,
    emitted: usize,
    failed: bool,
}

enum Timeline {
    Empty,
    Captured {
        first: CaptureTime,
        source_frames: usize,
    },
}

impl CaptureNormalizer {
    /// Fix source/canonical formats and allocate bounded resampler buffers once.
    pub fn new(
        ready: CaptureReady<AudioFormat>,
        source: AudioFormat,
    ) -> Result<Self, AdapterError> {
        let rate = source.sample_rate_hz.get() as usize;
        if ![16000, 44100, 48000].contains(&rate)
            || source.channels.get() > 8
            || ready.format.sample_rate_hz.get() != 16000
            || ready.format.channels.get() != 1
        {
            return Err(AdapterError::Unavailable(UnavailableReason::Unsupported));
        }
        let resampler =
            FftFixedIn::<f32>::new(rate, 16000, rate / 100, 1, 1).map_err(device_failure)?;
        let output = resampler.output_buffer_allocate(true);
        let filter_delay = resampler.output_delay();
        let input = [Vec::with_capacity(resampler.input_frames_next())];
        Ok(Self {
            ready,
            source,
            resampler,
            input,
            output,
            filter_delay,
            pending: Vec::with_capacity(HOST_CHUNK_SAMPLES),
            timeline: Timeline::Empty,
            emitted: 0,
            failed: false,
        })
    }

    /// Normalize one source callback of at most 250 ms. Any error ends this normalizer.
    pub fn push(
        &mut self,
        samples: &[f32],
        captured_at: CaptureTime,
    ) -> Result<Vec<AudioFrame>, AdapterError> {
        if self.failed {
            return Err(AdapterError::Discontinuity(Discontinuity::ClockReset));
        }
        let result = self.push_source(samples, captured_at);
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    fn push_source(
        &mut self,
        samples: &[f32],
        captured_at: CaptureTime,
    ) -> Result<Vec<AudioFrame>, AdapterError> {
        let channels = self.source.channels.get() as usize;
        let rate = self.source.sample_rate_hz.get() as usize;
        if samples.is_empty()
            || !samples.len().is_multiple_of(channels)
            || samples.len() / channels > rate / 4
        {
            return Err(AdapterError::InvalidInput(InputError::LimitExceeded));
        }
        if captured_at.session != self.ready.clock.local_origin.session {
            return Err(AdapterError::Discontinuity(Discontinuity::ClockReset));
        }
        let first = match self.timeline {
            Timeline::Empty => captured_at,
            Timeline::Captured {
                first,
                source_frames,
            } => {
                let expected = first.elapsed + source_duration(source_frames, rate);
                if expected.abs_diff(captured_at.elapsed) > Duration::from_millis(2) {
                    return Err(AdapterError::Discontinuity(Discontinuity::ClockReset));
                }
                first
            }
        };
        let mut frames = Vec::new();
        for source_frame in samples.chunks_exact(channels) {
            let mut mono = 0.0;
            for sample in source_frame {
                if !sample.is_finite() || sample.abs() > 1.0 {
                    return Err(AdapterError::InvalidInput(InputError::InvalidAudio));
                }
                mono += *sample / channels as f32;
            }
            self.input[0].push(mono);
            if self.input[0].len() != self.resampler.input_frames_next() {
                continue;
            }
            let (_, produced) = self
                .resampler
                .process_into_buffer(&self.input, &mut self.output, None)
                .map_err(device_failure)?;
            self.input[0].clear();
            for index in 0..produced {
                if self.filter_delay != 0 {
                    self.filter_delay -= 1;
                    continue;
                }
                let sample = self.output[0][index];
                if !sample.is_finite() {
                    return Err(AdapterError::Failed(FailureReason::InvalidOutput));
                }
                self.pending.push(sample.clamp(-1.0, 1.0));
                if self.pending.len() != HOST_CHUNK_SAMPLES {
                    continue;
                }
                let stamp = FrameStamp {
                    sequence: (self.emitted / HOST_CHUNK_SAMPLES) as u64,
                    captured_at: CaptureTime {
                        session: first.session,
                        elapsed: first.elapsed + sample_duration(self.emitted),
                    },
                };
                let pcm =
                    std::mem::replace(&mut self.pending, Vec::with_capacity(HOST_CHUNK_SAMPLES));
                frames.push(
                    AudioFrame::new(
                        &self.ready,
                        stamp,
                        pcm,
                        NonZeroUsize::new(HOST_CHUNK_SAMPLES).unwrap(),
                    )
                    .map_err(AdapterError::InvalidInput)?,
                );
                self.emitted += HOST_CHUNK_SAMPLES;
            }
        }
        let preceding = match self.timeline {
            Timeline::Empty => 0,
            Timeline::Captured { source_frames, .. } => source_frames,
        };
        self.timeline = Timeline::Captured {
            first,
            source_frames: preceding + samples.len() / channels,
        };
        Ok(frames)
    }
}

/// Explicitly activated default macOS microphone. Dropping it stops acquisition.
/// A 640 ms queue bounds callback output. Overflow and device errors end the epoch.
pub struct Microphone {
    ready: CaptureReady<AudioFormat>,
    receiver: Receiver<AudioFrame>,
    failure: Arc<AtomicU8>,
    _stream: cpal::Stream,
}

/// A configured microphone whose stream has not started capturing.
pub struct PreparedMicrophone(Microphone);

impl PreparedMicrophone {
    /// Metadata fixed before a runtime allocates its utterance decoder.
    pub fn ready(&self) -> &CaptureReady<AudioFormat> {
        &self.0.ready
    }

    /// Start capture after the host's attempt is ready to accept new samples.
    pub fn start(self, work: &WorkContext<'_>) -> Result<Microphone, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        self.0._stream.play().map_err(cpal_error)?;
        work.check().map_err(AdapterError::Work)?;
        Ok(self.0)
    }
}

impl Microphone {
    /// Open the current OS microphone only after the host requests a capture.
    /// Uses its default source format. No hardware sample-rate change is requested.
    pub fn prepare(
        clock: &LocalClock,
        work: &WorkContext<'_>,
    ) -> Result<PreparedMicrophone, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        let device = cpal::default_host()
            .default_input_device()
            .ok_or(AdapterError::Unavailable(UnavailableReason::Missing))?;
        let config = device.default_input_config().map_err(cpal_error)?;
        if config.sample_format() != cpal::SampleFormat::F32 {
            return Err(AdapterError::Unavailable(UnavailableReason::Unsupported));
        }
        let source = AudioFormat {
            sample_rate_hz: std::num::NonZeroU32::new(config.sample_rate())
                .ok_or(AdapterError::InvalidInput(InputError::InvalidAudio))?,
            channels: std::num::NonZeroU16::new(config.channels())
                .ok_or(AdapterError::InvalidInput(InputError::InvalidAudio))?,
        };
        let mut hash = Sha256::new();
        hash.update(
            b"voiceid-coreaudio-development-v1\0rubato=0.16.2;mono-mean;drop-filter-delay;clock-step=2ms\0",
        );
        hash.update(device.id().map_err(cpal_error)?.to_string());
        hash.update(source.sample_rate_hz.get().to_le_bytes());
        hash.update(source.channels.get().to_le_bytes());
        let ready = clock.capture_ready(ProfileId(hash.finalize().into()));
        let (sender, receiver) = sync_channel(64);
        let failure = Arc::new(AtomicU8::new(0));
        let anchor = Arc::new(OnceLock::new());
        let mut callback = InputCallback {
            normalizer: CaptureNormalizer::new(ready, source)?,
            sender,
            failure: failure.clone(),
            anchor: anchor.clone(),
        };
        let errors = failure.clone();
        let stream = device
            .build_input_stream(
                config.config(),
                move |samples: &[f32], info| callback.input(samples, info),
                move |error| invalidate(&errors, error_code(cpal_error(error))),
                Some(Duration::from_secs(3)),
            )
            .map_err(cpal_error)?;
        let before = clock.origin().elapsed();
        let source_time = stream.now();
        let after = clock.origin().elapsed();
        if after - before > ready.clock.maximum_error {
            return Err(AdapterError::Discontinuity(Discontinuity::ClockReset));
        }
        anchor
            .set(ClockAnchor {
                source: source_time,
                local: before + (after - before) / 2,
            })
            .map_err(clock_failure)?;
        work.check().map_err(AdapterError::Work)?;
        Ok(PreparedMicrophone(Self {
            ready,
            receiver,
            failure,
            _stream: stream,
        }))
    }

    /// Inspect the default device format without opening an audio stream.
    pub fn default_device() -> Result<String, AdapterError> {
        let device = cpal::default_host()
            .default_input_device()
            .ok_or(AdapterError::Unavailable(UnavailableReason::Missing))?;
        let config = device.default_input_config().map_err(cpal_error)?;
        Ok(format!(
            "{}: {} Hz, {} channels, {:?}",
            device.id().map_err(cpal_error)?,
            config.sample_rate(),
            config.channels(),
            config.sample_format()
        ))
    }
}

impl AudioCapture for Microphone {
    fn ready(&self) -> &CaptureReady<AudioFormat> {
        &self.ready
    }
    fn next_frame(
        &mut self,
        work: &WorkContext<'_>,
    ) -> Result<CaptureEvent<AudioFrame>, AdapterError> {
        loop {
            work.check().map_err(AdapterError::Work)?;
            check_failure(&self.failure)?;
            match self.receiver.recv_timeout(Duration::from_millis(50)) {
                Ok(frame) => {
                    work.check().map_err(AdapterError::Work)?;
                    check_failure(&self.failure)?;
                    return Ok(CaptureEvent::Frame(frame));
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(AdapterError::Failed(FailureReason::Device));
                }
            }
        }
    }
}

struct InputCallback {
    normalizer: CaptureNormalizer,
    sender: SyncSender<AudioFrame>,
    failure: Arc<AtomicU8>,
    anchor: Arc<OnceLock<ClockAnchor>>,
}

struct ClockAnchor {
    source: cpal::StreamInstant,
    local: Duration,
}

impl InputCallback {
    fn input(&mut self, samples: &[f32], info: &cpal::InputCallbackInfo) {
        if self.failure.load(Ordering::Acquire) != 0 {
            return;
        }
        let captured_at = match self.capture_time(info) {
            Ok(time) => time,
            Err(error) => {
                invalidate(&self.failure, error_code(error));
                return;
            }
        };
        let frames = match self.normalizer.push(samples, captured_at) {
            Ok(frames) => frames,
            Err(error) => {
                invalidate(&self.failure, error_code(error));
                return;
            }
        };
        for frame in frames {
            match self.sender.try_send(frame) {
                Ok(()) => {}
                Err(TrySendError::Full(_)) => {
                    invalidate(&self.failure, 1);
                    return;
                }
                Err(TrySendError::Disconnected(_)) => {
                    invalidate(&self.failure, 3);
                    return;
                }
            }
        }
    }

    fn capture_time(
        &mut self,
        info: &cpal::InputCallbackInfo,
    ) -> Result<CaptureTime, AdapterError> {
        let timestamp = info.timestamp();
        let anchor = self.anchor.get().ok_or_else(clock_failure_empty)?;
        let elapsed = if let Some(delta) = timestamp.capture.checked_duration_since(anchor.source) {
            anchor.local + delta
        } else {
            let delta = anchor
                .source
                .checked_duration_since(timestamp.capture)
                .ok_or_else(clock_failure_empty)?;
            anchor
                .local
                .checked_sub(delta)
                .ok_or_else(clock_failure_empty)?
        };
        Ok(CaptureTime {
            session: self.normalizer.ready.clock.local_origin.session,
            elapsed,
        })
    }
}

fn source_duration(frames: usize, rate: usize) -> Duration {
    Duration::from_nanos((frames as u128 * 1_000_000_000 / rate as u128) as u64)
}
fn invalidate(failure: &AtomicU8, code: u8) {
    let _ = failure.compare_exchange(0, code, Ordering::AcqRel, Ordering::Acquire);
}
fn check_failure(failure: &AtomicU8) -> Result<(), AdapterError> {
    match failure.load(Ordering::Acquire) {
        0 => Ok(()),
        1 => Err(AdapterError::Discontinuity(Discontinuity::Overflow)),
        2 => Err(AdapterError::Discontinuity(Discontinuity::ClockReset)),
        4 => Err(AdapterError::Unavailable(
            UnavailableReason::PermissionDenied,
        )),
        _ => Err(AdapterError::Discontinuity(Discontinuity::DeviceChanged)),
    }
}
fn error_code(error: AdapterError) -> u8 {
    match error {
        AdapterError::Discontinuity(Discontinuity::Overflow) => 1,
        AdapterError::Discontinuity(Discontinuity::ClockReset) => 2,
        AdapterError::Unavailable(UnavailableReason::PermissionDenied) => 4,
        _ => 3,
    }
}
fn cpal_error(error: cpal::Error) -> AdapterError {
    match error.kind() {
        cpal::ErrorKind::PermissionDenied => {
            AdapterError::Unavailable(UnavailableReason::PermissionDenied)
        }
        cpal::ErrorKind::Xrun => AdapterError::Discontinuity(Discontinuity::Overflow),
        _ => AdapterError::Failed(FailureReason::Device),
    }
}
fn device_failure<E>(_: E) -> AdapterError {
    AdapterError::Failed(FailureReason::Device)
}
fn clock_failure<E>(_: E) -> AdapterError {
    clock_failure_empty()
}
fn clock_failure_empty() -> AdapterError {
    AdapterError::Discontinuity(Discontinuity::ClockReset)
}
