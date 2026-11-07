//! Seeded corpus of `spoken-intent` requests, their near misses and their
//! confusion sets. Every text comes from the crate's `render`; the near-miss
//! texts that the grammar cannot express (negation, a changed verb, an added
//! clause, a missing amount) are edits of rendered token lists.

use std::num::NonZeroU8;

use serde_json::{json, Value};
use spoken_intent::{
    confusion_set, phonetic_key, render, ChallengeWord, NearAmount, Network, ProposalV1,
    SpokenAccount, SpokenRequestV1, CHALLENGE_WORDS, RENDERER_VERSION,
};

/// The 60 contacts: confusable pairs, digits, dashes and underscores.
pub const ACCOUNTS: [&str; 60] = [
    // Confusable pairs (Section 9.2).
    "alice.testnet", "alicia.testnet", "jon.testnet", "john.testnet", "rob.testnet",
    "bob.testnet", "payroll.testnet", "payrolls.testnet", "sara.testnet", "sarah.testnet",
    "eric.testnet", "erik.testnet", "anna.testnet", "hannah.testnet", "mark.testnet",
    "marco.testnet", "tom.testnet", "tim.testnet", "ben.testnet", "ken.testnet",
    "lisa.testnet", "liza.testnet", "dan.testnet", "dana.testnet", "nina.testnet",
    "tina.testnet",
    // Digits and separators.
    "bob-1.testnet", "bob-2.testnet", "alice2.testnet", "team-7.testnet", "vault_3.testnet",
    "ops-42.testnet", "fund_9.testnet", "savings-1.testnet", "rent-2026.testnet",
    "gift_5.testnet", "kim-08.testnet", "studio-3.testnet", "lab_7.testnet", "max99.testnet",
    // Plain names, some on mainnet-style `.near`.
    "carol.near", "david.near", "emma.near", "frank.near", "grace.near", "henry.testnet",
    "ivan.testnet", "julia.testnet", "oliver.testnet", "peter.testnet", "quinn.near",
    "ruby.near", "steve.testnet", "uma.testnet", "victor.testnet", "wendy.near",
    "zoe.testnet", "felix.testnet", "maya.near", "leo.testnet",
];

pub const TRANSFER_REQUESTS: usize = 200;
pub const MULTISIG_REQUESTS: usize = 50;

pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    pub fn next(&mut self) -> u64 {
        // xorshift64*
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    pub fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn text(tokens: &[spoken_intent::SpokenToken]) -> String {
    tokens.iter().map(|t| t.as_str()).collect::<Vec<_>>().join(" ")
}

fn account(id: &str) -> SpokenAccount {
    SpokenAccount::new(id).unwrap_or_else(|_| panic!("unspeakable account {id}"))
}

fn amount(hundredths: u64) -> NearAmount {
    NearAmount::from_hundredths(hundredths).expect("speakable amount")
}

/// 200 amounts in hundredths: structural values first, then a seeded
/// log-uniform fill with one and two decimals.
fn sample_amounts(rng: &mut Rng) -> Vec<u64> {
    let mut values: Vec<u64> = Vec::new();
    // Edges.
    for v in [1u64, 2, 5, 9, 10, 50, 99, 100, 101, 100_000_000, 99_999_999, 10_000_000] {
        values.push(v);
    }
    // Teens and tens (13 and 30, ... 19 and 90), whole and as decimals.
    for teen in 13u64..=19 {
        let ten = (teen - 10) * 10;
        values.push(teen * 100);
        values.push(ten * 100);
        values.push(teen * 10); // 1.3 .. 1.9
        values.push(teen * 10_000); // 1,300 .. 1,900
        values.push(ten * 10_000); // 3,000 .. 9,000
    }
    // Repeated digits.
    for d in 1u64..=9 {
        values.push(d * 11 * 100); // 11 .. 99
        values.push(d * 111); // 1.11 .. 9.99
        values.push(d * 111_100); // 1,111 .. 9,999
        values.push(d * 11); // 0.11 .. 0.99
    }
    // Plan examples.
    for v in [2_500u64, 250, 125_000, 25] {
        values.push(v);
    }
    values.sort_unstable();
    values.dedup();
    while values.len() < TRANSFER_REQUESTS {
        // Log-uniform whole part from 0 to 999,999, then 0, 1 or 2 decimals.
        let magnitude = rng.below(6) as u32;
        let whole = rng.below(10u64.pow(magnitude + 1));
        let fraction = match rng.below(3) {
            0 => 0,
            1 => rng.below(10) * 10,
            _ => rng.below(100),
        };
        let v = whole * 100 + fraction;
        if (1..=100_000_000).contains(&v) && !values.contains(&v) {
            values.push(v);
        }
    }
    values.truncate(TRANSFER_REQUESTS);
    // Seeded shuffle, so amounts do not follow account order.
    for i in (1..values.len()).rev() {
        let j = rng.below(i as u64 + 1) as usize;
        values.swap(i, j);
    }
    values
}

fn edit_distance(a: &[u8], b: &[u8]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut next = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            next.push((next[j] + 1).min(prev[j + 1] + 1).min(prev[j] + usize::from(ca != cb)));
        }
        prev = next;
    }
    prev[b.len()]
}

