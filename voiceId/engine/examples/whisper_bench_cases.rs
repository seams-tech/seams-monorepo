//! Run speech-to-text bench cases through the native Whisper adapter.
//!
//! Usage: whisper_bench_cases <stt-bench-cache> <q8_0|q5_0> <case-set> [maximum-cases]
//! Reads `<cache>/cases.jsonl` and the model from `<cache>/ggml`. Writes
//! `<cache>/runs/<run>.jsonl` and `<run>.summary.json` for the bench scorer.

#[cfg(not(target_os = "macos"))]
fn main() {}

#[cfg(target_os = "macos")]
fn main() -> Result<(), String> {
    bench::run()
}

#[cfg(target_os = "macos")]
mod bench {
    use std::fs;
    use std::io::Write;
    use std::num::NonZeroUsize;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    use serde::Deserialize;
    use serde_json::json;
    use voiceid_engine::adapters::native::local_host::LocalClock;
    use voiceid_engine::adapters::native::{
        VoiceModel, WHISPER_LARGE_V3_TURBO_Q5_0, WHISPER_LARGE_V3_TURBO_Q8_0, WhisperLanguage,
        WhisperLimits, WhisperTranscriber,
    };
    use voiceid_engine::adapters::{AdapterError, Transcriber, TranscriptStream};
    use voiceid_engine::domain::{AudioFrame, CaptureTime, FrameStamp, ProfileId, TimeRange};
    use voiceid_engine::utterance::{SpeechWindow, TranscriptOutcome, UtteranceId, UtteranceSpan};

