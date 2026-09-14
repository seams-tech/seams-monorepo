# Local VoiceID architecture and implementation plan

Date: 2026-09-14
Status: proposed implementation plan for the confirmed local-first direction.
The replacement runtime and its acceptance gates are not implemented yet.

Related plans:

- [Legacy removal](voiceId-legacy-removal-plan.md)
- [MPC wallet extension](voiceId-mpc-wallet-extension-plan.md)

## Product direction

VoiceID helps a robot determine who spoke a command, whether that person is
plausibly nearby, and whether the command can be attributed to that person in
the current conversation. Voice analysis and available visual analysis run on
the device. Raw audio, video, and biometric templates stay local.

The robot may accept a command while looking away from someone it recently
saw, when current speech and continuing scene evidence support that attribution.
Every command receives a fresh assessment. A remembered presence observation
never creates a general unlocked state.

### Confirmed decisions

- Local processing is the normal and complete command path; no hosted verifier
  or biometric-upload fallback is required.
- ZK is removed from the architecture and implementation queue. No proving
  subsystem is part of this plan.
- Combine voice with recent visual context when available. Looking directly
  at the speaker's mouth for every command is unnecessary.
- Treat unavailable, stale, contradictory, and ambiguous evidence explicitly.
- Keep perception, command authorization, and physical safety as separate
  responsibilities.
- Reuse useful audio components while replacing the old application lifecycle.
- Wallet signing is an optional consumer addressed by its own plan.

### Proposed first delivery scope

Start with one enrolled owner, English commands, one controlled indoor setting,
one native device profile, and a small allowlist of low-risk robot interactions.
Other people can be present; they remain unknown participants and can cause
ambiguity. Simultaneous speech requires clarification rather than a best guess.

Use the existing Python package and model adapters for the first runtime. A
single process with bounded model work is the default. Introduce a worker
process only where an actual native-library isolation or cancellation need is
demonstrated. No browser application, plugin framework, model-service mesh,
general-purpose SDK, or multi-device synchronization is needed for this MVP.

These are planning assumptions. L0 records the actual hardware, language, action
allowlist, and resource limits before they become release requirements.

## Runtime responsibilities

| Component | Responsibility and boundary |
| --- | --- |
| Native capture | Acquire timestamped audio frames and camera frames when available. Preserve audio channel layout and report device/clock discontinuities. |
| Utterance processing | Detect speech, stream transcription, identify utterance boundaries, and derive model input windows from the same captured source. |
| Voice analysis | Assess quality, speaker similarity, and presentation-attack signals independently. Preserve uncertainty and model/calibration identity. |
| Visual context | Detect/track people, associate an enrolled face where supported, and maintain short-lived last-seen context. Treat face matching as probabilistic evidence. |
| Spatial association | Relate audio direction to visual tracks using calibrated microphones, camera geometry, and robot pose where available. |
| Attribution | Associate the current utterance with a participant using current voice and temporal/spatial context. Reject contradictory or ambiguous associations. |
| Command interpretation and policy | Interpret a bounded command vocabulary, determine whether speech addresses the robot, and apply the locally configured action policy. |
| Robot adapter | Deliver an allowed, operation-specific command to the existing robot controller. The controller retains all physical safety checks. |

Keep these as direct modules in `verifier/voiceid_verifier/`. Existing
`embeddings.py`, `scoring.py`, `pad.py`, and useful enrollment helpers remain
there. Rewrite `runtime.py` for coordination and add only the capture,
presence/attribution, local-storage, and command modules needed by the slice.
The `voiceid_verifier` package name can remain; a naming migration adds no
product value.

## Capture and model execution

### Audio

Live input is timestamped PCM with a capture-session identity, sequence number,
sample rate, channel layout, and clock mapping validated at acquisition. Keep
array channels until source localization is complete. Derive mono/resampled
views only for models that need them. A mono microphone explicitly provides no
array-derived sound direction or distance estimate.

Use a bounded in-memory ring buffer. Define frame size, speech pre-roll,
endpointing, maximum utterance length, and retention horizon for the selected
device. On overflow, sequence gaps, device replacement, or clock reset, invalidate
affected observations and pending decisions. Do not silently stitch recordings
across discontinuities.

