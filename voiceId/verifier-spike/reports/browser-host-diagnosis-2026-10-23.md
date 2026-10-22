# Browser host diagnosis

Two faults appeared during the initial composed browser journey. The first was a test
fixture ordering defect. The second was an enrollment-lease conflict after
startup cancellation. The public Wallet and private native branches contain the
corrections. That initial admission-only journey performed no live microphone
recording or transaction broadcast.

## Facts

| ID | Measured fact | Instrument and scope | Check |
| --- | --- | --- | --- |
| F1 | The fixture reported `prepared:idle`, then `mounted`, `ready=true`, `inert=true`, and zero signing admissions. | Public browser snapshot in `/tmp/voiceid-gate-diagnostic.log`, 2026-10-23. | The phase list confirms that preparation arrived. The DOM confirms that activation did not occur. |
| F2 | The original fixture ignored preparation while idle. It stored the mounted admission after awaiting UI creation. | `VoiceIdWalletHostProbe.ts` and `TransactionReviewAdmission.prepared`. | The admission publishes preparation once. The fixture needs the admission before mounting completes. |
| F3 | The existing 40 confirmation/review browser tests passed. | `/tmp/voiceid-wallet-ui.log`. | This controls the existing protocol. It does not establish the new VoiceID path. |
| F4 | A fixture-only preparing branch permitted activation and the public VoiceID journey passed. | Public browser contract and the composed native journey. | The current report contains real native approval at the existing signing boundary. |
| F5 | The earlier native run printed two `Conflict` errors after cancellation. Its fresh request failed. | Native stderr captured in the tool transcript. | The original file was overwritten by the next run. The excerpt below preserves that observation. |
| F6 | The earlier constructor acquired the Keychain namespace lease before loading models. | Native session and Keychain source. | A blocked lease maps to `StoreError::Conflict`. The exact previous holder PID was not measured. |
| F7 | Model loading now checks cancellation before acquiring the lease. The identical journey passed afterward. | Native source and real Chromium/native-messaging journey. | The session still retains the exclusive lease throughout capture and result consumption. |

Earlier stderr excerpt:

```text
Error: "VoiceID native messaging: Conflict"
Error: "VoiceID native messaging: Conflict"
Error: "VoiceID connection closed"
```

## Candidate causes

| Cause | Evidence | Result |
| --- | --- | --- |
| The fixture discards early preparation. | Fits F1 and F2. The fixture-only control in F4 recovers. | Confirmed for the activation stall. |
| The production admission never prepares. | F1 records preparation and a ready surface. | Rejected for that stall. |
| Speech recognition causes the activation stall. | The surface remains inert before Confirm can start the check. | Rejected for that stall. |
| Cancelled startup retains the enrollment lease during model loading. | Fits F5 and F6. The corrected order passes F7. | Source-supported diagnosis with a passing control. |
| An unrelated process holds the lease. | An isolated `Conflict` also fits this cause. The journey uses a fresh random namespace. | No holder-PID evidence exists. Exact attribution remains inferred. |

The independent reviewer agreed with the fixture diagnosis and found that the
lease correction preserves exclusive enrollment access. The reviewer identified
two evidence limits. The earlier conflict file was not retained. The original
`cancel_during_capture` case cancelled immediately after Confirm and could cover
startup instead.

The current journey has separate `cancel_pending_startup` and
`cancel_after_capture_started` cases. The latter waits for the native listening
event. Capture readiness grants no approval and does not extend the deadline.

The repeatable [browser report](browser-host-2026-10-23.json) records binary,
extension, and Wallet probe hashes. Its parity covers the real native provider,
Chrome transport, and production review/signing-admission hook. Live capture and
funded transaction execution remain outside this test.

## Extension to real MPC and testnet

The later journey now signs through the real Wallet and confirms a testnet
transfer. It uses synthetic speech, real native models, and a browser virtual
authenticator. It preserves the existing server authorization and quota policy.