/// The other contact whose phonetic key is closest; ties go to the lower
/// index.
fn closest_contact(receiver: &SpokenAccount, contacts: &[SpokenAccount]) -> SpokenAccount {
    let key = phonetic_key(receiver);
    contacts
        .iter()
        .filter(|c| *c != receiver)
        .min_by_key(|c| edit_distance(key.as_str().as_bytes(), phonetic_key(c).as_str().as_bytes()))
        .cloned()
        .expect("another contact")
}

fn amount_category(hundredths: u64) -> &'static str {
    if hundredths % 100 != 0 {
        if hundredths % 10 != 0 { "two_decimals" } else { "one_decimal" }
    } else if hundredths >= 100_000 {
        "whole_1000_plus"
    } else {
        "whole_below_1000"
    }
}

fn account_category(id: &str) -> &'static str {
    let name = id.split('.').next().unwrap_or(id);
    if name.contains('_') {
        "underscore"
    } else if name.contains('-') {
        "dash"
    } else if name.bytes().any(|b| b.is_ascii_digit()) {
        "digit"
    } else {
        "letters"
    }
}

fn tokens_of(request: &SpokenRequestV1) -> Vec<String> {
    render(request).spoken.iter().map(|t| t.as_str().to_owned()).collect()
}

fn join(words: &[String]) -> String {
    words.join(" ")
}

/// Positions of the amount words inside a transfer's spoken tokens:
/// between `send` and `near`.
fn without_amount(words: &[String], send_index: usize) -> Vec<String> {
    let near = words[send_index..].iter().position(|w| w == "near").expect("near") + send_index;
    let mut out = words[..=send_index].to_vec();
    out.extend_from_slice(&words[near..]);
    out
}

fn added_clause(words: &[String], other: &SpokenAccount) -> Vec<String> {
    let clause = render(&SpokenRequestV1::VaultTransfer {
        network: Network::Testnet,
        vault: account("vault.testnet"),
        owner: account("owner.testnet"),
        receiver: other.clone(),
        amount: amount(10_000),
        nonce: 0,
    });
    let mut out = words.to_vec();
    out.push("and".into());
    out.extend(clause.spoken.iter().map(|t| t.as_str().to_owned()));
    out
}

fn amount_misses(h: u64) -> Vec<(&'static str, u64)> {
    let mut out = Vec::new();
    if h * 10 <= 100_000_000 {
        out.push(("ten_times", h * 10));
    }
    // A moved decimal point: one tenth if exact, else one hundred times.
    if h % 10 == 0 && h / 10 >= 1 {
        out.push(("moved_decimal", h / 10));
    } else if h * 100 <= 100_000_000 {
        out.push(("moved_decimal", h * 100));
    }
    out
}

