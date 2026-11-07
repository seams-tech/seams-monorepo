//! Refactor 210 Gate STT-1: the model side.
//!
//! ```text
//! txg-infer <aurora|citrinet> <model.onnx> <corpus.json> <cases.jsonl> <scores.jsonl> [threads]
//! ```
//!
//! Runs one model with tract on every case's raw f32 16 kHz audio. It writes
//! the greedy CTC transcript (decoded as `phrase.ts` does) and the Rule B
//! inputs: the CTC log-likelihood of the expected text and the best
//! log-likelihood over the request's confusion set. `txg-text decide` then
//! applies `normalize` and Rule A, and `score.py` picks the Rule B margin.

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use tract_onnx::prelude::*;

const SAMPLE_RATE: usize = 16_000;
const TOKEN_COUNT: usize = 257;
const SPEECH_LEVEL_DBFS: f64 = -26.0;
const PAD_SECONDS: f64 = 0.3;
/// Plans are built for audio lengths in steps of this many samples; the tail
/// is padded with zeros (silence).
const LENGTH_STEP: usize = SAMPLE_RATE / 4;

/// The Wallet's VoiceID package, relative to `voiceId/stt-bench`.
const WALLET_VOICEID: &str = "../../../seams-wallet/packages/voiceid";

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 6 && args.len() != 7 {
        bail!("usage: txg-infer <aurora|citrinet> <model.onnx> <corpus.json> <cases.jsonl> <out.jsonl> [threads]");
    }
    let threads = args.get(6).map(|t| t.parse()).transpose()?.unwrap_or(8);
    score(&args[1], &args[2], &args[3], &args[4], &args[5], threads)
}

// ---------------------------------------------------------------- tokens

/// Reads `PHRASE_TOKEN_PIECES` from the Wallet's TypeScript table.
fn token_table(model: &str, bench_dir: &std::path::Path) -> Result<Vec<String>> {
    let file = match model {
        "aurora" => "src/browser/phraseVocabulary.ts",
        "citrinet" => "src/browser/phraseTokens.ts",
        other => bail!("unknown model {other}"),
    };
    let path = bench_dir.join(WALLET_VOICEID).join(file);
    let source = std::fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let marker = "PHRASE_TOKEN_PIECES: readonly string[] = [";
    let open = source.find(marker).context("token table start")? + marker.len() - 1;
    let close = open + source[open..].find("];").context("table end")?;
    let body = source[open..=close].trim_end_matches(']').trim_end().trim_end_matches(',');
    let pieces: Vec<String> = serde_json::from_str(&format!("{body}]"))?;
    if pieces.len() != TOKEN_COUNT - usize::from(model == "citrinet") {
        bail!("{model} table has {} pieces", pieces.len());
    }
    Ok(pieces)
}

struct Tokenizer {
    model: String,
    pieces: HashMap<String, usize>,
    blank: usize,
}

impl Tokenizer {
    fn new(model: &str, table: &[String]) -> Self {
        let pieces = table.iter().enumerate().filter(|(_, p)| !p.is_empty()).map(|(i, p)| (p.clone(), i)).collect();
        let blank = if model == "aurora" { 0 } else { TOKEN_COUNT - 1 };
        Self { model: model.to_owned(), pieces, blank }
    }

    /// Greedy longest match per word: WordPiece (`##`) for Citrinet, and
    /// SentencePiece (`▁` word start) for Aurora.
    fn encode(&self, text: &str) -> Option<Vec<usize>> {
        let mut out = Vec::new();
        for word in text.split_whitespace() {
            let chars: Vec<char> = if self.model == "aurora" {
                std::iter::once('\u{2581}').chain(word.chars()).collect()
            } else {
                word.chars().collect()
            };
            let mut start = 0;
            while start < chars.len() {
                let mut found = None;
                for end in (start + 1..=chars.len()).rev() {
                    let mut piece: String = chars[start..end].iter().collect();
                    if self.model == "citrinet" && start > 0 {
                        piece = format!("##{piece}");
                    }
                    if let Some(&id) = self.pieces.get(&piece) {
                        found = Some((id, end));
                        break;
                    }
                }
                let (id, end) = found?;
                out.push(id);
                start = end;
            }
        }
        Some(out)
    }
}

