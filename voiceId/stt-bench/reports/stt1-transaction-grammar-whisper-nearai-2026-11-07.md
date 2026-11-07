# Gate STT-1, Whisper large-v3 on NEAR AI Cloud, Rule W — 2026-11-07

Third run of Refactor 210 plan item 8 (`docs/refactor-210-voice-intents.md`
Section 9). The earlier runs are
[`stt1-transaction-grammar-2026-11-07.md`](stt1-transaction-grammar-2026-11-07.md) and
[`stt1-transaction-grammar-ruleb-2026-11-07.md`](stt1-transaction-grammar-ruleb-2026-11-07.md).
Full metrics: [`stt1-transaction-grammar-whisper-nearai-2026-11-07.json`](stt1-transaction-grammar-whisper-nearai-2026-11-07.json).

## Result

**STT-1 fails.** Rule W accepts 60.0% of correct readings (pass needs 95%).
It accepts no near miss. Plain Rule A accepts about as many correct readings,
but it also accepts 10 near misses.

| Rule | Correct accepted | Near misses accepted | Pass |
| --- | --- | --- | --- |
| Rule W | 1,801 of 3,000 (60.0%) | 0 of 3,742 | no |
| Rule A (exact words) | 1,831 of 3,000 (61.0%) | 10 of 3,742 | no |
| Rule W, literal digit "." (see below) | 807 of 3,000 (26.9%) | 0 of 3,742 | no |

Transcription errors: 0 of 6,742 calls. The transcripts were made earlier;
this run made no network calls.

## Rule W

The same steps for every case:

1. Text step: lowercase; trim; drop final `. , ! ?`; remove commas inside
   digit groups ("8,888" → "8888"); a `.` between two letters, or between a
   letter and a digit, becomes " dot "; `-` becomes " dash "; `_` becomes
   " underscore "; then `spoken-intent` `normalize`. `normalize` reads a
   numeral by its value ("42" → "forty two"). If a step refuses, the case is
   refused.
2. Transfers: the words after the first "to" must have the same
   `phonetic_key` as exactly one of the 60 corpus contacts (equal keys only).
   Those words are then replaced by the words of that contact.
3. Accept only if `render` of the `parse_transfer` result equals the expected
   spoken text of the case's `requestId`. For multisig approvals, the words of
   step 1 must equal the expected spoken text, word for word.

Interpretation: a `.` between two digits stays a decimal point, so "1.01"
stays an amount. The literal reading ("between two letters or digits" → also
"1.01" → "1 dot 01") refuses every decimal amount; its row above shows the
effect. All other numbers use the main reading.

The key of the heard words comes from the crate's `phonetic_key`: each word
is keyed as a one-word account and the keys are joined, and each run of one
letter becomes one letter. A unit test checks that this equals
`phonetic_key` of the account for five contacts. A recipient with a one-letter
word cannot be keyed and is refused (0 correct cases).

## Correct readings accepted

| Group | Rule W | Rule A |
| --- | --- | --- |
| Daniel | 298 / 500 (59.6%) | 126 (25.2%) |
| Karen | 304 / 500 (60.8%) | 363 (72.6%) |
| Moira | 326 / 500 (65.2%) | 384 (76.8%) |
| Rishi | 260 / 500 (52.0%) | 237 (47.4%) |
| Samantha | 308 / 500 (61.6%) | 358 (71.6%) |
| Tessa | 305 / 500 (61.0%) | 363 (72.6%) |
| Rate 160 | 920 / 1,500 (61.3%) | 976 (65.1%) |
| Rate 210 | 881 / 1,500 (58.7%) | 855 (57.0%) |
| Transfers | 1,695 / 2,400 (70.6%) | 1,716 (71.5%) |
| Multisig approvals | 106 / 600 (17.7%) | 115 (19.2%) |

Daniel gains most from Rule W: Whisper often writes "testnote" for his
"testnet", and both have the same key.

## Near misses accepted

| missKind | Cases | Rule W | Rule A |
| --- | --- | --- | --- |
| add_remove_swapped | 40 | 0 | 0 |
| added_clause | 500 | 0 | 0 |
| changed_verb | 500 | 0 | 0 |
| missing_amount | 420 | 0 | 0 |
| moved_decimal | 356 | 0 | 0 |
| negation | 500 | 0 | 0 |
| one_digit | 418 | 0 | 0 |
| other_contact | 420 | 0 | **10** |
| proposal_id | 100 | 0 | 0 |
| swapped_challenge | 100 | 0 | 0 |
| ten_times | 348 | 0 | 0 |
| threshold_changed | 20 | 0 | 0 |
| version_digit | 20 | 0 | 0 |

Rule W has no false accept. The 10 Rule A false accepts are homophones: the
audio says one name and Whisper writes its homophone, which is the expected
contact.

| Case | Audio says | Heard |
| --- | --- | --- |
| t016-near_miss-other_contact-Samantha-160 | … to jon dot testnet | `Send 1400 near to john.testnet.` |
| t047-near_miss-other_contact-Samantha-160 | … to erik dot testnet | `Send 544,491.06 near to eric.testnet.` |
| t047-near_miss-other_contact-Samantha-210 | … to erik dot testnet | `Send 544,491.06 near to eric.testnet.` |
| t076-near_miss-other_contact-Samantha-160 | … to jon dot testnet | `Send 44,048.17 near to john.testnet.` |
| t076-near_miss-other_contact-Samantha-210 | … to jon dot testnet | `Send 44,048.17 near to john.testnet.` |
| t107-near_miss-other_contact-Moira-160 | … to erik dot testnet | `Send 211,662 near to eric.testnet.` |
| t107-near_miss-other_contact-Moira-210 | … to erik dot testnet | `Send 211,662 near to eric.testnet.` |
| t154-near_miss-other_contact-Samantha-160 | … to sara dot testnet | `Send 5000 near to sarah.testnet.` |
| t154-near_miss-other_contact-Samantha-210 | … to sara dot testnet | `Send 5,000 near to sarah.testnet.` |
| t196-near_miss-other_contact-Samantha-160 | … to jon dot testnet | `Send 140 near to john.testnet.` |

