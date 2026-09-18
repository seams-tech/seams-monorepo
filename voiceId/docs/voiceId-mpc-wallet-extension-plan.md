# Local VoiceID extension for MPC wallet signing

Date: 2026-09-14
Updated: 2026-09-16
Status: proposed extension; no VoiceID wallet factor or signing integration is
implemented by this plan. Local gating and standalone remote admission are
separate delivery stages.

Related plans:

- [Local VoiceID architecture and implementation](voiceId-local-architecture-and-implementation-plan.md)
- [macOS virtual capture device](voiceId-macos-virtual-capture-device-plan.md)
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

## Public extension and proprietary provider

The VoiceID wallet extension lives in the public `seams-wallet` repository. It
exposes only the provider contract and wallet integration needed to support a
VoiceID implementation. The engine, model integration, calibration, and private
provider implementation remain in `seams-monorepo/voiceId` and are delivered as
versioned proprietary native/WASM artifacts with any required host bindings.

The integrating wallet runtime explicitly supplies a provider implementing the
public contract. Public SDK builds, examples, and contract tests work without
private source, models, or release credentials. VoiceID is optional: importing
the base SDK does not load the engine or fetch biometric model assets. Use the
existing wallet package conventions for an optional module/export; introduce a
separate package only if the delivery boundary needs it.

### Minimal provider surface

These are responsibilities to map to exact wallet types in W0, rather than a
second protocol schema or a commitment to method names.

| Surface | Required boundary |
| --- | --- |
| Capabilities and readiness | Contract/artifact version, supported approval profiles, and explicit ready/unavailable states. A provider's capability report grants no wallet authority. |
| Enrollment binding | Associate a deliberate local enrollment with a wallet-authorized device/credential setup. Expose only necessary opaque identifiers and public credential data; biometric collection and template administration stay private/local. |
| Approve one operation | Accept the wallet's validated frozen operation/challenge, deterministic presentation context, required approval profile, and deadline. Return an operation-bound result with explicit approved, denied, insufficient, cancelled, expired, or unavailable state. |
| Cancellation and lifecycle | Use the host's existing cancellation mechanism where possible. Invalidate pending work on cancellation, lock, enrollment replacement, disposal, or restart; late results cannot approve a new attempt. |

Keep local-gating approval and signed device assertion results as distinct
variants. A local result is consumed only by the pending wallet approval
controller. For standalone admission, that controller's protected device-key
adapter creates the assertion after local approval; the server's existing
verification boundary alone creates verified factor evidence. Neither a generic
`approved: true` nor a provider-constructed verified type is remote authority.

The public wallet extension owns operation binding, presentation, result parsing,
and the approval lifecycle. The private provider translates its request into the
engine's local approval profile. The wallet's custody controller owns all MPC
material and device authorization key access. No `unlockShare()`, raw-key export,
sensor stream, template, embedding, or score API is exposed by this contract.
The engine remains usable by robots without wallet protocol dependencies.

### Native and browser delivery

Native is the first integration target. The local engine structure selected on
2026-09-15 is an embedded Rust shared library, initially developed on Apple
Silicon macOS. Integrate it through the small C host boundary defined in the
local contract checkpoint. Validate inputs and associate results with the exact
pending request; define caller access and host restart behavior. Consume exact
public extension and private artifact versions, with integrity and capability
checks using existing release metadata. The Rust scaffold adds no wallet API.

Browser WASM is a separate target under local-plan L7. The current browser wallet
runs in its own hosted wallet iframe. Load the private provider/artifact through
the wallet-controlled runtime and asset delivery, or design an explicit bridge
to a native approval controller. Application-side callback injection across the
iframe boundary is not an existing integration mechanism. Define the required
origin checks, media permissions, cancellation, and worker/host ownership before
implementing that transport. Biometric processing remains on the user device.

Public contract compatibility, compiled artifact integrity, and device admission
assurance are separate checks. Shipping proprietary WASM provides no proof of
faithful VoiceID execution. Distributed binaries and model assets remain
inspectable; preserve private source and comply with upstream redistribution
licenses without promising that delivered assets are secret.

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

The local plan's [guiding security principles](voiceId-local-architecture-and-implementation-plan.md#guiding-security-principles)
apply to this extension. Capture integrity, human attribution, and transaction
intent remain separate claims, including on hardware-backed capture platforms.

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

The enforcement review must follow the complete path from acquired samples through
preprocessing, artifact-verified models/configuration, current enrollment, fresh
attribution, and approval of the exact presented operation to device-key use.
Identify every handoff that can substitute data or bypass a check. A signed final
approval cannot establish these properties unless the declared device boundary
actually enforces them. Hardware-backed capture, if later available, strengthens
only the properties its evaluated platform contract covers.

