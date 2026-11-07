//! Refactor 210 Gate STT-1: the text side, linked to `spoken-intent`.
//!
//! ```text
//! txg-text corpus <seed> <corpus.json>
//! txg-text decide <corpus.json> <scores.jsonl> <decisions.jsonl>
//! ```
//!
//! `corpus` writes the seeded requests, near misses and confusion sets.
//! `decide` applies Rule A to each transcript of `txg-infer`: `normalize`,
//! then an exact token match with `render(request).spoken`. It also adds the
//! normalized word count (for Rule B) and, for transfers, the
//! `parse_transfer` result of the transcript.

mod corpus;
mod rulew;

use std::io::{BufRead, BufWriter, Write};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use spoken_intent::{normalize, parse_transfer, ParseResult, SpokenAccount};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("corpus") if args.len() == 4 => {
            let corpus = corpus::build(args[2].parse()?);
            std::fs::write(&args[3], serde_json::to_vec_pretty(&corpus)?)?;
            let requests = corpus["requests"].as_array().unwrap();
            let misses: usize = requests.iter().map(|r| r["nearMisses"].as_array().unwrap().len()).sum();
            let confusion: usize = requests.iter().map(|r| r["confusionSet"].as_array().unwrap().len()).sum();
            println!("corpus: {} requests, {misses} near-miss texts, {confusion} confusion-set texts", requests.len());
            Ok(())
        }
        Some("decide") if args.len() == 5 => decide(&args[2], &args[3], &args[4]),
        Some("rulew") if args.len() == 6 => rulew::run(&args[2], &args[3], &args[4], &args[5]),
        Some("rulew2") if args.len() == 7 => rulew::run2(&args[2], &args[3], &args[4], &args[5], &args[6]),
        _ => bail!("usage: txg-text corpus <seed> <out.json> | txg-text decide <corpus.json> <scores.jsonl> <out.jsonl> | txg-text rulew <corpus.json> <cases.jsonl> <heard.jsonl> <out.jsonl>"),
    }
}

fn decide(corpus_path: &str, scores_path: &str, out_path: &str) -> Result<()> {
    let corpus: Value = serde_json::from_slice(&std::fs::read(corpus_path)?)?;
    let contacts: Vec<SpokenAccount> = corpus["contacts"]
        .as_array()
        .context("contacts")?
        .iter()
        .map(|c| SpokenAccount::new(c.as_str().unwrap()).expect("speakable contact"))
        .collect();
    let mut out = BufWriter::new(std::fs::File::create(out_path)?);
    let mut rows = 0usize;
    for line in std::io::BufReader::new(std::fs::File::open(scores_path)?).lines() {
        let mut row: Value = serde_json::from_str(&line?)?;
        let transcript = row["transcript"].as_str().unwrap_or_default().to_owned();
        let tokens = normalize(&transcript);
        let normalized = tokens
            .as_ref()
            .map(|t| t.iter().map(|w| w.as_str()).collect::<Vec<_>>().join(" "));
        let expected = row["expected"].as_str().unwrap_or_default().to_owned();
        row["normalized"] = json!(normalized);
        row["words"] = json!(tokens.as_ref().map_or(0, Vec::len));
        row["ruleA"] = json!(normalized.as_deref() == Some(expected.as_str()));
        if row["requestId"].as_str().is_some_and(|id| id.starts_with('t')) {
            row["parse"] = match tokens.as_ref().map(|t| parse_transfer(t, &contacts)) {
                None => json!("NotNormalizable"),
                Some(ParseResult::Transfer(p)) => {
                    json!({"receiver": p.receiver.as_str(), "amountHundredths": p.amount.hundredths()})
                }
                Some(ParseResult::Refused(reason)) => json!(format!("{reason:?}")),
            };
        }
        serde_json::to_writer(&mut out, &row)?;
        out.write_all(b"\n")?;
        rows += 1;
    }
    out.flush()?;
    println!("decide: {rows} rows");
    Ok(())
}
