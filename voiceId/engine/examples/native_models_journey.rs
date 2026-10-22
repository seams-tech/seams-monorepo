//! Real native model journey over consented local fixtures. No wallet or live capture is used.

#[cfg(target_family = "wasm")]
fn main() {}

#[cfg(not(target_family = "wasm"))]
fn main() -> Result<(), String> {
    native::run()
}

#[cfg(not(target_family = "wasm"))]
mod native {
    use std::cell::Cell;
    use std::collections::BTreeMap;
    use std::fs;
    use std::io::{Read, Seek, Write};
    use std::num::{NonZeroU16, NonZeroU32, NonZeroU64, NonZeroUsize};
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    use serde::{Deserialize, Serialize};
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use voiceid_engine::adapters::AdapterError;
    use voiceid_engine::adapters::native::{
        EcapaCalibration, EcapaMatcher, MoonshineLimits, MoonshineTranscriber, SpeakerEmbedding,
        VerifiedFile, VerifiedModelDirectory,
    };
    use voiceid_engine::attribution::{AttributionOutcome, SupportingGate};
    use voiceid_engine::domain::{
        AudioFormat, AudioFrame, CaptureReady, CaptureSessionId, CaptureTime, ClockMapping,
        DeviceId, EnrollmentId, EnrollmentRef, FailureReason, FrameStamp, InputError, ModelId,
        ProfileId,
    };
    use voiceid_engine::enrollment::{EnrollmentRecord, EnrollmentState, FaceEnrollment};
    use voiceid_engine::runtime::{
        AudioProfile, AudioRuntime, Cancellation, Clock, StopReason, WorkContext,
    };
    use voiceid_engine::utterance::{SpeechWindow, TranscriptOutcome, UtteranceId};

    const MAXIMUM_SAMPLES: usize = 480_000;
    const MAXIMUM_FILE_BYTES: u64 = 128 * 1024 * 1024;
    const MINIMUM_DIRECTION_AGREEMENT: f32 = 0.99999;
    const MAXIMUM_SCORE_DELTA: f32 = 0.001;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct JourneyInput {
        schema_version: String,
        model_directory: PathBuf,
        moonshine_library: FileInput,
        onnx_runtime_library: FileInput,
        speaker_model: FileInput,
        speaker_accept_similarity: f32,
        speaker_minimum_samples: usize,
        speaker_minimum_rms: f32,
        speaker_template: Vec<f32>,
        model_manifest_sha256: String,
        exporter_sha256: String,
        source_ecapa_tree_sha256: String,
        packages: BTreeMap<String, String>,
        cases: Vec<Fixture>,
    }

    #[derive(Deserialize)]
    struct FileInput {
        path: PathBuf,
        sha256: [u8; 32],
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixture {
        id: String,
        source_fixture_id: String,
        case_kind: CaseKind,
        relation: String,
        pcm: FileInput,
        sample_count: usize,
        reference_embedding: Vec<f32>,
        reference_transcript_sha256: [u8; 32],
    }

    #[derive(Clone, Copy, Deserialize, Serialize)]
    #[serde(rename_all = "snake_case")]
    enum CaseKind {
        Recording,
        BoundaryPrefix,
    }

    struct ReplayClock {
        origin: Instant,
        audio_offset: Cell<Duration>,
        session: Cell<CaptureSessionId>,
        cancelled: Cell<bool>,
    }

    impl ReplayClock {
        fn new() -> Self {
            Self {
                origin: Instant::now(),
                audio_offset: Cell::new(Duration::ZERO),
                session: Cell::new(CaptureSessionId([1; 16])),
                cancelled: Cell::new(false),
            }
        }

        fn work(&self) -> WorkContext<'_> {
            let now = self.now();
            WorkContext {
                deadline: CaptureTime {
                    session: now.session,
                    elapsed: now.elapsed + Duration::from_secs(180),
                },
                clock: self,
                cancellation: self,
            }
        }

