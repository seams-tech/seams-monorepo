# macOS virtual capture device plan

Date: 2026-09-16
Status: proposed architecture; no virtual capture device, authenticated-capture
protocol, or hardware-backed capture implementation exists yet.

Related plans:

- [Local VoiceID architecture and implementation](voiceId-local-architecture-and-implementation-plan.md)
- [MPC wallet extension](voiceId-mpc-wallet-extension-plan.md)

## Objective

Build the first macOS VoiceID capture path as a virtual protected microphone
device. It must exercise the same boundary expected from a later STM32 capture
module:

1. the VoiceID host issues a fresh, bounded capture request;
2. a separate capture-device process acquires microphone audio after accepting
   that request;
3. the device emits ordered audio evidence authenticated by its device key;
4. a verifier admits only valid, fresh, continuous evidence to the VoiceID
   pipeline; and
5. capture assurance remains explicit through attribution and authorization.

The Mac implementation is a protocol and integration prototype. macOS controls
the built-in microphone and can replace samples before the capture process sees
them. A Mac key protected by the Secure Enclave can be non-exportable while its
signing API still accepts host-supplied bytes. Consequently, this design does not
claim cryptographic sensor origin or resistance to a compromised Mac.

The later STM32 implementation replaces the capture-device and transport
adapters. The evidence verifier, engine input boundary, models, attribution, and
consumer integrations should remain unchanged.

## Settled structure

| Decision | Direction |
| --- | --- |
| Engine delivery | Keep the VoiceID engine as an embedded Rust library. The virtual device is a separate private development executable, not a conversion of the engine into a service. |
| Process boundary | Run microphone acquisition and evidence production in a dedicated capture-device process. Run verification and VoiceID processing in the host process. |
| First transport | Use a local Unix-domain socket with bounded binary messages, peer-identity checks, deadlines, and explicit connection lifecycle. |
| Future transport | Implement the same logical protocol over USB for STM32. Transport framing may differ; capture semantics and canonical signed content stay stable. |
| Key implementations | Provide a deterministic test signer, a development software signer, and a Mac protected-key signer behind one narrow signing authority. The STM32/STSAFE signer is a later implementation. |
| Raw signing | Expose no `sign(bytes)` or `sign(digest)` request to the host. Only the capture-device state machine can authorize capture-evidence signatures. |
| Model placement | Run transcription, speaker matching, PAD, visual association, and attribution in the VoiceID host. The capture device owns no biometric decision. |
| Assurance | Represent simulated, Mac key-protected, and hardware-protected capture as different verified states. Policy must select the minimum accepted assurance explicitly. |

Process separation gives the prototype a realistic API and failure boundary. It
does not create a hardware boundary against the operating system, an administrator,
debugger access, process injection, or microphone substitution.

## Architecture

```text
┌────────────────────────────────────┐
│ macOS virtual capture device       │
│                                    │
│  microphone adapter                │
│       │                            │
│  bounded capture session           │
│       │                            │
│  chunk digest chain                │
│       │                            │
│  capture-only signing authority    │
└──────────────┬─────────────────────┘
               │ authenticated capture protocol
               │ Unix socket now; USB later
               ▼
┌────────────────────────────────────┐
│ VoiceID host                       │
│                                    │
│  protocol decoder                  │
│       │                            │
│  evidence verifier                 │
│       │                            │
│  verified capture stream           │
│       │                            │
│  ASR / speaker / PAD / attribution │
└──────────────┬─────────────────────┘
               ▼
       robot or wallet consumer
```

The verifier, rather than the capture process or caller, creates verified capture
domain values. A caller-provided `trusted`, `signed`, or assurance string carries
no authority.

## Capture-device state machine

Use explicit states so a signing operation cannot exist independently of a valid
capture session:

| State | Accepted operations |
| --- | --- |
| Idle | Query capabilities; begin one fresh request. |
| Capturing | Emit the next ordered authenticated segment; finish, cancel, or report a terminal discontinuity. |
| Finalizing | Seal the final manifest for the exact accepted request and captured segment chain. |
| Completed | Return the immutable completion result once; begin requires a new request and session. |
| Failed | Report a bounded failure and discard partial authority; recovery creates a new session. |

`BeginCapture` requires a host-generated unpredictable challenge, request identity,
capture profile, exclusive deadline, and supported evidence-protocol version. The
device creates a fresh session identity and starts acquisition only after accepting
that request. It cannot reseal prerecorded media under a new challenge through the
supported API.

Cancellation, deadline expiry, device change, sequence loss, buffer overflow,
clock reset, process restart, signer failure, and transport loss terminate the
session. Partial evidence from a terminated session cannot authorize an action.

