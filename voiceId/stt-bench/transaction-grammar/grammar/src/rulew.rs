//! Rule W: text cleanup, a phonetic recipient match, then `render` equality.
//!
//! ```text
//! txg-text rulew <corpus.json> <cases.jsonl> <heard.jsonl> <out.jsonl>
//! ```
//!
//! `heard.jsonl` has one line per case: `{caseId, heard, seconds,
//! audioSeconds}` or `{caseId, error}`. The rule is the same for every case:
//!
//! 1. Text step: lowercase; trim; drop final `. , ! ?`; remove thousands
//!    commas inside digit groups; a `.` between two letters, or between a
//!    letter and a digit, becomes " dot "; `-` becomes " dash "; `_` becomes
//!    " underscore "; then `normalize`. A `.` between two digits stays a
//!    decimal point (variant `literal` also turns it into " dot ").
//! 2. Transfers: the words after the first "to" must have the same
//!    `phonetic_key` as exactly one contact; they are then replaced by the
//!    words of that contact.
//! 3. Accept only if `render` of the `parse_transfer` result (transfers) or
//!    the step-1 words (multisig approvals) equal the expected spoken text.
//!
//! Rule A (plain `normalize` of the transcript, exact words) is written too.

use std::collections::HashMap;
use std::io::{BufRead, BufWriter, Write};

use anyhow::{Context, Result};
use serde_json::{json, Value};
use spoken_intent::{
    normalize, normalize_punctuated, parse_transfer, phonetic_key, render, NearAccount, NearAmount,
    Network, ParseResult, PunctuatedRefusal, SpokenAccount, SpokenRequestV1,
};

fn join(words: &[&str]) -> String {
    words.join(" ")
}

/// Step 1 before `normalize`. `literal` also turns a `.` between two digits
/// into " dot ".
pub fn clean(heard: &str, literal: bool) -> String {
    let mut text = heard.trim().to_lowercase();
    while text.ends_with(['.', ',', '!', '?']) {
        text.pop();
        text = text.trim_end().to_owned();
    }
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len() + 16);
    for (i, &c) in chars.iter().enumerate() {
        let prev = i.checked_sub(1).map(|j| chars[j]);
        let next = chars.get(i + 1).copied();
        let alnum = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric());
        let digit = |c: Option<char>| c.is_some_and(|c| c.is_ascii_digit());
        match c {
            ',' if digit(prev) && digit(next) => {}
            '.' if alnum(prev) && alnum(next) && (literal || !(digit(prev) && digit(next))) => {
                out.push_str(" dot ")
            }
            '-' => out.push_str(" dash "),
            '_' => out.push_str(" underscore "),
            _ => out.push(c),
        }
    }
    out
}

/// The phonetic key of a word list, from the crate's `phonetic_key`: each
/// word is keyed as a one-word account and the keys are joined, then each
/// run of one letter becomes one letter. This equals the key of an account
/// with these spoken words. `None` if a word is not a speakable account (a
/// one-letter word).
fn words_key(words: &[&str]) -> Option<String> {
    let mut raw = String::new();
    for w in words {
        raw.push_str(phonetic_key(&SpokenAccount::new(w).ok()?).as_str());
    }
    let mut key = String::with_capacity(raw.len());
    for c in raw.chars() {
        if !key.ends_with(c) {
            key.push(c);
        }
    }
    Some(key)
}

struct Contact {
    account: SpokenAccount,
    key: String,
    words: Vec<String>,
}

struct Decision {
    accepted: bool,
    stage: &'static str,
    detail: Value,
}

