# Gate STT-1, Whisper large-v3 on NEAR AI Cloud, forgiving send slots — 2026-11-09

Seventh run. It rescores the Whisper transcripts of
[`stt1-transaction-grammar-whisper-nearai-2026-11-07.md`](stt1-transaction-grammar-whisper-nearai-2026-11-07.md)
with the send-sentence rules of `seams-wallet` commit `976167297`
(`crates/spoken-intent/src/punctuated.rs`). The previous run is
[`stt1-transaction-grammar-whisper-nearai-slots-2026-11-07.md`](stt1-transaction-grammar-whisper-nearai-slots-2026-11-07.md).
Full metrics:
[`stt1-transaction-grammar-whisper-nearai-forgiving-2026-11-09.json`](stt1-transaction-grammar-whisper-nearai-forgiving-2026-11-09.json).

The reason: on staging, Whisper heard the user's "Send 0.01 NEAR to
seams-v1.testnet" as "send zero point zero one year to seams dash v one dot
testnet", and the verifier refused it. The Speak-to-Sign demo should forgive
words that hold no value.

## Result

**Transfers rise from 94.6% to 98.0%, with 0 false accepts.** STT-1 still
fails overall (91.1%; pass needs 95%) because of the multisig approvals, which
these rules do not change.

| Rule | Correct accepted | Transfers | Multisig | False accepts |
| --- | --- | --- | --- | --- |
| Forgiving send slots | 2,733 of 3,000 (91.1%) | 2,351 of 2,400 (98.0%) | 382 of 600 (63.7%) | 0 of 3,742 |
| Same, without rule 5 (one-edit receiver) | 2,716 of 3,000 (90.5%) | 2,334 of 2,400 (97.3%) | 382 of 600 (63.7%) | 0 of 3,742 |
| Slot rules, previous run | 2,652 of 3,000 (88.4%) | 2,270 of 2,400 (94.6%) | 382 of 600 (63.7%) | 0 of 3,742 |

This run made no network calls. It reused the 6,742 transcripts.

## The rules

All rules apply only in a sentence whose first word is "send". None of the
words they read is a grammar word, so the amount and the receiver are still
compared exactly with the request.

1. **Verb.** "sent" or "sends" as the first word becomes "send".
2. **Unit.** A closed list of sound-alikes of "near" in the word before the
   first "to" becomes "near": nia, nir, nair, neer, nier, nea, nit, nid, net,
   nee, knee, here, hear, year, ear, mir. If that word is part of the amount,
   "near" is put in.
3. **Amount.** In the amount slot, free and tree become "three", for and fore
   "four", won "one", ate "eight", and "dash" is dropped ("200-1587.5").
   The rules apply only if the slot holds a number word and nothing but
   number words, "point" and "dash".
4. **Network suffix.** A closed list of sound-alikes of "testnet" as the last
   recipient word (testnut, testnit, testnid, testnode, testmode, testnote,
   testament, testnacht, testnets, testneat, or "test" and net/nut/nit/node/
   note/mode) becomes "testnet".
5. **Receiver.** After every equal-key reading fails, a recipient whose
   phonetic key is one edit from exactly one contact, with the same first two
   letters, matches that contact.

## Near misses

The 3,742 near misses have 0 false accepts. 114 near misses are accepted
because the audio names a sound-alike of the true receiver and the decision
pays the request exactly (69 before). The one-edit rule adds these pairs
(audio name, request receiver): payroll/payrolls, hannah/henry,
alicia/alice, marco/mark, and the reverse pairs.

A first version required only an equal first letter. It also accepted
"anna" for "uma" (both keys start with a vowel), so the rule keeps the first
two letters. A version with no first-letter rule accepted "zoe" for "leo" and
"jon" for "dan".

## Remaining refused correct transfers

49 correct transfers are still refused:

- Words joined by Whisper: "96nit at", "nitaeric.testnet", "near toucane.testnet"
  ("to ken"), "near2lab".
- Amounts that Whisper writes as a phone number ("1-800-45.91" for 1,845.91)
  or as a different number ("19" for "ninety", "AT" for "eighty").
- Recipients that are one edit from two contacts ("huma" for "uma"), and two
  edits away ("twin" for "quinn").

## A vocabulary prompt does not work

NEAR AI's `/v1/audio/transcriptions` accepts a `prompt` field but ignores it.
Thirty clips gave the same text with and without the prompts "NEAR testnet",
"Send NEAR to a testnet account." and "NEAR, testnet, dot, dash, underscore".
`temperature` and `response_format` do change the reply, so the form is read.

## Commands

From `voiceId/stt-bench`. `R` is the first run's work folder
(`corpus.json`, `cases.jsonl`); `H` is the Whisper transcript file; `W` is a
scratch folder.

```sh
cargo run --release --offline --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir "$W/target" -- \
  rulecrate "$R/corpus.json" "$R/cases.jsonl" "$H" "$W/decisions-forgiving.jsonl"
python3 transaction-grammar/score_whisper_crate.py "$W/decisions-forgiving.jsonl" \
  reports/stt1-transaction-grammar-whisper-nearai-forgiving-2026-11-09.json
```

The scorer code is unchanged. The JSON `date` and `decisions` fields are the
scorer's fixed values.
