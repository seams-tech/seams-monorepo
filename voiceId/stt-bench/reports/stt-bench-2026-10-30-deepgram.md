# Speech-to-text bench report

Source: `stt-bench-2026-10-30-deepgram.json`. Error rates are lower-is-better; recall and accept rates of the correct phrase are higher-is-better.


## English bakery dictation: word error rate

| Run | clean | 10 dB | 5 dB | 0 dB |
| --- | --- | --- | --- | --- |
| moonshine-base-en | 16.8% | 18.9% | 22.1% | 29.2% |
| moonshine-medium-streaming-en | 16.3% | 16.7% | 19.9% | 26.1% |
| moonshine-medium-streaming-en-vocab | 15.3% | 15.5% | 18.4% | 25.3% |
| moonshine-tiny-streaming-en | 27.0% | 30.6% | 34.6% | 44.7% |
| moonshine-tiny-streaming-en-vocab | 24.8% | 28.8% | 32.1% | 43.3% |
| whisper-large-v3-turbo-en | 8.8% | 9.4% | 10.4% | 13.2% |
| whisper-large-v3-turbo-en-vocab | 5.8% | 6.4% | 6.6% | 9.7% |
| workers-ai-flux-en-dictation_en | 15.6% | 15.9% | 19.5% | 27.3% |
| workers-ai-flux-en-vocab-dictation_en | 10.8% | 12.2% | 14.6% | 22.4% |
| workers-ai-nova-3-en-dictation_en | 8.8% | 10.0% | 11.0% | 14.6% |
| workers-ai-nova-3-en-vocab-dictation_en | 6.2% | 6.6% | 7.4% | 10.7% |
| workers-ai-whisper-large-v3-turbo-en-dictation_en | 8.7% | 9.3% | 9.9% | 13.0% |
| workers-ai-whisper-large-v3-turbo-en-vocab-dictation_en | 5.7% | 6.2% | 6.5% | 8.9% |

## English bakery dictation: key-term recall

| Run | clean | 10 dB | 5 dB | 0 dB |
| --- | --- | --- | --- | --- |
| moonshine-base-en | 64.2% | 63.4% | 60.7% | 55.9% |
| moonshine-medium-streaming-en | 73.3% | 71.6% | 68.6% | 62.7% |
| moonshine-medium-streaming-en-vocab | 76.2% | 75.8% | 73.6% | 67.0% |
| moonshine-tiny-streaming-en | 61.8% | 56.6% | 51.6% | 46.3% |
| moonshine-tiny-streaming-en-vocab | 67.6% | 61.3% | 57.3% | 51.3% |
| whisper-large-v3-turbo-en | 75.3% | 75.6% | 74.6% | 71.4% |
| whisper-large-v3-turbo-en-vocab | 86.9% | 87.4% | 86.8% | 83.7% |
| workers-ai-flux-en-dictation_en | 72.2% | 70.8% | 68.0% | 60.8% |
| workers-ai-flux-en-vocab-dictation_en | 79.3% | 79.3% | 77.8% | 69.8% |
| workers-ai-nova-3-en-dictation_en | 77.6% | 75.4% | 74.4% | 70.2% |
| workers-ai-nova-3-en-vocab-dictation_en | 85.8% | 85.2% | 84.8% | 80.9% |
| workers-ai-whisper-large-v3-turbo-en-dictation_en | 76.2% | 76.1% | 75.6% | 72.4% |
| workers-ai-whisper-large-v3-turbo-en-vocab-dictation_en | 87.6% | 88.2% | 87.8% | 84.7% |

## English human read speech (FLEURS): word error rate

| Run | clean | 10 dB | 5 dB | 0 dB |
| --- | --- | --- | --- | --- |
| moonshine-base-en | 11.7% | 15.5% | 18.7% | 28.3% |
| moonshine-medium-streaming-en | 8.0% | 10.9% | 14.1% | 22.3% |
| moonshine-tiny-streaming-en | 18.4% | 24.1% | 29.3% | 40.3% |
| whisper-large-v3-turbo-en | 4.8% | 5.1% | 6.2% | 10.2% |

## Japanese bakery dictation: character error rate

