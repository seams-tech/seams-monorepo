# Gate STT-1, Whisper large-v3 on NEAR AI Cloud, Rule W2 — 2026-11-07

Fourth run of Refactor 210 plan item 8 (`docs/refactor-210-voice-intents.md`
Section 9). It rescores the Whisper transcripts of
[`stt1-transaction-grammar-whisper-nearai-2026-11-07.md`](stt1-transaction-grammar-whisper-nearai-2026-11-07.md)
with Rule W2. Full metrics:
[`stt1-transaction-grammar-whisper-nearai-w2-2026-11-07.json`](stt1-transaction-grammar-whisper-nearai-w2-2026-11-07.json).

## Result

**STT-1 fails.** Rule W2 accepts 84.4% of correct readings (pass needs 95%).
It has 0 false accepts. Transfers reach 94.3%; multisig approvals reach
only 44.8%.

| Rule | Correct accepted | False accepts | Homophone of the true receiver | Pass |
| --- | --- | --- | --- | --- |
| Rule W2 | 2,531 of 3,000 (84.4%) | 0 of 3,742 | 69 | no |
| Rule W | 1,801 of 3,000 (60.0%) | 0 of 3,742 | 0 | no |
| Rule A (exact words) | 1,831 of 3,000 (61.0%) | 0 of 3,742 | 10 | no |

This run made no network calls. It reused the 6,742 transcripts of the
earlier run (0 transcription errors). Rule W gives the same 1,801 as the
earlier report. No correct reading that Rule W accepts is refused by Rule W2.

## Rule W2

Rule W2 is Rule W with four changes.

1. **Aliases.** In the text step, a whole word (after edge punctuation is
   removed) is replaced. A word inside an account token is not replaced.

   | Heard word | Becomes | Hits in this run |
   | --- | --- | --- |
   | approved | approve | 734 |
   | nir | near | 237 |
   | neer | near | 0 |

   Check: no alias equals a grammar word, and each target is a grammar word.
   The grammar words (178) are every word of the rendered requests, their
   near misses and confusion sets, the 60 contacts, the 64 challenge words,
   and the number words. `rulew2` stops if the check fails.
2. **Account tokens.** A token with a letter and a separator (`-` `_` `.`),
   or with letters and digits together, is an account token. Each digit
   becomes its own word, and each separator becomes its word:
   "ops-42.testnet" → "ops dash four two dot testnet". A token without a
   letter stays a value ("1,300", "74.15"). `spoken-intent` was not changed.
3. **Valid vaults.** For each transfer request, the vault holds the corpus
   contacts minus every contact confusable with the receiver (keys equal or
   one edit apart, `PhoneticKey::is_confusable_with`). The receiver stays.
   Then, in corpus order, a contact is dropped if it is confusable with a
   contact already kept. The recipient match and `parse_transfer` use only
   this set. Multisig approvals do not use contacts.
4. **Homophone row.** A near miss whose audio names a different contact,
   confusable with the true receiver, is counted as "homophone of the true
   receiver" only if it is accepted and the parsed recipient and amount
   equal the request exactly. Every other accepted near miss is a false
   accept.

### Contacts that the valid vaults remove

The 60 contacts form 36 confusable pairs. Each of the 200 transfer requests
removes 18 to 20 contacts (median 19; 187 requests remove 19). The vault
then holds 40 to 42 contacts. 32 different contacts are removed in at least
one vault.

| Contacts confusable with the receiver | Requests |
| --- | --- |
| 0 | 93 |
| 1 | 60 |
| 2 | 10 |
| 3 | 3 |
| 4 | 18 |
| 5 | 16 |

The pairs include tim/tom, jon/john/ben/ken/dan, anna/hannah/dana/nina/tina,
lisa/liza/alicia, sara/sarah, eric/erik, emma/maya and zoe/leo. The JSON
lists every pair and every vault.

## Correct readings accepted

