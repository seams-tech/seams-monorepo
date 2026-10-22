//! Synthetic-audio provider for the real Chrome/native/wallet journey. Never used by the installed host.

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("browser_host_journey requires macOS");
    std::process::exit(1);
}

#[cfg(target_os = "macos")]
fn main() -> Result<(), String> {
    journey::run()
}

#[cfg(target_os = "macos")]
mod journey {
    use std::fs;
    use std::num::NonZeroUsize;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use voiceid_engine::adapters::native::KeychainStore;
    use voiceid_engine::adapters::native::browser_host::{CommandCapture, run as serve};
    use voiceid_engine::adapters::native::local_host::{
        CollectionPurpose, LocalClock, LocalModels, collect_utterance, enroll_captures,
    };
    use voiceid_engine::adapters::{AdapterError, AudioCapture, CaptureEvent, TemplateStore};
    use voiceid_engine::domain::{
        AudioFormat, AudioFrame, CaptureReady, CaptureTime, FrameStamp, InputError, ProfileId,
    };
    use voiceid_engine::enrollment::EnrollmentState;
    use voiceid_engine::runtime::{Clock, WorkContext};
    use voiceid_engine::utterance::SpeechWindow;

    struct SyntheticCommand(PathBuf);
    impl CommandCapture for SyntheticCommand {
        fn collect(
            &mut self,
            clock: &LocalClock,
            work: &WorkContext<'_>,
            on_started: &mut dyn FnMut() -> Result<(), AdapterError>,
        ) -> Result<SpeechWindow, AdapterError> {
            let samples = read_pcm(&self.0).map_err(invalid_fixture)?;
            let mut capture = Replay::new(samples, clock);
            on_started()?;
            collect_utterance(&mut capture, CollectionPurpose::Command, work)
        }
    }

    struct Replay {
        ready: CaptureReady<AudioFormat>,
        start: CaptureTime,
        samples: Vec<f32>,
        offset: usize,
    }
    impl Replay {
        fn new(samples: Vec<f32>, clock: &LocalClock) -> Self {
            Self {
                ready: clock.capture_ready(ProfileId([17; 32])),
                start: clock.now(),
                samples,
                offset: 0,
            }
        }
    }
    impl AudioCapture for Replay {
        fn ready(&self) -> &CaptureReady<AudioFormat> {
            &self.ready
        }
        fn next_frame(
            &mut self,
            work: &WorkContext<'_>,
        ) -> Result<CaptureEvent<AudioFrame>, AdapterError> {
            work.check().map_err(AdapterError::Work)?;
            if self.offset + 160 > self.samples.len() {
                return Ok(CaptureEvent::Ended);
            }
            let captured_at = CaptureTime {
                session: self.start.session,
                elapsed: self.start.elapsed + Duration::from_nanos(self.offset as u64 * 62_500),
            };
            let end = captured_at.elapsed + Duration::from_millis(10);
            while work.clock.now().elapsed < end {
                work.check().map_err(AdapterError::Work)?;
                std::thread::sleep(Duration::from_millis(5));
            }
            let samples = self.samples[self.offset..self.offset + 160].to_vec();
            let sequence = self.offset as u64 / 160;
            self.offset += 160;
            AudioFrame::new(
                &self.ready,
                FrameStamp {
                    sequence,
                    captured_at,
                },
                samples,
                NonZeroUsize::new(160).unwrap(),
            )
            .map(CaptureEvent::Frame)
            .map_err(AdapterError::InvalidInput)
        }
    }

    pub fn run() -> Result<(), String> {
        let mut args = std::env::args().skip(1);
        let command = args.next().ok_or("expected init, serve, or delete")?;
        let models = PathBuf::from(args.next().ok_or("expected model metadata")?);
        let namespace = args.next().ok_or("expected disposable namespace")?;
        if !namespace.starts_with("com.seams.voiceid.browser-journey.") {
            return Err("journey only uses a disposable Keychain namespace".into());
        }
        match command.as_str() {
            "init" => {
                let media = PathBuf::from(args.next().ok_or("expected media directory")?);
                initialize(&models, &namespace, &media)
            }
            "serve" => {
                let fixture = PathBuf::from(args.next().ok_or("expected synthetic PCM")?);
                let origin = args.next().ok_or("expected Chrome extension origin")?;
                serve(&models, &namespace, &origin, &mut SyntheticCommand(fixture))
            }
            "delete" => cleanup(&namespace),
            _ => Err("expected init, serve, or delete".into()),
        }
    }

    fn initialize(models: &Path, namespace: &str, media: &Path) -> Result<(), String> {
        let clock = LocalClock::new().map_err(error_text)?;
        let work = clock.work_for(Duration::from_secs(60));
        let mut store = KeychainStore::open(namespace, &work).map_err(error_text)?;
        if !matches!(
            store.load(&work).map_err(error_text)?,
            EnrollmentState::Empty
        ) {
            return Err("disposable enrollment already exists".into());
        }
        let mut models = LocalModels::load(models, &work).map_err(error_text)?;
        let first = enrollment_sample(
            &mut models,
            &clock,
            &media.join("enroll-1.canonical.f32"),
            &work,
        )?;
        let second = enrollment_sample(
            &mut models,
            &clock,
            &media.join("enroll-2.canonical.f32"),
            &work,
        )?;
        let third = enrollment_sample(
            &mut models,
            &clock,
            &media.join("enroll-3.canonical.f32"),
            &work,
        )?;
        let record = enroll_captures(store.device(), [first, second, third]).map_err(error_text)?;
        store.create(&record, &work).map_err(error_text)
    }

    fn enrollment_sample(
        models: &mut LocalModels,
        clock: &LocalClock,
        path: &Path,
        work: &WorkContext<'_>,
    ) -> Result<voiceid_engine::adapters::native::SpeakerEmbedding, String> {
        let mut capture = Replay::new(read_pcm(path)?, clock);
        let window = collect_utterance(&mut capture, CollectionPurpose::Enrollment, work)
            .map_err(error_text)?;
        models.matcher.extract(&window, work).map_err(error_text)
    }

    fn cleanup(namespace: &str) -> Result<(), String> {
        let clock = LocalClock::new().map_err(error_text)?;
        let work = clock.work_for(Duration::from_secs(5));
        let mut store = KeychainStore::open(namespace, &work).map_err(error_text)?;
        if let EnrollmentState::Enrolled(record) = store.load(&work).map_err(error_text)? {
            store.delete(record.identity, &work).map_err(error_text)?;
        }
        store.destroy_empty(&work).map_err(error_text)
    }

    fn read_pcm(path: &Path) -> Result<Vec<f32>, String> {
        let metadata = fs::metadata(path).map_err(error_text)?;
        if metadata.len() == 0 || metadata.len() > 640_000 || metadata.len() % 640 != 0 {
            return Err("invalid bounded synthetic PCM fixture".into());
        }
        let bytes = fs::read(path).map_err(error_text)?;
        let mut samples = Vec::with_capacity(bytes.len() / 4);
        for bytes in bytes.chunks_exact(4) {
            let sample = f32::from_le_bytes(bytes.try_into().map_err(error_text)?);
            if !sample.is_finite() {
                return Err("invalid synthetic PCM sample".into());
            }
            samples.push(sample);
        }
        Ok(samples)
    }

    fn invalid_fixture(_error: String) -> AdapterError {
        AdapterError::InvalidInput(InputError::InvalidAudio)
    }
    fn error_text(error: impl std::fmt::Debug) -> String {
        format!("{error:?}")
    }
}
