# VoiceID transaction confirmation phrases

Status: the front-page canvas preview is implemented. The user chose to keep
transaction phrases demo-only for now. The SDK retains its random challenges and
current models. The SDK confirmation draft is saved outside the active source.
Command-to-intent work remains a separate optional decision for the user.

The preview checks cover confirmation, cancellation, pause/resume, four themes,
and 390px/320px layouts. A separate voice-first demo is available for comparison.
Japanese controls and the English spoken phrase also passed a browser check. Evidence is written to
`.artifacts/wallet-voiceid-showcase/result.json`, screenshots, and `trace.zip`.

## Initial recognition results — October 27, 2026

The implementation draft derives native NEAR and Arc USDC transfer phrases from
the signing inputs. It keeps the request hash, review deadline, foreground Confirm
action, and speaker threshold. Short amounts use an exact action/amount/asset
check. Amounts that cannot fit a short phrase retain the random challenge without
rounding. Enrollment and unlock keep the random phrase bank.

The real-Aurora browser screen rejected all four correct baseline recordings:
10 NEAR, 0.5 NEAR, 10 USDC, and 10.25 USDC. For example, “send ten near now” became
“sent ten yar now.” This is a model limitation, not a reason to relax financial
field checks. Clearer transfer wording also failed Aurora screening.

Two larger local models were evaluated in an isolated Node process. These runs
used synthetic Samantha speech at 160 words per minute, without a transcript hint.

| Model                | Quantized model bytes | Observation                                                                                             |
| -------------------- | --------------------: | ------------------------------------------------------------------------------------------------------- |
| Moonshine Tiny       |            28,180,947 | Still omitted transfer words and asset names in the clearer phrases.                                    |
| Whisper Tiny English |            40,843,851 | Preserved all four baseline amounts and assets with “transfer … NEAR tokens” and “transfer … USD coin.” |

Whisper also retained negation and additional transfer words in the tested
adversarial recordings. These measurements do not establish browser latency,
human accuracy, or authentication safety. Browser integration, wrong-field checks,
and full no-sign-on-rejection contracts remain required.

The user chose the demo-only scope after reviewing these results. The current
SDK source and build retain their working random-challenge behavior. No
larger-model dependency was added. Production transaction phrases require a
separate decision to resume recognition qualification and SDK integration.

Local evidence: `.artifacts/voiceid-transaction-confirmation/`. It contains the
implementation patch, generated audio, model hashes, and transcription reports.
The patch includes the strict verifier and its draft browser/type fixtures; it
must pass qualification before integration. The first browser run also exceeded
its configured timeout after writing the report; the recognition mismatches were
recorded independently of that infrastructure timeout.

## Hosted recognition screen — October 27, 2026

Cloudflare Workers AI was tested through its real HTTP API with
`@cf/openai/whisper-large-v3-turbo`. OpenAI and ElevenLabs remain untested because
their API keys were unavailable in the local environment. The user was asked for
their configured credential locations.

Each run used the same 21 synthetic recordings, totaling 41.56 seconds. Fifteen
recordings came from the Aurora screen. Six additional recordings covered clearer
transfer wording, negation, and an additional instruction. All recordings used
Samantha at 160 words per minute, with 16 kHz mono PCM audio.

| Cloudflare configuration               | Exact normalized transcripts | Correct confirmations matched | False matches across 160 negative comparisons | Median HTTP time | Observed p95 |
| -------------------------------------- | ---------------------------: | ----------------------------: | --------------------------------------------: | ---------------: | -----------: |
| English only, no vocabulary hint       |                        17/21 |                           6/8 |                                             0 |           1.23 s |       4.12 s |
| English with a fixed ticker vocabulary |                        21/21 |                           8/8 |                                             0 |           1.77 s |       4.90 s |

The fixed hint was identical for every request:
“Cryptocurrency vocabulary: NEAR, USDC, USD Coin, Ether, ETH, Bitcoin, BTC.”
It contained no expected amount or confirmation sentence. Without that hint,
Cloudflare rendered NEAR as “NIR” in four recordings. Strict matching rejected
those results. Both runs correctly transcribed all four original short transfer
examples that Aurora had rejected.

The checker normalized case, terminal punctuation, explicit number spellings,
and USDC letter spacing. It used no approximate text matching or phonetic
substitutions. Negation, negative amounts, wrong actions/assets, missing amounts,
and additional instructions remained distinct from the approved examples.