| Group | Rule W2 | Rule W | Rule A |
| --- | --- | --- | --- |
| Transfers | 2,262 / 2,400 (94.25%) | 1,695 / 2,400 (70.62%) | 1,716 / 2,400 (71.5%) |
| Multisig approvals | 269 / 600 (44.83%) | 106 / 600 (17.67%) | 115 / 600 (19.17%) |
| Daniel | 423 / 500 (84.6%) | 298 / 500 (59.6%) | 126 / 500 (25.2%) |
| Karen | 430 / 500 (86.0%) | 304 / 500 (60.8%) | 363 / 500 (72.6%) |
| Moira | 436 / 500 (87.2%) | 326 / 500 (65.2%) | 384 / 500 (76.8%) |
| Rishi | 372 / 500 (74.4%) | 260 / 500 (52.0%) | 237 / 500 (47.4%) |
| Samantha | 434 / 500 (86.8%) | 308 / 500 (61.6%) | 358 / 500 (71.6%) |
| Tessa | 436 / 500 (87.2%) | 305 / 500 (61.0%) | 363 / 500 (72.6%) |
| Rate 160 | 1,267 / 1,500 (84.47%) | 920 / 1,500 (61.33%) | 976 / 1,500 (65.07%) |
| Rate 210 | 1,264 / 1,500 (84.27%) | 881 / 1,500 (58.73%) | 855 / 1,500 (57.0%) |

## False accepts

0 for Rule W2. There is no heard text to list.

| missKind | Cases | Rule W2 | Rule W | Rule A |
| --- | --- | --- | --- | --- |
| add_remove_swapped | 40 | 0 | 0 | 0 |
| added_clause | 500 | 0 | 0 | 0 |
| changed_verb | 500 | 0 | 0 | 0 |
| missing_amount | 420 | 0 | 0 | 0 |
| moved_decimal | 356 | 0 | 0 | 0 |
| negation | 500 | 0 | 0 | 0 |
| one_digit | 418 | 0 | 0 | 0 |
| other_contact | 420 | 0 | 0 | 0 |
| proposal_id | 100 | 0 | 0 | 0 |
| swapped_challenge | 100 | 0 | 0 | 0 |
| ten_times | 348 | 0 | 0 | 0 |
| threshold_changed | 20 | 0 | 0 | 0 |
| version_digit | 20 | 0 | 0 | 0 |

## Homophone of the true receiver

69 Rule W2 cases, all of missKind `other_contact`. In each case the audio
names a contact that the vault removed, because it is confusable with the
true receiver. The heard name then keys to the true receiver. The decision
pays the true receiver the exact amount, so the money reaches the intended
account. In most cases Whisper heard the audio name correctly ("tom" for
"tom"). The vault refuses "tom" as a contact, so "tom" can only mean "tim".

Rule A has 10 such cases (the 10 false accepts of the earlier report).