fn rule_w(
    heard: &str,
    literal: bool,
    expected: &str,
    is_transfer: bool,
    contacts: &[Contact],
    accounts: &[SpokenAccount],
) -> Decision {
    let cleaned = clean(heard, literal);
    let Some(tokens) = normalize(&cleaned) else {
        return Decision { accepted: false, stage: "normalize", detail: json!({"cleaned": cleaned}) };
    };
    let words: Vec<&str> = tokens.iter().map(|t| t.as_str()).collect();
    let normalized = join(&words);
    if !is_transfer {
        let accepted = normalized == expected;
        return Decision {
            accepted,
            stage: if accepted { "accepted" } else { "words" },
            detail: json!({"cleaned": cleaned, "normalized": normalized}),
        };
    }
    let mut detail = json!({"cleaned": cleaned, "normalized": normalized});
    let mut final_words: Vec<String> = words.iter().map(|w| (*w).to_owned()).collect();
    if let Some(to) = words.iter().position(|w| *w == "to") {
        let recipient = &words[to + 1..];
        let key = words_key(recipient);
        let matches: Vec<&Contact> = match &key {
            Some(k) => contacts.iter().filter(|c| &c.key == k).collect(),
            None => Vec::new(),
        };
        detail["recipient"] = json!(join(recipient));
        detail["recipientKey"] = json!(key);
        detail["keyMatches"] = json!(matches.iter().map(|c| c.account.as_str()).collect::<Vec<_>>());
        if matches.len() != 1 {
            return Decision {
                accepted: false,
                stage: if key.is_none() { "recipient_unkeyable" } else if matches.is_empty() { "recipient_no_key_match" } else { "recipient_ambiguous" },
                detail,
            };
        }
        final_words.truncate(to + 1);
        final_words.extend(matches[0].words.iter().cloned());
    }
    let final_tokens = normalize(&final_words.join(" ")).expect("normalized words stay normalizable");
    match parse_transfer(&final_tokens, accounts) {
        ParseResult::Transfer(p) => {
            let rendered = render(&SpokenRequestV1::AccountTransfer {
                network: Network::Testnet,
                owner: NearAccount::new("owner.testnet").unwrap(),
                receiver: p.receiver.clone(),
                amount: NearAmount::from_hundredths(p.amount.hundredths()).unwrap(),
            })
            .spoken_text;
            let accepted = rendered == expected;
            detail["rendered"] = json!(rendered);
            Decision { accepted, stage: if accepted { "accepted" } else { "render_differs" }, detail }
        }
        ParseResult::Refused(reason) => {
            detail["parseRefusal"] = json!(format!("{reason:?}"));
            Decision { accepted: false, stage: "parse", detail }
        }
    }
}

pub fn run(corpus_path: &str, cases_path: &str, heard_path: &str, out_path: &str) -> Result<()> {
    let corpus: Value = serde_json::from_slice(&std::fs::read(corpus_path)?)?;
    let accounts: Vec<SpokenAccount> = corpus["contacts"]
        .as_array()
        .context("contacts")?
        .iter()
        .map(|c| SpokenAccount::new(c.as_str().unwrap()).expect("speakable contact"))
        .collect();
    let contacts: Vec<Contact> = accounts
        .iter()
        .map(|a| {
            let words: Vec<String> = normalize(a.as_str()).unwrap().iter().map(|t| t.as_str().to_owned()).collect();
            Contact { account: a.clone(), key: phonetic_key(a).as_str().to_owned(), words }
        })
        .collect();
    let expected: HashMap<String, String> = corpus["requests"]
        .as_array()
        .context("requests")?
        .iter()
        .map(|r| (r["id"].as_str().unwrap().to_owned(), r["spoken"].as_str().unwrap().to_owned()))
        .collect();
    let mut heard: HashMap<String, Value> = HashMap::new();
    for line in std::io::BufReader::new(std::fs::File::open(heard_path)?).lines() {
        let row: Value = serde_json::from_str(&line?)?;
        heard.insert(row["caseId"].as_str().context("caseId")?.to_owned(), row);
    }
    let mut out = BufWriter::new(std::fs::File::create(out_path)?);
    let mut rows = 0usize;
    for line in std::io::BufReader::new(std::fs::File::open(cases_path)?).lines() {
        let case: Value = serde_json::from_str(&line?)?;
        let case_id = case["caseId"].as_str().context("caseId")?;
        let request_id = case["requestId"].as_str().context("requestId")?;
        let want = expected.get(request_id).context("request")?;
        let mut row = json!({
            "caseId": case_id, "requestId": request_id, "role": case["role"], "missKind": case["missKind"],
            "voice": case["voice"], "rate": case["rate"], "audioText": case["text"], "expected": want,
        });
        match heard.get(case_id) {
            None => row["error"] = json!("no transcript"),
            Some(h) if h.get("error").is_some() => row["error"] = h["error"].clone(),
            Some(h) => {
                let text = h["heard"].as_str().unwrap_or_default();
                row["heard"] = json!(text);
                row["seconds"] = h["seconds"].clone();
                row["audioSeconds"] = h["audioSeconds"].clone();
                let plain = normalize(text).map(|t| t.iter().map(|w| w.as_str()).collect::<Vec<_>>().join(" "));
                row["ruleA"] = json!(plain.as_deref() == Some(want.as_str()));
                let is_transfer = request_id.starts_with('t');
                let w = rule_w(text, false, want, is_transfer, &contacts, &accounts);
                row["ruleW"] = json!(w.accepted);
                row["stage"] = json!(w.stage);
                row["detail"] = w.detail;
                let lit = rule_w(text, true, want, is_transfer, &contacts, &accounts);
                row["ruleWLiteral"] = json!(lit.accepted);
            }
        }
        serde_json::to_writer(&mut out, &row)?;
        out.write_all(b"\n")?;
        rows += 1;
    }
    out.flush()?;
    println!("rulew: {rows} rows");
    Ok(())
}