fn greedy_text(logp: &[f32], frames: usize, tok: &Tokenizer, table: &[String]) -> String {
    let mut greedy = Vec::new();
    let mut previous = usize::MAX;
    for frame in 0..frames {
        let row = &logp[frame * TOKEN_COUNT..(frame + 1) * TOKEN_COUNT];
        let mut best = tok.blank;
        let mut maximum = f32::NEG_INFINITY;
        for (token, &value) in row.iter().enumerate() {
            if value > maximum {
                maximum = value;
                best = token;
            }
        }
        if best != tok.blank && best != previous {
            greedy.push(best);
        }
        previous = best;
    }
    if tok.model == "aurora" {
        let joined: String = greedy.iter().map(|&t| table[t].as_str()).collect();
        joined.replace('\u{2581}', " ").split_whitespace().collect::<Vec<_>>().join(" ")
    } else {
        // decodeWordPieces in phrase.ts.
        let mut text = String::new();
        let mut join_next = false;
        for &t in &greedy {
            let piece = table[t].as_str();
            if piece.starts_with('[') {
                continue;
            }
            if let Some(rest) = piece.strip_prefix("##") {
                text.push_str(rest);
            } else if piece == "'" {
                text.push('\'');
                join_next = true;
                continue;
            } else {
                if !(join_next || text.is_empty()) {
                    text.push(' ');
                }
                text.push_str(piece);
            }
            join_next = false;
        }
        text.trim().to_owned()
    }
}

// ---------------------------------------------------------------- CTC

fn log_softmax(logits: &[f32], frames: usize) -> Vec<f32> {
    let mut out = vec![0f32; logits.len()];
    for f in 0..frames {
        let row = &logits[f * TOKEN_COUNT..(f + 1) * TOKEN_COUNT];
        let max = row.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let sum: f64 = row.iter().map(|&v| ((v - max) as f64).exp()).sum();
        let lse = max as f64 + sum.ln();
        for (o, &v) in out[f * TOKEN_COUNT..(f + 1) * TOKEN_COUNT].iter_mut().zip(row) {
            *o = (v as f64 - lse) as f32;
        }
    }
    out
}

fn lae(a: f64, b: f64) -> f64 {
    if a == f64::NEG_INFINITY {
        return b;
    }
    if b == f64::NEG_INFINITY {
        return a;
    }
    let m = a.max(b);
    m + ((a - m).exp() + (b - m).exp()).ln()
}

/// log P(labels | audio) under CTC.
fn ctc_log_likelihood(logp: &[f32], frames: usize, labels: &[usize], blank: usize) -> f64 {
    let ext: Vec<usize> = std::iter::once(blank).chain(labels.iter().flat_map(|&l| [l, blank])).collect();
    let s = ext.len();
    let neg = f64::NEG_INFINITY;
    let mut alpha = vec![neg; s];
    let lp = |f: usize, t: usize| logp[f * TOKEN_COUNT + t] as f64;
    alpha[0] = lp(0, ext[0]);
    if s > 1 {
        alpha[1] = lp(0, ext[1]);
    }
    for f in 1..frames {
        let mut next = vec![neg; s];
        for i in 0..s {
            let mut a = alpha[i];
            if i >= 1 {
                a = lae(a, alpha[i - 1]);
            }
            if i >= 2 && ext[i] != blank && ext[i] != ext[i - 2] {
                a = lae(a, alpha[i - 2]);
            }
            if a != neg {
                next[i] = a + lp(f, ext[i]);
            }
        }
        alpha = next;
    }
    if s == 1 { alpha[0] } else { lae(alpha[s - 1], alpha[s - 2]) }
}

