# Browser host diagnosis

Two faults appeared during the composed browser journey. The first was a test
fixture ordering defect. The second was an enrollment-lease conflict after
startup cancellation. The public Wallet and private native branches contain the
corrections. No live microphone recording or transaction broadcast occurred.

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
