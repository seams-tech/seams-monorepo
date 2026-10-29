//! Check a phrase set against the phrase rules, then match transcripts against it.
//!
//! Usage: phrase_agreement <phrases.json> <transcripts.jsonl>
//! `phrases.json` is a JSON array of phrase texts. Each transcript line holds
//! `caseId` and `hypothesis`. Each output line holds `caseId` and the indexes of
//! the phrases that the transcript matches, for comparison with the bench scorer.

use std::fs;

use serde::Deserialize;
use serde_json::json;
use voiceid_engine::phrase::PhraseBank;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Transcript {
    case_id: String,
    hypothesis: String,
}

fn main() -> Result<(), String> {
    let mut arguments = std::env::args().skip(1);
    let usage = "phrase_agreement <phrases.json> <transcripts.jsonl>";
    let phrases: Vec<String> =
        serde_json::from_str(&fs::read_to_string(arguments.next().ok_or(usage)?).map_err(text)?)
            .map_err(text)?;
    let transcripts = fs::read_to_string(arguments.next().ok_or(usage)?).map_err(text)?;
    let bank = PhraseBank::new(phrases.iter().map(String::as_str))
        .map_err(|error| format!("phrase set refused: {error:?}"))?;
    for line in transcripts.lines() {
        let transcript: Transcript = serde_json::from_str(line).map_err(text)?;
        let accepted: Vec<usize> = bank
            .phrases()
            .iter()
            .enumerate()
            .filter(|(_, phrase)| phrase.matches(&transcript.hypothesis))
            .map(|(index, _)| index)
            .collect();
        println!(
            "{}",
            json!({"caseId": transcript.case_id, "accepted": accepted})
        );
    }
    Ok(())
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}