// ---------------------------------------------------------------------------
// Rule W2
//
// ```text
// txg-text rulew2 <corpus.json> <cases.jsonl> <heard.jsonl> <out.jsonl> <meta.json>
// ```
//
// Rule W with three changes:
// 1. Whole-word aliases in the text step (`ALIASES`).
// 2. An account token (letters with a separator `- _ .`, or letters and
//    digits in one token) is spelled: each digit becomes its own word and
//    each separator its word ("ops-42.testnet" -> "ops dash four two dot
//    testnet"). Other numbers stay values.
// 3. A valid vault per transfer request: the corpus contacts minus every
//    contact confusable with the receiver (the receiver stays), and minus the
//    later contact of any other confusable pair (corpus order). Recipient
//    match and `parse_transfer` use only that set.
// Each row also names the contact that the audio says, and whether it is a
// different contact confusable with the true receiver.

/// Whole-word aliases of the text step: heard word -> grammar word.
pub const ALIASES: [(&str, &str); 3] = [("approved", "approve"), ("nir", "near"), ("neer", "near")];

const DIGIT_WORDS: [&str; 10] = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const EDGE: [char; 7] = [',', '.', '!', '?', ';', ':', '"'];

fn is_account_token(core: &str) -> bool {
    let letter = core.chars().any(|c| c.is_ascii_alphabetic());
    let separator = core.chars().any(|c| matches!(c, '-' | '_' | '.'));
    let digit = core.chars().any(|c| c.is_ascii_digit());
    letter && (separator || digit)
}

/// Step 1 of Rule W2 before `normalize`. Returns the text and the aliases
/// that were applied.
pub fn clean2(heard: &str) -> (String, Vec<String>) {
    let mut text = heard.trim().to_lowercase();
    while text.ends_with(['.', ',', '!', '?']) {
        text.pop();
        text = text.trim_end().to_owned();
    }
    let mut out: Vec<String> = Vec::new();
    let mut applied = Vec::new();
    for token in text.split_ascii_whitespace() {
        let core = token.trim_matches(&EDGE[..]);
        if let Some((from, to)) = ALIASES.iter().find(|(from, _)| *from == core) {
            out.push((*to).to_owned());
            applied.push(format!("{from}->{to}"));
        } else if is_account_token(core) {
            let mut spelled = String::new();
            for c in core.chars() {
                match c {
                    '0'..='9' => {
                        spelled.push(' ');
                        spelled.push_str(DIGIT_WORDS[(c as u8 - b'0') as usize]);
                        spelled.push(' ');
                    }
                    '.' => spelled.push_str(" dot "),
                    '-' => spelled.push_str(" dash "),
                    '_' => spelled.push_str(" underscore "),
                    _ => spelled.push(c),
                }
            }
            out.push(spelled.split_ascii_whitespace().collect::<Vec<_>>().join(" "));
        } else {
            out.push(clean(token, false));
        }
    }
    (out.join(" "), applied)
}