// ---------------------------------------------------------------- audio

fn frame_rms(samples: &[f64]) -> Vec<f64> {
    samples.chunks_exact(160).map(|f| (f.iter().map(|v| v * v).sum::<f64>() / 160.0 + 1e-12).sqrt()).collect()
}

/// `trim_and_level` and the clean `mix` of `prepare.py`: trim to the active
/// speech, set the active level to -26 dBFS and pad 0.3 s on each side.
fn prepare_audio(raw: &[f32]) -> Vec<f32> {
    let samples: Vec<f64> = raw.iter().map(|&v| v as f64).collect();
    let rms = frame_rms(&samples);
    let max = rms.iter().cloned().fold(0.0, f64::max);
    let floor = max * 10f64.powf(-40.0 / 20.0);
    let active: Vec<usize> = rms.iter().enumerate().filter(|(_, &r)| r > floor).map(|(i, _)| i).collect();
    let (first, last) = (active[0], *active.last().unwrap());
    let start = first.saturating_sub(5) * 160;
    let end = ((last + 6) * 160).min(samples.len());
    let speech = &samples[start..end];
    let speech_rms = frame_rms(speech);
    let smax = speech_rms.iter().cloned().fold(0.0, f64::max);
    let kept: Vec<f64> = speech_rms.iter().cloned().filter(|&r| r > smax * 10f64.powf(-40.0 / 20.0)).collect();
    let level = (kept.iter().map(|r| r * r).sum::<f64>() / kept.len() as f64).sqrt();
    let gain = 10f64.powf(SPEECH_LEVEL_DBFS / 20.0) / level;
    let pad = (PAD_SECONDS * SAMPLE_RATE as f64) as usize;
    let mut out = vec![0f32; pad];
    out.extend(speech.iter().map(|v| (v * gain) as f32));
    out.extend(std::iter::repeat(0f32).take(pad));
    out
}

