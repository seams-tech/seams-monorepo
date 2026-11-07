# Gate STT-1, Whisper large-v3 on NEAR AI Cloud, crate text step — 2026-11-07

Fifth run of Refactor 210 plan item 8 (`docs/refactor-210-voice-intents.md`
Section 9). It rescores the Whisper transcripts of
[`stt1-transaction-grammar-whisper-nearai-2026-11-07.md`](stt1-transaction-grammar-whisper-nearai-2026-11-07.md)
with the text step that now ships in `spoken-intent`
(`seams-wallet/crates/spoken-intent`, `normalize_punctuated`). Full metrics:
[`stt1-transaction-grammar-whisper-nearai-crate-2026-11-07.json`](stt1-transaction-grammar-whisper-nearai-crate-2026-11-07.json).

## Result

**STT-1 fails.** The crate text step accepts 88.1% of correct readings (pass
needs 95%). It has 0 false accepts. Transfers stay at 94.3%; multisig
approvals rise from 44.8% to 63.7%.

| Rule | Correct accepted | False accepts | Homophone of the true receiver | Pass |
| --- | --- | --- | --- | --- |
| Crate (`normalize_punctuated`) | 2,644 of 3,000 (88.1%) | 0 of 3,742 | 69 | no |
| Rule W2 (in-tool) | 2,531 of 3,000 (84.4%) | 0 of 3,742 | 69 | no |
| Rule A (exact words) | 1,831 of 3,000 (61.0%) | 0 of 3,742 | 10 | no |

This run made no network calls. It reused the 6,742 transcripts (0
transcription errors). The crate and the in-tool Rule W2 differ in 113
decisions. All 113 are correct "set verifier version" readings that the
crate accepts. No near-miss decision differs.

## What the crate step is

`spoken_intent::normalize_punctuated(transcript, contacts)` is the Rule W2
text step (aliases, account-token digit spelling, punctuation) and the
recipient match by equal `phonetic_key`, with one change: a numeral directly
after "version" (digits, with only `,` or `-` between them) is read digit by
digit. "Version 10374" and "Version 115-54" become the check digits, not a
number. `normalize` is unchanged for CTC models.

The scorer gives the function the valid vault of the W2 report for
transfers and no contacts for multisig approvals. The recipient step runs
only when the first word is "send". So 1 transfer that W2 counted as "no key
match" is now a `parse` refusal; the decision is the same.

## Version digits

The crate now renders **eight** version check digits (open question 14).
The corpus audio speaks **five**, because it was made before this change. So
the expected text of every "set verifier version" case is the corpus text
with five digits. The score shows that Whisper's digit groups are read
correctly; it does not measure eight spoken digits. A new corpus must do
that.

| Multisig kind | Crate | Rule W2 |
| --- | --- | --- |
| Set verifier version | 113 / 120 | 0 / 120 |
| Set threshold | 107 / 120 | 107 / 120 |
| Remove member | 77 / 120 | 77 / 120 |
| Transfer | 54 / 120 | 54 / 120 |
| Add member | 31 / 120 | 31 / 120 |

The 7 refused version readings have other word errors: "set verify
version" (3), "Falken" or "Boister" for a challenge word (3), and "fork and
needle" (1). The 20 `version_digit` near misses are all refused.

## Refused correct readings

356 correct readings are refused: 218 multisig word differences, 86
`parse_transfer` refusals and 52 recipients with no key match. The causes
are those of the W2 report without the version row: "ad" for "add",
"testnut" for "testnet" in approvals, and "nia"/"nair" for "near".

## Commands

From `voiceId/stt-bench`. `R` is the first run's work folder
(`corpus.json`, `cases.jsonl`); `H` is the Whisper transcript file; `W` is a
scratch folder.

```sh
cargo test --release --offline --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir "$W/target"
cargo run --release --offline --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir "$W/target" -- \
  rulecrate "$R/corpus.json" "$R/cases.jsonl" "$H" "$W/decisions-crate.jsonl"
python3 transaction-grammar/score_whisper_crate.py "$W/decisions-crate.jsonl" \
  reports/stt1-transaction-grammar-whisper-nearai-crate-2026-11-07.json
```

New code: `rule_crate` and `run_crate` in
`transaction-grammar/grammar/src/rulew.rs` (the `rulecrate` subcommand) and
`transaction-grammar/score_whisper_crate.py`.