/// Every word the grammar and this corpus can say: rendered requests, their
/// near misses and confusion sets, contacts, challenge words, number words.
fn grammar_words(corpus: &Value) -> std::collections::BTreeSet<String> {
    let mut texts: Vec<String> = Vec::new();
    for r in corpus["requests"].as_array().unwrap() {
        texts.push(r["spoken"].as_str().unwrap().to_owned());
        for m in r["nearMisses"].as_array().unwrap() {
            texts.push(m["text"].as_str().unwrap().to_owned());
        }
        for c in r["confusionSet"].as_array().unwrap() {
            texts.push(c.as_str().unwrap().to_owned());
        }
    }
    for c in corpus["contacts"].as_array().unwrap() {
        texts.push(c.as_str().unwrap().to_owned());
    }
    for w in spoken_intent::CHALLENGE_WORDS {
        texts.push(w.to_owned());
    }
    let mut n: u64 = 0;
    while n <= 120 {
        texts.push(n.to_string());
        n += 1;
    }
    for n in [1_000u64, 1_000_000, 1_000_000_000, 1_000_000_000_000, 1_000_000_000_000_000, u64::MAX] {
        texts.push(n.to_string());
    }
    texts.push("1.5".to_owned());
    let mut words = std::collections::BTreeSet::new();
    for t in texts {
        for w in normalize(&t).unwrap() {
            words.insert(w.as_str().to_owned());
        }
    }
    words
}

/// The contact indices of a valid vault whose transfer pays `receiver`.
fn vault_for(receiver: usize, contacts: &[Contact]) -> Vec<usize> {
    let keys: Vec<spoken_intent::PhoneticKey> = contacts.iter().map(|c| phonetic_key(&c.account)).collect();
    let mut kept = vec![receiver];
    for i in 0..contacts.len() {
        if i == receiver || keys[i].is_confusable_with(&keys[receiver]) {
            continue;
        }
        if kept.iter().any(|&k| keys[i].is_confusable_with(&keys[k])) {
            continue;
        }
        kept.push(i);
    }
    kept.sort_unstable();
    kept
}

fn rule_w2(heard: &str, expected: &str, is_transfer: bool, vault: &[&Contact]) -> Decision {
    let (cleaned, aliases) = clean2(heard);
    let Some(tokens) = normalize(&cleaned) else {
        return Decision { accepted: false, stage: "normalize", detail: json!({"cleaned": cleaned, "aliases": aliases}) };
    };
    let words: Vec<&str> = tokens.iter().map(|t| t.as_str()).collect();
    let normalized = join(&words);
    let mut detail = json!({"cleaned": cleaned, "normalized": normalized, "aliases": aliases});
    if !is_transfer {
        let accepted = normalized == expected;
        return Decision { accepted, stage: if accepted { "accepted" } else { "words" }, detail };
    }
    let mut final_words: Vec<String> = words.iter().map(|w| (*w).to_owned()).collect();
    if let Some(to) = words.iter().position(|w| *w == "to") {
        let recipient = &words[to + 1..];
        let key = words_key(recipient);
        let matches: Vec<&&Contact> = match &key {
            Some(k) => vault.iter().filter(|c| &c.key == k).collect(),
            None => Vec::new(),
        };
        detail["recipient"] = json!(join(recipient));
        detail["recipientKey"] = json!(key);
        detail["keyMatches"] = json!(matches.iter().map(|c| c.account.as_str()).collect::<Vec<_>>());
        if matches.len() != 1 {
            return Decision {
                accepted: false,
                stage: if key.is_none() { "recipient_unkeyable" } else if matches.is_empty() { "recipient_no_key_match" } else { "recipient_ambiguous" },
                detail,
            };
        }
        final_words.truncate(to + 1);
        final_words.extend(matches[0].words.iter().cloned());
    }
    let accounts: Vec<SpokenAccount> = vault.iter().map(|c| c.account.clone()).collect();
    let final_tokens = normalize(&final_words.join(" ")).expect("normalized words stay normalizable");
    match parse_transfer(&final_tokens, &accounts) {
        ParseResult::Transfer(p) => {
            let rendered = render(&SpokenRequestV1::AccountTransfer {
                network: Network::Testnet,
                owner: NearAccount::new("owner.testnet").unwrap(),
                receiver: p.receiver.clone(),
                amount: NearAmount::from_hundredths(p.amount.hundredths()).unwrap(),
            })
            .spoken_text;
            let accepted = rendered == expected;
            detail["rendered"] = json!(rendered);
            detail["parsedReceiver"] = json!(p.receiver.as_str());
            detail["parsedHundredths"] = json!(p.amount.hundredths());
            Decision { accepted, stage: if accepted { "accepted" } else { "render_differs" }, detail }
        }
        ParseResult::Refused(reason) => {
            detail["parseRefusal"] = json!(format!("{reason:?}"));
            Decision { accepted: false, stage: "parse", detail }
        }
    }
}

