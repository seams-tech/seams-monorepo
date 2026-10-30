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

## Embedding model comparison — 2026-10-30

EmbeddingGemma 2 (`google/embeddinggemma-2`, revision `f9972ac2`, Apache 2.0)
maps audio and text into one 768-number vector space. It gives no transcript,
so it cannot do dictation and the strict word match cannot apply.
`embedding_probe.py` scores each recording of `approval_en_v2` by cosine
similarity to the displayed phrase. It loads the text and audio encoders in
float32 on Apple M4 Pro (MPS).

| Check, on the same 2,640 cases | Correct phrase accepted, clean / 10 / 5 / 0 dB | Near miss accepted |
| --- | --- | --- |
| Whisper turbo MLX, strict match | 97.9% / 94.4% / 86.8% / 81.9% | 0 of 1,920 |
| EmbeddingGemma 2, one threshold on the displayed phrase | 37.5% / 30.6% / 27.8% / 20.8% | 0 of 1,920 |
| EmbeddingGemma 2, displayed phrase against the spoken near-miss texts | 39.6% / 32.6% / 28.5% / 25.0% | 0 of 1,920 |

Each EmbeddingGemma row is the best of three text prompts (`none`, `Document`,
`SentenceSimilarity`). Its threshold or margin is the lowest that accepts no
near miss and no unrelated sentence of this data, so the rates are optimistic.
The second row compares against the exact near-miss sentences that were
spoken, which a real verifier does not know.

- A negation scores almost as high as the phrase. "do not pay invoice three
  five nine" has a mean similarity of 0.816 to the displayed phrase; the
  phrase itself has 0.836 (`Document` prompt).
- If the displayed phrase only has to rank first against its decoys, it ranks
  first for 79–89% of correct recordings, but 13–15% of changed verbs and
  6–8% of negations also rank first.
- The vector holds the words, not the voice. For all 48 clean correct
  recordings, the nearest other recording is the same phrase in another voice
  (mean similarity 0.956), never the same voice with another phrase (0.658).
  It cannot replace the speaker model.
- One audio vector takes 49 ms on average (p95 58 ms). Loading takes 6.6 s.

Result: keep Whisper for dictation and the approval phrase, and keep a speaker
model for VoiceID. EmbeddingGemma 2 suits search across voice notes, photos and
text, which this bench does not measure.

## Voxtral comparison — 2026-10-30

Voxtral Mini 4B Realtime (`mistralai/Voxtral-Mini-4B-Realtime-2602`, Apache
2.0, 13 languages) ran as the MLX 4-bit conversion
`mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit` (revision `fdebf7b2`,
3.1 GB) through mlx-audio 0.6.3, with the model's default 480 ms
transcription delay and the whole utterance at once. It takes no vocabulary.
Full tables: [`reports/stt-bench-2026-10-30-voxtral.md`](reports/stt-bench-2026-10-30-voxtral.md).

| Second phrase bank, 2,640 cases | Correct phrase accepted, clean / 10 / 5 / 0 dB | Near miss accepted | Median per utterance |
| --- | --- | --- | --- |
| Whisper turbo MLX, strict match | 97.9% / 94.4% / 86.8% / 81.9% | 0 of 1,920 | 0.42 s |
| Voxtral 4B Realtime 4-bit, strict match | 89.6% / 80.6% / 76.4% / 64.6% | 0 of 1,920 | 1.45 s |

- Voxtral accepted no near miss, no unrelated sentence and no other phrase.
- About one third of its 118 refused correct phrases lose or change the first
  word, which is usually the action: "Invoice 359." for "pay invoice three five
  nine", mostly in cafeteria noise.
- Full-precision weights (fp16, 8.9 GB) took about 7.4 s per utterance on this
  Mac, so they were not run on the whole set. The 2,400 ms delay, Voxtral Mini
  3B (July 2025, no Japanese), dictation and Japanese were not measured.
- The browser ONNX builds are about 2.8 GB (Realtime) and 2.7 GB (Mini 3B) at
  4-bit with 16-bit activations, against 563 MB for Whisper turbo.

Result: keep Whisper turbo. `run_model.py` keeps the Voxtral models; run them
with the separate venv from `requirements-voxtral.txt`.

## Workers AI comparison — 2026-10-30

Satyr Plan 82 runs Whisper turbo on Workers AI (`@cf/openai/whisper-large-v3-turbo`).
`workers_ai_run.py` posts each case to the probe Worker in `workers-ai-probe/`,
which calls the model through the Workers AI binding. The probe runs on
Cloudflare's network through `wrangler dev --remote` and is never deployed;
every request ran in Tokyo (colo NRT). The Plan 82 settings are the model
defaults with `language` and `vad_filter: true`. Accuracy runs send six
requests at a time; latency runs send one. Full tables:
[`reports/stt-bench-2026-10-30-workers-ai.md`](reports/stt-bench-2026-10-30-workers-ai.md).

