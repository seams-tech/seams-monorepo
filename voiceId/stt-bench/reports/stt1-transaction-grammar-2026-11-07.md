# Gate STT-1: speech-to-text on the transaction grammar — 2026-11-07

Refactor 210 plan item 8 (`docs/refactor-210-voice-intents.md` Section 9).
Apple M4 Pro, tract 0.23.10 (the Gate 0 probe version), native build.
Full metrics: [`stt1-transaction-grammar-2026-11-07.json`](stt1-transaction-grammar-2026-11-07.json).
Code: [`../transaction-grammar/`](../transaction-grammar/).

## Result

**STT-1 fails for both models and both rules.** The gate needs at least 95%
acceptance of correct readings on clean speech and 0 near-miss acceptances.

| Model | Rule A: correct accepted | Rule A: near misses accepted | Rule B: margin | Rule B: correct accepted (test half) | Rule B: near misses accepted |
| --- | --- | --- | --- | --- | --- |
| Aurora INT8 | 5 of 3,000 (0.17%) | 0 of 3,742 (≤ 0.08%) | 51.6 | 0 of 1,500 (0%) | 0 of 3,742 |
| Citrinet INT8 | 14 of 3,000 (0.47%) | 0 of 3,742 (≤ 0.08%) | 54.9 | 0 of 1,500 (0%) | 0 of 3,742 |

The bound is the one-sided 95% Clopper–Pearson upper bound. Both rules
refuse every near miss, but they refuse almost every correct reading too.

## Corpus

- Texts: `spoken-intent` `render` and `confusion_set`, seed 210
  (`txg-text corpus 210`). 250 requests: 200 vault transfers (200 amounts
  from 0.01 to 1,000,000 NEAR: teens and tens, repeated digits, one and two
  decimals, edges) to 60 contacts (confusable pairs such as alice/alicia,
  jon/john, rob/bob, payroll/payrolls; digits, dashes, underscores), and 50
  multisig approvals (ids 1–999, all five proposal kinds, challenge words).
- Near misses: 1,871 texts. Changed amount (one digit, ten times, moved
  decimal point), the closest other contact by `phonetic_key`, changed verb
  ("lend", "improve"), negation ("do not ..."), added clause ("and send one
  hundred near to ..."), missing amount, and for approvals the neighbour
  proposal id, swapped challenge words, add/remove swapped, threshold and
  version digit changed.
- Voices: macOS `say` Samantha, Daniel, Karen, Moira, Rishi, Tessa, at 160
  and 210 words per minute. Each correct text: all 12 voice–rate pairs
  (3,000 cases). Each near miss: 2 pairs in rotation (3,742 cases).
- Audio: `say` AIFF, ffmpeg to 16 kHz mono f32; trimmed, set to −26 dBFS
  and padded by 0.3 s as in `prepare.py`. Mean length 4.4 s. No private
  recordings were used.

## Rules as built

- **Rule A**: greedy CTC decode as in `phrase.ts` (Aurora blank 0 with `▁`
  pieces; Citrinet blank 256 with WordPiece), then `normalize`, then an exact
  match with `render(request).spoken`.
- **Rule B**: CTC log-likelihood of the expected text minus the best
  log-likelihood over `confusion_set(request, contacts)` (all 60 contacts),
  and a normalized word count within one of the expected count. Texts are
  tokenized by greedy longest match. The margin is the smallest value that
  accepts no near miss of the even-numbered requests; acceptance is reported
  on the odd-numbered requests.

## Why the models fail

| Diagnostic, correct readings | Aurora | Citrinet |
| --- | --- | --- |
| "testnet" recognized | 0.4% | 2.9% |
| "dot" recognized | 22% | 3.6% |
| "send" recognized | 16% | 52% |
| "approve" recognized | 0% | 16% |
| Amount words heard exactly (transfers) | 46% | 58% |
| Same, whole amounts / two decimals | 62–68% / 27% | 69–71% / 45% |
| Accepted at 160 / 210 wpm, Rule A | 0.33% / 0% | 0.93% / 0% |
| Mean inference per case (tract, native) | 5.3 ms | 18.0 ms |

- The account words fail first. "testnet" comes out as "testnut",
  "testament" or "dottistent". Most Rule A refusals are `NotTransfer` or
  `UnknownRecipient` in `parse_transfer`.
- Amounts are heard exactly only about half the time, and decimals less.
- Some confusable contacts are true homophones (eric/erik, sara/sarah):
  the models hear the more common spelling. `phonetic_key` would refuse the
  second contact of such a pair, so a real contact book has fewer of them.
- Rule B cannot be safe with the current `confusion_set`. A changed verb
  ("lend") and a negation are not in the set, so they keep the expected text
  as the best candidate. At margin 0, Rule B accepts 57% of correct readings
  and 457 of 3,742 near misses. The changed verb then forces the margin to
  about 52–55, which no correct reading reaches.

## Next steps (Section 9.4)

1. Do not narrow only the amounts: the account words fail more than the
   amounts. A narrowed grammar must also drop "dot testnet" (for example, a
   spoken contact label from the vault) and use common verbs.
2. Measure Whisper Tiny English as a verifier candidate on this corpus.
3. If Rule B stays a candidate, add verb, negation and clause variants to its
   competitor set; the current set only covers field changes.

## Limits

- Synthetic `say` voices only; no noise, no people (Gate STT-2).
- Native tract, not the wasm verifier or the browser runtime. Aurora and
  Citrinet plans are built per 0.25 s length step, with silence padding at
  the end.
- The Rule B tokenization is a greedy longest match, not the models' own
  tokenizers; Rule A does not depend on it.

## Commands

From `voiceId/stt-bench`, with `W` a work folder outside the repository:

```sh
transaction-grammar/run.sh "$W" stt1-transaction-grammar-2026-11-07
```

The script runs, in order:

```sh
cargo run --release --offline --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir "$W/target" -- corpus 210 "$W/corpus.json"
python3 transaction-grammar/make_audio.py "$W/corpus.json" "$W/audio" "$W/cases.jsonl"
cargo run --release --offline --manifest-path transaction-grammar/infer/Cargo.toml --target-dir "$W/target" -- aurora ../../../seams-wallet/packages/voiceid/assets/aurora-int8.onnx "$W/corpus.json" "$W/cases.jsonl" "$W/scores-aurora.jsonl" 8
cargo run --release --offline --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir "$W/target" -- decide "$W/corpus.json" "$W/scores-aurora.jsonl" "$W/decisions-aurora.jsonl"
# the same two commands for citrinet
python3 transaction-grammar/score.py reports/stt1-transaction-grammar-2026-11-07.json "corpus=$W/corpus.json" "aurora=$W/decisions-aurora.jsonl" "citrinet=$W/decisions-citrinet.jsonl"
```

Two crates, because `spoken-intent` pins borsh 1.6.1 and tract needs borsh
1.7 or later. Audio synthesis takes about 25 minutes; inference takes 14 s
(Aurora) and 27 s (Citrinet) on 8 threads.
