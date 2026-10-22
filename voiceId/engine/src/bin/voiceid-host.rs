//! Local macOS VoiceID development host. Perception results provide no wallet authority.

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("voiceid-host requires macOS");
    std::process::exit(1);
}

#[cfg(target_os = "macos")]
fn main() -> Result<(), String> {
    host::run()
}

#[cfg(target_os = "macos")]
mod host {
    use std::io::{self, BufRead, Read};
    use std::path::PathBuf;
    use std::time::Duration;

    use voiceid_engine::adapters::native::local_host::{
        CollectionPurpose, LocalClock, LocalModels, SpokenCommand, collect_utterance,
        enroll_captures, finish_capture, spoken_command,
    };
    use voiceid_engine::adapters::native::{KeychainStore, Microphone, SpeakerEmbedding};
    use voiceid_engine::adapters::{AdapterError, AudioCapture, StoreError, TemplateStore};
    use voiceid_engine::attribution::AttributionOutcome;
    use voiceid_engine::domain::EnrollmentRef;
    use voiceid_engine::enrollment::{EnrollmentRecord, EnrollmentState};
    use voiceid_engine::runtime::AudioRuntime;
    use voiceid_engine::utterance::TranscriptOutcome;

    const SERVICE: &str = "com.seams.voiceid.prototype";
    const USAGE: &str = "voiceid-host devices | status | delete | enroll <native-inputs.json> | check <native-inputs.json> | browser <native-inputs.json> <namespace> <caller-origin>";

    enum Command {
        Devices,
        Status,
        Delete,
        Enroll(PathBuf),
        Check(PathBuf),
        Browser(PathBuf, String, String),
    }

    pub fn run() -> Result<(), String> {
        let command = parse_command()?;
        if let Command::Browser(models, namespace, origin) = command {
            return voiceid_engine::adapters::native::browser_host::run(
                &models,
                &namespace,
                &origin,
                &mut voiceid_engine::adapters::native::browser_host::MicrophoneCommand,
            );
        }
        if matches!(command, Command::Devices) {
            println!("{}", Microphone::default_device().map_err(adapter_error)?);
            return Ok(());
        }
        let clock = LocalClock::new().map_err(adapter_error)?;
        let mut store = KeychainStore::open(SERVICE, &clock.work_for(Duration::from_secs(10)))
            .map_err(store_error)?;
        match command {
            Command::Devices => unreachable!(),
            Command::Browser(..) => unreachable!(),
            Command::Status => {
                match store
                    .load(&clock.work_for(Duration::from_secs(10)))
                    .map_err(store_error)?
                {
                    EnrollmentState::Empty => {
                        println!("No voice enrollment. Run enroll to create one.")
                    }
                    EnrollmentState::Enrolled(_) => {
                        println!("Voice enrollment is stored in the local Keychain.")
                    }
                }
                Ok(())
            }
            Command::Delete => {
                let record = require_enrollment(
                    store
                        .load(&clock.work_for(Duration::from_secs(10)))
                        .map_err(store_error)?,
                )?;
                store
                    .delete(record.identity, &clock.work_for(Duration::from_secs(10)))
                    .map_err(store_error)?;
                println!("Voice enrollment deleted.");
                Ok(())
            }
            Command::Enroll(path) => enroll(path, &clock, &mut store),
            Command::Check(path) => check(path, &clock, &mut store),
        }
    }

    fn parse_command() -> Result<Command, String> {
        let mut arguments = std::env::args_os().skip(1);
        let command = match arguments
            .next()
            .as_deref()
            .and_then(std::ffi::OsStr::to_str)
        {
            Some("devices") => Command::Devices,
            Some("status") => Command::Status,
            Some("delete") => Command::Delete,
            Some("enroll") => Command::Enroll(PathBuf::from(arguments.next().ok_or(USAGE)?)),
            Some("check") => Command::Check(PathBuf::from(arguments.next().ok_or(USAGE)?)),
            Some("browser") => Command::Browser(
                PathBuf::from(arguments.next().ok_or(USAGE)?),
                arguments
                    .next()
                    .ok_or(USAGE)?
                    .into_string()
                    .map_err(|_| USAGE)?,
                arguments
                    .next()
                    .ok_or(USAGE)?
                    .into_string()
                    .map_err(|_| USAGE)?,
            ),
            _ => return Err(USAGE.into()),
        };
        if arguments.next().is_some() {
            return Err(USAGE.into());
        }
        Ok(command)
    }

    fn enroll(path: PathBuf, clock: &LocalClock, store: &mut KeychainStore) -> Result<(), String> {
        if matches!(
            store
                .load(&clock.work_for(Duration::from_secs(10)))
                .map_err(store_error)?,
            EnrollmentState::Enrolled(_)
        ) {
            return Err("An enrollment exists. Delete it before deliberate setup again.".into());
        }
        let mut models = LocalModels::load(&path, &clock.work_for(Duration::from_secs(60)))
            .map_err(adapter_error)?;
        println!(
            "Record three voice samples. Only the voice template will be stored in the local Keychain."
        );
        let first = enrollment_capture(1, &mut models, clock)?;
        let second = enrollment_capture(2, &mut models, clock)?;
        let third = enrollment_capture(3, &mut models, clock)?;
        let record =
            enroll_captures(store.device(), [first, second, third]).map_err(adapter_error)?;
        store
            .create(&record, &clock.work_for(Duration::from_secs(10)))
            .map_err(store_error)?;
        println!("Voice enrolled. Run check to try a spoken command.");
        Ok(())
    }