Transcription must use an actual incremental runtime API. Speaker and PAD models
may evaluate bounded speech windows when enough current audio is available;
they do not need to produce a result on every frame. Preserve shared capture and
utterance identities across all stages. A valid owner's earlier speech cannot
authorize a different speaker's command later in the same buffer. Insufficient
current speaker evidence requires a repeat or clarification.

Run independent stages concurrently where the hardware benefits. Bound queue
depth, work admission, and deadlines. A timed-out stage cannot later emit an
allowed command. Keep buffers alive until their final reader finishes; do not
zero memory while a timed-out native job still uses it. Test and document native
library copies and best-effort cleanup limits rather than promising complete
memory erasure.

The existing energy-based speech detector, ECAPA integration, and research
AASIST adapter are starting baselines. Their old recording lengths and
thresholds are not release settings for conversational commands. Moonshine's
old closed-set approval intent classifier is separate from the new robot
command vocabulary.

### Video and spatial context

Retain a short, bounded in-memory frame history only where a temporal visual
check needs it. Prefer derived track observations for recent-presence memory.
Persist neither raw video nor continuous face observations by default.

An observation records its capture time, track identity, coordinate frame,
location uncertainty, and identity state. Map camera and microphone clocks to
one local monotonic timeline. Calibrate array direction against camera geometry
and account for robot/head movement. Unknown calibration or stale pose makes
spatial association unavailable.

Direction is a cue with uncertainty; it does not by itself establish distance,
speaker identity, or a live source. The robot's own speech, nearby loudspeakers,
television audio, reverberation, and head motion must be evaluated explicitly.
Use the robot's playback signal for self-speech suppression where the device
supports it. Do not allow synthesized robot speech to approve a command.

When a face is visible during the utterance, evaluate lightweight mouth-motion
and speech-timing consistency as an additional cue. A positive result may
influence policy only after calibration. Absence of concurrent mouth footage
does not invalidate a supported recent-visual-context path. Full lip reading
and photorealistic audiovisual spoof detection are outside the first scope.

## Temporal state and attribution

Use explicit domain states with required branch-specific data. Normalize raw
device events, model responses, persisted records, and local IPC once at their
boundaries. Python uses precise tagged variants and exhaustive handling; any
later TS boundary follows the repository's discriminated-union and type-fixture
rules. Diagnostic scores describe the decision and never replace domain state.

| State | Required meaning |
| --- | --- |
| Sensor available / unavailable / faulted | Available includes capture profile and clock mapping. Other branches carry a reason and cannot manufacture observations. |
| Identity matched / unknown / ambiguous | Matched includes enrollment identity and version. Unknown and ambiguous cannot carry an authorized owner identity. |
| Visual track current / recent / expired / departed | Current/recent include observation time and location uncertainty. Recent additionally has a bounded validity deadline. Departed invalidates continuity immediately. |
| Attribution attributed / ambiguous / rejected / insufficient | Attributed identifies the current utterance, participant, supporting checks, capture session, and validity window. Other branches cannot become executable commands. |
| Command allowed / needs clarification / denied / no command | Allowed includes the exact command, utterance, attributed identity where required, policy version, and deadline. Other branches expose no execution handle. |

Presence is per participant. The validity horizon is calibrated for the target
environment, with an explicit maximum age. Seeing someone depart, losing track
identity at a crossing, changing capture sessions, restarting the process, or
receiving contradictory spatial evidence invalidates continuity early.
Confidence decay alone cannot override those invalidations.

Do not multiply voice, PAD, and visual scores as though they were independent
probabilities. Start with explicit calibrated eligibility gates and contradiction
rules; introduce learned fusion only if measured failure cases justify it.

### Intended interaction behavior

