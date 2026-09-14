# VoiceID architecture discussion: local inference, ZK, robotics, and MPC

Date: 2026-09-13

Scope: summary of the September 12–13 architecture conversation and its repository review.

Follow-up, 2026-09-14: ZK has been removed from the selected direction. Current
planning is split into [legacy removal](voiceId-legacy-removal-plan.md),
[local conversational VoiceID](voiceId-local-architecture-and-implementation-plan.md),
and the [MPC wallet extension](voiceId-mpc-wallet-extension-plan.md). The discussion
below is historical and does not override those plans.

This document records the discussion's decisions, recommendations, and open
requirements. It does not change the implementation or establish that a security
or performance gate has passed. VoiceID now lives in `seams-monorepo/voiceId`;
repository links below resolve within that folder.

## Outcome and decision status

The user made latency the highest priority and selected local inference for
robotics vocal commands. The proposed wallet direction is local inference with
a protected voice authenticator that issues a transaction-bound signed
authorization. The wallet recommendation remains conditional on providing that
protected boundary and has not been explicitly adopted or implemented.

| Topic | Position reached in the conversation | Status |
| --- | --- | --- |
| Product scope | Build VoiceID. Existing passkeys are already implemented. | User requirement |
| Initial privacy objective | Keep recordings, voiceprints, and any ZK proof generation on the client. | Explicit objective; the later latency priority did not explicitly waive it |
| Primary comparison criteria | Security and speed, with latency the most important factor. | User priority |
| Robotics | Use local inference for owner-authenticated vocal commands. | User selected |
| MPC wallet | Use local inference plus a protected, transaction-bound signed authorization. | Assistant recommendation; platform and protection requirements remain open |
| ZK on the critical path | Reconsider only when private remote verification justifies its measured proving cost. | Assistant recommendation |

## Initial proposal: client-side ZK VoiceID

The original question was whether voice authentication could keep vocal samples
on-device and send only a zero-knowledge proof to a server. The proposed protocol
was:

1. Enroll locally from several recordings. Derive a speaker template and retain
   it with a random commitment secret on-device. Register a cryptographic hiding
   commitment bound to the account. Authorize enrollment and template replacement.
2. Receive a fresh, unpredictable spoken challenge, expiry, and operation binding.
3. Run speaker verification, challenge recognition, quality checks, and
   presentation attack detection (PAD) locally.
4. Generate a ZK proof covering the approved computation and thresholds, the
   committed template, and the current challenge.
5. Submit the proof and public verification inputs. The server verifies them and
   consumes the challenge.

Under this design, the server receives commitments, proofs, challenge identifiers,
and verification metadata. Audio, enrollment recordings, embeddings, templates,
and private prover inputs remain on-device. Proof generation uses no cloud prover.
The application must also preserve this boundary in logging, diagnostics, and
storage; the existence of a ZK proof alone does not enforce application privacy.

The proof must cover preprocessing and the derivation of decisions from the same
audio. A proof that two embeddings are similar is insufficient: a modified client
could substitute the enrolled embedding for the fresh input. Likewise, proving a
client-supplied `passed` value would leave the actual checks unenforced.