    const CHUNK_SAMPLES: usize = 1_600;
    const MAXIMUM_SAMPLES: usize = 480_000;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        set: String,
        language: String,
        case_id: String,
        path: PathBuf,
        seconds: f64,
    }

    pub fn run() -> Result<(), String> {
        let mut arguments = std::env::args().skip(1);
        let usage = "whisper_bench_cases <stt-bench-cache> <q8_0|q5_0> <case-set> [maximum-cases]";
        let cache = PathBuf::from(arguments.next().ok_or(usage)?);
        let model: &'static VoiceModel = match arguments.next().as_deref() {
            Some("q8_0") => &WHISPER_LARGE_V3_TURBO_Q8_0,
            Some("q5_0") => &WHISPER_LARGE_V3_TURBO_Q5_0,
            _ => return Err(usage.into()),
        };
        let set = arguments.next().ok_or(usage)?;
        let maximum_cases = match arguments.next() {
            Some(value) => value.parse().map_err(error_text)?,
            None => usize::MAX,
        };
        let cases: Vec<Case> = fs::read_to_string(cache.join("cases.jsonl"))
            .map_err(error_text)?
            .lines()
            .map(serde_json::from_str)
            .collect::<Result<Vec<Case>, _>>()
            .map_err(error_text)?
            .into_iter()
            .filter(|case| case.set == set)
            .take(maximum_cases)
            .collect();
        let language = match cases.first().map(|case| case.language.as_str()) {
            Some("en") => WhisperLanguage::English,
            Some("ja") => WhisperLanguage::Japanese,
            _ => return Err("no cases match".into()),
        };

        let clock = LocalClock::new().map_err(adapter_error)?;
        let ready = clock.capture_ready(ProfileId([7; 32]));
        let mut transcriber = WhisperTranscriber::new(
            model,
            &cache.join("ggml"),
            language,
            WhisperLimits {
                maximum_samples: limit(MAXIMUM_SAMPLES)?,
                maximum_text_bytes: limit(4096)?,
            },
        )
        .map_err(adapter_error)?;
        let started = Instant::now();
        transcriber
            .prepare(&clock.work_for(Duration::from_secs(120)))
            .map_err(adapter_error)?;
        let load_seconds = started.elapsed().as_secs_f64();

        let run_id = format!(
            "whisper-cpp-{}-{}",
            model.id.trim_start_matches("whisper-"),
            set
        );
        let runs = cache.join("runs");
        fs::create_dir_all(&runs).map_err(error_text)?;
        let mut output =
            fs::File::create(runs.join(format!("{run_id}.jsonl"))).map_err(error_text)?;
        let mut audio_seconds = 0.0;
        let mut compute_seconds = 0.0;
        let mut origin = Duration::ZERO;
        for (sequence, case) in cases.iter().enumerate() {
            let samples = read_wav(&cache.join(&case.path))?;
            let work = clock.work_for(Duration::from_secs(60));
            let id = UtteranceId {
                session: work.deadline.session,
                sequence: sequence as u64,
            };
            let began = Instant::now();
            let mut stream = transcriber.start(id, &work).map_err(adapter_error)?;
            let first = CaptureTime {
                session: id.session,
                elapsed: origin,
            };
            for (index, chunk) in samples.chunks(CHUNK_SAMPLES).enumerate() {
                let stamp = FrameStamp {
                    sequence: index as u64,
                    captured_at: CaptureTime {
                        session: id.session,
                        elapsed: origin + sample_duration(index * CHUNK_SAMPLES),
                    },
                };
                let frame = AudioFrame::new(&ready, stamp, chunk.to_vec(), limit(CHUNK_SAMPLES)?)
                    .map_err(|error| adapter_error(AdapterError::InvalidInput(error)))?;
                let window = SpeechWindow::new(id, frame, Duration::from_secs(1))
                    .map_err(|error| adapter_error(AdapterError::InvalidInput(error)))?;
                stream.push(&window, &work).map_err(adapter_error)?;
            }
            origin += sample_duration(samples.len());
            let end = CaptureTime {
                session: id.session,
                elapsed: origin,
            };
            let source = UtteranceSpan::new(
                id,
                TimeRange::new(first, end)
                    .map_err(|error| adapter_error(AdapterError::InvalidInput(error)))?,
            )
            .map_err(|error| adapter_error(AdapterError::InvalidInput(error)))?;
            let hypothesis = match stream.finish(source, &work).map_err(adapter_error)? {
                TranscriptOutcome::Speech(text) => text.text().to_owned(),
                TranscriptOutcome::NoSpeech(_) => String::new(),
            };
            let seconds = began.elapsed().as_secs_f64();
            audio_seconds += case.seconds;
            compute_seconds += seconds;
            writeln!(
                output,
                "{}",
                json!({"caseId": case.case_id, "hypothesis": hypothesis, "computeSeconds": (seconds * 10_000.0).round() / 10_000.0})
            )
            .map_err(error_text)?;
            if (sequence + 1) % 200 == 0 {
                eprintln!("{} of {} cases", sequence + 1, cases.len());
            }
        }
        let summary = json!({
            "runId": run_id,
            "model": format!("whisper-cpp-{}", model.id.trim_start_matches("whisper-")),
            "language": cases[0].language,
            "vocabulary": false,
            "set": set,
            "identity": {
                "file": model.file_name,
                "url": model.url,
                "sha256": model.sha256,
                "runtime": "voiceid-engine WhisperTranscriber, whisper-rs 0.16.0, whisper.cpp 1.8.3, Metal",
                "modelId": hex(&transcriber.model_id().0),
            },
            "caseCount": cases.len(),
            "loadSeconds": (load_seconds * 100.0).round() / 100.0,
            "audioSeconds": (audio_seconds * 10.0).round() / 10.0,
            "computeSeconds": (compute_seconds * 10.0).round() / 10.0,
            "realTimeFactor": (compute_seconds / audio_seconds * 10_000.0).round() / 10_000.0,
            "peakResidentBytes": 0,
            "peakGpuBytes": 0,
            "modelBytes": model.bytes,
        });
        fs::write(
            runs.join(format!("{run_id}.summary.json")),
            serde_json::to_string_pretty(&summary).map_err(error_text)? + "\n",
        )
        .map_err(error_text)?;
        println!(
            "{run_id}: {} cases, load {load_seconds:.1} s, {:.0} ms per case",
            cases.len(),
            compute_seconds / cases.len() as f64 * 1000.0
        );
        Ok(())
    }

    /// 16 kHz mono 16-bit PCM WAV, as the bench writes it.
    fn read_wav(path: &Path) -> Result<Vec<f32>, String> {
        let bytes = fs::read(path).map_err(error_text)?;
        if bytes.len() < 44
            || &bytes[0..4] != b"RIFF"
            || &bytes[8..16] != b"WAVEfmt "
            || u16::from_le_bytes([bytes[20], bytes[21]]) != 1
            || u16::from_le_bytes([bytes[22], bytes[23]]) != 1
            || u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]) != 16_000
            || u16::from_le_bytes([bytes[34], bytes[35]]) != 16
            || &bytes[36..40] != b"data"
        {
            return Err(format!("{} is not 16 kHz mono PCM16", path.display()));
        }
        Ok(bytes[44..]
            .chunks_exact(2)
            .map(|pair| f32::from(i16::from_le_bytes([pair[0], pair[1]])) / 32_768.0)
            .collect())
    }

    fn sample_duration(samples: usize) -> Duration {
        Duration::from_nanos(samples as u64 * 62_500)
    }
    fn limit(value: usize) -> Result<NonZeroUsize, String> {
        NonZeroUsize::new(value).ok_or("resource bound must be nonzero".into())
    }
    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
    fn adapter_error(error: AdapterError) -> String {
        format!("Whisper adapter: {error:?}")
    }
    fn error_text(error: impl std::fmt::Display) -> String {
        error.to_string()
    }
}