pub fn run2(corpus_path: &str, cases_path: &str, heard_path: &str, out_path: &str, meta_path: &str) -> Result<()> {
    let corpus: Value = serde_json::from_slice(&std::fs::read(corpus_path)?)?;
    let contacts: Vec<Contact> = corpus["contacts"]
        .as_array()
        .context("contacts")?
        .iter()
        .map(|c| {
            let a = SpokenAccount::new(c.as_str().unwrap()).expect("speakable contact");
            let words: Vec<String> = normalize(a.as_str()).unwrap().iter().map(|t| t.as_str().to_owned()).collect();
            Contact { key: phonetic_key(&a).as_str().to_owned(), account: a, words }
        })
        .collect();
    let index_of: HashMap<&str, usize> = contacts.iter().enumerate().map(|(i, c)| (c.account.as_str(), i)).collect();
    let by_words: HashMap<String, usize> = contacts.iter().enumerate().map(|(i, c)| (c.words.join(" "), i)).collect();

    // Alias check against every grammar word.
    let vocabulary = grammar_words(&corpus);
    let alias_check: Vec<Value> = ALIASES
        .iter()
        .map(|(from, to)| json!({"heard": from, "grammarWord": to, "targetIsGrammarWord": vocabulary.contains(*to), "aliasIsGrammarWord": vocabulary.contains(*from)}))
        .collect();
    anyhow::ensure!(ALIASES.iter().all(|(from, to)| !vocabulary.contains(*from) && vocabulary.contains(*to)), "alias check failed: {alias_check:?}");

    // Valid vaults.
    struct Req {
        expected: String,
        vault: Vec<usize>,
        receiver: Option<usize>,
    }
    let mut requests: HashMap<String, Req> = HashMap::new();
    let mut vault_rows = Vec::new();
    for r in corpus["requests"].as_array().context("requests")? {
        let id = r["id"].as_str().unwrap().to_owned();
        let receiver = r["receiver"].as_str().map(|a| *index_of.get(a).expect("receiver is a contact"));
        let vault = match receiver {
            Some(rc) => vault_for(rc, &contacts),
            None => (0..contacts.len()).collect(),
        };
        if let Some(rc) = receiver {
            let removed: Vec<&str> = (0..contacts.len()).filter(|i| !vault.contains(i)).map(|i| contacts[i].account.as_str()).collect();
            let keys_rc = phonetic_key(&contacts[rc].account);
            let with_receiver: Vec<&str> = (0..contacts.len())
                .filter(|&i| i != rc && phonetic_key(&contacts[i].account).is_confusable_with(&keys_rc))
                .map(|i| contacts[i].account.as_str())
                .collect();
            vault_rows.push(json!({"requestId": id, "receiver": contacts[rc].account.as_str(), "vaultSize": vault.len(),
                "removed": removed, "removedConfusableWithReceiver": with_receiver}));
        }
        requests.insert(id, Req { expected: r["spoken"].as_str().unwrap().to_owned(), vault, receiver });
    }
    let pairs: Vec<Value> = (0..contacts.len())
        .flat_map(|i| (i + 1..contacts.len()).map(move |j| (i, j)))
        .filter(|&(i, j)| phonetic_key(&contacts[i].account).is_confusable_with(&phonetic_key(&contacts[j].account)))
        .map(|(i, j)| json!([contacts[i].account.as_str(), contacts[j].account.as_str(), contacts[i].key, contacts[j].key]))
        .collect();
    let meta = json!({
        "aliases": alias_check,
        "grammarWordCount": vocabulary.len(),
        "contacts": contacts.len(),
        "confusablePairs": pairs,
        "vaults": vault_rows,
    });
    std::fs::write(meta_path, serde_json::to_vec_pretty(&meta)?)?;

    let mut heard: HashMap<String, Value> = HashMap::new();
    for line in std::io::BufReader::new(std::fs::File::open(heard_path)?).lines() {
        let row: Value = serde_json::from_str(&line?)?;
        heard.insert(row["caseId"].as_str().context("caseId")?.to_owned(), row);
    }
    let mut out = BufWriter::new(std::fs::File::create(out_path)?);
    let mut rows = 0usize;
    for line in std::io::BufReader::new(std::fs::File::open(cases_path)?).lines() {
        let case: Value = serde_json::from_str(&line?)?;
        let case_id = case["caseId"].as_str().context("caseId")?;
        let request_id = case["requestId"].as_str().context("requestId")?;
        let req = requests.get(request_id).context("request")?;
        let audio_text = case["text"].as_str().unwrap_or_default();
        let mut row = json!({
            "caseId": case_id, "requestId": request_id, "role": case["role"], "missKind": case["missKind"],
            "voice": case["voice"], "rate": case["rate"], "audioText": audio_text, "expected": req.expected,
        });
        let is_transfer = request_id.starts_with('t');
        if let (true, Some(rc)) = (is_transfer, req.receiver) {
            let audio_rec = audio_text.split_once(" to ").and_then(|(_, rest)| by_words.get(rest).copied());
            row["receiver"] = json!(contacts[rc].account.as_str());
            row["audioRecipient"] = json!(audio_rec.map(|i| contacts[i].account.as_str()));
            row["audioNamesConfusableOfReceiver"] = json!(audio_rec.is_some_and(|i| i != rc
                && phonetic_key(&contacts[i].account).is_confusable_with(&phonetic_key(&contacts[rc].account))));
            row["expectedHundredths"] = corpus["requests"].as_array().unwrap().iter()
                .find(|r| r["id"] == request_id).unwrap()["amountHundredths"].clone();
        }
        match heard.get(case_id) {
            None => row["error"] = json!("no transcript"),
            Some(h) if h.get("error").is_some() => row["error"] = h["error"].clone(),
            Some(h) => {
                let text = h["heard"].as_str().unwrap_or_default();
                row["heard"] = json!(text);
                row["seconds"] = h["seconds"].clone();
                row["audioSeconds"] = h["audioSeconds"].clone();
                let plain = normalize(text).map(|t| t.iter().map(|w| w.as_str()).collect::<Vec<_>>().join(" "));
                row["ruleA"] = json!(plain.as_deref() == Some(req.expected.as_str()));
                let all: Vec<&Contact> = contacts.iter().collect();
                let accounts: Vec<SpokenAccount> = contacts.iter().map(|c| c.account.clone()).collect();
                let w = rule_w(text, false, &req.expected, is_transfer, &contacts, &accounts);
                row["ruleW"] = json!(w.accepted);
                row["stageW"] = json!(w.stage);
                let vault: Vec<&Contact> = if is_transfer { req.vault.iter().map(|&i| &contacts[i]).collect() } else { all };
                let w2 = rule_w2(text, &req.expected, is_transfer, &vault);
                row["ruleW2"] = json!(w2.accepted);
                row["stage"] = json!(w2.stage);
                row["detail"] = w2.detail;
            }
        }
        serde_json::to_writer(&mut out, &row)?;
        out.write_all(b"\n")?;
        rows += 1;
    }
    out.flush()?;
    println!("rulew2: {rows} rows");
    Ok(())
}

