# Speech-to-text bench: bakery dictation and approval phrases

This bench compares local speech-to-text models for two Satyr Kitchen uses
on an Apple Silicon Mac at a bakery bench:

- **Dictation**: free speech with product, supplier and place names, amounts
  and times. Measured by word error rate (WER; character error rate for
  Japanese), key-term recall and exact sentences.
- **Approval phrases**: the person reads a displayed phrase that names one
  action. The transcript must match the phrase, and a changed phrase must be
  refused. Measured by true accepts of the correct phrase and false accepts of
  near misses (added negation, changed verb, changed detail, missing word),
  other phrases and unrelated bench talk.

Speaker verification is outside this bench.

## Models

| Run | Model | Runtime |
| --- | --- | --- |
| `whisper-large-v3-turbo` | `mlx-community/whisper-large-v3-turbo` at a pinned revision (OpenAI Whisper large-v3-turbo, MIT) | `mlx-whisper` 0.4.3 on the Apple GPU |
| `moonshine-tiny-streaming` | Moonshine Tiny Streaming, quantized; the model in the native engine | `moonshine-voice` 0.1.5 (the engine's Moonshine version) |
| `moonshine-base` | Moonshine Base, quantized | `moonshine-voice` 0.1.5 |
| `moonshine-medium-streaming` | Moonshine Medium Streaming, quantized; the package default, added for comparison | `moonshine-voice` 0.1.5 |
| `whisper-cpp-large-v3-turbo-q8_0`, `-q5_0` | whisper.cpp ggml files of large-v3-turbo with 8-bit and 5-bit weights | The native engine's `WhisperTranscriber` (whisper.cpp 1.8.3, Metal), through `voiceId/engine/examples/whisper_bench_cases.rs` on branch `voiceid-whisper`; second phrase bank only |

Runs with `-vocab` pass the shop vocabulary in `corpus.py`: a Whisper initial
prompt or Moonshine key terms. Moonshine Base cannot take key terms. The
vocabulary holds more names than the sentences use. Approval runs never take
a vocabulary, because a prompt that holds the expected phrase would bias the
check that the phrase was spoken.

Moonshine runs use `transcribe_without_streaming` on the whole utterance. The
engine streams in 0.5 s updates; the final text can differ.

## Inputs

`prepare.py` builds every case into the ignored `.cache/` and writes
`inputs-manifest.json` with the source hashes.

- Bakery speech from `corpus.py`, spoken by macOS `say` voices: 30 English
  dictation sentences by six voices, two banks of 12 approval phrases with
  four near misses each and six unrelated sentences by four voices, and 15
  Japanese dictation sentences by one voice. The first bank (`approval_en`)
  uses supplier and pastry names. The second bank (`approval_en_v2`) uses
  common words and numbers only, with no names or homophones.
- Human read speech: 60 sentences each from the FLEURS `en_us` and `ja_jp`
  dev splits (CC-BY-4.0), pinned to a dataset revision.
- Noise: channel 1 of the DEMAND `DKITCHEN` (food preparation), `PCAFETER`
  (cafeteria crowd) and `DWASHING` (washing machine, a stand-in for a mixer
  motor) recordings (CC-BY-4.0, Zenodo record 1227121).

Speech is trimmed, set to −26 dBFS active level and padded by 0.3 s. Noise is
added at 10, 5 and 0 dB signal-to-noise ratio from a seeded offset. Each
utterance also runs clean.

## Results — 2026-10-29

Apple M4 Pro, macOS 15.7.1. Full tables:
[`reports/stt-bench-2026-10-29.md`](reports/stt-bench-2026-10-29.md). Every
transcript: `reports/stt-bench-2026-10-29-cases.jsonl.gz`.

| Measure | Whisper turbo | Moonshine Medium | Moonshine Base | Moonshine Tiny |
| --- | --- | --- | --- | --- |
| English bakery dictation WER, clean / 0 dB | 8.8% / 13.2% | 16.3% / 26.1% | 16.8% / 29.2% | 27.0% / 44.7% |
| Same, with the shop vocabulary | 5.8% / 9.7% | 15.3% / 25.3% | – | 24.8% / 43.3% |
| Key-term recall with vocabulary, clean / 0 dB | 86.9% / 83.7% | 76.2% / 67.0% | – | 67.6% / 51.3% |
| FLEURS English WER, clean / 0 dB | 4.8% / 10.2% | 8.0% / 22.3% | 11.7% / 28.3% | 18.4% / 40.3% |
| Correct approval phrase accepted, clean / 0 dB | 70.8% / 53.5% | 47.9% / 23.6% | 41.7% / 31.2% | 29.2% / 16.7% |
| Same, phrases without names, clean / 0 dB | 81% / 58% | 59% / 31% | 53% / 40% | 41% / 23% |
| Near miss accepted, `strict` | 0 of 1,920 | 0 of 1,920 | 0 of 1,920 | 0 of 1,920 |
| Correct phrase accepted, second bank, clean / 10 / 5 / 0 dB | 97.9% / 94.4% / 86.8% / 81.9% | 66.7% / 52.8% / 63.2% / 45.1% | – | – |
| Near miss accepted, second bank, `strict` | 0 of 1,920 | 2 of 1,920 | – | – |
| Same two rows, native engine with whisper.cpp 8-bit (874 MB) | 93.8% / 92.4% / 86.8% / 79.9%; 0 of 1,920 | – | – | – |
| Near miss accepted, `one_edit`, clean | 49.0% | 28.6% | 34.4% | 19.8% |
| Japanese bakery dictation CER, clean / 0 dB | 4.8% / 9.2% (2.8% / 6.4% with vocabulary) | – | 23.5% / 24.4% | 6.2% / 22.0% |
| FLEURS Japanese CER, clean / 0 dB | 4.2% / 6.5% | – | 25.4% / 32.3% | 12.0% / 23.2% |
| Model files | 1,614 MB | 269 MB | 141 MB | 45 MB |
| Mean time per utterance | 502 ms (GPU) | 332 ms (CPU) | 90 ms (CPU) | 121 ms (CPU) |

Findings:

- Whisper large-v3-turbo is the most accurate model in every set and noise
  level. With the shop vocabulary it makes about 40% of the dictation errors
  of Moonshine Medium.
- Public leaderboard averages rank Moonshine Medium close to Whisper. They use
  clean read English; they do not predict this bakery vocabulary or noise.
- The `strict` approval policy accepted no near miss for any model. `one_edit`
  accepted 20–49% of near misses, including "reject" for "approve". Keep
  `strict`.
- In the first bank, Whisper's refusals come from names ("Kanto Mills",
  "Valrhona"), a homophone ("flower" for "flour") and small word changes
  ("approved", "is passed").