| # | Case | Audio says | Paid (true receiver) | Heard |
| --- | --- | --- | --- | --- |
| 1 | t000-near_miss-other_contact-Moira-160 | eric.testnet | erik.testnet | `Send 8888 near to eric.testnet.` |
| 2 | t000-near_miss-other_contact-Moira-210 | eric.testnet | erik.testnet | `Send 8888 near to eric.testnet.` |
| 3 | t005-near_miss-other_contact-Tessa-160 | tim.testnet | tom.testnet | `Send 246,642 near to Tim.testnet.` |
| 4 | t005-near_miss-other_contact-Tessa-210 | tim.testnet | tom.testnet | `Send 246,642 near to Tim.testnet.` |
| 5 | t010-near_miss-other_contact-Karen-160 | lisa.testnet | liza.testnet | `Send 8.88 near to lisa.testnet.` |
| 6 | t010-near_miss-other_contact-Karen-210 | lisa.testnet | liza.testnet | `Send 8.88 near to lisa.testnet.` |
| 7 | t016-near_miss-other_contact-Samantha-160 | jon.testnet | john.testnet | `Send 1400 near to john.testnet.` |
| 8 | t016-near_miss-other_contact-Samantha-210 | jon.testnet | john.testnet | `Send 1,400 near to john.testnut.` |
| 9 | t018-near_miss-other_contact-Karen-160 | tom.testnet | tim.testnet | `Send 999999.99 near to tom.testnet.` |
| 10 | t018-near_miss-other_contact-Karen-210 | tom.testnet | tim.testnet | `Send 999,999.99 near to tom.testnet.` |
| 11 | t021-near_miss-other_contact-Samantha-160 | sarah.testnet | sara.testnet | `Send 416,317.3 near to sarah.testnet.` |
| 12 | t021-near_miss-other_contact-Samantha-210 | sarah.testnet | sara.testnet | `Send 416,317.3 near to sarah.testnut.` |
| 13 | t034-near_miss-other_contact-Rishi-160 | sara.testnet | sarah.testnet | `Send 42,144.75 near to sara.testnet.` |
| 14 | t034-near_miss-other_contact-Rishi-210 | sara.testnet | sarah.testnet | `Send 42,144.75 near to sara.testnet.` |
| 15 | t047-near_miss-other_contact-Samantha-160 | erik.testnet | eric.testnet | `Send 544,491.06 near to eric.testnet.` |
| 16 | t047-near_miss-other_contact-Samantha-210 | erik.testnet | eric.testnet | `Send 544,491.06 near to eric.testnet.` |
| 17 | t057-near_miss-other_contact-Samantha-160 | liza.testnet | lisa.testnet | `Send 3 near to Liza.testnet.` |
| 18 | t057-near_miss-other_contact-Samantha-210 | liza.testnet | lisa.testnet | `Send three near to Liza.testnet.` |
| 19 | t060-near_miss-other_contact-Tessa-160 | eric.testnet | erik.testnet | `Send 1.8 near to eric.testnet.` |
| 20 | t060-near_miss-other_contact-Tessa-210 | eric.testnet | erik.testnet | `Send 1.8 near to eric.testnet.` |
| 21 | t063-near_miss-other_contact-Tessa-160 | john.testnet | jon.testnet | `Send 9749.56 near to john.testnet.` |
| 22 | t063-near_miss-other_contact-Tessa-210 | john.testnet | jon.testnet | `Send 9749.56 near to john.testnet.` |
| 23 | t065-near_miss-other_contact-Moira-160 | tim.testnet | tom.testnet | `Send 1.4 near to tim.testnet.` |
| 24 | t065-near_miss-other_contact-Moira-210 | tim.testnet | tom.testnet | `Send 1.4 near to tim.testnet.` |
| 25 | t070-near_miss-other_contact-Daniel-160 | lisa.testnet | liza.testnet | `Send 45,751.2 near to Lisa.testnote` |
| 26 | t070-near_miss-other_contact-Daniel-210 | lisa.testnet | liza.testnet | `Send 45,751.2 near to lisa.testnote.` |
| 27 | t076-near_miss-other_contact-Samantha-160 | jon.testnet | john.testnet | `Send 44,048.17 near to john.testnet.` |
| 28 | t076-near_miss-other_contact-Samantha-210 | jon.testnet | john.testnet | `Send 44,048.17 near to john.testnet.` |
| 29 | t078-near_miss-other_contact-Moira-160 | tom.testnet | tim.testnet | `Send 84.6 near to tom.testnet.` |
| 30 | t078-near_miss-other_contact-Moira-210 | tom.testnet | tim.testnet | `Send 84.6 near to tom.testnet.` |
| 31 | t081-near_miss-other_contact-Samantha-160 | sarah.testnet | sara.testnet | `Send 0.5 near to sarah.testnet.` |
| 32 | t081-near_miss-other_contact-Samantha-210 | sarah.testnet | sara.testnet | `Send 0.5 near to sarah.testnet.` |
| 33 | t094-near_miss-other_contact-Rishi-160 | sara.testnet | sarah.testnet | `Send 3.1 near to sara.testnet.` |
| 34 | t094-near_miss-other_contact-Rishi-210 | sara.testnet | sarah.testnet | `Send 3.1 near to sara.testnet.` |
| 35 | t107-near_miss-other_contact-Moira-160 | erik.testnet | eric.testnet | `Send 211,662 near to eric.testnet.` |
| 36 | t107-near_miss-other_contact-Moira-210 | erik.testnet | eric.testnet | `Send 211,662 near to eric.testnet.` |
| 37 | t117-near_miss-other_contact-Tessa-160 | liza.testnet | lisa.testnet | `Send 55133.4 near to liza.testnet.` |
| 38 | t117-near_miss-other_contact-Tessa-210 | liza.testnet | lisa.testnet | `Send 55133.4 near to liza.testnet.` |
| 39 | t120-near_miss-other_contact-Tessa-160 | eric.testnet | erik.testnet | `Send 30 near to eric.testnet.` |
| 40 | t120-near_miss-other_contact-Tessa-210 | eric.testnet | erik.testnet | `Send 30 near to eric.testnet.` |
| 41 | t123-near_miss-other_contact-Tessa-160 | john.testnet | jon.testnet | `Send 70 near to john.testnet.` |
| 42 | t123-near_miss-other_contact-Tessa-210 | john.testnet | jon.testnet | `Send 70 near to john.testnet.` |
| 43 | t125-near_miss-other_contact-Moira-160 | tim.testnet | tom.testnet | `Send 3000 near to tim.testnet.` |
| 44 | t125-near_miss-other_contact-Moira-210 | tim.testnet | tom.testnet | `Send 3000 near to tim.testnet.` |
| 45 | t130-near_miss-other_contact-Daniel-160 | lisa.testnet | liza.testnet | `Send 0.09 near to lisa.testnet.` |
| 46 | t130-near_miss-other_contact-Daniel-210 | lisa.testnet | liza.testnet | `Send 0.09 near to Lisa.testnote.` |
| 47 | t136-near_miss-other_contact-Rishi-160 | jon.testnet | john.testnet | `Send 0.05 near to john.testnut.` |
| 48 | t136-near_miss-other_contact-Rishi-210 | jon.testnet | john.testnet | `Send 0.05 near to john.testnut.` |
| 49 | t138-near_miss-other_contact-Daniel-160 | tom.testnet | tim.testnet | `Send 99,220.05 near to tom.testnet.` |
| 50 | t138-near_miss-other_contact-Daniel-210 | tom.testnet | tim.testnet | `Send 99,220.05 near to tom.testnote.` |
| 51 | t141-near_miss-other_contact-Daniel-160 | sarah.testnet | sara.testnet | `Send 1500 near to sarah.testnote` |
| 52 | t141-near_miss-other_contact-Daniel-210 | sarah.testnet | sara.testnet | `Send 1500 near to sarah.testnote.` |
| 53 | t154-near_miss-other_contact-Samantha-160 | sara.testnet | sarah.testnet | `Send 5000 near to sarah.testnet.` |
| 54 | t154-near_miss-other_contact-Samantha-210 | sara.testnet | sarah.testnet | `Send 5,000 near to sarah.testnet.` |
| 55 | t167-near_miss-other_contact-Daniel-160 | erik.testnet | eric.testnet | `Send 19 near to eric.testnote.` |
| 56 | t167-near_miss-other_contact-Daniel-210 | erik.testnet | eric.testnet | `Send 19 near to eric.testnote.` |
| 57 | t177-near_miss-other_contact-Moira-160 | liza.testnet | lisa.testnet | `Send 9 near to liza.testnet` |
| 58 | t177-near_miss-other_contact-Moira-210 | liza.testnet | lisa.testnet | `Send 9 near to Liza.testnet.` |
| 59 | t180-near_miss-other_contact-Moira-160 | eric.testnet | erik.testnet | `Send 300 nir to eric.testnet` |
| 60 | t180-near_miss-other_contact-Moira-210 | eric.testnet | erik.testnet | `Send 300 near to eric.testnet.` |
| 61 | t183-near_miss-other_contact-Karen-160 | john.testnet | jon.testnet | `Send 8000 near to john.testnet.` |
| 62 | t183-near_miss-other_contact-Karen-210 | john.testnet | jon.testnet | `Send 8000 near to john.testnet.` |
| 63 | t185-near_miss-other_contact-Rishi-160 | tim.testnet | tom.testnet | `Send 14 near to tim.testnet.` |
| 64 | t185-near_miss-other_contact-Rishi-210 | tim.testnet | tom.testnet | `Send 14 near to tim.testnut.` |
| 65 | t190-near_miss-other_contact-Samantha-160 | lisa.testnet | liza.testnet | `Send 3333 near to lisa.testnet.` |
| 66 | t190-near_miss-other_contact-Samantha-210 | lisa.testnet | liza.testnet | `Send 3,333 near to lisa.testnet.` |
| 67 | t196-near_miss-other_contact-Samantha-160 | jon.testnet | john.testnet | `Send 140 near to john.testnet.` |
| 68 | t196-near_miss-other_contact-Samantha-210 | jon.testnet | john.testnet | `Send 140 near to john.testnut.` |
| 69 | t198-near_miss-other_contact-Moira-160 | tom.testnet | tim.testnet | `Send 201,587.5 near to tom.testnet.` |