| Same cases, Whisper turbo                                    | MLX on this Mac               | Workers AI                    |
| ------------------------------------------------------------ | ----------------------------- | ----------------------------- |
| Correct approval phrase accepted, clean / 10 / 5 / 0 dB      | 97.9% / 94.4% / 86.8% / 81.9% | 95.8% / 93.8% / 86.8% / 80.6% |
| Near miss, unrelated sentence or other phrase accepted       | 0                             | 0                             |
| English bakery dictation WER, clean / 0 dB                   | 8.8% / 13.2%                  | 8.7% / 13.0%                  |
| Same, with the shop vocabulary                               | 5.8% / 9.7%                   | 5.7% / 8.9%                   |
| Japanese bakery dictation CER, clean / 0 dB                  | 4.8% / 9.2%                   | 4.8% / 9.2%                   |
| Same, with the shop vocabulary                               | 2.8% / 6.4%                   | 2.8% / 6.0%                   |
| FLEURS Japanese CER, clean / 0 dB                            | 4.2% / 6.5%                   | 4.3% / 6.3%                   |

The one more clean refusal is "Ship badge 5 today" for "ship batch five
today"; MLX heard "badge" for another voice.

Latency from this Mac in Tokyo, 264 clean approval phrases (mean 2.3 s of
audio), one request at a time. The time is the round trip from the end of the
audio file to the transcript; the time inside the Worker around the AI call is
within 0.1 s of it.

| Settings                          | p50    | p95    | Max     |
| --------------------------------- | ------ | ------ | ------- |
| Plan 82: `vad_filter`, beam 5     | 1.57 s | 3.93 s | 7.33 s  |
| No `vad_filter`, beam 5           | 1.39 s | 3.73 s | 29.12 s |
| `vad_filter`, `beam_size` 1       | 1.46 s | 3.92 s | 8.94 s  |
| No `vad_filter`, `beam_size` 1    | 1.37 s | 3.46 s | 8.87 s  |

MLX on the M4 Pro takes 0.42 s at the median for the same model.

Result: Workers AI matches MLX accuracy, but it is about three times slower
than MLX at the median and has a long tail. Decoding settings do not change
that; the time is spent inside Workers AI.

## Deepgram comparison — 2026-10-30

Plan 82 decision D1a measures Deepgram Nova-3 and Flux on Workers AI, because
Whisper on Workers AI failed the latency gate. `deepgram_run.py` runs the same
cases through the probe Worker. Nova-3 takes the whole utterance over HTTP with
`smart_format`. Flux takes a live stream in 80 ms chunks at real time, then
silence until it ends the turn. Both use `mip_opt_out`. Full tables:
[`reports/stt-bench-2026-10-30-deepgram.md`](reports/stt-bench-2026-10-30-deepgram.md).

| Same cases                                              | Whisper on Workers AI         | Nova-3                        | Flux                          |
| ------------------------------------------------------- | ----------------------------- | ----------------------------- | ----------------------------- |
| Correct approval phrase accepted, clean / 10 / 5 / 0 dB | 95.8% / 93.8% / 86.8% / 80.6% | 91.7% / 89.6% / 86.1% / 79.2% | 72.9% / 72.2% / 68.1% / 54.2% |
| Near miss accepted (of 1,920)                           | 0                             | 0                             | 2                             |
| English bakery dictation WER, clean / 0 dB              | 8.7% / 13.0%                  | 8.8% / 14.6%                  | 15.6% / 27.3%                 |
| Same, with the shop vocabulary                          | 5.7% / 8.9%                   | 6.2% / 10.7%                  | 10.8% / 22.4%                 |
| Japanese bakery dictation CER, clean / 0 dB             | 4.8% / 9.2%                   | 10.9% / 19.4%                 | No Japanese                   |
| FLEURS Japanese CER, clean / 0 dB                       | 4.3% / 6.3%                   | 12.6% / 17.4%                 | No Japanese                   |

Nova-3 refuses key terms for Japanese (`does not support keyterm prompting`).
The Flux schema on Workers AI has no language setting. Flux streams ran eight at
a time for accuracy. One stream at a time, its clean approval band is 77.1%.

Latency from this Mac in Tokyo, 264 clean approval phrases, one at a time. The
Nova-3 and Whisper rows ran one after the other, in Tokyo (colo NRT).