// ---------------------------------------------------------------------------
// Rule W2 from the crate
//
// ```text
// txg-text rulecrate <corpus.json> <cases.jsonl> <heard.jsonl> <out.jsonl>
// ```
//
// The shipped text step: `spoken_intent::normalize_punctuated` with the valid
// vault of `vault_for` (transfers) or no contacts (multisig approvals), then
// `parse_transfer` and `render` (transfers) or word equality (approvals).
// Each row also carries the Rule W2 decision of `rule_w2` above, so the two
// can be compared case by case. The expected text is the corpus `spoken`
// text, as the audio was made from it.

fn rule_crate(heard: &str, expected: &str, is_transfer: bool, vault: &[SpokenAccount]) -> Decision {
    let contacts: &[SpokenAccount] = if is_transfer { vault } else { &[] };
    let tokens = match normalize_punctuated(heard, contacts) {
        Ok(tokens) => tokens,
        Err(refusal) => {
            let stage = match refusal {
                PunctuatedRefusal::NotNormalizable => "normalize",
                PunctuatedRefusal::RecipientUnkeyable => "recipient_unkeyable",
                PunctuatedRefusal::RecipientNotContact => "recipient_no_key_match",
                PunctuatedRefusal::RecipientAmbiguous => "recipient_ambiguous",
            };
            let recipient = heard.to_lowercase().split_once(" to ").map(|(_, rest)| rest.to_owned());
            return Decision {
                accepted: false,
                stage,
                detail: json!({"cleaned": heard.to_lowercase(), "recipient": recipient, "refusal": format!("{refusal:?}")}),
            };
        }
    };
    let normalized = tokens.iter().map(|t| t.as_str()).collect::<Vec<_>>().join(" ");
    let mut detail = json!({"normalized": normalized});
    if !is_transfer {
        let accepted = normalized == expected;
        return Decision { accepted, stage: if accepted { "accepted" } else { "words" }, detail };
    }
    match parse_transfer(&tokens, vault) {
        ParseResult::Transfer(p) => {
            let rendered = render(&SpokenRequestV1::AccountTransfer {
                network: Network::Testnet,
                owner: NearAccount::new("owner.testnet").unwrap(),
                receiver: p.receiver.clone(),
                amount: p.amount,
            })
            .spoken_text;
            let accepted = rendered == expected;
            detail["rendered"] = json!(rendered);
            detail["parsedReceiver"] = json!(p.receiver.as_str());
            detail["parsedHundredths"] = json!(p.amount.hundredths());
            Decision { accepted, stage: if accepted { "accepted" } else { "render_differs" }, detail }
        }
        ParseResult::Refused(reason) => {
            detail["parseRefusal"] = json!(format!("{reason:?}"));
            Decision { accepted: false, stage: "parse", detail }
        }
    }
}