## Why correct readings are still refused

469 correct readings are refused: 331 multisig word differences, 85
`parse_transfer` refusals and 53 recipients with no key match.

By cause (each case counted once):

| Cause | Cases | Example heard |
| --- | --- | --- |
| Multisig set verifier version: the five digits are read as a number | 120 (all 120) | `Approve Proposal 100 Set Verifier Version 10374 Salmon Oyster.` |
| "add" heard as "ad" | 64 | `Approve Proposal 13 Ad Member Alice 2.Testnet Mirror Hammer` |
| "testnet" heard as "testnut", "testnote" and similar | 59 | `Send 8888 NIA to eric.testnut.` |
| Transfer recipient key matches no contact | 52 | `Send 143123 nid to oliver.testnid.` |
| Other multisig transfer word differences ("cent", dashes) | 50 | `Approved Proposal 999-CENT-246642 Near to Alice.Testnet Rabbit Planet` |
| "near" heard as "nia", "nair", "nit" (parse refuses) | 49 | `Send 8888 nitaeric.testnet.` |
| Other `parse_transfer` refusals ("sent", amount) | 30 | `sent 96 near to tina.testnet.` |
| Other multisig remove member, threshold, add member differences | 45 | `Approved proposal 676 set threshold to free salmon trumpet.` |