| Model                         | From                 | p50    | p95    | Max     |
| ----------------------------- | -------------------- | ------ | ------ | ------- |
| Nova-3                        | End of file          | 0.26 s | 0.37 s | 0.72 s  |
| Whisper, Plan 82 settings     | End of file          | 2.04 s | 5.71 s | 10.67 s |
| Flux, `eager_eot_threshold`   | End of file          | 0.70 s | 1.16 s | 1.71 s  |
| Flux, end of turn             | End of speech        | 1.12 s | 1.56 s | 2.05 s  |
| Flux, eager end of turn       | End of speech        | 0.83 s | 1.20 s | –       |

The Flux time includes its own wait for silence. The other models need a
separate silence wait. Worker location is not under control through
`wrangler dev --remote`: an earlier Nova-3 run went through Los Angeles (0.62 s,
0.92 s), and some Flux streams went through Hong Kong or Los Angeles.

At 24 parallel streams, most Flux streams in Tokyo fell behind by more than 2 s
and their transcripts were cut. At 8 streams, 67 of 6,240 turns did not end.

Result: Nova-3 is fast and close to Whisper in English, but much worse in
Japanese. Flux is not accurate enough: it twice dropped "do not" from an
approval phrase and the strict match accepted the result.

## Record at the bench

`record.py` records one person in a real room condition, hands-free. Each run
records one condition: 50 prompts in about six minutes. It shows a phrase,
beeps after 1.5 s, and records a fixed window: 4 s for an approval phrase and
8 s for a dictation sentence. The prompts are the 12 phrases of the second
bank, two near misses for each phrase, four unrelated sentences, and the first
ten dictation sentences, in a fixed random order for each condition.

```sh
cd /absolute/path/to/seams-monorepo/voiceId/stt-bench
.cache/.venv/bin/python record.py --condition quiet
.cache/.venv/bin/python record.py --condition mixer
```

Before the first prompt, the script records three seconds of room sound to
estimate the signal-to-noise ratio of each take. Press Enter at any time to
pause after the current phrase; the pause menu records the last phrase again
or stops. The same command later resumes the condition. `--list-devices` and
`--device` select another microphone. `--dry-run` uses a macOS voice instead of
the microphone.

The recordings stay in the ignored `.cache/human/` folder. Never commit them.
Each run adds the recorded cases to `.cache/cases.jsonl` as the sets
`human_approval_en_v2` and `human_dictation_en`, with the condition label as
the condition. `prepare.py` keeps them. Score them like the other sets:

```sh
.cache/.venv/bin/python run_model.py --model whisper-large-v3-turbo --language en --set human_approval_en_v2
.cache/.venv/bin/python run_model.py --model whisper-large-v3-turbo --language en --set human_dictation_en
.cache/.venv/bin/python run_model.py --model moonshine-medium-streaming --language en --set human_approval_en_v2
"$engine/target/release/examples/whisper_bench_cases" .cache q8_0 human_approval_en_v2
.cache/.venv/bin/python score.py --report reports/stt-bench-YYYY-MM-DD
.cache/.venv/bin/python summarize.py reports/stt-bench-YYYY-MM-DD.json
```

The report then has tables for the recorded sets, one column for each condition.

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

The EmbeddingGemma 2 probe needs its own environment, because its packages
differ from the bench's pins:

```sh
uv venv --python 3.11 "$bench/.cache/.venv-embed"
uv pip install --python "$bench/.cache/.venv-embed/bin/python" -r "$bench/requirements-embed.txt"
"$bench/.cache/.venv-embed/bin/python" "$bench/embedding_probe.py" --out "$bench/reports/embeddinggemma2-approval-YYYY-MM-DD.json"
```

Voxtral runs need their own environment too (mlx-audio, mistral-common,
PyTorch). `--condition` and `--variant` select a part of a set:

```sh
uv venv --python 3.11 "$bench/.cache/.venv-voxtral"
uv pip install --python "$bench/.cache/.venv-voxtral/bin/python" -r "$bench/requirements-voxtral.txt"
"$bench/.cache/.venv-voxtral/bin/python" "$bench/run_model.py" --model voxtral-realtime-4b-4bit --language en --set approval_en_v2
```

Workers AI runs need a Wrangler sign-in with the `ai` scope. Start the probe in
one terminal, then run the sets from another:

```sh
npx wrangler dev --remote --config "$bench/workers-ai-probe/wrangler.jsonc" --port 8787 --ip 127.0.0.1
"$bench/.cache/.venv/bin/python" "$bench/workers_ai_run.py" --language en --set approval_en_v2
"$bench/.cache/.venv/bin/python" "$bench/workers_ai_run.py" --language en --set approval_en_v2 --condition clean --workers 1 --tag latency
```

`run_all.sh` runs each model in its own process, then writes
`reports/<name>.json` (all metrics, model and input hashes),
`reports/<name>.md` (tables) and `reports/<name>-cases.jsonl.gz` (every
reference and transcript). Moonshine Medium Streaming has no Japanese model.
Moonshine's Japanese models use the non-commercial Moonshine Community
License.
