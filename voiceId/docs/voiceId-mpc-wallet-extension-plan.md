# Local VoiceID extension for MPC wallet signing

Date: 2026-09-14
Status: proposed extension; no VoiceID wallet factor or signing integration is
implemented by this plan. Local gating and standalone remote admission are
separate delivery stages.

Related plans:

- [Local VoiceID architecture and implementation](voiceId-local-architecture-and-implementation-plan.md)
- [Legacy removal](voiceId-legacy-removal-plan.md)

## Objective

Let a user approve an exact wallet transaction by speaking to an enrolled local
device. VoiceID evaluates the approval locally, and the wallet's local signing
controller permits its client-side MPC contribution for that operation.

Audio, video, biometric templates, and model inference stay on the device. The
network carries challenges, authorization metadata where required, and the
existing MPC protocol messages. No ZK pipeline or server biometric inference is
part of this design.

The MPC protocol and public wallet keys remain unchanged. New work belongs at
the transaction-approval, local custody/access, and server-admission boundaries.

## Two delivery stages

| Stage | Authority and guarantee | Scope |
| --- | --- | --- |
| Local voice-gated signing | Existing wallet authentication and Wallet Session authorize the client. The controlled native signing runtime additionally requires a fresh local voice approval for every operation through this integration. The server does not independently verify VoiceID. | First integration and controlled evaluation. |
| Enrolled VoiceID device admission | A registered device authorization key signs the operation-bound challenge after the device's approval controller permits it. The server verifies this new factor and applies wallet policy. Assurance depends on the declared, evaluated device enforcement boundary. | Later standalone voice approval without another factor on each transaction. |

The first stage does not replace passkey/Email OTP unlock or create a new wallet
authentication method. Other existing wallet clients retain their current
behavior. Its local gate cannot be advertised as a wallet-wide server-enforced
voice requirement.

For the second stage, enrollment can use existing wallet authority to link the
device once. A spoken approval then authorizes a transaction through the enrolled
device. A separate platform and custody design is required before this can ship.

## Existing wallet boundaries to preserve

Wallet-owned implementation lives in the sibling `seams-wallet` repository:

- [Authentication and custody specification](../../../seams-wallet/docs/spec-2-auth-custody-and-credentials.md)
- [Wallet sessions and execution lanes](../../../seams-wallet/docs/spec-3-wallet-sessions-and-execution-lanes.md)
- [Operation fingerprint and digest binding](../../../seams-wallet/packages/shared-ts/src/authorization/operationFingerprint.ts)
- [Server-verified factor evidence](../../../seams-wallet/packages/wallet-server/src/authorization/factorEvidence.ts)

The current factor result types support passkey and Email OTP. Operation
bindings already carry operation identity and lane, intent, and display digests.
Extend those owning boundaries where needed; do not create a competing VoiceID
transaction canonicalizer, quota system, or MPC session protocol.

Custody terms retain their existing meanings:

- The random wallet custody seed derives the Ed25519 Yao Client root and ECDSA
  client root share independently.
- A lane holder share is curve-specific provisioned material, independent of
  seed derivation and excluded from recovery sets.
- Voice samples and embeddings never derive any of these secrets or an envelope
  encryption key.
- VoiceID receives neither wallet custody seed nor owner signing roots nor lane
  holder shares. It supplies local verification results to the controller that
  owns the exact approval workflow.
- Normal unlock and factor addition preserve the established custody proofs.
  They do not become registration/recovery custody ceremonies or create a
  conversion between the two existing manifest/envelope proof types.
- An additional device authorization key signs admission assertions only. It is
  distinct from all MPC signing material and never substitutes for an MPC share.

Prefer a linked device's suitably scoped signing lane for the standalone native
device pilot. This avoids giving the robot the wallet custody seed. Verify that
the existing device-linking/provisioning flow supports the selected runtime;
the reviewed specification is not proof that a native robot adapter exists.

Adding VoiceID as an owner-level seed-envelope unlock method is a separate
custody expansion. If later selected, it must protect the same existing seed
under a cryptographic device key and preserve the authenticated wallet/key
manifest binding. It is outside the initial pilot.

## Transaction approval flow

### 1. Prepare and bind the operation

The existing wallet flow prepares the operation and its actual signing payload.
The client verifies the resolved details it will present. Freeze the operation
binding before collecting approval; a changed amount, recipient, network,
contract call, fee policy, or signing payload requires a new approval.

The challenge is issued within authenticated wallet context and binds:

- an unpredictable nonce, challenge identity, issue time, and expiry;
- wallet authority, the relevant session/lane/key identity, and operation identity;
- the canonical signing payload plus the existing intent/display bindings;
- the requesting application/origin and intended verifying service;
- for device admission, the registered device/key and allowed policy profile.

Use the existing canonical operation representation and domain-separated
signature encoding. Map each concept to its owning wallet type during W0;
this list is not a second wire schema. Authenticate challenge delivery and
verify the full binding at both ends.

### 2. Present the transaction and collect fresh approval

