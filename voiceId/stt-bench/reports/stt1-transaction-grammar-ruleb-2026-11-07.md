# Gate STT-1, Rule B with a grammar confusion set — 2026-11-07

Second run of Refactor 210 plan item 8 (`docs/refactor-210-voice-intents.md`
Section 9). The first run is
[`stt1-transaction-grammar-2026-11-07.md`](stt1-transaction-grammar-2026-11-07.md).
Full metrics: [`stt1-transaction-grammar-ruleb-2026-11-07.json`](stt1-transaction-grammar-ruleb-2026-11-07.json).

## Result

**STT-1 still fails for both models.** The margin falls from 52–55 to 9–15,
but correct acceptance stays far below 95%. No near miss is accepted.

| Model | Rule B margin (first run) | Correct accepted, test half | Correct accepted, all | Near misses accepted |
| --- | --- | --- | --- | --- |
| Aurora INT8 | 14.8 (51.6) | 4 of 1,500 (0.27%) | 13 of 3,000 | 0 of 3,742 |
| Citrinet INT8 | 9.0 (54.9) | 31 of 1,500 (2.1%) | 71 of 3,000 | 0 of 3,742 |

Rule A is unchanged (5 and 14 of 3,000 accepted, 0 near misses).

## The confusion_set change

`spoken-intent` `confusion_set` (seams-wallet `crates/spoken-intent/src/confusion.rs`,
uncommitted) keeps all field changes and adds, from the grammar:

- Changed verb: each other word of send, approve, reject, add, remove, set,
  at the first word and at the first word of a proposal.
- Negation: "do not", "dont", "never", "not" before each verb; "not" after it.
- Dropped clause: the amount, the amount and "near", the receiver, the verb;
  for an approval, "proposal" and its id, the proposal, one or both challenge words.
- Added clause: "and" plus the transfer or proposal again, for the request
  and for each field change with the same id.
- Amounts: one hundred times and one hundredth added.

Confusion-set texts: 23,958 → 52,150. The old set is a subset of the new one.

## Corpus identity check

The new `corpus.json` came from `txg-text corpus 210`. A script compared it
with the first run's file: every field except `confusionSet` is identical,
and the near-miss texts and the correct readings are byte-identical. The
audio and `cases.jsonl` of the first run were reused unchanged.

## Per near-miss category

"Covered" counts the near-miss texts that are in the new set exactly. The
held-out categories are the honest test. "Calibration max" is the highest
Rule B score of a calibration-half near miss; the largest one sets the margin.

| Category | Covered | Aurora calibration max | Aurora at margin 0 | Citrinet calibration max | Citrinet at margin 0 |
| --- | --- | --- | --- | --- | --- |
| negation | 250 / 250 | −11.9 | 0 | −12.3 | 0 |
| missing_amount | 210 / 210 | −30.5 | 0 | −70.4 | 0 |
| other_contact | 210 / 210 | 10.2 | 23 | 7.5 | 16 |
| one_digit | 209 / 209 | 1.9 | 2 | −2.8 | 0 |
| ten_times | 174 / 174 | −1.9 | 0 | −20.0 | 0 |
| moved_decimal | 178 / 178 | −3.9 | 0 | 0.2 | 1 |
| proposal_id | 50 / 50 | −9.7 | 0 | −4.0 | 0 |
| swapped_challenge | 50 / 50 | −32.1 | 0 | −38.6 | 0 |
| add_remove_swapped | 20 / 20 | −22.0 | 0 | −35.5 | 0 |
| **changed_verb** ("lend", "improve") | **0 / 250** | **14.8** | 92 | **9.0** | 229 |
| **added_clause** | **0 / 250** | none finite | 0 | −8.9 | 0 |
| **threshold_changed** | **8 / 10** | −10.7 | 0 | 5.8 | 1 |
| **version_digit** | **0 / 10** | −36.1 | 0 | −24.5 | 0 |

Each text has two voice cases, so the "at margin 0" columns count cases.
All categories at the calibrated margin: 0 accepted.

## Why Rule B still fails

- A held-out changed verb sets the margin. "lend" and "improve" are not
  grammar verbs. They sound like "send" and "approve", so the expected text
  stays the best candidate.
- Without held-out categories in calibration, the margin is 10.2 (Aurora) and
  7.5 (Citrinet). This accepts 48 and 225 of 1,500 test correct readings, and
  3 and 37 held-out near misses. So the held-out categories are not safe either.
- `other_contact` is covered, but true homophones (eric/erik, sara/sarah)
  still score up to 10.2. A margin cannot separate homophones.
- The correct readings score low. The test-half median is 4.1 (Aurora) and
  5.1 (Citrinet); the 95th percentile is 9.7 and 8.7. At margin 0, a
  competitor wins for 1,009 (Aurora) and 1,187 (Citrinet) correct readings,
  mostly a field change: the models mishear amounts and contacts.

## Commands

From `voiceId/stt-bench`. `OLD` is the first run's work folder; `W` is a new one.

```sh
UPDATE_SPOKEN_INTENT_VECTORS=1 cargo test --manifest-path ../../../seams-wallet/crates/spoken-intent/Cargo.toml
cargo test --manifest-path ../../../seams-wallet/crates/spoken-intent/Cargo.toml
cargo build --manifest-path ../../../seams-wallet/crates/spoken-intent/Cargo.toml --target wasm32-unknown-unknown
cargo build --manifest-path ../../../seams-wallet/crates/spoken-intent/Cargo.toml --target wasm32-wasip2
cargo run --release --offline --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir "$W/target" -- corpus 210 "$W/corpus.json"
# for model in aurora citrinet:
cargo run --release --offline --manifest-path transaction-grammar/infer/Cargo.toml --target-dir "$W/target" -- $model ../../../seams-wallet/packages/voiceid/assets/$model-int8.onnx "$W/corpus.json" "$OLD/cases.jsonl" "$W/scores-$model.jsonl" 8
cargo run --release --offline --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir "$W/target" -- decide "$W/corpus.json" "$W/scores-$model.jsonl" "$W/decisions-$model.jsonl"
python3 transaction-grammar/score.py "$W/score.json" "corpus=$W/corpus.json" "aurora=$W/decisions-aurora.jsonl" "citrinet=$W/decisions-citrinet.jsonl"
```

Open item: the vector regeneration (first command) needed an approval that
this run did not get. `spoken_intent_vectors_v1.json` is not yet updated, so
`committed_spoken_intent_vectors_match_generator` fails until it runs. The
other 7 crate tests and both wasm builds pass.

The corpus check, the per-category analysis and the merge into the report
JSON ran from scripts in the session scratch folder. The tools in
`transaction-grammar/` were not changed. Inference took 38 s (Aurora) and
40 s (Citrinet) on 8 threads.