| Situation | Required behavior |
| --- | --- |
| Owner is visible and current voice/source evidence agrees | Attribute the utterance and evaluate the exact command under the allowlist. |
| Owner was recently seen; robot looks away; current speech and location remain consistent | Permit the calibrated recent-context path for allowed low-risk interactions. No new visual observation is invented. |
| Camera is absent, disabled, or its last observation expired | Use only an explicitly qualified audio-only policy. Restrict actions or request clarification; never claim visual confirmation. |
| Owner was seen leaving or another source contradicts the owner track | Invalidate recent context and reject/clarify the attribution. |
| Two people could be speaking, speech overlaps, or current audio is too short | Request a fresh utterance or visual reacquisition; do not select the nearest historical owner match. |
| Speech is background conversation, TV playback, or robot self-speech | Do not execute a command. Ambiguous addressedness requires clarification. |
| A model is missing, uncalibrated, overloaded, or past its deadline | Return the explicit degraded/insufficient state. Required checks cannot be skipped to obtain approval. |

The action allowlist and evidence requirements are configured locally by the
application owner. A caller or language model cannot label its own operation
low-risk. The initial recognizer may use a wake/address cue and a short
conversation context; neither makes unrelated later speech executable.

Emergency stop and protective pause remain available independently of owner
authentication. Identity never overrides the robot's safety controller.

## Enrollment, local storage, and privacy

- Enrollment requires deliberate local setup approval. Never enroll whoever
  happens to be near an unconfigured microphone.
- Gather sufficient varied, quality-controlled voice material and optional
  consented face samples. Bind the paired enrollment through the setup flow;
  simultaneous observation alone cannot assign an identity.
- Commit a template atomically only after its collection and stability checks
  pass. Re-enrollment or deletion invalidates dependent in-memory identities.
- Encrypt templates with a randomly generated key protected by the selected
  device's storage facilities. Bind ciphertext to enrollment identity, device,
  modality, and template/model version using authenticated metadata. Base64
  serialization provides no encryption.
- Keep enrollment replacement, deletion, and reset as explicit local operations.
  No automatic template learning from accepted commands in the MVP.
- Keep raw media in bounded RAM by default. Diagnostic capture is an explicit,
  consented, time/size-limited offline research operation. Ordinary logs exclude
  raw media, embeddings, and complete transcripts.
- Offline startup works after dependencies and models have been provisioned.
  Model downloading/updating is an explicit maintenance operation. Inference
  never silently downloads assets or calls a remote fallback.

The MVP trusts the local OS, runtime, and configured sensor acquisition path.
It evaluates physical replay and spoofing but does not claim resistance to a
fully compromised endpoint or prove sensor provenance. Trusted hardware and
sensor-path qualification are separate deployment decisions. Wallet use states
its stronger or additional assumptions in the extension plan.

## Implementation sequence and exit gates

### L0 — Fix the first device and experiment contract

- [ ] Select the actual robot/native host, OS, microphone channel access, camera,
      playback reference, and robot pose interface. Record unavailable features.
- [ ] Choose the first language, owner setup, permitted commands, and supported
      audio-only behavior. Keep all initial actions low-risk.
- [ ] Set measurable latency, memory, buffer, and operating-environment budgets.
      As a starting experiment, propose warm p95 final attribution within
      500 ms of speech end and a 1 s decision deadline; confirm or revise from
      target-device measurements. These are targets, not inherited guarantees.
- [ ] Confirm licenses, local model availability, and setup consent.

Exit: one concrete hardware profile and acceptance contract. A development Mac
alone cannot establish target-robot performance.

### L1 — Retain adapters and create precise local boundaries

Coordinate with deletion-plan D1.

- [ ] Define capture, utterance, enrollment, stage-result, and command states.
- [ ] Decouple retained PCM adapters from HTTP and old enrollment/phrase DTOs.
- [ ] Preserve adapter, quality, aggregation, timeout, and cleanup tests.
- [ ] Add a deterministic timestamped event-replay test input without making it
      a production sensor source or an alternative authorization path.

Exit: model work and state tests run without the old TS application.

### L2 — Deliver the native audio vertical slice

- [ ] Capture real PCM continuously with bounded buffers and discontinuity handling.
- [ ] Implement actual streaming transcription and per-utterance speaker/quality/PAD
      assessment with independent states and bounded execution.