Rule W refuses these because jon/john, eric/erik and sara/sarah have equal
keys. The same rule refuses correct readings of these contacts (see below).

## Call latency

| Measure | Value |
| --- | --- |
| Call time, median | 1.307 s |
| Call time, p95 | 1.584 s |
| Audio length, median | 3.401 s |
| Call time / audio length, median | 0.385 |
| Call time / audio length, p95 | 0.722 |

## Why correct readings were refused

1,199 correct readings were refused, by stage:

| Stage | Cases |
| --- | --- |
| Multisig words differ | 494 |
| Recipient key matches several contacts | 423 |
| Recipient key matches no contact | 160 |
| `parse_transfer` refused | 122 |

The 20 most common reasons. A case with two word differences counts under
both.

| # | Cases | Reason | Example heard |
| --- | --- | --- | --- |
| 1 | 431 | multisig: "approve" heard as "approved" | `Approved proposal 1 send 8888 near to bob.testnet violin muffin.` |
| 2 | 66 | multisig: "add" heard as "ad" | `Approve Proposal 13 Ad Member Alice 2.Testnet Mirror Hammer` |
| 3 | 60 | parse NotTransfer: "near" heard as "nir" | `Send 1,300 NIR to payrolls.testnet.` |
| 4 | 48 | multisig: "testnet" heard as "testnut" | `Approved proposal 1 send 8888 near to bob.testnut violin muffin.` |
| 5 | 42 | several keys: tim dot testnet (heard exactly) | `Send 999,999.99 near to tim.testnet.` |
| 6 | 37 | several keys: liza dot testnet (heard exactly) | `Send 8.88 near to liza.testnet.` |
| 7 | 33 | several keys: tom dot testnet (heard exactly) | `Send 246,642 near to tom.testnet.` |
| 8 | 33 | several keys: john dot testnet (heard exactly) | `Send 1400 near to john.testnet.` |
| 9 | 32 | no key: rent-2026 read by value, "two thousand twenty six" | `Send 733,186 near to rent-2026.testnet` |
| 10 | 31 | no key: ops-42 read by value, "forty two" | `Send 74.15 near to ops-42.testnet.` |
| 11 | 31 | no key: kim-08 read by value, "eight" | `Send 219.9 near to kim-08.testnet.` |
| 12 | 30 | several keys: jon heard as john | `Send 5 near to john.testnet.` |
| 13 | 30 | several keys: lisa dot testnet (heard exactly) | `Send 3 near to lisa.testnet.` |
| 14 | 29 | several keys: erik heard as eric | `Send 8888 near to eric.testnet.` |
| 15 | 25 | several keys: sarah dot testnet (heard exactly) | `Send 42144.75 near to sarah.testnet.` |
| 16 | 24 | multisig version digits read by value: "seven" → "hundred seventy" | `Approve Proposal 100 Set Verifier Version 10374 Salmon Oyster.` |
| 17 | 24 | multisig version digits read by value: "five zero" → "fifty thousand" | `Approved Proposal 550 Set Verifier Version 50239 Garden Needle` |
| 18 | 24 | multisig version digits read by value: extra "thousand" | `Approved Proposal 741 Set Verifier Version 34696 Island Ladder` |
| 19 | 23 | several keys: eric dot testnet (heard exactly) | `Send 544,491.06 near to eric.testnet.` |
| 20 | 18 | several keys: sara heard as sarah | `Send 416,317.3 near to sarah.testnet.` |

Main points:

- Multisig approvals pass only 17.7%. Whisper writes "Approved" for
  "approve" in 431 of 600 cases. Step 1 does not use phonetic keys for these
  words, so one wrong suffix refuses the case.
- 423 transfers are refused because their contact shares a key with another
  contact: tim/tom (TAM), lisa/liza, jon/john, eric/erik, sara/sarah. Many
  were heard exactly. A vault that holds both contacts of a pair cannot
  accept either one by key. Section 9.2 of the plan already makes a contract
  refuse the second of two confusable contacts; this corpus breaks that rule
  on purpose.
- 160 transfers fail because `normalize` reads digits in an account by value
  ("ops-42" → "forty two", spoken "four two"), so the key does not match.
- "near" heard as "nir" or "nia" refuses 60 or more transfers in
  `parse_transfer`.

## Commands

From `voiceId/stt-bench`. `R` is the first run's work folder
(`corpus.json`, `cases.jsonl`); `H` is the Whisper transcript file; `W` is a
scratch folder.

```sh
cargo test --release --offline --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir "$W/target"
cargo run --release --offline --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir "$W/target" -- \
  rulew "$R/corpus.json" "$R/cases.jsonl" "$H" "$W/decisions-whisper.jsonl"
python3 transaction-grammar/score_whisper.py "$W/decisions-whisper.jsonl" \
  reports/stt1-transaction-grammar-whisper-nearai-2026-11-07.json
```

New code: `transaction-grammar/grammar/src/rulew.rs` (the `rulew`
subcommand, two unit tests) and `transaction-grammar/score_whisper.py`.
`spoken-intent` was not changed. Every per-case decision stays in
`$W/decisions-whisper.jsonl`.