| Run | clean | 10 dB | 5 dB | 0 dB |
| --- | --- | --- | --- | --- |
| moonshine-base-ja | 23.5% | 21.6% | 22.7% | 24.4% |
| moonshine-tiny-streaming-ja | 6.2% | 13.2% | 17.8% | 22.0% |
| whisper-large-v3-turbo-ja | 4.8% | 5.9% | 6.9% | 9.2% |
| whisper-large-v3-turbo-ja-vocab | 2.8% | 4.2% | 4.1% | 6.4% |
| workers-ai-nova-3-ja-dictation_ja | 10.9% | 12.5% | 15.0% | 19.4% |
| workers-ai-whisper-large-v3-turbo-ja-dictation_ja | 4.8% | 6.2% | 6.6% | 9.2% |
| workers-ai-whisper-large-v3-turbo-ja-vocab-dictation_ja | 2.8% | 4.7% | 5.8% | 6.0% |

## Japanese bakery dictation: key-term recall

| Run | clean | 10 dB | 5 dB | 0 dB |
| --- | --- | --- | --- | --- |
| moonshine-base-ja | 65.0% | 73.3% | 67.5% | 64.2% |
| moonshine-tiny-streaming-ja | 77.5% | 65.0% | 63.3% | 54.2% |
| whisper-large-v3-turbo-ja | 90.0% | 85.8% | 83.3% | 74.2% |
| whisper-large-v3-turbo-ja-vocab | 95.0% | 90.8% | 90.8% | 84.2% |
| workers-ai-nova-3-ja-dictation_ja | 67.5% | 58.3% | 55.0% | 50.8% |
| workers-ai-whisper-large-v3-turbo-ja-dictation_ja | 90.0% | 85.0% | 84.2% | 74.2% |
| workers-ai-whisper-large-v3-turbo-ja-vocab-dictation_ja | 95.0% | 90.0% | 90.8% | 85.0% |

## Japanese human read speech (FLEURS): character error rate

| Run | clean | 10 dB | 5 dB | 0 dB |
| --- | --- | --- | --- | --- |
| moonshine-base-ja | 25.4% | 27.0% | 29.2% | 32.3% |
| moonshine-tiny-streaming-ja | 12.0% | 13.7% | 15.4% | 23.2% |
| whisper-large-v3-turbo-ja | 4.2% | 4.6% | 5.1% | 6.5% |
| workers-ai-nova-3-ja-fleurs_ja | 12.6% | 12.6% | 13.9% | 17.4% |
| workers-ai-whisper-large-v3-turbo-ja-fleurs_ja | 4.3% | 4.4% | 4.7% | 6.3% |

## Approval phrases (first phrase bank), `strict` policy: accept rates

| Run | clean: correct / near miss | 10 dB: correct / near miss | 5 dB: correct / near miss | 0 dB: correct / near miss | negation | verb | detail | missing | unrelated | other phrase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| moonshine-base-en | 41.7% / 0.0% | 43.1% / 0.0% | 32.6% / 0.0% | 31.2% / 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| moonshine-medium-streaming-en | 47.9% / 0.0% | 36.1% / 0.0% | 26.4% / 0.0% | 23.6% / 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| moonshine-tiny-streaming-en | 29.2% / 0.0% | 27.1% / 0.0% | 18.1% / 0.0% | 16.7% / 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| whisper-large-v3-turbo-en | 70.8% / 0.0% | 69.4% / 0.0% | 67.4% / 0.0% | 53.5% / 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |

## Approval phrases (first phrase bank), `one_edit` policy: accept rates

| Run | clean: correct / near miss | 10 dB: correct / near miss | 5 dB: correct / near miss | 0 dB: correct / near miss | negation | verb | detail | missing | unrelated | other phrase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| moonshine-base-en | 75.0% / 34.4% | 68.8% / 34.0% | 56.2% / 29.7% | 47.9% / 22.6% | 0.0% | 37.7% | 40.8% | 38.8% | 0.0% | 0.0% |
| moonshine-medium-streaming-en | 72.9% / 28.6% | 67.4% / 28.5% | 59.7% / 25.9% | 59.7% / 21.9% | 0.0% | 34.8% | 35.4% | 32.7% | 0.0% | 0.0% |
| moonshine-tiny-streaming-en | 60.4% / 19.8% | 46.5% / 17.9% | 36.1% / 16.3% | 34.0% / 13.0% | 0.0% | 21.2% | 23.1% | 20.2% | 0.0% | 0.0% |
| whisper-large-v3-turbo-en | 89.6% / 49.0% | 91.7% / 48.4% | 89.6% / 46.4% | 81.2% / 39.6% | 0.0% | 60.4% | 65.6% | 54.8% | 0.0% | 0.0% |

## Approval phrases (second phrase bank, common words and numbers), `strict` policy: accept rates