Render or speak a deterministic summary derived from the same resolved
transaction. Include the relevant asset, amount, destination, network, and fee
bounds. Arbitrary contract calls require a supported trustworthy explanation;
unknown or undecodable operations are denied by the initial allowlist.

The starting wallet profile requires an explicit approval containing a short,
fresh spoken cue tied to the current challenge. This reduces reuse of a cached
generic approval. It adds listening time, which must be measured. The
cryptographic nonce retains cryptographic entropy independently of the shorter
spoken cue. Any later relaxed conversational profile needs its own evaluation.

Local VoiceID checks the current speaker, approval content/cue, quality, spoofing
signals, and supporting visual/source context. Current or recently observed
presence can help attribution; it never supplies approval by itself. A prior
robot command result cannot be reused for a wallet transaction.

Collect approval only after the operation has been presented. Rejection,
cancellation, ambiguity, timeout, insufficient speech, or a changed operation
ends the attempt. Do not ask a general conversational model to decide wallet
authority or invent transaction details.

### 3. Permit the local MPC operation

The local signing controller owns the pending operation and consumes successful
verification within that context. Its supported API authorizes one exact
operation. It does not expose a general `unlockShare()` method, raw secrets, or
a bearer approval that unrelated callers can reuse.

Existing Wallet Session material may remain protected and resident according to
the wallet's current lifecycle. The new gate controls each use; it need not
decrypt and reconstruct secret material on every utterance. Enrollment changes,
device lock, revocation, session expiry, exhausted allowance, and controller
restart invalidate pending local approvals.

Define available local states as explicit branches: locked, awaiting approval,
approved for operation, signing, completed, denied, expired, and outcome unknown.
Approved/signing branches require the exact authority, operation binding, and
deadline. In-process typed states improve correctness; they do not protect
against compromised code in the same trust boundary.

### 4. Authenticate remote admission

For local gating, preserve existing wallet/session authentication and admission.
The server tracks the fresh challenge in the owning operation lifecycle. Local
voice success adds no new remotely verified factor claim.

For device admission, the enrolled device authorization key signs the complete
challenge/operation binding. Send only necessary public identifiers, binding,
expiry, and protocol/policy version. A signed local model score remains a device
claim and is unnecessary for the initial server decision. Do not send raw media,
embeddings, full transcripts, or reusable biometric hashes.

The server verifies the registered credential, permitted assurance profile,
signature, audience/origin, exact operation, deadline, enrollment/revocation
state, and current wallet permissions before admitting signing.

### 5. Admit once and run the existing MPC protocol

Atomically associate the accepted challenge with one operation and the existing
quota/admission claim. Concurrent requests cannot spend the approval or allowance
twice. Repeating the same admitted operation returns its pending/result state;
another operation cannot reuse its challenge.

Only admitted operations begin normal client/server MPC participation. The
device authorization signature answers the challenge. The final MPC signature
signs the chain's actual signing payload. Never require the final wallet
signature as the prerequisite for admitting that same MPC operation.

The server checks current wallet policy even after local approval. Revocation
blocks subsequent admission; an already completed signature cannot be recalled.
Document the existing in-flight cancellation limits precisely.

If a response is lost after possible admission/signing, query the same operation
identity and reconcile its outcome. Do not generate a replacement operation and
automatically sign again. A resumed native client cannot restore an unused local
voice approval from a prior process.

## Device trust and biometric limits

A signed challenge proves participation of its key and binds a fresh response.
It does not establish that a human spoke, that the microphone is genuine, or
that the matcher was executed correctly.

The controlled MVP trusts the selected native runtime and OS. Physical replay,
cloned speech, nearby attackers, and misleading visual context remain in its
evaluation scope. Full endpoint compromise is outside that MVP assurance claim.

For a server-recognized voice factor, select and document how the device enforces
capture, template access, matching, approval binding, attempt limits, and key use.
A hardware-stored key alone is insufficient when an ordinary application can
invoke it after bypassing VoiceID. Attestation, if available, must be assessed
for exactly what code/key/sensor properties it establishes. Do not infer sensor
provenance from app identity or a TPM quote.

This plan does not assume that arbitrary VoiceID models can run inside a phone's
existing biometric enclave or become a built-in Face ID modality. Platform
feasibility is an explicit W2 gate. A browser may request the native approval
flow, but a browser success flag cannot establish standalone voice admission.

An unpredictable spoken cue helps against fixed recordings. It does not defeat
live synthesis, relay, coercion, or compromised sensors by itself. Voice, PAD,
visual timing, and source association retain independent uncertainty. An
unqualified required check leads to denial or the existing explicit wallet
authentication flow, with its actual method recorded accurately.

## Implementation milestones

### W0 — Define one narrow integration contract

- [ ] Choose the native host, wallet lane/protocol, test network, initial asset
      and transaction allowlist. Keep the first real signing exercise on testnet.
- [ ] Map challenge and approval fields to existing wallet operation, session,
      authority, quota, canonicalization, and confirmation boundaries.
