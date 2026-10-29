//! Spoken approval phrases: rules for the displayed phrase and strict transcript matching.
//!
//! A phrase names one action in common words and spoken numbers, for example
//! "pay invoice three five nine". The rules come from the 2026-10-29 speech bench
//! (`voiceId/stt-bench`): phrases without names or homophones raised Whisper's
//! correct accepts from 71% to 98% with no near miss accepted, and words that sound
//! alike inside one set of phrases caused the only false accepts.
//!
//! Names cannot be detected here; the caller composes phrases from common words.
//! A match is evidence that the words were said. It grants no approval authority.

use std::collections::BTreeSet;

/// Shortest and longest phrase, in words.
pub const PHRASE_WORDS: std::ops::RangeInclusive<usize> = 3..=8;

/// Words that sound like another word ("flour" and "flower", "two" and "to").
/// "one", "two", "four" and "eight" are refused for the same reason; teens and
/// tens are refused because "fifteen" and "fifty" sound alike in noise.
const SOUND_ALIKE_WORDS: &[&str] = &[
    "access",
    "ad",
    "add",
    "ate",
    "buy",
    "by",
    "bye",
    "cache",
    "cash",
    "cell",
    "eight",
    "eighteen",
    "eighty",
    "excess",
    "fifteen",
    "fifty",
    "flour",
    "flower",
    "for",
    "fore",
    "forty",
    "four",
    "fourteen",
    "knew",
    "new",
    "nineteen",
    "ninety",
    "one",
    "read",
    "red",
    "reed",
    "rights",
    "sails",
    "sales",
    "sea",
    "see",
    "sell",
    "seventeen",
    "seventy",
    "sixteen",
    "sixty",
    "thirteen",
    "thirty",
    "to",
    "too",
    "twelve",
    "twenty",
    "two",
    "weakly",
    "weekly",
    "won",
    "writes",
];

/// Groups of words that Whisper or Moonshine confused in the bench. Two phrases in
/// one set must not differ only by words of one group.
const CONFUSED_WORDS: &[&[&str]] = &[
    &["stock", "staff", "stop"],
    &["batch", "badge"],
    &["price", "prize"],
    &["cake", "case"],
    &["send", "sent"],
    &["the", "a", "an"],
];

const FILLER_WORDS: &[&str] = &["hmm", "mm", "mhm", "mmm", "uh", "um"];

const DIGITS: &[(&str, u64)] = &[
    ("zero", 0),
    ("one", 1),
    ("two", 2),
    ("three", 3),
    ("four", 4),
    ("five", 5),
    ("six", 6),
    ("seven", 7),
    ("eight", 8),
    ("nine", 9),
];
const TEENS_AND_TENS: &[(&str, u64)] = &[
    ("ten", 10),
    ("eleven", 11),
    ("twelve", 12),
    ("thirteen", 13),
    ("fourteen", 14),
    ("fifteen", 15),
    ("sixteen", 16),
    ("seventeen", 17),
    ("eighteen", 18),
    ("nineteen", 19),
    ("twenty", 20),
    ("thirty", 30),
    ("forty", 40),
    ("fifty", 50),
    ("sixty", 60),
    ("seventy", 70),
    ("eighty", 80),
    ("ninety", 90),
];
const MULTIPLIERS: &[(&str, u64)] = &[("hundred", 100), ("thousand", 1_000)];

/// Why a phrase or a set of phrases breaks the rules.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PhraseError {
    /// Fewer than three or more than eight words.
    Length,
    /// A word holds a digit or a symbol. Write numbers as spoken words.
    Characters,
    /// A word sounds like another word, for example "flour".
    SoundAlike,
    /// "hundred" or "thousand" without one digit word before it, or with a digit word after it.
    Number,
    /// Two phrases in one set are the same.
    Duplicate,
    /// Two phrases in one set differ only by words that sound alike, for example
    /// "share the stock report" and "share the staff report".
    Confusable,
}

/// One displayed approval phrase that passed the rules.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActionPhrase {
    words: Vec<String>,
    spoken: String,
}