| Run | clean: correct / near miss | 10 dB: correct / near miss | 5 dB: correct / near miss | 0 dB: correct / near miss | negation | verb | detail | missing | unrelated | other phrase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| moonshine-medium-streaming-en-approval_en_v2 | 66.7% / 0.0% | 52.8% / 0.2% | 63.2% / 0.2% | 45.1% / 0.0% | 0.0% | 0.0% | 0.4% | 0.0% | 0.0% | 0.0% |
| voxtral-realtime-4b-4bit-en-approval_en_v2 | 89.6% / 0.0% | 80.6% / 0.0% | 76.4% / 0.0% | 64.6% / 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| whisper-cpp-large-v3-turbo-q5_0-approval_en_v2 | 93.8% / 0.0% | 91.0% / 0.0% | 86.8% / 0.0% | 79.2% / 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| whisper-cpp-large-v3-turbo-q8_0-approval_en_v2 | 93.8% / 0.0% | 92.4% / 0.0% | 86.8% / 0.0% | 79.9% / 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| whisper-large-v3-turbo-en-approval_en_v2 | 97.9% / 0.0% | 94.4% / 0.0% | 86.8% / 0.0% | 81.9% / 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| workers-ai-flux-en-approval_en_v2 | 72.9% / 0.0% | 72.2% / 0.2% | 68.1% / 0.2% | 54.2% / 0.0% | 0.4% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| workers-ai-flux-en-approval_en_v2-clean-latency | 77.1% / 0.0% | – | – | – | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| workers-ai-flux-en-eager0.5-approval_en_v2-clean-latency | 77.1% / 0.0% | – | – | – | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| workers-ai-nova-3-en-approval_en_v2 | 91.7% / 0.0% | 89.6% / 0.0% | 86.1% / 0.0% | 79.2% / 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| workers-ai-nova-3-en-approval_en_v2-clean-latency | 91.7% / 0.0% | – | – | – | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| workers-ai-nova-3-en-approval_en_v2-clean-latency2 | 91.7% / 0.0% | – | – | – | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| workers-ai-whisper-large-v3-turbo-en-approval_en_v2 | 95.8% / 0.0% | 93.8% / 0.0% | 86.8% / 0.0% | 80.6% / 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| workers-ai-whisper-large-v3-turbo-en-approval_en_v2-clean-latency | 95.8% / 0.0% | – | – | – | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| workers-ai-whisper-large-v3-turbo-en-approval_en_v2-clean-latency2 | 95.8% / 0.0% | – | – | – | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| workers-ai-whisper-large-v3-turbo-en-beam1-approval_en_v2-clean-latency | 95.8% / 0.0% | – | – | – | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| workers-ai-whisper-large-v3-turbo-en-novad-approval_en_v2-clean-latency | 97.9% / 0.0% | – | – | – | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| workers-ai-whisper-large-v3-turbo-en-novad-beam1-approval_en_v2-clean-latency | 97.9% / 0.0% | – | – | – | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |

## Approval phrases (second phrase bank, common words and numbers), `one_edit` policy: accept rates