- [ ] Add explicit local enrollment, protected template storage, and deletion.
- [ ] Interpret a small command set and expose local status plus a non-actuating
      command sink for testing. Missing calibration prevents restricted execution.
- [ ] Document one runtime invocation, test command, and offline smoke procedure.

Exit: an enrolled owner can complete the audio slice on the selected device;
stale results, unknown speakers, self-speech, and overload cannot trigger the
test sink incorrectly. D2 can remove the old application. This is an interim
audio milestone, not completion of the conversational visual-context MVP.

### L3 — Add visual memory and source association

- [ ] Implement optional camera capture, person tracking, consented face matching,
      and bounded current/recent/expired/departed state.
- [ ] Implement microphone direction where supported, clock/geometry/pose mapping,
      and uncertainty-aware association with visual tracks.
- [ ] Evaluate concurrent mouth-motion timing; represent unavailable or unqualified
      checks explicitly.
- [ ] Implement the interaction table, including looking away, leaving, track
      crossings, occlusion, sensor failure, and audio-only degradation.

Exit: deterministic tests and real captures demonstrate supported recent-context
attribution and early invalidation. Camera availability never becomes a hidden
requirement for starting the runtime.

### L4 — Integrate the robot command boundary

- [ ] Bind every allowed result to one command/utterance and a short deadline.
      Reject duplicates, changed commands, expired results, and old capture sessions.
- [ ] Add the bounded addressedness/conversation rules and clarification behavior.
- [ ] Connect the low-risk allowlist to the existing robot controller. Keep its
      independent safety and emergency paths intact.
- [ ] Invalidate pending decisions on lock, enrollment change, shutdown, and sensor
      discontinuity. Restart begins without remembered authority.

Exit: no consumer can turn generic presence or a stale successful model score
into execution through the supported API.

### L5 — Calibrate and qualify the complete local MVP

- [ ] Extend existing corpus tools with synchronized audio/video and track-event
      provenance. Preserve old measurements under their original profiles.
- [ ] Use development/calibration/evaluation partitions without subject/session
      leakage. Add consented independent human speakers; synthetic impostors
      alone cannot establish population accuracy.
- [ ] Measure command-level false attribution/execution, genuine completion,
      clarification/rejection rates, PAD errors, and visual association errors.
      Report sample counts, uncertainty, and results by capture/attack condition.
- [ ] Test recordings, live clones, loudspeakers near the owner, screen/photo face
      presentation, an owner nearby while another person speaks, overlapping
      speakers, short commands, noise, motion, and robot self-speech.
- [ ] Measure listening duration, endpointing, each model stage, fusion/policy,
      action dispatch, cold start, p50/p95/p99, peak RAM, and sustained resource use.
- [ ] Test network-disabled operation, device loss, clock/pose discontinuity,
      process/model failure, bounded overload, cancellation, and a sustained soak.
- [ ] Fix acceptance thresholds before the held-out evaluation. Record the chosen
      model/capture/calibration versions in the existing provenance mechanism.

Exit: all declared hardware and degraded-mode profiles meet agreed numerical
acceptance criteria, the robot runbook is executable, and deletion-plan D3 is
complete. Until criteria are selected and measured, label the system experimental.

## Open decisions and dependencies

| Decision | Needed by |
| --- | --- |
| Actual device, array/channel access, camera, calibration and pose interfaces | L0; blocks hardware-specific capture/localization work. |
| Allowed commands and the required evidence for camera-present and audio-only operation | L0; blocks executable policy. |
| Face/tracking implementation and any mouth-motion check | L3; selected from target-device measurements and license review. |
| Recent-context horizon, continuity rules, thresholds, and acceptable error rates | Initial rules in L0/L3; frozen before L5 evaluation. |
| Device key protection and enrollment administration | L2; no claim of protected storage before implementation. |
| Multisubject corpus access and consent | L5; blocks biometric/security qualification. |

The wallet extension can be designed alongside this work. It cannot turn an
unqualified robot perception result into a financial authorization, and it is
not a prerequisite for the local MVP.