ZKML provides mechanisms for proving private inference, but the conversation did
not establish that the complete VoiceID pipeline can be proved within an
acceptable device latency or memory budget. EZKL was identified as a candidate
tool to evaluate, with operator support, quantization effects, and proving costs
still to be measured. See the [ZKML research paper](https://ddkang.github.io/papers/2024/zkml-eurosys.pdf)
and [EZKL implementation](https://github.com/zkonduit/ezkl).

## What the security guarantees mean

Voice matching is probabilistic. A cryptographic proof or signature can protect
an authorization message, while the underlying biometric decision still has
false accepts, false rejects, and spoofing weaknesses.

- **Privacy:** keeping enrollment material off the server removes one source of
  recordings and templates that could be exposed through a server breach.
  Attackers may still obtain a person's voice from calls, videos, or other sources.
- **Correct execution:** a sound ZK proof establishes that the specified checks
  passed on the supplied private inputs. A protected authenticator assertion
  relies on the approved device implementation enforcing those checks.
- **Capture authenticity:** neither a proof of inference nor an ordinary device
  signature independently establishes that a person spoke into a real microphone.
  Capture protection and spoof detection are separate requirements.
- **Freshness:** consuming a nonce prevents reuse of the corresponding proof or
  assertion. Connecting the spoken content to an unpredictable challenge helps
  reject old recordings. Prompt-targeted synthesis and live relay remain relevant.
- **Endpoint compromise:** local storage moves template protection to the device.
  Theft of the template and its commitment secret can enable offline testing
  against the exact reference. Server rate limits constrain submitted attempts,
  rather than all private experimentation.

With identical inputs, models, thresholds, and arithmetic, moving inference or
adding ZK does not improve the biometric classification itself. Quantization or
model simplification requires renewed evaluation. Recent
[ASVspoof 5 results](https://arxiv.org/abs/2601.03944) report continuing difficulties
with adversarial attacks and audio compression.

## Repository findings

The conversation initially described a proposed ZK architecture. A subsequent
code review established that the implementation followed a different data flow.
That implementation was removed in the 2026-09-14 cutover and remains available
in Git history. The table records the pre-cutover finding.

| Area | Observed implementation or plan |
| --- | --- |
| Browser transport | Enrollment and verification submitted audio blobs as multipart requests. |
| Inference | The server forwarded base64 audio and an enrollment template to the Python HTTP service. |
| Template storage | Templates were held server-side and wrapped for encrypted persistence. |
| Privacy boundary | Raw audio crossed route, transcript-provider, and verifier boundaries during processing. Ordinary persistence and audits excluded raw audio. |
| ZK | The review found no VoiceID circuits, local prover, or ZK verification flow. |
| Wallet integration | Current evidence is experimental and signing-ineligible. Direct VoiceID wallet authorization remains unimplemented. |

The current model stack is Moonshine Tiny Streaming, SpeechBrain ECAPA, and
AASIST. Those components, the challenge lifecycle, and the evaluation corpus are
useful foundations for local inference; their presence does not establish a
protected authenticator or a complete ZK system.

Two removed plans informed the discussion: a robot sidecar runbook retained
hosted template/policy interactions, while the signing profile proposed a
protected local authenticator returning signed assertions. Git history retains
both. The linked plans at the top of this document replace them.

## Security and latency comparison

Inference location and the mechanism used to authenticate its result are separate
design choices. Local processing can preserve biometric privacy without generating
a ZK proof when an approved local component already enforces authorization.

| Approach | Security tradeoff | Latency tradeoff |
| --- | --- | --- |
| Server inference | The server executes authoritative checks and processes biometric data. Server and service compromise are part of the trust model. | Client upload, network delay, service queueing, inference, and response delivery. Powerful server hardware may accelerate inference. |
| Client inference with ZK | The verifier checks computation without receiving biometric inputs. The circuit and input provenance must be sound; endpoint storage still needs protection. | Local inference/witness work plus proof generation, transmission, and verification. No complete VoiceID proving benchmark exists in the reviewed work. |
| Protected local inference | Trust rests in protected capture, templates, approved checks, and authorization enforcement. Ordinary application code cannot be allowed to bypass them. | Avoids cloud inference and ZK proving overhead. Requires sufficient local hardware and measurements under realistic load. |

The removed MVP task plan targeted warm post-utterance p95 latency of 500 ms,
with a 1-second hard ceiling, on Apple Silicon macOS. These were inference-stack
targets rather than demonstrated robot, wallet end-to-end, or ZK proving latency.

Listening time also matters. The removed verification ceremony asked for 3–5
seconds of speech. Streaming can overlap model work with speaking, but cannot
eliminate the need for sufficient speaker evidence. Requiring a random spoken
challenge on every command increases interaction time. Very short commands
provide less evidence than longer utterances.

Other tradeoffs discussed include heavier client model/prover distribution,
more involved model and circuit upgrades, reduced server visibility for
diagnostics, and device recovery. Strictly local templates require secure
transfer or re-enrollment on a new device; a public commitment cannot reconstruct
a lost template.

## Robotics: selected direction

Use local inference for vocal commands, with the robot treated as an approved
device if it holds the owner's template. The security recommendation adds a
protected capture and authorization boundary. Selecting local inference alone
does not establish that protection.

```text
Robot microphone
  -> local speaker, command, quality, and spoof checks
  -> authorization for the specific owner command
  -> independent robot safety controller
  -> permitted action
```

An initial owner unlock must not grant subsequent speakers command authority.
Each command needs speaker verification or an adequately validated continuous
authentication mechanism, with recognition and spoof checks tied to the same
utterance. Authorization must identify the command, target robot, and freshness
context. Compromised software must be unable to fabricate an accepted result or
bypass the enforcement boundary.

The recommendation was to keep ZK outside the normal command path unless another
party needs private, verifiable evidence. A phone proving authentication to a
robot that must never receive its enrolled template is a distinct possible
deployment. Authentication of subsequent commands remains necessary.

Owner authentication and physical safety remain independent. Emergency stop and
protective pause remain available without owner authentication, and identity
authorization cannot override the robot's safety controller.

## MPC wallet: recommended direction

The recommendation was local inference plus an approved voice authenticator that
issues a signed authorization for one exact transaction. This preserves local
biometrics and avoids proving the complete voice pipeline on the signing path.
The server-facing artifact would be a signed assertion with public metadata.

```text
Router fixes transaction and issues a fresh challenge
  -> protected local voice verification and spoken approval
  -> authenticator signs the transaction binding, challenge, and expiry
  -> remote admission verifies and consumes the authorization
  -> existing MPC signing flow
```

The transaction binding must cover the actual signing payload and resolved
transaction details. The user-facing summary must derive from that same binding.
A changed transaction needs a new authorization. The voice authorization key is
separate from MPC signing material; VoiceID does not derive or handle signing
shares. MPC protects signing material, while the authorization layer establishes
the operation the user approved.

This recommendation depends on a real protected voice boundary. A native app
with a hardware-stored key is insufficient if ordinary app code can request a
signature without successful voice verification. The approved component must
enforce capture, template matching, phrase checks, PAD, and permitted key use.

For an ordinary browser, trusting a local success flag or application signature
does not satisfy those requirements. The unresolved choices are a suitable
external/native protected authenticator, server inference that changes the
audio-privacy boundary, or client-side ZK whose complete latency must be measured.
The conversation did not resolve the wallet's platform constraint.

The removed signing profile outlined `VoiceIdAuthenticatorAdmittedTransaction`
as a future admission path. That historical E0/E1/E2 evidence could not
construct the authorization.

## Follow-up requirements identified

These are open engineering questions, rather than newly completed work:

1. Select the robot hardware, microphone path, local template storage, and
   authorization enforcement boundary. Determine whether hosted policy calls can
   stay outside the latency-critical command path.
2. Determine whether wallet use may depend on a native or dedicated voice
   authenticator, and which protected implementation can actually enforce the
   complete voice ceremony.
3. Benchmark listening time, endpointing, inference, authorization, and network
   contribution separately. For wallets, also measure admission and MPC signing.
4. Evaluate owner acceptance, impostors, replay, clones, injection, multiple
   speakers, noise, distance, and short commands on each supported capture profile.
5. Define local enrollment, revocation, deletion, device transfer, and recovery.
6. Update the active plans and request/storage contracts when the target is
   adopted. Preserve the existing engine as an evaluation baseline while replacing
   incompatible production data paths.
7. If ZK remains a candidate, benchmark a complete proof covering preprocessing,
   speaker, phrase, and PAD checks on the target device before selecting it for a
   latency-sensitive flow.