pub fn run_crate(corpus_path: &str, cases_path: &str, heard_path: &str, out_path: &str) -> Result<()> {
    let corpus: Value = serde_json::from_slice(&std::fs::read(corpus_path)?)?;
    let contacts: Vec<Contact> = corpus["contacts"]
        .as_array()
        .context("contacts")?
        .iter()
        .map(|c| {
            let a = SpokenAccount::new(c.as_str().unwrap()).expect("speakable contact");
            let words: Vec<String> = normalize(a.as_str()).unwrap().iter().map(|t| t.as_str().to_owned()).collect();
            Contact { key: phonetic_key(&a).as_str().to_owned(), account: a, words }
        })
        .collect();
    let index_of: HashMap<&str, usize> = contacts.iter().enumerate().map(|(i, c)| (c.account.as_str(), i)).collect();
    let by_words: HashMap<String, usize> = contacts.iter().enumerate().map(|(i, c)| (c.words.join(" "), i)).collect();
    let requests: HashMap<String, &Value> =
        corpus["requests"].as_array().context("requests")?.iter().map(|r| (r["id"].as_str().unwrap().to_owned(), r)).collect();
    let mut heard: HashMap<String, Value> = HashMap::new();
    for line in std::io::BufReader::new(std::fs::File::open(heard_path)?).lines() {
        let row: Value = serde_json::from_str(&line?)?;
        heard.insert(row["caseId"].as_str().context("caseId")?.to_owned(), row);
    }
    let mut out = BufWriter::new(std::fs::File::create(out_path)?);
    let (mut rows, mut differ) = (0usize, 0usize);
    for line in std::io::BufReader::new(std::fs::File::open(cases_path)?).lines() {
        let case: Value = serde_json::from_str(&line?)?;
        let case_id = case["caseId"].as_str().context("caseId")?;
        let request_id = case["requestId"].as_str().context("requestId")?;
        let request = requests.get(request_id).context("request")?;
        let expected = request["spoken"].as_str().context("spoken")?;
        let receiver = request["receiver"].as_str().map(|a| *index_of.get(a).expect("receiver is a contact"));
        let is_transfer = request_id.starts_with('t');
        let vault: Vec<&Contact> = match receiver {
            Some(rc) if is_transfer => vault_for(rc, &contacts).into_iter().map(|i| &contacts[i]).collect(),
            _ => contacts.iter().collect(),
        };
        let vault_accounts: Vec<SpokenAccount> = vault.iter().map(|c| c.account.clone()).collect();
        let audio_text = case["text"].as_str().unwrap_or_default();
        let mut row = json!({
            "caseId": case_id, "requestId": request_id, "role": case["role"], "missKind": case["missKind"],
            "voice": case["voice"], "rate": case["rate"], "audioText": audio_text, "expected": expected,
            "requestKindDetail": request["kind"],
        });
        if let (true, Some(rc)) = (is_transfer, receiver) {
            let audio_rec = audio_text.split_once(" to ").and_then(|(_, rest)| by_words.get(rest).copied());
            row["receiver"] = json!(contacts[rc].account.as_str());
            row["audioRecipient"] = json!(audio_rec.map(|i| contacts[i].account.as_str()));
            row["audioNamesConfusableOfReceiver"] = json!(audio_rec.is_some_and(|i| i != rc
                && phonetic_key(&contacts[i].account).is_confusable_with(&phonetic_key(&contacts[rc].account))));
            row["expectedHundredths"] = request["amountHundredths"].clone();
        }
        match heard.get(case_id) {
            None => row["error"] = json!("no transcript"),
            Some(h) if h.get("error").is_some() => row["error"] = h["error"].clone(),
            Some(h) => {
                let text = h["heard"].as_str().unwrap_or_default();
                row["heard"] = json!(text);
                let plain = normalize(text).map(|t| t.iter().map(|w| w.as_str()).collect::<Vec<_>>().join(" "));
                row["ruleA"] = json!(plain.as_deref() == Some(expected));
                let w2 = rule_w2(text, expected, is_transfer, &vault);
                let c = rule_crate(text, expected, is_transfer, &vault_accounts);
                row["ruleW2"] = json!(w2.accepted);
                row["ruleW2Detail"] = w2.detail;
                row["ruleCrate"] = json!(c.accepted);
                row["stage"] = json!(c.stage);
                row["detail"] = c.detail;
                differ += usize::from(w2.accepted != c.accepted);
            }
        }
        serde_json::to_writer(&mut out, &row)?;
        out.write_all(b"\n")?;
        rows += 1;
    }
    out.flush()?;
    println!("rulecrate: {rows} rows, {differ} decisions differ from rule_w2");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean2_steps() {
        assert_eq!(clean2("Send 74.15 near to ops-42.testnet.").0, "send 74.15 near to ops dash four two dot testnet");
        assert_eq!(clean2("Send 1,300 NIR to rent-2026.testnet").0, "send 1300 near to rent dash two zero two six dot testnet");
        assert_eq!(clean2("Approved Proposal 13 Ad Member Alice 2.Testnet").0, "approve proposal 13 ad member alice two dot testnet");
        assert_eq!(clean2("to max99.testnet, neer").0, "to max nine nine dot testnet near");
        assert_eq!(clean2("Version 10374 kim-08.testnet").0, "version 10374 kim dash zero eight dot testnet");
    }

    #[test]
    fn clean_steps() {
        assert_eq!(clean(" Send 8,888.5 near to Eric.Testnet. ", false), "send 8888.5 near to eric dot testnet");
        assert_eq!(clean("Send 1 near to bob-1.testnet!", false), "send 1 near to bob dash 1 dot testnet");
        assert_eq!(clean("Send 2.5 near", true), "send 2 dot 5 near");
        assert_eq!(clean("to vault_3.testnet", false), "to vault underscore 3 dot testnet");
    }

    #[test]
    fn words_key_equals_account_key() {
        for id in ["eric.testnet", "bob-1.testnet", "rent-2026.testnet", "philip.near", "kim-08.testnet"] {
            let a = SpokenAccount::new(id).unwrap();
            let words: Vec<String> = normalize(id).unwrap().iter().map(|t| t.as_str().to_owned()).collect();
            let refs: Vec<&str> = words.iter().map(String::as_str).collect();
            assert_eq!(words_key(&refs).unwrap(), phonetic_key(&a).as_str(), "{id}");
        }
    }
}