Use local bounded freshness for human evidence and the wallet's existing server
challenge/expiry checks for remote admission. Challenge freshness alone cannot
make an old recording or prior presence observation fresh. An assurance profile
that requires a verified property must reject its absence; any existing-method
fallback retains its own explicit method and assurance state.

Disclose only the wallet-scoped credential and operation binding needed for
admission. A registered device key is intentionally linkable within that wallet;
do not export underlying sensor identifiers or biometric hashes as additional
cross-application identifiers. Enrollment/device revocation and changes to accepted
runtime/model/profile revisions invalidate affected pending approvals. Revocation
can block future admission and cannot undo a completed signature or transaction.

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
- [ ] Define the minimal public provider contract and optional extension surface
      in `seams-wallet`, coordinating with local-plan L1. Specify distinct local
      approval and device-assertion variants, boundary parsers, and cancellation.
- [ ] Select the private artifact/native binding and version/capability contract.
      Document the browser wallet-origin boundary for later L7 integration.
- [ ] Add public contract tests with deterministic provider doubles independent
      of private assets. Keep real model/provider evaluation in `seams-monorepo`.
- [ ] Select the local trusted process boundary and how it exclusively controls
      the integration's signing entry point.
- [ ] Set approval timeout, retry/rate limits, command/cue requirements, risk
      limits, and measurable acceptance criteria.

Exit: a public extension contract and a private provider delivery boundary for
local gating that preserve current remote auth, custody, operation retries, and
MPC behavior. No proprietary source is required to build or test the extension.

### W1 — Implement local voice-gated signing under existing authority

- [ ] Use existing wallet authentication to prepare the native client's selected
      lane/session material. Do not add a VoiceID factor yet.
- [ ] Add the operation-bound challenge, deterministic summary, and pending
      approval lifecycle within the existing wallet workflow.
- [ ] Adapt local VoiceID to the wallet's fresh approval/cue profile without
      adding server challenges to ordinary robot interactions.
- [ ] Implement the optional public extension in `seams-wallet` and the private
      provider in `seams-monorepo`. Integrate the actual compiled native release
      from local-plan L6; early development can use an explicit local build.
- [ ] Gate the actual client signing entry point; keep secret material and the
      reusable session handle inaccessible to the conversational caller.
- [ ] Add exact-operation consumption, failure, cancellation, restart, and
      uncertain-outcome behavior.
- [ ] Exercise the complete path on testnet and qualify the wallet-specific
      captures. A successful robot demo alone does not pass this gate.
- [ ] Verify clean-host composition of exact extension/artifact releases without
      private source access. Missing providers, unsupported versions/profiles,
      cancellation, and artifact/bridge failure cannot bypass approval.

Exit: every operation through the native integration needs fresh local approval
and valid existing server authority. No claim of standalone VoiceID login or
server-verified biometrics is made.

### W2 — Establish the standalone device and custody design

- [ ] Qualify the enforcement platform and state its compromise assumptions.
      Confirm its actual capability to protect the approval-to-key-use path.
- [ ] Review capture-to-key-use handoffs against the guiding principles. Specify
      verified properties, accepted artifact/profile revisions, and behavior when
      required assurance is unavailable or withdrawn; test bypass attempts in W4.
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
- [ ] Keep signed assertions unverified at the provider/client boundary; only
      the server verifier constructs the new verified factor variant. Reject
      local-only approval results wherever standalone admission is required.
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
- [ ] Verify public builds/tests have no private source/model dependency and that
      real private-provider composition passes the same public contract scenarios.
      Qualify any later browser/WASM integration separately with local-plan L7.

Exit: held-out wallet-specific evaluation and lifecycle/security tests meet
agreed criteria on the supported device and transaction profile. Real-value
rollout requires an explicit policy/review decision after testnet qualification.

## Repository ownership and tests

- Proprietary engine source, local models/calibration, capture, perception,
  native/WASM builds, and the private provider stay in `seams-monorepo/voiceId`.
- The optional public VoiceID extension, provider contract, client
  signing/custody integration, server factor admission, and wallet lifecycle
  contracts belong in `seams-wallet`. Public contract tests use deterministic
  providers that do not require private artifacts.
- Private Console composition and deployed product acceptance tests stay in
  `seams-monorepo/tests/`; consume exact wallet and proprietary artifact releases.
  Private engine/model tests and evaluation remain with the VoiceID tooling;
  all private TypeScript tests use the top-level `tests/` workspace.
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