These are 21 synthetic recordings and one sequential run per configuration.
The 160 comparisons reuse those transcripts against eight expected confirmations.
They are not 160 independent audio trials. HTTP timing includes network and service
time. This screen did not test speaker verification, signing, human speech, or
provider outages. Human recordings and integrated authorization contracts remain
required before changing SDK behavior.

The estimated model cost was $0.00036 per run at the
[listed Cloudflare rate](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/).
This is a duration-based estimate, not a billing statement.

Local repeatable evidence is saved under
`.artifacts/voiceid-transaction-confirmation/hosted/`, including both JSON reports,
audio hashes, transcripts, request times, and comparison results. The standalone
runner is `../hosted-evaluation.mjs` relative to that directory. Its provider
arguments are `cloudflare`, `cloudflare-vocabulary`, `openai`, and `elevenlabs`.
It uses local credentials without writing them to its reports.

Cloudflare with the fixed vocabulary is a candidate for the next real-voice
evaluation. Transaction phrases remain demo-only. No provider was integrated into
the Wallet or deployed by this evaluation.

## Scope and ownership

The application prepares the transaction intent. Its speech interface, command
transcription, trading strategy, venue selection, and quote acquisition stay
outside the Wallet.

The Wallet receives the prepared request, verifies the meaning it can establish
from that request, and presents its full review. VoiceID derives a short spoken
confirmation from that same reviewed operation.

Example:

1. Application supplies a prepared sale of 10 NEAR for USDC.
2. Wallet shows the amount, receiving asset, minimum received, fees, and expiry.
3. VoiceID prepares the phrase “Sell ten NEAR.”
4. User reads the phrase. VoiceID checks the speaker and the critical words.
5. Approval applies only to the reviewed operation. The receipt follows signing.

The short phrase does not repeat every term. The full review remains the source
for price bounds, fees, recipient, network, and additional actions.

## Model decision

| Component                       | Suitable responsibility                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| ReDimNet B1                     | Compare the speaker with the saved enrollment.                                         |
| AuroraASR                       | Transcribe the spoken confirmation for checking. It cannot summarize transaction data. |
| Silero VAD                      | Detect speech activity.                                                                |
| Deterministic phrase renderer   | Copy the validated action, amount, and asset into a short phrase.                      |
| Jev, if evaluation justifies it | Select among already-safe candidate phrase IDs or request a fallback.                  |

Start with the deterministic renderer for supported transaction types. This adds
no model weights, API key, network request, or model latency to the Wallet.

Jev accepts state and typed questions. Its documented outputs are choices,
scores, and probabilities; it does not generate arbitrary text. We could give it
safe candidates such as `sell_amount_asset` and `swap_asset_pair`. Code would
render the selected candidate using the original values. Jev would never supply
or rewrite amounts, asset identifiers, addresses, or approval permissions.

If the operation already has a verified semantic type, template selection needs
no model. An ambiguous or undecoded transaction must not gain a trusted meaning
from a model classification alone.

Sources checked October 27, 2026:

