//! macOS local-host journey with real models, synthetic speech, and a disposable Keychain namespace.

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("local_host_journey requires macOS");
    std::process::exit(1);
}

#[cfg(target_os = "macos")]
fn main() -> Result<(), String> {
    journey::run()
}

#[cfg(target_os = "macos")]
mod journey {
    use std::cell::Cell;
    use std::collections::VecDeque;
    use std::fs;
    use std::num::{NonZeroU16, NonZeroU32, NonZeroU64};
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::{Duration, Instant};

    use serde_json::json;
    use sha2::{Digest, Sha256};
    use voiceid_engine::adapters::native::local_host::{
        CollectionPurpose, LocalClock, LocalModels, SpokenCommand, collect_utterance,
        enroll_captures, finish_capture, spoken_command,
    };
    use voiceid_engine::adapters::native::{
        CaptureNormalizer, EcapaMatcher, KeychainStore, SpeakerEmbedding,
    };
    use voiceid_engine::adapters::{
        AdapterError, AudioCapture, CaptureEvent, StoreError, TemplateStore,
    };
    use voiceid_engine::attribution::AttributionOutcome;
    use voiceid_engine::domain::{
        AudioFormat, AudioFrame, CaptureReady, CaptureTime, Discontinuity, InputError, ProfileId,
    };
    use voiceid_engine::enrollment::{EnrollmentRecord, EnrollmentReplacement, EnrollmentState};
    use voiceid_engine::runtime::{
        AudioRuntime, Cancellation, Clock, StopReason, WorkContext, WorkError,
    };
    use voiceid_engine::utterance::TranscriptOutcome;

    const PROMPTS: [&str; 3] = [
        "I am setting up voice approval on this device. Check my voice before each operation.",
        "I will review every operation before I approve it. I can always cancel a pending request.",
        "This is my third enrollment sample. Keep my voice template on this device and check each request.",
    ];

