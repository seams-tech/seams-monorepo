# VoiceID transaction confirmation phrases

Status: the front-page canvas preview is implemented. The SDK confirmation draft
passed type checks, but Aurora failed its exact-field speech screen. The draft is
saved outside the active SDK pending the speech-model choice. Command-to-intent
work remains deferred by the user.

The development and production previews pass browser checks for preparation,
confirmation, cancellation, pause/resume, four themes, and 390px/320px layouts.
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

The current SDK source and build retain their working random-challenge behavior.
No larger-model dependency was added. The user must choose whether to add the
larger local model download or keep transaction phrases in the demo for now.

Local evidence: `.artifacts/voiceid-transaction-confirmation/`. It contains the
implementation patch, generated audio, model hashes, and transcription reports.
The patch includes the strict verifier and its draft browser/type fixtures; it
must pass qualification before integration. The first browser run also exceeded
its configured timeout after writing the report; the recognition mismatches were
recorded independently of that infrastructure timeout.

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

## 1. Front-page demo

Update `apps/wallet-console/src/showcase/voiceid.ts` in this repository. Preserve
the existing SDK modal, themes, receipt, playback clock, and canvas controls.

Show this sequence:

1. **Prepared trade:** a sample sale of 10 NEAR for USDC. Label the quote as an
   example. Show a fixed example minimum received, fee, and slippage limit.
2. **Prepare confirmation:** a brief transition from the reviewed trade to its
   short phrase. The copy says “Preparing confirmation.”
3. **Read aloud:** show “Sell ten NEAR.” Play the existing simulated speech
   activity, then “Checking your voice…”
4. **Receipt:** show the existing signing, broadcast, and confirmation sequence.
   Completion returns to the prepared review.

The preview starts at the Wallet boundary. It does not show the Wallet
transcribing a trading command or obtaining a quote. Keep microphone access,
model downloads, AI API calls, and real transactions out of the canvas demo.
Label the new intent-specific confirmation as a concept preview until released.

Keep autoplay, manual confirmation, cancellation, pause/resume, theme changes,
and replay functional. Cancelling during phrase preparation or capture cancels
every pending transition. A new run cannot receive an old run's completion.

Update English and Japanese interface copy. The spoken phrase remains English
while the recognition model supports only English.

Extend `tests/e2e/wallet-voiceid-showcase.e2e.mjs` to exercise the new sequence,
cancel during preparation and capture, repeat with a fresh run, and inspect all
four themes plus 390px and 320px widths. Save screenshots, a trace, and JSON
evidence. Assert that the preview requests no microphone, inference assets,
model API, or signing endpoint. Replace the old fixed-phrase assertions.

## 2. SDK phrase preparation

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

## Delivery order

1. Implement and verify the lightweight canvas preview.
2. Add typed transaction phrases and exact field checking in the optional SDK.
3. Qualify Aurora on the transaction-phrase test set.
4. Evaluate Jev or another model only for a measured gap.
5. Publish a new SDK version, update exact application dependencies, and deploy
   matching host assets before applications use the new behavior.

Hands-free activation beyond the current Confirm action is a separate policy
change. It needs its own user-intent and microphone-lifecycle contract.