- [TypeSafe introduction](https://docs.typesafe.ai/introduction)
- [Jev question types](https://docs.typesafe.ai/introduction/quickstart)
- [AuroraASR model card](https://huggingface.co/AuroraAI-Research/AuroraASR-1M)

## 1. Front-page and separate voice-first demos

The front page keeps its review-first order: trade review, “Confirm with VoiceID,”
one “Sell ten NEAR” voice prompt, then the receipt. The extra preparation screen
and quote paragraph were removed at the user's request.

The separate `showcase/voiceid-reverse/` page starts with one voice prompt:
“Sell ten NEAR for USDC.” After the simulated speaker check, it shows the trade
review with one “Confirm trade” button. It waits for that click before showing
signing and the receipt. There is no second voice prompt. Done replays the flow.

Both pages share the SDK modal, transaction data, themes, receipt, and simulated
playback. The spoken phrase remains English. Controls support English and Japanese.
They make no microphone, model, provider API, or signing requests. The separate
page is a UX experiment and does not change SDK authorization behavior.

Cancellation during capture or checking stops pending transitions. The separate
page offers Try again after cancellation. Cancelling the trade review starts a
fresh voice attempt. Old callbacks cannot advance the cancelled attempt.

`tests/e2e/wallet-voiceid-showcase.e2e.mjs` exercises both orders, explicit
confirmation, cancellation, replay, pause/resume, four themes, and 390px/320px
layouts. It saves screenshots, a trace, and JSON evidence. It checks that neither
page requests microphone access, inference assets, provider APIs, or signing.

## 2. Future SDK phrase preparation — deferred

Implement production behavior in `seams-wallet`, primarily in
`packages/voiceid/src/capture/approval.ts`, `browser/phrase.ts`, and the shared
review/display boundary that owns the transaction's verified meaning.

Current constraints:

- `TransactionReviewWire` carries review identity and expiry. It does not carry
  the transaction's semantic meaning.
- `VoiceIdApproval` already binds approval to an operation hash and review
  deadline. Preserve that binding.
- `SpokenPhrase` currently names the finite challenge bank. It cannot represent
  arbitrary amounts and asset names.
- Current approval requires a foreground review and an explicit Confirm action.
  This plan does not remove that requirement.

Derive the phrase from decoded signing inputs and verified asset metadata.
Never derive authoritative fields from an app-supplied display sentence alone.
Treat token symbols as display data; identify assets by network and contract or
native-asset identity.

Start with transfers, then add swaps whose decoder can establish the sale
amount, receiving asset, recipient, minimum output, and additional approvals.
Unsupported calls and compound operations retain the full review and existing
confirmation policy. A friendly label must not conceal an unlimited allowance
or an extra transfer.

Represent phrase preparation as a result union: a supported structured phrase,
an explicit unsupported operation, or a recoverable preparation failure. Require
the narrow supported intent type in each phrase builder. Validate external
inputs once at the request boundary.

Keep transaction-bound phrases and random challenge phrases as distinct typed
variants. Enrollment and unlock retain the existing phrase bank. The user must
still be able to re-enroll, cancel, or choose another supported method.

## 3. Check the spoken meaning

Reuse Aurora and the speaker model first. Expose the independently decoded text
to a transaction-phrase verifier instead of comparing only with the fixed bank.

Normalize supported spoken number forms to an exact decimal representation.
For example, “ten” and “10” may match; “one”, “one hundred”, and “ten thousand”
must not match 10. Avoid floating-point amounts and silent rounding.

Require exact semantic agreement on action, amount, and asset. Preserve negation
checks. Restrict accepted ticker pronunciations to explicit asset aliases and
reject ambiguity. Do not apply the current 30% text-difference allowance to
financial fields. Harmless wording can vary around those fields.

Use a fresh challenge for each attempt. A short transaction phrase can recur,
so it does not independently establish audio freshness or liveness. If additional
spoken freshness is required, evaluate a brief random suffix separately from
the action fields. Keep the existing speaker threshold at 0.5 during evaluation.

Reuse cancellation, expiry, request generation, and operation-hash checks.
Changing the transaction, quote bounds, network, account, or asset invalidates
the prepared phrase and approval. A transcript or model choice cannot grant
signing permission on its own.

## 4. Recognition and model evaluation

Extend the existing real-Aurora browser test and generated audio fixtures.
Exercise correct phrases and deliberately confusable alternatives: buy/sell,
10/100, decimals, ticker names, changed recipients, negation, and compound calls.
Include cancellation, expired quotes, and replacement of a reviewed request.
The E2E artifact must show that rejected or stale approvals never reach signing.

Synthetic speech supports development checks. Test natural speech from multiple
people, accents, microphones, and speaking rates before setting production
acceptance criteria. Measure owner rejection and wrong-field acceptance
separately. A more accurate ASR model is an evaluation option if Aurora cannot
meet those criteria; do not compensate by accepting ambiguous amounts.

Evaluate Jev only if candidate selection is a demonstrated problem. Compare it
with the deterministic baseline for incorrect selections, latency, cost, and
availability. Include adversarial metadata and unknown operations. Model scores
must not serve as authorization decisions.

A remote model requires an explicit decision about transaction-data disclosure
and the operator's service boundary. Keep provider credentials out of the
browser. On timeout or uncertainty, retain the ordinary review path.

## Future delivery order — deferred after the demo

1. Implement and verify the lightweight canvas preview.
2. Add typed transaction phrases and exact field checking in the optional SDK.
3. Qualify Aurora on the transaction-phrase test set.
4. Evaluate Jev or another model only for a measured gap.
5. Publish a new SDK version, update exact application dependencies, and deploy
   matching host assets before applications use the new behavior.

Hands-free activation beyond the current Confirm action is a separate policy
change. It needs its own user-intent and microphone-lifecycle contract.