    fn enrollment_capture(
        index: usize,
        models: &mut LocalModels,
        clock: &LocalClock,
    ) -> Result<SpeakerEmbedding, String> {
        println!(
            "Sample {index}/3: press Enter, then read a sentence for at least three seconds. Pause when finished."
        );
        wait_for_enter()?;
        let work = clock.work_for(Duration::from_secs(15));
        let mut microphone = Microphone::prepare(clock, &work)
            .map_err(adapter_error)?
            .start(&work)
            .map_err(adapter_error)?;
        println!("Listening…");
        let window = collect_utterance(&mut microphone, CollectionPurpose::Enrollment, &work)
            .map_err(adapter_error)?;
        drop(microphone);
        models
            .matcher
            .extract(&window, &work)
            .map_err(adapter_error)
    }

    fn check(path: PathBuf, clock: &LocalClock, store: &mut KeychainStore) -> Result<(), String> {
        let record = require_enrollment(
            store
                .load(&clock.work_for(Duration::from_secs(10)))
                .map_err(store_error)?,
        )?;
        let expected = record.identity;
        let models = LocalModels::load(&path, &clock.work_for(Duration::from_secs(60)))
            .map_err(adapter_error)?;
        println!("Local voice check. No wallet operation is connected.");
        println!("Press Enter, then say ‘I approve this operation’ or ‘I cancel this operation’.");
        wait_for_enter()?;
        let work = clock.work_for(Duration::from_secs(25));
        let prepared = Microphone::prepare(clock, &work).map_err(adapter_error)?;
        let mut runtime = AudioRuntime::new(
            *prepared.ready(),
            models.profile,
            EnrollmentState::Enrolled(record),
            models.transcriber,
            models.matcher,
        )
        .map_err(adapter_error)?;
        let id = runtime.begin(&work).map_err(adapter_error)?;
        let mut microphone = prepared.start(&work).map_err(adapter_error)?;
        let ready = *microphone.ready();
        println!("Listening…");
        let captured = collect_utterance(&mut microphone, CollectionPurpose::Command, &work)
            .map_err(adapter_error)?;
        drop(microphone);
        finish_capture(&mut runtime, id, &ready, &captured, &work).map_err(adapter_error)?;
        let current = require_enrollment(store.load(&work).map_err(store_error)?)?;
        require_current(expected, current.identity)?;
        let result = runtime.take_result(id, &work).map_err(adapter_error)?;
        match result.attribution() {
            AttributionOutcome::Attributed(_) => match result.transcript() {
                TranscriptOutcome::Speech(transcript) => {
                    let message = match spoken_command(transcript) {
                        SpokenCommand::Approve => {
                            "Enrolled speaker said approve. This check performs no wallet action."
                        }
                        SpokenCommand::Cancel => {
                            "Enrolled speaker said cancel. This check performs no wallet action."
                        }
                        SpokenCommand::Unrecognized => {
                            "The voice matched. The command was not recognized."
                        }
                    };
                    println!("{message}")
                }
                TranscriptOutcome::NoSpeech(_) => println!("No command recognized."),
            },
            AttributionOutcome::Rejected { .. } => {
                println!("The voice did not match the enrollment.")
            }
            AttributionOutcome::Insufficient { .. } | AttributionOutcome::Ambiguous { .. } => {
                println!("The voice check was inconclusive. Try again in a quiet place.")
            }
        }
        Ok(())
    }

    fn require_current(expected: EnrollmentRef, current: EnrollmentRef) -> Result<(), String> {
        if expected != current {
            return Err("Enrollment changed during capture. Start a new check.".into());
        }
        Ok(())
    }
    fn require_enrollment(state: EnrollmentState) -> Result<EnrollmentRecord, String> {
        match state {
            EnrollmentState::Empty => Err("No enrollment exists. Run enroll first.".into()),
            EnrollmentState::Enrolled(record) => Ok(record),
        }
    }
    fn wait_for_enter() -> Result<(), String> {
        let mut input = String::new();
        let read = io::stdin()
            .lock()
            .take(1025)
            .read_line(&mut input)
            .map_err(io_error)?;
        if read == 0 || read > 1024 {
            return Err("Capture was not started.".into());
        }
        Ok(())
    }
    fn adapter_error(error: AdapterError) -> String {
        format!("VoiceID: {error:?}")
    }
    fn store_error(error: StoreError) -> String {
        format!("VoiceID Keychain: {error:?}")
    }
    fn io_error<E: std::fmt::Display>(error: E) -> String {
        error.to_string()
    }
}