| Run | clean: correct / near miss | 10 dB: correct / near miss | 5 dB: correct / near miss | 0 dB: correct / near miss | negation | verb | detail | missing | unrelated | other phrase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| moonshine-medium-streaming-en-approval_en_v2 | 95.8% / 44.8% | 86.8% / 39.6% | 83.3% / 39.1% | 67.4% / 32.3% | 0.0% | 51.5% | 54.0% | 45.6% | 0.0% | 0.0% |
| voxtral-realtime-4b-4bit-en-approval_en_v2 | 97.9% / 60.9% | 94.4% / 56.8% | 91.0% / 53.8% | 79.9% / 45.0% | 0.0% | 81.9% | 75.8% | 53.3% | 0.0% | 0.0% |
| whisper-cpp-large-v3-turbo-q5_0-approval_en_v2 | 97.9% / 67.7% | 97.9% / 66.8% | 95.8% / 64.6% | 91.0% / 54.9% | 0.0% | 89.0% | 91.5% | 70.2% | 0.0% | 0.0% |
| whisper-cpp-large-v3-turbo-q8_0-approval_en_v2 | 100.0% / 68.2% | 98.6% / 66.5% | 96.5% / 64.6% | 89.6% / 55.0% | 0.0% | 89.0% | 92.5% | 69.2% | 0.0% | 0.0% |
| whisper-large-v3-turbo-en-approval_en_v2 | 100.0% / 68.8% | 100.0% / 67.2% | 97.2% / 64.8% | 89.6% / 56.2% | 0.0% | 89.6% | 93.1% | 70.6% | 0.0% | 0.0% |
| workers-ai-flux-en-approval_en_v2 | 81.2% / 57.3% | 85.4% / 54.7% | 86.1% / 51.6% | 69.4% / 41.0% | 1.2% | 71.2% | 65.0% | 62.1% | 0.0% | 0.0% |
| workers-ai-flux-en-approval_en_v2-clean-latency | 89.6% / 60.4% | – | – | – | 2.1% | 85.4% | 79.2% | 75.0% | 0.0% | 0.0% |
| workers-ai-flux-en-eager0.5-approval_en_v2-clean-latency | 89.6% / 59.4% | – | – | – | 2.1% | 81.2% | 79.2% | 75.0% | 0.0% | 0.0% |
| workers-ai-nova-3-en-approval_en_v2 | 97.9% / 66.7% | 98.6% / 66.1% | 97.2% / 64.6% | 93.1% / 56.1% | 0.0% | 85.2% | 90.2% | 75.4% | 0.0% | 0.0% |
| workers-ai-nova-3-en-approval_en_v2-clean-latency | 97.9% / 66.7% | – | – | – | 0.0% | 93.8% | 93.8% | 79.2% | 0.0% | 0.0% |
| workers-ai-nova-3-en-approval_en_v2-clean-latency2 | 97.9% / 66.7% | – | – | – | 0.0% | 93.8% | 93.8% | 79.2% | 0.0% | 0.0% |
| workers-ai-whisper-large-v3-turbo-en-approval_en_v2 | 100.0% / 67.2% | 99.3% / 65.1% | 97.9% / 62.7% | 88.9% / 54.3% | 0.0% | 89.2% | 92.5% | 63.7% | 0.0% | 0.0% |
| workers-ai-whisper-large-v3-turbo-en-approval_en_v2-clean-latency | 100.0% / 67.2% | – | – | – | 0.0% | 100.0% | 100.0% | 68.8% | 0.0% | 0.0% |
| workers-ai-whisper-large-v3-turbo-en-approval_en_v2-clean-latency2 | 100.0% / 67.2% | – | – | – | 0.0% | 100.0% | 100.0% | 68.8% | 0.0% | 0.0% |
| workers-ai-whisper-large-v3-turbo-en-beam1-approval_en_v2-clean-latency | 100.0% / 68.2% | – | – | – | 0.0% | 97.9% | 100.0% | 75.0% | 0.0% | 0.0% |
| workers-ai-whisper-large-v3-turbo-en-novad-approval_en_v2-clean-latency | 100.0% / 66.7% | – | – | – | 0.0% | 97.9% | 100.0% | 68.8% | 0.0% | 0.0% |
| workers-ai-whisper-large-v3-turbo-en-novad-beam1-approval_en_v2-clean-latency | 100.0% / 68.2% | – | – | – | 0.0% | 97.9% | 100.0% | 75.0% | 0.0% | 0.0% |

## Size and speed on this Mac

| Run | Model files | Load | Mean per utterance | Real-time factor | Peak resident | Peak GPU |
| --- | --- | --- | --- | --- | --- | --- |
| moonshine-base-en | 141 MB | 0.6 s | 90 ms | 0.023 | 0.91 GB | – |
| moonshine-base-ja | 141 MB | 0.5 s | 277 ms | 0.023 | 1.04 GB | – |
| moonshine-medium-streaming-en | 269 MB | 0.7 s | 332 ms | 0.085 | 1.49 GB | – |
| moonshine-medium-streaming-en-vocab | 269 MB | 0.8 s | 378 ms | 0.093 | 1.31 GB | – |
| moonshine-tiny-streaming-en | 45 MB | 0.2 s | 121 ms | 0.031 | 0.66 GB | – |
| moonshine-tiny-streaming-en-vocab | 45 MB | 0.2 s | 138 ms | 0.034 | 0.64 GB | – |
| moonshine-tiny-streaming-ja | 32 MB | 0.2 s | 151 ms | 0.012 | 0.53 GB | – |
| whisper-large-v3-turbo-en | 1614 MB | 4.2 s | 502 ms | 0.128 | 1.86 GB | 2.48 GB |
| whisper-large-v3-turbo-en-vocab | 1614 MB | 3.9 s | 450 ms | 0.111 | 1.84 GB | 2.48 GB |
| whisper-large-v3-turbo-ja | 1614 MB | 3.3 s | 506 ms | 0.042 | 1.88 GB | 2.49 GB |
| whisper-large-v3-turbo-ja-vocab | 1614 MB | 2.6 s | 555 ms | 0.118 | 1.93 GB | 2.48 GB |