Accepted correct readings by multisig kind: set threshold 107/120, remove
member 77/120, transfer 54/120, add member 31/120, set verifier version
0/120.

The 20 most common word-level reasons (a case with two differences counts
under both):

| # | Cases | Reason | Example heard |
| --- | --- | --- | --- |
| 1 | 66 | words differ: 'add' -> 'ad' | `Approve Proposal 13 Ad Member Alice 2.Testnet Mirror Hammer` |
| 2 | 48 | words differ: 'testnet' -> 'testnut' | `Approved proposal 1 send 8888 near to bob.testnut violin muffin.` |
| 3 | 26 | parse NotTransfer: 'near' -> 'nia' | `Send 8888 NIA to eric.testnut.` |
| 4 | 24 | words differ: 'seven' -> 'hundred seventy' | `Approve Proposal 100 Set Verifier Version 10374 Salmon Oyster.` |
| 5 | 24 | words differ: 'five zero' -> 'fifty thousand' | `Approved Proposal 550 Set Verifier Version 50239 Garden Needle` |
| 6 | 24 | words differ: '' -> 'thousand' | `Approved Proposal 741 Set Verifier Version 34696 Island Ladder` |
| 7 | 12 | words differ: 'one zero' -> 'ten thousand' | `Approve Proposal 100 Set Verifier Version 10374 Salmon Oyster.` |
| 8 | 12 | words differ: 'send' -> 'cent' | `Approved proposal 999 cent 246,642 near to alice.testnet rabbit planet.` |
| 9 | 12 | words differ: 'three' -> 'hundred thirty' | `Approved Proposal 550 Set Verifier Version 50239 Garden Needle` |
| 10 | 12 | words differ: '' -> 'thirty nine thousand' | `Approved Proposal 158 Set Verifier Version 39311 Falcon Needle` |
| 11 | 12 | words differ: 'six zero' -> 'sixty thousand' | `Approve Proposal 632 Set Verifier Version 60374 Penguin Tomato` |
| 12 | 12 | words differ: 'harbor' -> 'harbour' | `Approved Proposal 326 AD Member Sarah.Testnet Harbour Garden` |
| 13 | 12 | words differ: 'nine' -> 'hundred ninety' | `Approved Proposal 741 Set Verifier Version 34696 Island Ladder` |
| 14 | 12 | words differ: 'three' -> 'thirty' | `Approved Proposal 741 Set Verifier Version 34696 Island Ladder` |
| 15 | 12 | words differ: 'seven' -> 'thousand' | `Approved Proposal 363 Set Verifier Version 77347 Cotton Rabbit` |
| 16 | 12 | words differ: '' -> 'seventy' | `Approved Proposal 363 Set Verifier Version 77347 Cotton Rabbit` |
| 17 | 12 | words differ: 'four' -> 'hundred forty' | `Approved Proposal 363 Set Verifier Version 77347 Cotton Rabbit` |
| 18 | 12 | words differ: 'one one' -> 'hundred eleven' | `Approved Proposal 762 Set Verifier Version 20711 Blanket Lizard` |
| 19 | 12 | words differ: 'two zero' -> 'twenty thousand' | `Approved Proposal 762 Set Verifier Version 20711 Blanket Lizard` |
| 20 | 12 | words differ: 'erik' -> 'eric' | `Approve Proposal 585 Remove Member Eric.Testnet Walnut Jacket` |