impl ActionPhrase {
    /// Check one phrase. Case and runs of spaces are ignored.
    pub fn new(text: &str) -> Result<Self, PhraseError> {
        let words: Vec<String> = text
            .split_whitespace()
            .map(str::to_ascii_lowercase)
            .collect();
        if !PHRASE_WORDS.contains(&words.len()) {
            return Err(PhraseError::Length);
        }
        if words
            .iter()
            .any(|word| !word.bytes().all(|byte| byte.is_ascii_lowercase()))
        {
            return Err(PhraseError::Characters);
        }
        if words
            .iter()
            .any(|word| SOUND_ALIKE_WORDS.contains(&word.as_str()))
        {
            return Err(PhraseError::SoundAlike);
        }
        for (index, word) in words.iter().enumerate() {
            if lookup(MULTIPLIERS, word).is_none() {
                continue;
            }
            let before = index
                .checked_sub(1)
                .and_then(|previous| lookup(DIGITS, &words[previous]));
            let after = words.get(index + 1).and_then(|next| lookup(DIGITS, next));
            if before.is_none() || after.is_some() {
                return Err(PhraseError::Number);
            }
        }
        let spoken = spoken_form(&words.join(" "));
        Ok(Self { words, spoken })
    }

    /// The phrase as the person reads it.
    pub fn text(&self) -> String {
        self.words.join(" ")
    }

    /// Strict match: after normalization the heard words equal the phrase. Case,
    /// punctuation, digits for number words, "¥600" for "six hundred yen", fillers
    /// such as "um", and spacing ("re-fund") do not change the result. Any other
    /// added, missing, or changed word refuses the match.
    pub fn matches(&self, heard: &str) -> bool {
        !self.spoken.is_empty() && spoken_form(heard) == self.spoken
    }
}

/// A set of phrases that can be on screen in one context. No two may be confused.
#[derive(Clone, Debug)]
pub struct PhraseBank {
    phrases: Vec<ActionPhrase>,
}

impl PhraseBank {
    /// Check every phrase and every pair of phrases.
    pub fn new<'a>(texts: impl IntoIterator<Item = &'a str>) -> Result<Self, PhraseError> {
        let phrases = texts
            .into_iter()
            .map(ActionPhrase::new)
            .collect::<Result<Vec<_>, _>>()?;
        let mut seen = BTreeSet::new();
        for phrase in &phrases {
            if !seen.insert(phrase.spoken.as_str()) {
                return Err(PhraseError::Duplicate);
            }
        }
        for (index, left) in phrases.iter().enumerate() {
            for right in &phrases[index + 1..] {
                if confusable(&left.words, &right.words) {
                    return Err(PhraseError::Confusable);
                }
            }
        }
        Ok(Self { phrases })
    }

    /// Phrases in their original order.
    pub fn phrases(&self) -> &[ActionPhrase] {
        &self.phrases
    }
}

/// Same length with one differing word that sounds alike, or one extra article.
fn confusable(left: &[String], right: &[String]) -> bool {
    if left.len() == right.len() {
        let mut differences = left.iter().zip(right).filter(|(a, b)| a != b);
        return match (differences.next(), differences.next()) {
            (Some((a, b)), None) => sounds_alike(a, b),
            _ => false,
        };
    }
    let (short, long) = if left.len() < right.len() {
        (left, right)
    } else {
        (right, left)
    };
    if long.len() != short.len() + 1 {
        return false;
    }
    (0..long.len()).any(|skip| {
        matches!(long[skip].as_str(), "the" | "a" | "an")
            && long[..skip] == short[..skip]
            && long[skip + 1..] == short[skip..]
    })
}

fn sounds_alike(left: &str, right: &str) -> bool {
    CONFUSED_WORDS
        .iter()
        .any(|group| group.contains(&left) && group.contains(&right))
        || sound_key(left) == sound_key(right)
}