        fn admit_audio_through(&self, end: CaptureTime) {
            let now = self.now();
            if end.elapsed > now.elapsed {
                self.audio_offset
                    .set(self.audio_offset.get() + end.elapsed - now.elapsed);
            }
        }
    }

    impl Clock for ReplayClock {
        fn now(&self) -> CaptureTime {
            CaptureTime {
                session: self.session.get(),
                elapsed: self.origin.elapsed() + self.audio_offset.get(),
            }
        }
    }

    impl Cancellation for ReplayClock {
        fn is_cancelled(&self) -> bool {
            self.cancelled.get()
        }
    }

    type NativeRuntime = AudioRuntime<MoonshineTranscriber, EcapaMatcher>;

    struct CaseOutcome {
        transcript_matches: bool,
        attribution: &'static str,
        decoder_start_ms: f64,
        partial_work_ms: f64,
        finish_ms: f64,
    }

    pub fn run() -> Result<(), String> {
        let mut arguments = std::env::args_os().skip(1);
        let input_path = PathBuf::from(
            arguments
                .next()
                .ok_or("native journey requires an input JSON path")?,
        );
        let output_path = PathBuf::from(
            arguments
                .next()
                .ok_or("native journey requires an output JSON path")?,
        );
        if arguments.next().is_some() {
            return Err("unexpected native journey arguments".into());
        }
        if input_path == output_path {
            return Err("input and output paths must differ".into());
        }
        let result = run_journey(&input_path, &output_path);
        if let Err(error) = &result {
            write_report(
                &output_path,
                &json!({
                    "schemaVersion": "voiceid_native_models_journey_v1",
                    "status": "failed", "error": error,
                }),
            )?;
        }
        result
    }

