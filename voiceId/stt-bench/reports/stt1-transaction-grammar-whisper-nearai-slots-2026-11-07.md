# Gate STT-1, Whisper large-v3 on NEAR AI Cloud, crate slot rules — 2026-11-07

Sixth run of Refactor 210 plan item 8 (`docs/refactor-210-voice-intents.md`
Section 9), task K. It rescores the Whisper transcripts of
[`stt1-transaction-grammar-whisper-nearai-2026-11-07.md`](stt1-transaction-grammar-whisper-nearai-2026-11-07.md)
with two new slot rules in `spoken_intent::normalize_punctuated`
(`seams-wallet/crates/spoken-intent/src/punctuated.rs`). The previous run is
[`stt1-transaction-grammar-whisper-nearai-crate-2026-11-07.md`](stt1-transaction-grammar-whisper-nearai-crate-2026-11-07.md).
Full metrics:
[`stt1-transaction-grammar-whisper-nearai-slots-2026-11-07.json`](stt1-transaction-grammar-whisper-nearai-slots-2026-11-07.json).

## Result

**STT-1 still fails.** The crate text step accepts 88.4% of correct readings
(pass needs 95%). It has 0 false accepts. Transfers rise from 94.3% to 94.6%.

| Rule | Correct accepted | Transfers | Multisig | False accepts | Pass |
| --- | --- | --- | --- | --- | --- |
| Crate with slot rules | 2,652 of 3,000 (88.4%) | 2,270 of 2,400 (94.6%) | 382 of 600 (63.7%) | 0 of 3,742 | no |
| Crate, previous run | 2,644 of 3,000 (88.1%) | 2,262 of 2,400 (94.3%) | 382 of 600 (63.7%) | 0 of 3,742 | no |
| Rule W2 (in-tool) | 2,531 of 3,000 (84.4%) | 2,262 of 2,400 (94.3%) | 269 of 600 (44.8%) | 0 of 3,742 | no |

This run made no network calls. It reused the 6,742 transcripts. The 69
accepted near misses are the same homophones of the true receiver as before
(the audio names a contact that the valid vault does not hold).

## The two rules

Both rules apply only in a sentence whose first word is "send".

1. **Amount slot** (`two_heard_as_to`). If the words are "send to near to …"
   or "send too near to …", the second word becomes "two". Whisper writes
   the spoken "two" as "to" ("Send to near to lab underscore seven dot
   testnet").
2. **Network suffix** (`dot_before_testnet`). If the recipient words match
   no contact, have a word before a final "testnet", and that word is not
   "dot", "dot" is put before "testnet" and the match is tried once more.
   The match must still be exactly one contact by equal `phonetic_key`.
   Mainnet ("near" suffix) has no rule: the function does not know the
   network, and "near" is also the amount unit.

The first version of rule 2 put "dot" in before the match. That lost 5
correct readings: "umidot testnet" has the key of "uma dot testnet", and
"umidot dot testnet" does not. So rule 2 now runs only when the words as
heard match no contact.

## What changed

All 8 changed decisions are correct transfers of request `t111` ("send two
near to lab underscore seven dot testnet") that rule 1 now accepts. Rule 2
changes no decision: no transcript in this corpus drops "dot" before
"testnet". The observed live error "seams v1 testnet" is in the grammar tests
and the vectors, not in this corpus.

Rule 1 also reads 5 near misses, and each is still refused because the
rendered request differs from the expected text:

| Near miss kind | Heard | Expected request |
| --- | --- | --- |
| `one_digit` | "Send to near to lisa.testnet." | three near |
| `moved_decimal` (2) | "Send to near to tina.testnet." | zero point zero two near |
| `other_contact` (2) | "Send to near to fund underscore nine dot testnet." | lab underscore seven |

## Near-miss categories

The corpus has 13 near-miss kinds: `add_remove_swapped`, `added_clause`,
`changed_verb`, `missing_amount`, `moved_decimal`, `negation`, `one_digit`,
`other_contact`, `proposal_id`, `swapped_challenge`, `ten_times`,
`threshold_changed`, `version_digit`. Each has 0 false accepts. The rules
cannot change the five kinds that apply to approvals only. For the others:

- `missing_amount`: rule 1 needs "near" and then "to" after the word, so
  "send to alice dot testnet" and "send near to alice dot testnet" stay
  refused.
- `negation`, `changed_verb`: the first word is not "send", or "not" is the
  second word, so no rule applies.
- `added_clause`: the recipient holds the second clause, so it matches no
  contact with or without "dot".
- `other_contact`, `one_digit`, `moved_decimal`, `ten_times`: the rules do
  not change a contact or an amount other than "to" in the slot "send _ near
  to". The decision still compares the rendered request with the expected
  text.

The crate tests `two_heard_as_to_fills_only_a_one_word_amount_slot` and
`dot_before_testnet_keeps_the_contact_match` (`tests/grammar.rs`) check these
refusals directly.

## Remaining refused correct readings

348 correct readings are refused: 218 multisig word differences, 86
`parse_transfer` refusals and 44 recipients with no key match. Two of these
are "Send to near2lab underscore 7 dot testnet": Whisper joins "to" with
"lab", so rule 1 does not apply.

## Commands

From `voiceId/stt-bench`. `R` is the first run's work folder
(`corpus.json`, `cases.jsonl`); `H` is the Whisper transcript file; `W` is a
scratch folder.

```sh
cargo run --release --offline --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir "$W/target" -- \
  rulecrate "$R/corpus.json" "$R/cases.jsonl" "$H" "$W/decisions-slots.jsonl"
python3 transaction-grammar/score_whisper_crate.py "$W/decisions-slots.jsonl" \
  reports/stt1-transaction-grammar-whisper-nearai-slots-2026-11-07.json
```

The scorer code is unchanged. The JSON `date` and `decisions` fields are the
scorer's fixed values.
