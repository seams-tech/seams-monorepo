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
    use std::num::NonZeroUsize;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use voiceid_engine::adapters::native::local_host::{
        CollectionPurpose, HOST_MAXIMUM_SAMPLES, LocalClock, LocalModels, SpokenCommand,
        collect_utterance, enroll_captures, finish_capture, spoken_command,
    };
    use voiceid_engine::adapters::native::{
        DEFAULT_WHISPER_MODEL, InstallState, KeychainStore, Microphone, SpeakerEmbedding,
        WhisperLanguage, WhisperLimits, WhisperTranscriber,
    };
    use voiceid_engine::adapters::{AdapterError, AudioCapture, StoreError, TemplateStore};
    use voiceid_engine::attribution::AttributionOutcome;
    use voiceid_engine::domain::{EnrollmentRef, UnavailableReason};
    use voiceid_engine::enrollment::{EnrollmentRecord, EnrollmentState};
    use voiceid_engine::phrase::ActionPhrase;
    use voiceid_engine::runtime::AudioRuntime;
    use voiceid_engine::utterance::TranscriptOutcome;

    const SERVICE: &str = "com.seams.voiceid.prototype";
    const USAGE: &str = "voiceid-host devices | status | delete | voice status|on|off <voice-model-directory> | enroll <native-inputs.json> | check <native-inputs.json> [phrase] | bridge <native-inputs.json> <namespace> <wallet-origin>";

    enum Command {
        Devices,
        Status,
        Delete,
        Voice(VoiceCommand, PathBuf),
        Enroll(PathBuf),
        Check(PathBuf, Option<String>),
        Bridge(PathBuf, String, String),
    }

    enum VoiceCommand {
        Status,
        On,
        Off,
    }

    pub fn run() -> Result<(), String> {
        let command = parse_command()?;
        if let Command::Bridge(models, namespace, origin) = command {
            return voiceid_engine::adapters::native::local_bridge::run(
                &models,
                &namespace,
                &origin,
                &mut voiceid_engine::adapters::native::local_bridge::MicrophoneCommand,
            );
        }
        if matches!(command, Command::Devices) {
            println!("{}", Microphone::default_device().map_err(adapter_error)?);
            return Ok(());
        }
        let clock = LocalClock::new().map_err(adapter_error)?;
        if let Command::Voice(action, directory) = command {
            return voice(action, &directory, &clock);
        }
        let mut store = KeychainStore::open(SERVICE, &clock.work_for(Duration::from_secs(10)))
            .map_err(store_error)?;
        match command {
            Command::Devices | Command::Voice(..) | Command::Bridge(..) => unreachable!(),
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
            Command::Check(path, phrase) => check(path, phrase, &clock, &mut store),
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
            Some("voice") => {
                let action = match arguments
                    .next()
                    .as_deref()
                    .and_then(std::ffi::OsStr::to_str)
                {
                    Some("status") => VoiceCommand::Status,
                    Some("on") => VoiceCommand::On,
                    Some("off") => VoiceCommand::Off,
                    _ => return Err(USAGE.into()),
                };
                Command::Voice(action, PathBuf::from(arguments.next().ok_or(USAGE)?))
            }
            Some("enroll") => Command::Enroll(PathBuf::from(arguments.next().ok_or(USAGE)?)),
            Some("check") => Command::Check(
                PathBuf::from(arguments.next().ok_or(USAGE)?),
                arguments
                    .next()
                    .map(|phrase| phrase.into_string().map_err(|_| USAGE))
                    .transpose()?,
            ),
            Some("bridge") => Command::Bridge(
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

    /// Voice stays off until the person agrees to the download. Turning it off deletes the files.
    fn voice(action: VoiceCommand, directory: &Path, clock: &LocalClock) -> Result<(), String> {
        let model = DEFAULT_WHISPER_MODEL;
        let megabytes = model.bytes / 1_000_000;
        match action {
            VoiceCommand::Status => match model.state(directory) {
                InstallState::NotInstalled => {
                    println!(
                        "Voice is off. Run voice on to download the speech model ({megabytes} MB)."
                    )
                }
                InstallState::Partial { bytes } => println!(
                    "Voice is off. A download stopped at {} of {megabytes} MB. Run voice on to resume it.",
                    bytes / 1_000_000
                ),
                InstallState::Installed => {
                    println!("Voice is on. {} is installed ({megabytes} MB).", model.id)
                }
            },
            VoiceCommand::On => {
                if model.state(directory) != InstallState::Installed {
                    println!(
                        "Voice needs a one-time download of {} ({megabytes} MB, {} licence) into {}.",
                        model.id,
                        model.license,
                        directory.display()
                    );
                    println!("The model stays on this Mac. Type yes to download it:");
                    if read_line()?.trim() != "yes" {
                        println!("Voice stays off. Nothing was downloaded.");
                        return Ok(());
                    }
                }
                let mut reported = 0;
                model
                    .install(
                        directory,
                        &mut |done, total| {
                            let percent = done * 100 / total;
                            if percent >= reported + 10 {
                                eprintln!("{percent}% of {megabytes} MB");
                                reported = percent;
                            }
                        },
                        &clock.work_for(Duration::from_secs(4 * 60 * 60)),
                    )
                    .map_err(adapter_error)?;
                // The first load compiles the GPU shaders. Do it now, not at the first command.
                println!("Preparing the speech model…");
                let mut transcriber = WhisperTranscriber::new(
                    model,
                    directory,
                    WhisperLanguage::English,
                    WhisperLimits {
                        maximum_samples: NonZeroUsize::new(HOST_MAXIMUM_SAMPLES).ok_or(USAGE)?,
                        maximum_text_bytes: NonZeroUsize::new(4096).ok_or(USAGE)?,
                    },
                )
                .map_err(adapter_error)?;
                transcriber
                    .prepare(&clock.work_for(Duration::from_secs(120)))
                    .map_err(adapter_error)?;
                println!("Voice is on. The model loads when a voice session starts.");
            }
            VoiceCommand::Off => {
                model.remove(directory).map_err(adapter_error)?;
                println!("Voice is off. The speech model is deleted from this Mac.");
            }
        }
        Ok(())
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

    fn check(
        path: PathBuf,
        phrase: Option<String>,
        clock: &LocalClock,
        store: &mut KeychainStore,
    ) -> Result<(), String> {
        let phrase = phrase
            .map(|text| {
                ActionPhrase::new(&text)
                    .map_err(|error| format!("The phrase breaks the phrase rules: {error:?}"))
            })
            .transpose()?;
        let record = require_enrollment(
            store
                .load(&clock.work_for(Duration::from_secs(10)))
                .map_err(store_error)?,
        )?;
        let expected = record.identity;
        let models = LocalModels::load(&path, &clock.work_for(Duration::from_secs(60)))
            .map_err(adapter_error)?;
        println!("Local voice check. No wallet operation is connected.");
        match &phrase {
            Some(phrase) => println!("Press Enter, then say ‘{}’.", phrase.text()),
            None => println!(
                "Press Enter, then say ‘I approve this operation’ or ‘I cancel this operation’."
            ),
        }
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
        let id = runtime.begin(&work).map_err(|error| match error {
            AdapterError::Unavailable(UnavailableReason::Missing) => {
                "Voice is off. Run voice on to download the speech model.".to_owned()
            }
            error => adapter_error(error),
        })?;
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
                TranscriptOutcome::Speech(transcript) if phrase.is_some() => {
                    if phrase
                        .as_ref()
                        .is_some_and(|phrase| phrase.matches(transcript.text()))
                    {
                        println!("Enrolled speaker said the phrase. This check performs no action.")
                    } else {
                        println!("The voice matched. The words did not match the phrase.")
                    }
                }
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
        read_line()
            .map(drop)
            .map_err(|_| "Capture was not started.".into())
    }
    fn read_line() -> Result<String, String> {
        let mut input = String::new();
        let read = io::stdin()
            .lock()
            .take(1025)
            .read_line(&mut input)
            .map_err(io_error)?;
        if read == 0 || read > 1024 {
            return Err("No answer was read.".into());
        }
        Ok(input)
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