    fn run_journey(input_path: &Path, output_path: &Path) -> Result<(), String> {
        if output_path.exists() {
            fs::remove_file(output_path).map_err(error_text)?;
        }
        let file = fs::File::open(input_path).map_err(error_text)?;
        let mut input_bytes = Vec::new();
        file.take(1_048_577)
            .read_to_end(&mut input_bytes)
            .map_err(error_text)?;
        if input_bytes.len() > 1_048_576 {
            return Err("native journey input exceeds its bound".into());
        }
        let input: JourneyInput = serde_json::from_slice(&input_bytes).map_err(error_text)?;
        if input.schema_version != "voiceid_native_journey_input_v1"
            || input.cases.is_empty()
            || input.cases.len() > 128
        {
            return Err("unsupported native journey input".into());
        }
        let clock = ReplayClock::new();
        let work = clock.work();
        let started = Instant::now();
        let model = VerifiedModelDirectory::moonshine_tiny(&input.model_directory, &work)
            .map_err(adapter_error)?;
        let native_library = verify(&input.moonshine_library, &work)?;
        let runtime_library = verify(&input.onnx_runtime_library, &work)?;
        let transcriber = MoonshineTranscriber::load(
            native_library,
            verify(&input.onnx_runtime_library, &work)?,
            model,
            MoonshineLimits {
                maximum_samples: limit(MAXIMUM_SAMPLES)?,
                maximum_text_bytes: limit(4096)?,
                maximum_lines: limit(32)?,
            },
            &work,
        )
        .map_err(adapter_error)?;
        let transcription_model = transcriber.model_id();
        let speaker_id = ModelId(input.speaker_model.sha256);
        let calibration = EcapaCalibration::new(
            speaker_id,
            input.speaker_accept_similarity,
            limit(input.speaker_minimum_samples)?,
            limit(MAXIMUM_SAMPLES)?,
            input.speaker_minimum_rms,
        )
        .map_err(adapter_error)?;
        let mut comparison_matcher = EcapaMatcher::load(
            &runtime_library,
            verify(&input.speaker_model, &work)?,
            calibration,
            &work,
        )
        .map_err(adapter_error)?;
        let runtime_matcher = EcapaMatcher::load(
            &runtime_library,
            verify(&input.speaker_model, &work)?,
            calibration,
            &work,
        )
        .map_err(adapter_error)?;
        let profile = audio_profile(transcription_model, calibration.gate())?;
        let mut runtime = AudioRuntime::new(
            ready(clock.session.get()),
            profile,
            EnrollmentState::Enrolled(reference_enrollment(&input.speaker_template, speaker_id)?),
            transcriber,
            runtime_matcher,
        )
        .map_err(adapter_error)?;
        let startup_ms = elapsed_ms(started);
        let mut cases = Vec::new();
        let mut recording_count = 0;
        let mut boundary_case_count = 0;
        let template = SpeakerEmbedding::from_values(speaker_id, &input.speaker_template)
            .map_err(adapter_error)?;
        for fixture in &input.cases {
            let samples = load_samples(fixture, &clock.work())?;
            let full_window = full_window(&samples, &clock)?;
            clock.admit_audio_through(full_window.source().captured().end());
            let started = Instant::now();
            let actual = comparison_matcher
                .extract(&full_window, &clock.work())
                .map_err(adapter_error)?;
            let speaker_ms = elapsed_ms(started);
            let expected = SpeakerEmbedding::from_values(speaker_id, &fixture.reference_embedding)
                .map_err(adapter_error)?;
            let agreement = actual.similarity(&expected).map_err(adapter_error)?;
            let native_score = actual.similarity(&template).map_err(adapter_error)?;
            let reference_score = expected.similarity(&template).map_err(adapter_error)?;
            let score_delta = (native_score - reference_score).abs();
            require(
                agreement >= MINIMUM_DIRECTION_AGREEMENT,
                "native embedding differs from Python reference",
            )?;
            require(
                score_delta <= MAXIMUM_SCORE_DELTA,
                "native speaker score differs from Python reference",
            )?;
            let outcome = run_case(&mut runtime, fixture, &samples, &clock)?;
            require(
                outcome.transcript_matches,
                "native transcript differs from Python streaming reference",
            )?;
            let sufficient = samples.len() >= input.speaker_minimum_samples
                && rms(&samples) >= f64::from(input.speaker_minimum_rms);
            let empty_transcript: [u8; 32] = Sha256::digest(b"").into();
            let expected_attribution =
                if !sufficient || fixture.reference_transcript_sha256 == empty_transcript {
                    "insufficient"
                } else if reference_score >= input.speaker_accept_similarity {
                    "attributed"
                } else {
                    "rejected"
                };
            require(
                outcome.attribution == expected_attribution,
                "native attribution differs from reference gate",
            )?;
            cases.push(json!({
                "fixtureId": fixture.id, "relation": fixture.relation,
                "sourceFixtureId": fixture.source_fixture_id, "caseKind": fixture.case_kind,
                "samples": samples.len(), "embeddingDirectionCosine": agreement,
                "speakerScoreDelta": score_delta, "transcriptMatches": outcome.transcript_matches,
                "attribution": outcome.attribution, "speakerMs": speaker_ms,
                "decoderStartMs": outcome.decoder_start_ms, "partialWorkMs": outcome.partial_work_ms,
                "finishMs": outcome.finish_ms,
            }));
            match fixture.case_kind {
                CaseKind::Recording => recording_count += 1,
                CaseKind::BoundaryPrefix => boundary_case_count += 1,
            }
            println!("verified native fixture {}", fixture.id);
        }
        let fixture = owner_fixture(&input.cases)?;
        let samples = load_samples(fixture, &clock.work())?;
        let first_id = runtime.begin(&clock.work()).map_err(adapter_error)?;
        push_chunk(
            &mut runtime,
            first_id,
            &samples[..1600],
            0,
            clock.now(),
            &clock,
        )?;
        runtime.cancel(first_id).map_err(adapter_error)?;
        let recovered = run_case(&mut runtime, fixture, &samples, &clock)?;
        require(
            recovered.transcript_matches,
            "native decoder did not recover after cancellation",
        )?;
        let old_id = runtime.begin(&clock.work()).map_err(adapter_error)?;
        runtime.stop(StopReason::Closed);
        clock.session.set(CaptureSessionId([2; 16]));
        runtime
            .restart(ready(clock.session.get()))
            .map_err(adapter_error)?;
        let current_id = runtime.begin(&clock.work()).map_err(adapter_error)?;
        require(
            runtime.finish(old_id, &clock.work())
                == Err(AdapterError::InvalidInput(InputError::UtteranceMismatch)),
            "old epoch reached native finalization",
        )?;
        runtime.cancel(current_id).map_err(adapter_error)?;
        let restarted = run_case(&mut runtime, fixture, &samples, &clock)?;
        require(
            restarted.transcript_matches,
            "native decoder did not recover after restart",
        )?;
        let corruption_rejected =
            reject_modified_model(&input.speaker_model, output_path, &clock.work())?;
        require(corruption_rejected, "modified native model was accepted")?;
        let report = json!({
            "schemaVersion": "voiceid_native_models_journey_v1",
            "status": "passed",
            "capture": "accelerated_timestamped_fixture_replay",
            "pcmNormalization": "finite_pcm_peak_scaled_only_when_peak_exceeds_one",
            "models": "real_native_moonshine_and_ecapa_onnx",
            "walletSigning": false, "populationAccuracyQualified": false,
            "gateScope": "fixture_development_only",
            "enrollmentSource": "python_reference_mean_of_three_owner_enrollment_captures",
            "packages": input.packages, "modelManifestSha256": input.model_manifest_sha256,
            "exporterSha256": input.exporter_sha256, "sourceEcapaTreeSha256": input.source_ecapa_tree_sha256,
            "moonshineLibrarySha256": input.moonshine_library.sha256,
            "onnxRuntimeLibrarySha256": input.onnx_runtime_library.sha256,
            "speakerModelSha256": input.speaker_model.sha256,
            "transcriptionModelSha256": transcription_model.0,
            "speakerCalibrationSha256": calibration.gate().calibration.0,
            "minimumDirectionAgreement": MINIMUM_DIRECTION_AGREEMENT,
            "maximumSpeakerScoreDelta": MAXIMUM_SCORE_DELTA,
            "startupMs": startup_ms, "caseCount": cases.len(),
            "recordingCount": recording_count, "boundaryCaseCount": boundary_case_count,
            "cases": cases,
            "cancelRecovery": true, "restartRecovery": true, "oldEpochRejected": true,
            "modifiedModelRejected": corruption_rejected,
        });
        write_report(output_path, &report)?;
        println!("Native journey evidence: {}", output_path.display());
        Ok(())
    }