    struct ReplayClock {
        clock: LocalClock,
        origin: Instant,
        offset: Cell<Duration>,
    }
    impl ReplayClock {
        fn new() -> Result<Self, String> {
            Ok(Self {
                clock: LocalClock::new().map_err(adapter_error)?,
                origin: Instant::now(),
                offset: Cell::new(Duration::ZERO),
            })
        }
        fn work(&self) -> WorkContext<'_> {
            WorkContext {
                deadline: CaptureTime {
                    session: self.now().session,
                    elapsed: self.now().elapsed + Duration::from_secs(60),
                },
                clock: self,
                cancellation: self,
            }
        }
        fn advance_to(&self, time: CaptureTime) {
            let now = self.now();
            if time.elapsed > now.elapsed {
                self.offset
                    .set(self.offset.get() + time.elapsed - now.elapsed);
            }
        }
        fn ready(&self) -> CaptureReady<AudioFormat> {
            self.clock.capture_ready(ProfileId(
                Sha256::digest(b"voiceid-local-host-replay-v1").into(),
            ))
        }
    }
    impl Clock for ReplayClock {
        fn now(&self) -> CaptureTime {
            CaptureTime {
                session: self.clock.now().session,
                elapsed: self.origin.elapsed() + self.offset.get(),
            }
        }
    }
    impl Cancellation for ReplayClock {
        fn is_cancelled(&self) -> bool {
            false
        }
    }

    struct ReplayCapture<'a> {
        ready: CaptureReady<AudioFormat>,
        frames: VecDeque<AudioFrame>,
        clock: &'a ReplayClock,
    }
    impl<'a> ReplayCapture<'a> {
        fn new(samples: &[f32], rate: u32, clock: &'a ReplayClock) -> Result<Self, String> {
            let ready = clock.ready();
            let source = source_format(rate);
            let mut normalizer = CaptureNormalizer::new(ready, source).map_err(adapter_error)?;
            let mut frames = VecDeque::new();
            let start = clock.now();
            for (sequence, chunk) in samples.chunks(rate as usize / 100).enumerate() {
                let timestamp = CaptureTime {
                    session: start.session,
                    elapsed: start.elapsed + Duration::from_millis(sequence as u64 * 10),
                };
                frames.extend(normalizer.push(chunk, timestamp).map_err(adapter_error)?);
            }
            Ok(Self {
                ready,
                frames,
                clock,
            })
        }
    }
    impl AudioCapture for ReplayCapture<'_> {
        fn ready(&self) -> &CaptureReady<AudioFormat> {
            &self.ready
        }
        fn next_frame(
            &mut self,
            work: &WorkContext<'_>,
        ) -> Result<CaptureEvent<AudioFrame>, AdapterError> {
            work.check().map_err(AdapterError::Work)?;
            match self.frames.pop_front() {
                Some(frame) => {
                    self.clock.advance_to(frame.span().end());
                    Ok(CaptureEvent::Frame(frame))
                }
                None => Ok(CaptureEvent::Ended),
            }
        }
    }

    pub fn run() -> Result<(), String> {
        if std::env::args().nth(1).as_deref() == Some("probe-store") {
            let service = std::env::args().nth(2).ok_or("probe requires namespace")?;
            let clock = LocalClock::new().map_err(adapter_error)?;
            match KeychainStore::open(&service, &clock.work_for(Duration::from_secs(5))) {
                Err(StoreError::Conflict) => std::process::exit(42),
                Ok(_) => return Err("namespace unexpectedly admitted a concurrent owner".into()),
                Err(error) => return Err(store_error(error)),
            }
        }
        let mut arguments = std::env::args_os().skip(1);
        let models = PathBuf::from(
            arguments
                .next()
                .ok_or("required: native-inputs.json evidence.json")?,
        );
        let output = PathBuf::from(
            arguments
                .next()
                .ok_or("required: native-inputs.json evidence.json")?,
        );
        if arguments.next().is_some() || models == output {
            return Err("invalid journey paths".into());
        }
        let clock = ReplayClock::new()?;
        let service = format!(
            "com.seams.voiceid.journey.{:x}",
            u128::from_le_bytes(clock.now().session.0)
        );
        let mut evidence = Vec::new();
        let result = run_with_cleanup(&models, &output, &service, &clock, &mut evidence);
        let report = match &result {
            Ok(report) => report.clone(),
            Err(error) => {
                json!({"schemaVersion":"voiceid_local_host_journey_v1", "status":"failed", "error":error, "keychainNamespace":service, "cases":evidence})
            }
        };
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(error_text)?;
        }
        fs::write(
            &output,
            serde_json::to_vec_pretty(&report).map_err(error_text)?,
        )
        .map_err(error_text)?;
        result?;
        println!("Local host journey evidence: {}", output.display());
        Ok(())
    }

    fn run_with_cleanup(
        models: &Path,
        output: &Path,
        service: &str,
        clock: &ReplayClock,
        evidence: &mut Vec<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let mut store = KeychainStore::open(service, &clock.work()).map_err(store_error)?;
        let result = run_journey(models, output, &mut store, service, clock, evidence);
        if let EnrollmentState::Enrolled(record) = store.load(&clock.work()).map_err(store_error)? {
            store
                .delete(record.identity, &clock.work())
                .map_err(store_error)?;
        }
        store.destroy_empty(&clock.work()).map_err(store_error)?;
        evidence
            .push(json!({"case":"keychain-cleanup", "outcome":"owner_and_device_items_deleted"}));
        result
    }

    fn run_journey(
        models_path: &Path,
        output: &Path,
        store: &mut KeychainStore,
        service: &str,
        clock: &ReplayClock,
        evidence: &mut Vec<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let media = output.with_extension("media");
        fs::create_dir_all(&media).map_err(error_text)?;
        let mut models = LocalModels::load(models_path, &clock.work()).map_err(adapter_error)?;
        let first = enrollment_sample(
            "enroll-1",
            PROMPTS[0],
            &media,
            &mut models.matcher,
            clock,
            evidence,
        )?;
        let second = enrollment_sample(
            "enroll-2",
            PROMPTS[1],
            &media,
            &mut models.matcher,
            clock,
            evidence,
        )?;
        let third = enrollment_sample(
            "enroll-3",
            PROMPTS[2],
            &media,
            &mut models.matcher,
            clock,
            evidence,
        )?;
        let record =
            enroll_captures(store.device(), [first, second, third]).map_err(adapter_error)?;
        let original = record.identity;
        store.create(&record, &clock.work()).map_err(store_error)?;
        require(
            store.create(&record, &clock.work()) == Err(StoreError::Conflict),
            "duplicate setup overwrote enrollment",
        )?;
        let probe = Command::new(std::env::current_exe().map_err(error_text)?)
            .args(["probe-store", service])
            .status()
            .map_err(error_text)?;
        require(
            probe.code() == Some(42),
            "concurrent host bypassed namespace lease",
        )?;
        let stored = require_enrollment(store.load(&clock.work()).map_err(store_error)?)?;
        require(
            stored.identity == original && stored.device == store.device(),
            "durable enrollment identity changed",
        )?;

        let owner = enrollment_sample(
            "mixed-owner",
            PROMPTS[0],
            &media,
            &mut models.matcher,
            clock,
            evidence,
        )?;
        let other_samples = synthesize("mixed-other", "Daniel", PROMPTS[1], 48000, &media)?;
        let mut other_capture = ReplayCapture::new(&other_samples, 48000, clock)?;
        let other_window = collect_utterance(
            &mut other_capture,
            CollectionPurpose::Enrollment,
            &clock.work(),
        )
        .map_err(adapter_error)?;
        let other = models
            .matcher
            .extract(&other_window, &clock.work())
            .map_err(adapter_error)?;
        let owner_again = enrollment_sample(
            "mixed-owner-again",
            PROMPTS[2],
            &media,
            &mut models.matcher,
            clock,
            evidence,
        )?;
        require(
            matches!(
                enroll_captures(store.device(), [owner, other, owner_again]),
                Err(AdapterError::InvalidInput(InputError::InvalidReplacement))
            ),
            "mixed-speaker enrollment was accepted",
        )?;

        let ready = clock.ready();
        let profile = models.profile;
        let mut runtime = AudioRuntime::new(
            ready,
            profile,
            EnrollmentState::Enrolled(stored),
            models.transcriber,
            models.matcher,
        )
        .map_err(adapter_error)?;
        for (name, text, rate, expected) in [
            (
                "approve-48k",
                "I approve this operation.",
                48000,
                SpokenCommand::Approve,
            ),
            (
                "cancel-44k1",
                "I cancel this operation.",
                44100,
                SpokenCommand::Cancel,
            ),
            (
                "extra-words",
                "I approve this operation and then cancel it.",
                16000,
                SpokenCommand::Unrecognized,
            ),
        ] {
            let id = runtime.begin(&clock.work()).map_err(adapter_error)?;
            let samples = synthesize(name, "Samantha", text, rate, &media)?;
            let mut capture = ReplayCapture::new(&samples, rate, clock)?;
            let window = collect_utterance(&mut capture, CollectionPurpose::Command, &clock.work())
                .map_err(adapter_error)?;
            finish_capture(&mut runtime, id, &ready, &window, &clock.work())
                .map_err(adapter_error)?;
            let result = runtime
                .take_result(id, &clock.work())
                .map_err(adapter_error)?;
            require(
                matches!(result.attribution(), AttributionOutcome::Attributed(_)),
                "enrolled command speaker did not match",
            )?;
            let TranscriptOutcome::Speech(transcript) = result.transcript() else {
                return Err("command transcription returned no speech".into());
            };
            let actual = spoken_command(transcript);
            require(
                actual == expected,
                &format!("command mismatch for {name}: expected {expected:?}, received {actual:?}"),
            )?;
            require(
                runtime.take_result(id, &clock.work()).is_err(),
                "result was consumed twice",
            )?;
            evidence.push(json!({"case":name, "sourceRateHz":rate, "pcmSha256":pcm_digest(&samples), "command":format!("{actual:?}"), "speaker":"matched", "singleConsumption":true}));
        }
        let id = runtime.begin(&clock.work()).map_err(adapter_error)?;
        let samples = synthesize(
            "different-speaker",
            "Daniel",
            "I approve this operation.",
            48000,
            &media,
        )?;
        let mut capture = ReplayCapture::new(&samples, 48000, clock)?;
        let window = collect_utterance(&mut capture, CollectionPurpose::Command, &clock.work())
            .map_err(adapter_error)?;
        finish_capture(&mut runtime, id, &ready, &window, &clock.work()).map_err(adapter_error)?;
        let result = runtime
            .take_result(id, &clock.work())
            .map_err(adapter_error)?;
        require(
            matches!(result.attribution(), AttributionOutcome::Rejected { .. }),
            "different speaker was not rejected",
        )?;
        evidence.push(json!({"case":"different-speaker", "sourceRateHz":48000, "pcmSha256":pcm_digest(&samples), "speaker":"rejected"}));
        runtime.stop(StopReason::Closed);
        drop(runtime);

        let mut replacement = require_enrollment(store.load(&clock.work()).map_err(store_error)?)?;
        replacement.identity.version = NonZeroU64::new(original.version.get() + 1).unwrap();
        store
            .replace(
                EnrollmentReplacement::new(original, &replacement).map_err(error_debug)?,
                &clock.work(),
            )
            .map_err(store_error)?;
        require(
            store.replace(
                EnrollmentReplacement::new(original, &replacement).map_err(error_debug)?,
                &clock.work(),
            ) == Err(StoreError::Conflict),
            "stale replacement was accepted",
        )?;
        require(
            store.delete(original, &clock.work()) == Err(StoreError::Conflict),
            "stale deletion removed a newer template",
        )?;
        let expired = WorkContext {
            deadline: clock.now(),
            clock,
            cancellation: clock,
        };
        require(
            store.delete(replacement.identity, &expired)
                == Err(StoreError::Work(WorkError::DeadlineExceeded)),
            "expired mutation reached Keychain",
        )?;
        let cancelled = LocalClock::new().map_err(adapter_error)?;
        cancelled.cancel();
        require(
            store.delete(
                replacement.identity,
                &cancelled.work_for(Duration::from_secs(1)),
            ) == Err(StoreError::Work(WorkError::Cancelled)),
            "cancelled mutation reached Keychain",
        )?;
        store
            .delete(replacement.identity, &clock.work())
            .map_err(store_error)?;
        require(
            matches!(
                store.load(&clock.work()).map_err(store_error)?,
                EnrollmentState::Empty
            ),
            "deleted enrollment remained available",
        )?;
        verify_capture_failures(clock)?;

        Ok(json!({
            "schemaVersion":"voiceid_local_host_journey_v1", "status":"passed",
            "capture":"accelerated_synthetic_pcm_through_production_normalizer_and_collector",
            "liveMicrophoneQualified":false, "populationAccuracyQualified":false, "walletSigning":false,
            "models":"real_native_moonshine_and_ecapa_onnx", "store":"real_disposable_login_keychain_namespace",
            "ownerVoice":"macOS Samantha", "differentVoice":"macOS Daniel", "cases":evidence,
            "threeCaptureEnrollment":true, "mixedSpeakerEnrollmentRejected":true, "duplicateCreateRejected":true,
            "durableReload":true, "concurrentHostRejected":true, "advancingReplacement":true, "staleReplacementRejected":true,
            "staleDeleteRejected":true, "expiredMutationRejected":true, "cancelledMutationRejected":true,
            "deletedEnrollmentUnavailable":true, "captureGapRejected":true, "oversizedCallbackRejected":true,
            "keychainCleanup":true, "reportContainsMediaOrTemplates":false,
            "commandProfile":"first_person_exact_v1",
            "transcriptionModelSha256":profile.transcription_model.0,
            "speakerModelSha256":profile.speaker.model.0,
            "speakerCalibrationSha256":profile.speaker.calibration.0,
        }))
    }

    fn enrollment_sample(
        name: &str,
        text: &str,
        media: &Path,
        matcher: &mut EcapaMatcher,
        clock: &ReplayClock,
        evidence: &mut Vec<serde_json::Value>,
    ) -> Result<SpeakerEmbedding, String> {
        let samples = synthesize(name, "Samantha", text, 48000, media)?;
        let mut capture = ReplayCapture::new(&samples, 48000, clock)?;
        let window = collect_utterance(&mut capture, CollectionPurpose::Enrollment, &clock.work())
            .map_err(adapter_error)?;
        let embedding = matcher
            .extract(&window, &clock.work())
            .map_err(adapter_error)?;
        evidence.push(json!({"case":name, "sourceRateHz":48000, "pcmSha256":pcm_digest(&samples), "samples":window.audio().samples().len(), "outcome":"enrollment_capture_extracted"}));
        println!("verified enrollment capture {name}");
        Ok(embedding)
    }

    fn synthesize(
        name: &str,
        voice: &str,
        text: &str,
        rate: u32,
        directory: &Path,
    ) -> Result<Vec<f32>, String> {
        let audio = directory.join(name).with_extension("aiff");
        let status = Command::new("/usr/bin/say")
            .args(["-v", voice, "-r", "150", "-o"])
            .arg(&audio)
            .arg(text)
            .status()
            .map_err(error_text)?;
        require(status.success(), "macOS speech generation failed")?;
        let decoded = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(&audio)
            .args([
                "-ac",
                "1",
                "-ar",
                &rate.to_string(),
                "-f",
                "f32le",
                "pipe:1",
            ])
            .output()
            .map_err(error_text)?;
        require(
            decoded.status.success()
                && decoded.stdout.len() <= rate as usize * 10 * 4
                && decoded.stdout.len().is_multiple_of(4),
            "synthetic audio decode failed or exceeded its bound",
        )?;
        let mut samples = Vec::new();
        for bytes in decoded.stdout.chunks_exact(4) {
            samples.push(f32::from_le_bytes(bytes.try_into().map_err(error_text)?));
        }
        samples.resize(samples.len() + rate as usize, 0.0);
        Ok(samples)
    }

    fn verify_capture_failures(clock: &ReplayClock) -> Result<(), String> {
        let mut normalizer =
            CaptureNormalizer::new(clock.ready(), source_format(48000)).map_err(adapter_error)?;
        let start = clock.now();
        normalizer.push(&[0.0; 480], start).map_err(adapter_error)?;
        let gap = CaptureTime {
            session: start.session,
            elapsed: start.elapsed + Duration::from_millis(20),
        };
        require(
            matches!(
                normalizer.push(&[0.0; 480], gap),
                Err(AdapterError::Discontinuity(Discontinuity::ClockReset))
            ),
            "capture gap was accepted",
        )?;
        require(
            normalizer.push(&[0.0; 480], start).is_err(),
            "failed normalizer was reused",
        )?;
        let mut normalizer =
            CaptureNormalizer::new(clock.ready(), source_format(48000)).map_err(adapter_error)?;
        require(
            normalizer.push(&vec![0.0; 48000], start).is_err(),
            "oversized callback was accepted",
        )?;
        Ok(())
    }

    fn source_format(rate: u32) -> AudioFormat {
        AudioFormat {
            sample_rate_hz: NonZeroU32::new(rate).unwrap(),
            channels: NonZeroU16::MIN,
        }
    }
    fn pcm_digest(samples: &[f32]) -> Vec<u8> {
        let mut hash = Sha256::new();
        for sample in samples {
            hash.update(sample.to_le_bytes());
        }
        hash.finalize().to_vec()
    }
    fn require_enrollment(state: EnrollmentState) -> Result<EnrollmentRecord, String> {
        match state {
            EnrollmentState::Enrolled(record) => Ok(record),
            EnrollmentState::Empty => Err("expected durable enrollment".into()),
        }
    }
    fn require(condition: bool, message: &str) -> Result<(), String> {
        if condition {
            Ok(())
        } else {
            Err(message.into())
        }
    }
    fn error_debug<E: std::fmt::Debug>(error: E) -> String {
        format!("{error:?}")
    }
    fn adapter_error(error: AdapterError) -> String {
        error_debug(error)
    }
    fn store_error(error: StoreError) -> String {
        format!("Keychain: {error:?}")
    }
    fn error_text<E: std::fmt::Display>(error: E) -> String {
        error.to_string()
    }
}