- [ ] Select the local trusted process boundary and how it exclusively controls
      the integration's signing entry point.
- [ ] Set approval timeout, retry/rate limits, command/cue requirements, risk
      limits, and measurable acceptance criteria.

Exit: an exact contract for local gating that preserves current remote auth,
custody, operation retries, and MPC behavior.

### W1 — Implement local voice-gated signing under existing authority

- [ ] Use existing wallet authentication to prepare the native client's selected
      lane/session material. Do not add a VoiceID factor yet.
- [ ] Add the operation-bound challenge, deterministic summary, and pending
      approval lifecycle within the existing wallet workflow.
- [ ] Adapt local VoiceID to the wallet's fresh approval/cue profile without
      adding server challenges to ordinary robot interactions.
- [ ] Gate the actual client signing entry point; keep secret material and the
      reusable session handle inaccessible to the conversational caller.
- [ ] Add exact-operation consumption, failure, cancellation, restart, and
      uncertain-outcome behavior.
- [ ] Exercise the complete path on testnet and qualify the wallet-specific
      captures. A successful robot demo alone does not pass this gate.

Exit: every operation through the native integration needs fresh local approval
and valid existing server authority. No claim of standalone VoiceID login or
server-verified biometrics is made.

### W2 — Establish the standalone device and custody design

- [ ] Qualify the enforcement platform and state its compromise assumptions.
      Confirm its actual capability to protect the approval-to-key-use path.
- [ ] Choose the linked-device lane and provisioning flow; record exactly which
      curve-specific material resides where. Preserve the wallet's public keys.
- [ ] Register a separate device authorization public key under existing wallet
      authority, binding enrollment to the correct wallet and device.
- [ ] Define enrollment replacement, device/key rotation, revocation, loss,
      lockout, and recovery. Replacement requires independent existing authority;
      possession of a recording or a fresh local template cannot enroll a factor.
- [ ] Decide server admission requirements for supported device profiles. Any
      app/firmware attestation policy must have demonstrated platform support.

Exit: a reviewed device trust and lifecycle design. If this platform gate cannot
be met, standalone admission remains unimplemented; W1 retains its explicit
local-only enforcement claim.

### W3 — Add the server-recognized factor

- [ ] Extend wallet factor types and boundary parsers for the registered device
      assertion. Keep raw request shapes out of verified internal states.
- [ ] Verify assertions and enforce atomic challenge/operation/quota admission
      using existing wallet storage ownership.
- [ ] Enforce device/factor revocation without changing sibling factors or wallet
      keys. Voice approval initially authorizes individual transactions only.
- [ ] Add SDK/native integration and explicit UI method/assurance reporting.
- [ ] Keep key export, recovery-code reveal, owner-factor administration, and
      unattended reusable sessions outside this initial voice factor scope.

Exit: standalone device-approved transactions work within the selected policy
and evaluated trust boundary, without biometric uploads or MPC protocol changes.

### W4 — Qualify the security and operational behavior

- [ ] Reject altered payloads, summaries, wallets, origins, audiences, chains,
      keys/lanes, nonces, expiries, and policy bindings.
- [ ] Test concurrent admission, replay, response loss, process restart,
      revocation, session/quota expiry, and lost-device recovery.
- [ ] Test unrelated local caller access, bypass attempts, unprotected key-use
      APIs, and cross-operation approval reuse within the claimed trust model.
- [ ] Evaluate recorded approvals, targeted synthesis, live relay, visual spoofing,
      owner-nearby/non-owner-speaking cases, and robot self-speech.
- [ ] Measure full user time: prompt playback, speech, endpointing, inference,
      local key access, admission, MPC rounds, and result delivery separately.
- [ ] Verify media privacy in transport/logs and verify that approval can run
      locally while signing still correctly requires the remote MPC participant.

Exit: held-out wallet-specific evaluation and lifecycle/security tests meet
agreed criteria on the supported device and transaction profile. Real-value
rollout requires an explicit policy/review decision after testnet qualification.

## Repository ownership and tests

- Local models, capture, and perception stay in `seams-monorepo/voiceId`.
- Wallet SDK, client signing/custody integration, server factor admission, and
  wallet lifecycle contracts belong in `seams-wallet`.
- Private Console composition and deployed product acceptance tests stay in
  `seams-monorepo/tests/`; consume exact wallet package releases.
- Add behavioral tests for approval binding and replay/races, and TS type
  fixtures covering raw-result promotion, invalid branch combinations, broad
  spreads, and direct construction of verified authorization states.
- Reuse branch-specific factories and the existing custody/wire tests. No
  crypto changes are expected; if an intended wire change becomes necessary,
  regenerate its fixtures through the owning wallet workflow.
- Update the owning wallet specification and intended-behavior contract in the
  same implementation change. Classify failing tests before repairing them.

The local plan can ship independently. W1 reuses its engine, while W2-W4 add
wallet-specific assurance and lifecycle work rather than changing robot identity
observations into financial authority.