## Authenticated capture protocol

Freeze the protocol only after creating deterministic cross-implementation test
vectors. Canonical signed content must bind at least:

- protocol and evidence-format versions;
- device identity, signing-key identity, and implementation identity;
- declared capture-assurance class;
- host request identity, challenge digest, and deadline;
- fresh device capture-session identity;
- audio format and capture profile;
- segment sequence, sample count, capture interval, and audio digest;
- preceding segment digest or another unambiguous continuity commitment; and
- terminal status plus the final segment count and chain root.

Use domain-separated canonical encoding. Hash the exact audio bytes consumed by
the host after decoding; avoid independent normalization before digest comparison.
Reject unknown versions, algorithms, key identities, formats, assurance classes,
and non-canonical encodings.

Do not sign individual PCM samples. Authenticate bounded segments or checkpoints.
The chosen segment size and signature/MAC construction must support incremental
verification without exceeding the latency and secure-element operation budgets.
Until the STM32 path is measured, keep that batching choice inside the capture
protocol rather than the model API.

The model pipeline may perform speculative work only if its outputs remain
ineligible until the corresponding evidence is cryptographically verified. The
initial implementation should prefer verification before releasing each segment
to model adapters. No command or wallet approval can depend on unsealed or
unauthenticated evidence.

## Assurance types and admission

Represent the verified result as a discriminated domain state, provisionally:

| Assurance | Meaning |
| --- | --- |
| `SimulatedCapture` | Deterministic test or development software key; validates protocol behavior only. |
| `MacProtectedKeyCapture` | Evidence signed by a Mac-protected, non-exportable key; microphone origin still relies on macOS and the capture process. |
| `HardwareProtectedCapture` | Evidence verified from a separately qualified sensor/capture/firmware/key boundary such as the future STM32 module. |

These names describe evidence provenance, not speaker liveness, identity, or
intent. PAD, speaker matching, presence association, and operation-specific
approval remain separate results.

The configured consumer profile states its minimum assurance. Development robot
commands may accept simulated capture. A future wallet or high-risk robot action
can require hardware-protected capture. An unavailable assurance produces an
explicit insufficient/unavailable result; it never falls back silently.

## Engine integration boundary

Add authenticated capture without creating a second model pipeline:

- Keep `AudioFrame` as bounded owned PCM used by utterance and model stages.
- Add capture-evidence domain values and a verifier-owned construction path that
  associates accepted frames with verified provenance.
- Keep raw protocol messages, keys, signatures, socket identities, and USB details
  outside `AudioFrame` and model adapter APIs.
- Make the runtime consume one normalized capture source whose provenance is
  explicit. Direct OS capture and authenticated capture cannot be confused.
- Carry the verified capture-session and assurance reference into attribution and
  consumer eligibility. Logging may include bounded identifiers and assurance;
  it must exclude audio, signatures that enable tracking, and reusable biometric data.
- End the engine epoch and invalidate dependent work whenever the authenticated
  stream loses continuity or its verifier/device connection restarts.

The existing `AudioCapture` trait is an acquisition contract, not proof of
origin. Do not make every implementation implicitly trusted. During the contract
update, choose a precise wrapper or branch-specific capture-source type so only
the verifier can construct authenticated input.

## Signing authority

The signing boundary supports capture-specific operations only:

- create or open the configured device credential;
- identify the public verification key and supported algorithm;
- authenticate a canonical capture segment/checkpoint created by the active
  state machine; and
- close or invalidate the active signing session.

The virtual device must not expose arbitrary signing, key export, wallet signing,
template encryption, or biometric matching through this interface. Capture keys
remain independent of wallet custody seeds, MPC shares, wallet device-authorization
keys, and biometric-template protection keys.

A development software key is appropriate for deterministic tests. A Mac
protected-key implementation tests provisioning, key loss, restart, verification,
and non-exportability behavior. Neither implementation upgrades microphone
assurance to hardware-protected capture.

## Implementation sequence

### M0 — Freeze the threat model and contracts

- [ ] Record the virtual-device trust boundary and the attacks it does and does
      not address.
- [ ] Define precise request, segment, completion, failure, and assurance states.
- [ ] Select canonical encoding and algorithms already supported by both the Mac
      and the candidate STM32/STSAFE path.
- [ ] Define verifier key provisioning, replacement, and device-identity rules.
- [ ] Add deterministic protocol vectors for the canonical bytes and signatures.

Exit: the engine can distinguish raw OS capture, simulated authenticated capture,
Mac key-protected capture, and future hardware-protected capture at the type and
policy boundaries.