/// One digit of the amount in hundredths (padded to three digits) changed,
/// chosen from every speakable result. 1,000,000 NEAR has none.
fn one_digit_change(h: u64, rng: &mut Rng) -> Option<u64> {
    let digits = format!("{h:03}").into_bytes();
    let mut candidates = Vec::new();
    for position in 0..digits.len() {
        for digit in b'0'..=b'9' {
            if digit == digits[position] {
                continue;
            }
            let mut bytes = digits.clone();
            bytes[position] = digit;
            let candidate: u64 = String::from_utf8(bytes).unwrap().parse().unwrap();
            if (1..=100_000_000).contains(&candidate) {
                candidates.push(candidate);
            }
        }
    }
    if candidates.is_empty() {
        return None;
    }
    Some(candidates[rng.below(candidates.len() as u64) as usize])
}

pub fn build(seed: u64) -> Value {
    let mut rng = Rng::new(seed);
    let contacts: Vec<SpokenAccount> = ACCOUNTS.iter().map(|a| account(a)).collect();
    let vault = account("vault.testnet");
    let owner = account("owner.testnet");
    let amounts = sample_amounts(&mut rng);
    let mut requests: Vec<Value> = Vec::new();

    let vault_transfer = |receiver: &SpokenAccount, h: u64, nonce: u64| SpokenRequestV1::VaultTransfer {
        network: Network::Testnet,
        vault: vault.clone(),
        owner: owner.clone(),
        receiver: receiver.clone(),
        amount: amount(h),
        nonce,
    };

    for (index, &h) in amounts.iter().enumerate() {
        let receiver = &contacts[(index * 37 + 11) % contacts.len()];
        let nonce = rng.below(1_000_000);
        let request = vault_transfer(receiver, h, nonce);
        let words = tokens_of(&request);
        let mut misses: Vec<(String, Vec<String>)> = Vec::new();
        if let Some(changed) = one_digit_change(h, &mut rng) {
            misses.push(("one_digit".into(), tokens_of(&vault_transfer(receiver, changed, nonce))));
        }
        for (kind, value) in amount_misses(h) {
            misses.push((kind.into(), tokens_of(&vault_transfer(receiver, value, nonce))));
        }
        let other = closest_contact(receiver, &contacts);
        misses.push(("other_contact".into(), tokens_of(&vault_transfer(&other, h, nonce))));
        let mut verb = words.clone();
        verb[0] = "lend".into();
        misses.push(("changed_verb".into(), verb));
        let mut negated = vec!["do".to_owned(), "not".to_owned()];
        negated.extend(words.iter().cloned());
        misses.push(("negation".into(), negated));
        misses.push(("added_clause".into(), added_clause(&words, &other)));
        misses.push(("missing_amount".into(), without_amount(&words, 0)));
        let confusion: Vec<String> = confusion_set(&request, &contacts).iter().map(|t| text(t)).collect();
        requests.push(json!({
            "id": format!("t{index:03}"),
            "kind": "transfer",
            "amountCategory": amount_category(h),
            "accountCategory": account_category(receiver.as_str()),
            "receiver": receiver.as_str(),
            "amountHundredths": h,
            "display": render(&request).display_text,
            "spoken": join(&words),
            "confusionSet": confusion,
            "nearMisses": misses.into_iter().map(|(k, w)| json!({"kind": k, "text": join(&w)})).collect::<Vec<_>>(),
        }));
    }

    let multisig = account("treasury.testnet");
    let fixed_ids = [1u64, 13, 30, 42, 100, 999, 17, 70, 115, 550];
    for index in 0..MULTISIG_REQUESTS {
        let proposal_id = fixed_ids.get(index).copied().unwrap_or_else(|| 1 + rng.below(999));
        let first = rng.below(64) as u8;
        let second = (first as u64 + 1 + rng.below(63)) as u8 % 64;
        let challenge = [ChallengeWord::from_index(first).unwrap(), ChallengeWord::from_index(second).unwrap()];
        let member = &contacts[(index * 23 + 5) % contacts.len()];
        let (kind_name, proposal) = match index % 5 {
            0 => ("ms_transfer", ProposalV1::Transfer { receiver: member.clone(), amount: amount(amounts[index] ) }),
            1 => ("ms_add_member", ProposalV1::AddMember { member: member.clone() }),
            2 => ("ms_remove_member", ProposalV1::RemoveMember { member: member.clone() }),
            3 => ("ms_set_threshold", ProposalV1::SetThreshold { threshold: NonZeroU8::new(1 + rng.below(9) as u8).unwrap() }),
            _ => {
                let mut hash = [0u8; 32];
                for byte in hash.iter_mut() {
                    *byte = rng.below(256) as u8;
                }
                ("ms_set_verifier_version", ProposalV1::SetVerifierVersion { version_hash: hash })
            }
        };
        let approval = |id: u64, proposal: ProposalV1, challenge: [ChallengeWord; 2]| SpokenRequestV1::MultisigApproval {
            network: Network::Testnet,
            multisig: multisig.clone(),
            proposal_id: id,
            proposal,
            challenge,
        };
        let request = approval(proposal_id, proposal.clone(), challenge);
        let words = tokens_of(&request);
        let mut misses: Vec<(String, Vec<String>)> = Vec::new();
        let neighbour = if proposal_id > 1 && rng.below(2) == 0 { proposal_id - 1 } else { proposal_id + 1 };
        misses.push(("proposal_id".into(), tokens_of(&approval(neighbour, proposal.clone(), challenge))));
        misses.push(("swapped_challenge".into(), tokens_of(&approval(proposal_id, proposal.clone(), [challenge[1], challenge[0]]))));
        let variant = match &proposal {
            ProposalV1::Transfer { receiver, amount: a } => {
                if let Some(changed) = one_digit_change(a.hundredths(), &mut rng) {
                    misses.push(("one_digit".into(), tokens_of(&approval(proposal_id, ProposalV1::Transfer { receiver: receiver.clone(), amount: amount(changed) }, challenge))));
                }
                let mut missing = words.clone();
                let send = missing.iter().position(|w| w == "send").unwrap();
                missing = without_amount(&missing, send);
                misses.push(("missing_amount".into(), missing));
                ("other_contact", ProposalV1::Transfer { receiver: closest_contact(receiver, &contacts), amount: *a })
            }
            ProposalV1::AddMember { member } => ("add_remove_swapped", ProposalV1::RemoveMember { member: member.clone() }),
            ProposalV1::RemoveMember { member } => ("add_remove_swapped", ProposalV1::AddMember { member: member.clone() }),
            ProposalV1::SetThreshold { threshold } => ("threshold_changed", ProposalV1::SetThreshold { threshold: NonZeroU8::new(threshold.get() % 9 + 1).unwrap() }),
            ProposalV1::SetVerifierVersion { version_hash } => {
                let mut hash = *version_hash;
                hash[0] ^= 0x01; // changes the leading digits
                ("version_digit", ProposalV1::SetVerifierVersion { version_hash: hash })
            }
        };
        let variant_words = tokens_of(&approval(proposal_id, variant.1, challenge));
        if variant_words != words {
            misses.push((variant.0.into(), variant_words));
        }
        let mut verb = words.clone();
        verb[0] = "improve".into();
        misses.push(("changed_verb".into(), verb));
        let mut negated = vec!["do".to_owned(), "not".to_owned()];
        negated.extend(words.iter().cloned());
        misses.push(("negation".into(), negated));
        misses.push(("added_clause".into(), added_clause(&words, &closest_contact(member, &contacts))));
        let confusion: Vec<String> = confusion_set(&request, &contacts).iter().map(|t| text(t)).collect();
        requests.push(json!({
            "id": format!("m{index:03}"),
            "kind": kind_name,
            "proposalId": proposal_id,
            "display": render(&request).display_text,
            "spoken": join(&words),
            "confusionSet": confusion,
            "nearMisses": misses.into_iter().map(|(k, w)| json!({"kind": k, "text": join(&w)})).collect::<Vec<_>>(),
        }));
    }

    json!({
        "renderer": RENDERER_VERSION,
        "seed": seed,
        "contacts": ACCOUNTS.as_slice(),
        "challengeWords": CHALLENGE_WORDS.as_slice(),
        "requests": requests,
    })
}