Main points:

- Set verifier version fails in every case. Whisper writes the five check
  digits as one number ("10374"). Rule W2 reads a standalone number by its
  value, as the task asked. A digit-by-digit reading of the number after
  "version" would remove this cause.
- "ad" for "add" (64) and "nia"/"nair" for "near" (about 40) are the next
  alias candidates. In a transfer, "testnut"/"testnote" still match the
  recipient by key; the transfers in that row fail for another word, such as
  "nia". In a multisig approval, "testnut" alone refuses the case.
- Transfers alone are at 94.3%, just below 95%.

## Commands

From `voiceId/stt-bench`. `R` is the first run's work folder
(`corpus.json`, `cases.jsonl`); `H` is the Whisper transcript file; `W` is a
scratch folder.

```sh
cargo test --release --offline --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir "$W/target"
cargo run --release --offline --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir "$W/target" -- \
  rulew2 "$R/corpus.json" "$R/cases.jsonl" "$H" "$W/decisions-w2.jsonl" "$W/meta-w2.json"
python3 transaction-grammar/score_whisper_w2.py "$W/decisions-w2.jsonl" "$W/meta-w2.json" \
  reports/stt1-transaction-grammar-whisper-nearai-w2-2026-11-07.json
```

New code: `run2`, `rule_w2`, `clean2` and the vault and alias checks in
`transaction-grammar/grammar/src/rulew.rs` (the `rulew2` subcommand, one new
unit test), and `transaction-grammar/score_whisper_w2.py`. `spoken-intent`
was not changed. Every per-case decision stays in `$W/decisions-w2.jsonl`.