### M1 — Build the deterministic virtual device

- [ ] Implement an in-memory virtual device and deterministic signer for tests.
- [ ] Implement challenge/session binding, ordered segments, continuity commitment,
      terminal sealing, deadlines, and cancellation.
- [ ] Implement the evidence verifier and verified-frame admission path.
- [ ] Test modified audio, reordered/dropped/duplicated segments, stale or reused
      challenges, wrong keys, unknown versions, truncated sessions, and restarts.

Exit: malformed, replayed, stale, or discontinuous evidence cannot reach an
authorization-eligible engine result.

### M2 — Add the macOS process boundary

- [ ] Implement the private capture-device executable with bounded microphone
      buffers and no model or wallet dependencies.
- [ ] Implement the Unix-domain socket transport, peer checks, bounded framing,
      backpressure, deadlines, and clean shutdown.
- [ ] Use a development software key first; keep test determinism independent of
      the OS key store.
- [ ] Exercise the native VoiceID vertical slice through this process boundary.
- [ ] Test permission loss, device change, capture overflow, process crash,
      transport interruption, host restart, and device restart.

Exit: macOS VoiceID runs end to end through the same logical device protocol
expected from future hardware, with `SimulatedCapture` assurance.

### M3 — Add Mac protected-key signing

- [ ] Implement supported non-exportable signing-key provisioning and verification.
- [ ] Preserve the capture-only state machine; protected key access must not create
      a general signing oracle.
- [ ] Test key deletion/replacement, device migration behavior, user/session lock,
      failed signing, and verifier reprovisioning.
- [ ] Report `MacProtectedKeyCapture` only after the protected-key operation and
      full evidence verification succeed.

Exit: the prototype validates protected-key lifecycle and signed-capture protocol
behavior while retaining its explicit macOS microphone trust assumption.

### M4 — Replace the virtual device with STM32

- [ ] Implement microphone acquisition, protected buffers/peripheral ownership,
      secure boot/firmware identity, capture-only key use, and the protocol on the
      selected STM32 hardware.
- [ ] Add the USB transport adapter without changing model or consumer APIs.
- [ ] Run the same protocol vectors and adversarial verifier tests against firmware.
- [ ] Measure authenticated-segment latency, sustained audio transport, memory,
      overflow behavior, recovery, and key-operation limits.
- [ ] Qualify the actual microphone traces, firmware/debug state, physical boundary,
      key provisioning, and update/rollback process before emitting
      `HardwareProtectedCapture`.

Exit: the Mac virtual device can be removed from production composition while the
verified capture boundary and VoiceID pipeline remain intact.

## Required tests

At minimum, cover:

- byte-for-byte canonical encoding and signature vectors;
- challenge reuse, expired request, and capture that starts before request acceptance;
- modified PCM, metadata substitution, wrong format, and digest mismatch;
- sequence gaps, duplication, reordering, truncation, and conflicting final roots;
- wrong device/key, removed key, unsupported algorithm/version, and assurance mismatch;
- cancellation, timeout, process/transport restart, overflow, and uncertain completion;
- policy rejection when the verified assurance is below the required profile; and
- an end-to-end fixture proving models consume the same verified PCM bytes committed
  by the evidence protocol.

Do not test assurance by checking source text or accepting caller-created verified
objects. Use constructor visibility, compile-fail fixtures where useful, protocol
vectors, and behavioral tests at the verifier/runtime boundary.

## Non-goals

- Claiming that the Mac Secure Enclave is directly connected to the microphone.
- Claiming sensor-origin security against a compromised macOS installation.
- Moving VoiceID models, biometric templates, or wallet secrets into the capture device.
- Exposing a general signing service from the virtual or physical capture device.
- Selecting the final STM32 signature batching or transport parameters before measurement.
- Treating authenticated capture as proof of a live human, enrolled identity, presence,
  or consent for an operation.

## Open decisions

| Decision | Needed by |
| --- | --- |
| Canonical evidence encoding and signature/MAC construction | M0; must fit Mac and STM32/STSAFE capabilities. |
| Authenticated segment/checkpoint size | M0 proposal, frozen after M4 latency and secure-element measurements. |
| Mac protected-key API, key access policy, and deployment identity | M3. |
| Unix socket location, peer-identity mechanism, and executable supervision | M2. |
| STM32 secure/nonsecure peripheral, DMA, memory, firmware-update, and debug configuration | M4. |
| Production device provisioning, trust anchors, revocation, and recovery | M4 and the wallet extension's standalone device-admission stage. |