    fn write_report(output_path: &Path, report: &serde_json::Value) -> Result<(), String> {
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(error_text)?;
        }
        fs::write(
            output_path,
            serde_json::to_vec_pretty(report).map_err(error_text)?,
        )
        .map_err(error_text)
    }

    fn run_case(
        runtime: &mut NativeRuntime,
        fixture: &Fixture,
        samples: &[f32],
        clock: &ReplayClock,
    ) -> Result<CaseOutcome, String> {
        let started = Instant::now();
        let id = runtime.begin(&clock.work()).map_err(adapter_error)?;
        let decoder_start_ms = elapsed_ms(started);
        let captured_at = clock.now();
        let mut partial_work_ms = 0.0;
        for (sequence, chunk) in samples.chunks(1600).enumerate() {
            let captured_at = CaptureTime {
                session: id.session,
                elapsed: captured_at.elapsed + sample_duration(sequence * 1600),
            };
            let started = Instant::now();
            push_chunk(runtime, id, chunk, sequence as u64, captured_at, clock)?;
            partial_work_ms += elapsed_ms(started);
        }
        let started = Instant::now();
        runtime.finish(id, &clock.work()).map_err(adapter_error)?;
        let finish_ms = elapsed_ms(started);
        let result = runtime
            .take_result(id, &clock.work())
            .map_err(adapter_error)?;
        let transcript = match result.transcript() {
            TranscriptOutcome::Speech(text) => canonical_transcript(text.text()),
            TranscriptOutcome::NoSpeech(_) => String::new(),
        };
        let transcript_digest: [u8; 32] = Sha256::digest(transcript.as_bytes()).into();
        let attribution = match result.attribution() {
            AttributionOutcome::Attributed(_) => "attributed",
            AttributionOutcome::Rejected { .. } => "rejected",
            AttributionOutcome::Insufficient { .. } => "insufficient",
            AttributionOutcome::Ambiguous { .. } => "ambiguous",
        };
        Ok(CaseOutcome {
            transcript_matches: transcript_digest == fixture.reference_transcript_sha256,
            attribution,
            decoder_start_ms,
            partial_work_ms,
            finish_ms,
        })
    }

    fn push_chunk(
        runtime: &mut NativeRuntime,
        id: UtteranceId,
        samples: &[f32],
        sequence: u64,
        captured_at: CaptureTime,
        clock: &ReplayClock,
    ) -> Result<(), String> {
        let frame = AudioFrame::new(
            &ready(id.session),
            FrameStamp {
                sequence,
                captured_at,
            },
            samples.to_vec(),
            limit(1600)?,
        )
        .map_err(input_error)?;
        clock.admit_audio_through(frame.span().end());
        runtime
            .push(id, frame, &clock.work())
            .map_err(adapter_error)?;
        Ok(())
    }

    fn full_window(samples: &[f32], clock: &ReplayClock) -> Result<SpeechWindow, String> {
        let captured_at = clock.now();
        let audio = AudioFrame::new(
            &ready(captured_at.session),
            FrameStamp {
                sequence: 0,
                captured_at,
            },
            samples.to_vec(),
            limit(MAXIMUM_SAMPLES)?,
        )
        .map_err(input_error)?;
        SpeechWindow::new(
            UtteranceId {
                session: captured_at.session,
                sequence: 0,
            },
            audio,
            Duration::from_secs(30),
        )
        .map_err(input_error)
    }

    fn load_samples(fixture: &Fixture, work: &WorkContext<'_>) -> Result<Vec<f32>, String> {
        require(
            (1..=MAXIMUM_SAMPLES).contains(&fixture.sample_count),
            "fixture sample count exceeds its bound",
        )?;
        let file = VerifiedFile::read(
            &fixture.pcm.path,
            fixture.pcm.sha256,
            (MAXIMUM_SAMPLES * size_of::<f32>()) as u64,
            work,
        )
        .map_err(adapter_error)?;
        require(
            file.bytes().len() == fixture.sample_count * size_of::<f32>(),
            "fixture sample count mismatch",
        )?;
        let mut samples = Vec::with_capacity(fixture.sample_count);
        for bytes in file.bytes().chunks_exact(size_of::<f32>()) {
            let encoded: [u8; 4] = bytes.try_into().map_err(error_text)?;
            samples.push(f32::from_le_bytes(encoded));
        }
        Ok(samples)
    }

    fn reference_enrollment(values: &[f32], model: ModelId) -> Result<EnrollmentRecord, String> {
        let voice = SpeakerEmbedding::from_values(model, values)
            .map_err(adapter_error)?
            .into_voice_template()
            .map_err(adapter_error)?;
        Ok(EnrollmentRecord {
            identity: EnrollmentRef {
                id: EnrollmentId([4; 16]),
                version: NonZeroU64::MIN,
            },
            device: DeviceId([5; 16]),
            voice,
            face: FaceEnrollment::Disabled,
        })
    }

    fn audio_profile(
        transcription_model: ModelId,
        speaker: SupportingGate,
    ) -> Result<AudioProfile, String> {
        let mut identity = Sha256::new();
        identity.update(b"voiceid-native-models-journey-profile-v1\0");
        identity.update(transcription_model.0);
        identity.update(speaker.calibration.0);
        Ok(AudioProfile {
            id: ProfileId(identity.finalize().into()),
            transcription_model,
            speaker,
            maximum_samples: limit(MAXIMUM_SAMPLES)?,
            maximum_duration: Duration::from_secs(30),
            maximum_text_bytes: limit(4096)?,
            maximum_evidence_age: Duration::from_secs(120),
        })
    }

    fn ready(session: CaptureSessionId) -> CaptureReady<AudioFormat> {
        CaptureReady {
            profile: ProfileId([3; 32]),
            format: AudioFormat {
                sample_rate_hz: NonZeroU32::new(16000).unwrap(),
                channels: NonZeroU16::MIN,
            },
            clock: ClockMapping {
                source_origin: Duration::ZERO,
                local_origin: CaptureTime {
                    session,
                    elapsed: Duration::ZERO,
                },
                maximum_error: Duration::ZERO,
            },
        }
    }

    fn owner_fixture(fixtures: &[Fixture]) -> Result<&Fixture, String> {
        for fixture in fixtures {
            if fixture.relation == "owner_verification" {
                return Ok(fixture);
            }
        }
        Err("native journey requires an owner verification fixture".into())
    }

    fn reject_modified_model(
        model: &FileInput,
        output: &Path,
        work: &WorkContext<'_>,
    ) -> Result<bool, String> {
        let temporary = output.with_extension("modified-model.onnx");
        if let Some(parent) = temporary.parent() {
            fs::create_dir_all(parent).map_err(error_text)?;
        }
        fs::copy(&model.path, &temporary).map_err(error_text)?;
        let mut file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&temporary)
            .map_err(error_text)?;
        let mut byte = [0];
        file.read_exact(&mut byte).map_err(error_text)?;
        byte[0] ^= 0xff;
        file.rewind().map_err(error_text)?;
        file.write_all(&byte).map_err(error_text)?;
        drop(file);
        let rejected = VerifiedFile::read(&temporary, model.sha256, MAXIMUM_FILE_BYTES, work).err()
            == Some(AdapterError::Failed(FailureReason::InvalidOutput));
        fs::remove_file(&temporary).map_err(error_text)?;
        Ok(rejected)
    }

    fn canonical_transcript(text: &str) -> String {
        let mut canonical = String::new();
        for character in text.chars() {
            if character.is_ascii_alphanumeric() {
                canonical.push(character.to_ascii_lowercase());
            } else if !canonical.is_empty() && !canonical.ends_with(' ') {
                canonical.push(' ');
            }
        }
        if canonical.ends_with(' ') {
            canonical.pop();
        }
        canonical
    }

    fn rms(samples: &[f32]) -> f64 {
        let mut sum = 0.0;
        for sample in samples {
            sum += f64::from(*sample).powi(2);
        }
        (sum / samples.len() as f64).sqrt()
    }

    fn verify(input: &FileInput, work: &WorkContext<'_>) -> Result<VerifiedFile, String> {
        VerifiedFile::read(&input.path, input.sha256, MAXIMUM_FILE_BYTES, work)
            .map_err(adapter_error)
    }
    fn sample_duration(samples: usize) -> Duration {
        Duration::from_nanos(samples as u64 * 62_500)
    }
    fn elapsed_ms(started: Instant) -> f64 {
        started.elapsed().as_secs_f64() * 1000.0
    }
    fn limit(value: usize) -> Result<NonZeroUsize, String> {
        NonZeroUsize::new(value).ok_or("resource bound must be nonzero".into())
    }
    fn adapter_error(error: AdapterError) -> String {
        format!("native adapter: {error:?}")
    }
    fn input_error(error: InputError) -> String {
        adapter_error(AdapterError::InvalidInput(error))
    }
    fn error_text<E: std::fmt::Display>(error: E) -> String {
        error.to_string()
    }
    fn require(condition: bool, message: &str) -> Result<(), String> {
        if condition {
            Ok(())
        } else {
            Err(message.into())
        }
    }
}