fn read_f32(path: &str) -> Result<Vec<f32>> {
    let bytes = std::fs::read(path).with_context(|| format!("read {path}"))?;
    Ok(bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

// ---------------------------------------------------------------- score

type Plan = TypedRunnableModel;

struct Plans {
    bytes: Vec<u8>,
    plans: Mutex<HashMap<usize, Arc<Plan>>>,
}

impl Plans {
    fn get(&self, samples: usize) -> Result<Arc<Plan>> {
        if let Some(plan) = self.plans.lock().unwrap().get(&samples) {
            return Ok(plan.clone());
        }
        let plan = tract_onnx::onnx()
            .model_for_read(&mut self.bytes.as_slice())?
            .with_input_fact(0, f32::fact([1, samples]).into())?
            .into_optimized()?
            .into_runnable()?;
        self.plans.lock().unwrap().insert(samples, plan.clone());
        Ok(plan)
    }
}

struct Expected {
    spoken: String,
    words: usize,
    labels: Vec<usize>,
    confusion: Vec<(String, Vec<usize>)>,
}

fn score(model: &str, onnx: &str, corpus_path: &str, cases_path: &str, out_path: &str, threads: usize) -> Result<()> {
    let bench_dir = std::env::current_dir()?;
    let table = token_table(model, &bench_dir)?;
    let tok = Tokenizer::new(model, &table);
    let corpus: Value = serde_json::from_slice(&std::fs::read(corpus_path)?)?;
    let mut expected: HashMap<String, Expected> = HashMap::new();
    let mut untokenizable = 0usize;
    for request in corpus["requests"].as_array().unwrap() {
        let spoken = request["spoken"].as_str().unwrap().to_owned();
        let labels = tok.encode(&spoken).context("expected text not tokenizable")?;
        let confusion = request["confusionSet"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|t| {
                let t = t.as_str().unwrap();
                let labels = tok.encode(t);
                untokenizable += usize::from(labels.is_none());
                labels.map(|l| (t.to_owned(), l))
            })
            .collect();
        expected.insert(
            request["id"].as_str().unwrap().to_owned(),
            Expected { words: spoken.split(' ').count(), spoken, labels, confusion },
        );
    }
    if untokenizable > 0 {
        eprintln!("warning: {untokenizable} confusion texts not tokenizable");
    }
    let cases: Vec<Value> = std::io::BufReader::new(std::fs::File::open(cases_path)?)
        .lines()
        .map(|l| Ok(serde_json::from_str(&l?)?))
        .collect::<Result<_>>()?;
    let plans = Plans { bytes: std::fs::read(onnx)?, plans: Mutex::new(HashMap::new()) };
    let next = AtomicUsize::new(0);
    let out = Mutex::new(std::io::BufWriter::new(std::fs::File::create(out_path)?));
    let done = AtomicUsize::new(0);
    let started = Instant::now();

    std::thread::scope(|scope| -> Result<()> {
        let mut handles = Vec::new();
        for _ in 0..threads {
            handles.push(scope.spawn(|| -> Result<()> {
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some(case) = cases.get(index) else { return Ok(()) };
                    let exp = &expected[case["requestId"].as_str().unwrap()];
                    let mut audio = prepare_audio(&read_f32(case["audio"].as_str().unwrap())?);
                    let length = audio.len().div_ceil(LENGTH_STEP) * LENGTH_STEP;
                    audio.resize(length, 0.0);
                    let plan = plans.get(length)?;
                    let t0 = Instant::now();
                    let input = tract_ndarray::Array2::from_shape_vec((1, length), audio)?;
                    let outputs = plan.run(tvec!(Tensor::from(input).into()))?;
                    let infer_ms = t0.elapsed().as_secs_f64() * 1000.0;
                    let logits = outputs[0].to_plain_array_view::<f32>()?;
                    let shape = logits.shape().to_vec();
                    if shape.len() != 3 || shape[2] != TOKEN_COUNT {
                        bail!("logits shape {shape:?}");
                    }
                    let frames = shape[1];
                    let flat: Vec<f32> = logits.iter().copied().collect();
                    let logp = log_softmax(&flat, frames);
                    let transcript = greedy_text(&logp, frames, &tok, &table);
                    let ll_expected = ctc_log_likelihood(&logp, frames, &exp.labels, tok.blank);
                    let mut best_miss = (f64::NEG_INFINITY, String::new());
                    for (text, labels) in &exp.confusion {
                        let ll = ctc_log_likelihood(&logp, frames, labels, tok.blank);
                        if ll > best_miss.0 {
                            best_miss = (ll, text.clone());
                        }
                    }
                    let finite = |v: f64| if v.is_finite() { json!(v) } else { Value::Null };
                    let row = json!({
                        "caseId": case["caseId"], "requestId": case["requestId"], "role": case["role"],
                        "missKind": case["missKind"], "voice": case["voice"], "rate": case["rate"],
                        "text": case["text"], "expected": exp.spoken, "expectedWords": exp.words,
                        "transcript": transcript, "llExpected": finite(ll_expected), "llBestMiss": finite(best_miss.0),
                        "bestMiss": best_miss.1, "frames": frames, "samples": length, "inferMs": infer_ms,
                    });
                    let mut writer = out.lock().unwrap();
                    serde_json::to_writer(&mut *writer, &row)?;
                    writer.write_all(b"\n")?;
                    let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                    if n % 250 == 0 {
                        eprintln!("{model}: {n}/{} in {:.0} s", cases.len(), started.elapsed().as_secs_f64());
                    }
                }
            }));
        }
        for handle in handles {
            handle.join().expect("worker panicked")?;
        }
        Ok(())
    })?;
    out.lock().unwrap().flush()?;
    println!("{model}: scored {} cases in {:.0} s", cases.len(), started.elapsed().as_secs_f64());
    Ok(())
}