- The second bank, with common words and numbers, raised Whisper's correct
  accepts from 70.8% to 97.9% clean and from 53.5% to 81.9% at 0 dB, with no
  near miss accepted. Moonshine Medium rose from 47.9% to 66.7% clean.
- Moonshine Medium accepted two second-bank near misses: "share the staff
  report" was heard as "stock" in cafeteria noise. Words that change the
  action must not sound alike inside one bank (stock and staff, batch and
  badge, price and prize, cake and case). Whisper's remaining misses are of
  the same kind, plus "sent" for "send" and "a" for "the".
- The native engine's whisper.cpp runs accept the correct phrase about two
  points less often than MLX, with no near miss accepted. On the 480
  correct-phrase cases, 16-bit weights and timestamps did not close the gap,
  so it comes from the runtime. The engine README has the details.
- Moonshine Base Japanese cuts the end of many sentences; this run did not
  check whether a library length setting causes it. Moonshine's Japanese
  models use the non-commercial Moonshine Community License.

Limits:

- The bakery sets use macOS `say` voices, not human speech. FLEURS is human
  read speech of general sentences. Neither set includes a person at a bench.
- Noise is mixed digitally. There is no room echo, no laptop microphone and no
  real mixer recording; `DWASHING` stands in for a motor.
- Japanese bakery dictation uses one voice and 15 sentences.
- Moonshine runs use the package's quantized models. Whisper runs through MLX;
  a native engine integration through another runtime can change speed.
- Speaker verification and spoof detection are outside this bench.

## Run

```sh
bench=/absolute/path/to/seams-monorepo/voiceId/stt-bench
uv venv --python 3.11 "$bench/.cache/.venv"
uv pip install --python "$bench/.cache/.venv/bin/python" -r "$bench/requirements.txt"
"$bench/.cache/.venv/bin/python" "$bench/prepare.py"
"$bench/run_all.sh" stt-bench-YYYY-MM-DD
```

`run_model.py --set <set>` runs one case set, for example the second phrase
bank `approval_en_v2`; the 2026-10-29 second-bank results came from such
runs. A full English run includes every set.

`run_all.sh` runs each model in its own process, then writes
`reports/<name>.json` (all metrics, model and input hashes),
`reports/<name>.md` (tables) and `reports/<name>-cases.jsonl.gz` (every
reference and transcript). Moonshine Medium Streaming has no Japanese model.
Moonshine's Japanese models use the non-commercial Moonshine Community
License.