| ID | Measured fact | Instrument and scope | Check |
| --- | --- | --- | --- |
| F8 | An early Confirm click saw `inert=true` and zero voice connections. | Wallet DOM and deterministic bridge observation. | A control activated the same surface. Waiting for activation permits interaction. |
| F9 | Three denied preparations observed remaining uses `3, 3, 2, 2, 1, 1, 0`. The next review reported a changed session. | `/wallet/session/status` responses and application result. | The initial log omitted session identities. It cannot identify the exact identity-guard branch. |
| F10 | The six-use client setting still yielded three server uses. Owner unlock then allowed approval and left two uses after signing. | Server status, registration policy, and real WebAuthn unlock. | The server caps registration at three uses. The specification retains a spent early prepare after denial. |
| F11 | The old RPC fixture omitted `final_execution_status` and execution outcome fields. | Intended harness and production NEAR decoder. | A completed stub reply now passes the current decoder. Production decoding remains unchanged. |
| F12 | The first capture filter counted zero signed payloads although the application submitted. | Capture array, application result, and configured RPC origin. | The SDK uses FastNEAR. The observer accepted only `near.org`. Matching the configured origin captures and verifies the payload. |
| F13 | The bridge reports `cancelled, rejected, rejected, approved`. Only approval produces a valid registered-key signature. | Passive observation of actual Chrome port replies and independent Ed25519 verification. | The private native journey passes the same scenario with network-denied inference. |
| F14 | The faucet returned `EXECUTED_OPTIMISTIC`. An immediate final-state read reported a missing key. Waiting for transaction `FINAL` allowed funding and refund. | [Faucet finality record](browser-wallet-funding-finality-2026-10-23.json). | The control preserves the raw public response. The earlier failed run did not preserve its response. |
| F15 | The voice-approved self-transfer reached `FINAL` with a valid signature, one transfer action, and one yoctoNEAR. | [Testnet report](browser-wallet-testnet-2026-10-23.json), signature verification, and RPC receipt readback. | The run deleted its funder, returned its remaining balance, and removed local Wallet authority and enrollment. |

| Candidate cause | Evidence | Result |
| --- | --- | --- |
| The production review never activates. | F8 has a working control. | Rejected. The early test click caused the stall. |
| Voice denial can bypass signing. | F13 observes the denial and zero finalizations. Approval supplies the non-zero control. | Rejected for these cases. |
| Three denials exhaust the initial quota. | F9 and F10 match the current prepare policy. | Confirmed. The precise fourth-review guard remains inferred. |
| The six-use setting can override server policy. | F10 still observes three uses. | Rejected. |
| The production NEAR decoder rejects a valid final reply. | F11 records missing required fields. | Rejected. The RPC fixture was obsolete. |
| A zero capture proves no signature was produced. | F12 records a submitted transaction and the wrong observer origin. | Rejected. The instrument missed the configured RPC. |
| The faucet response guarantees final-state key availability. | F14 records optimistic execution and a missing key. | Rejected. Funding waits for finality. |

Classifications: activation timing, quota setup, and observer matching were
`valid_test_needs_update`. The incomplete RPC response was
`obsolete_test_or_fixture`. Runs against stopped services or reused local
bootstrap state were `environment_or_infrastructure_failure`.

The initial `production_regression` interpretation of the activation stall was
withdrawn. The earlier signature-verification claim preceded a working capture
instrument and was withdrawn. F13 and F15 establish that claim for the corrected
journey. The independent reviewer identified the missing session identities and
required direct voice-outcome observation. Both limits are recorded here.

The first failed faucet run did not retain its account ID or in-memory private
key. Its funding and account cleanup cannot be verified. The voice-approved
on-chain self-transfer did not start in that run. The successful run's funder
deletion is scoped to the recorded account. An
[independent RPC readback](browser-wallet-testnet-readback-2026-10-23.json)
confirms that successful transaction and the funder's deletion.
The final helper removes the temporary pre-finality probe and waits directly
for account-creation finality. The funded run included that probe. Removing the
probe was syntax-checked and was not rerun against the faucet.

The later independent review found matching binary, extension, and funded-scenario
hashes. Its Node crypto check also verified the raw RPC signature under the
registered key. The earlier MPC-only artifact retains its historical scenario hash.

Product parity now covers the real browser, native models, owner authorization,
MPC, signed payload, and funded testnet broadcast. Live microphone recognition,
targeted synthesis, clean-host installation, and uncertain broadcast outcomes
remain unqualified. Live speech, a clean Mac, and controlled reply loss would
settle the remaining applicable acceptance checks.