/// American Soundex. Coarse on purpose: it flags "batch"/"badge" and "price"/"prize".
fn sound_key(word: &str) -> [u8; 4] {
    fn code(byte: u8) -> u8 {
        match byte {
            b'b' | b'f' | b'p' | b'v' => b'1',
            b'c' | b'g' | b'j' | b'k' | b'q' | b's' | b'x' | b'z' => b'2',
            b'd' | b't' => b'3',
            b'l' => b'4',
            b'm' | b'n' => b'5',
            b'r' => b'6',
            _ => 0,
        }
    }
    let bytes = word.as_bytes();
    let mut key = [b'0'; 4];
    let Some(&first) = bytes.first() else {
        return key;
    };
    key[0] = first.to_ascii_uppercase();
    let mut length = 1;
    let mut previous = code(first);
    for &byte in &bytes[1..] {
        let current = code(byte);
        if current != 0 && current != previous && length < 4 {
            key[length] = current;
            length += 1;
        }
        if byte != b'h' && byte != b'w' {
            previous = current;
        }
    }
    key
}

/// Lowercase words with number words as digits and spacing removed, as in the bench
/// scorer: "Pay ¥3,000 deposit." and "pay three thousand yen deposit" both give
/// "pay3000yendeposit".
fn spoken_form(text: &str) -> String {
    let text = text.to_lowercase();
    let mut expanded = String::with_capacity(text.len() + 8);
    let characters: Vec<char> = text.chars().collect();
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if character == '¥' {
            let mut end = index + 1;
            while end < characters.len() && characters[end] == ' ' {
                end += 1;
            }
            let digits_start = end;
            while end < characters.len()
                && (characters[end].is_ascii_digit() || characters[end] == ',')
            {
                end += 1;
            }
            if end > digits_start && characters[digits_start].is_ascii_digit() {
                expanded.extend(&characters[digits_start..end]);
                expanded.push_str(" yen");
                index = end;
                continue;
            }
        }
        let between_digits = index > 0
            && characters[index - 1].is_ascii_digit()
            && characters.get(index + 1).is_some_and(char::is_ascii_digit);
        // Whisper writes "nine" as "9:00" or "9.00". The bench scorer refused "9:00";
        // nothing else is said, so the hour alone remains.
        if between_digits
            && (character == ':' || character == '.')
            && characters.get(index + 1..index + 3) == Some(&['0', '0'][..])
            && !characters.get(index + 3).is_some_and(char::is_ascii_digit)
        {
            index += 3;
            continue;
        }
        // "3,000" is one number; "9:30" reads as "930", as in the bench scorer.
        if between_digits && (character == ',' || character == ':') {
            index += 1;
            continue;
        }
        expanded.push(if character.is_ascii_alphanumeric() {
            character
        } else {
            ' '
        });
        index += 1;
    }
    let mut tokens: Vec<String> = Vec::new();
    for word in expanded.split_whitespace() {
        if FILLER_WORDS.contains(&word) {
            continue;
        }
        if let Some(value) = lookup(DIGITS, word) {
            // "twenty five" is 25.
            if let Some(last) = tokens.last_mut()
                && let Ok(tens) = last.parse::<u64>()
                && (20..100).contains(&tens)
                && tens % 10 == 0
                && value > 0
            {
                *last = (tens + value).to_string();
                continue;
            }
            tokens.push(value.to_string());
        } else if let Some(value) = lookup(TEENS_AND_TENS, word) {
            tokens.push(value.to_string());
        } else if let Some(multiplier) = lookup(MULTIPLIERS, word) {
            match tokens.last_mut().and_then(|last| {
                last.parse::<u64>()
                    .ok()
                    .and_then(|number| number.checked_mul(multiplier))
                    .map(|product| (last, product))
            }) {
                Some((last, product)) => *last = product.to_string(),
                None => tokens.push(multiplier.to_string()),
            }
        } else {
            tokens.push(word.to_owned());
        }
    }
    tokens.concat()
}

fn lookup(table: &[(&str, u64)], word: &str) -> Option<u64> {
    table
        .iter()
        .find(|(name, _)| *name == word)
        .map(|(_, value)| *value)
}
