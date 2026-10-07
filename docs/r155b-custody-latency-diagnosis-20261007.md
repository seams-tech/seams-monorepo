# R155B: custody setup latency diagnosis, 2026-10-07

The 6.173-second median setup request contains repeated custody admission,
several state transitions across Worker/DO boundaries, and substantial CPU work.
The existing application timers misattribute some of that work.
The available traces cannot assign every millisecond to a single cause.

This analysis uses deployed source `7d9956879187ae410518d9ec02de96fb5056a52b`.
Concurrent working-tree changes were excluded. No deployment changed for this diagnosis.

## Measurement correction

Cloudflare freezes `Date.now()` and `performance.now()` between I/O events.
A synchronous computation can report zero. Its elapsed time can then appear in
the next I/O span because that span started with a stale timestamp.
See [Cloudflare's timer documentation](https://developers.cloudflare.com/workers/runtime-apis/performance/).

Our `role_span_started_at_ms` and DO handler timers use that clock.
Thus `deriver_b.session_do` is not a clean network timer, and the 285 ms A protocol
span does not establish CPU parity with the user's local 250–400 ms baseline.
The previous report's interpretation is corrected accordingly.

Provider telemetry from the three uninstrumented wallets gives these whole-invocation measurements:

| Invocation | Median CPU | CPU range | Median wall time | Wall range |
| --- | ---: | ---: | ---: | ---: |
| A DO prepare | 204 ms | 176–254 ms | 511 ms | 451–553 ms |
| A DO execute | 545 ms | 505–880 ms | 2,503 ms | 2,409–3,268 ms |
| B Worker WebSocket execution | 832 ms | 692–1,061 ms | 1,927 ms | 1,875–2,603 ms |
| B DO prepare | 198 ms | 177–203 ms | 580 ms | 417–1,143 ms |
| B DO begin | 10 ms | 10–11 ms | 56 ms | 52–60 ms |
| B DO complete | 12 ms | 10–13 ms | 58 ms | 52–59 ms |

B begin/complete mapping uses command ordinals two and three in each fresh wallet
and the deployed lifecycle sequence. These calls used the same live object.
Repeated constructor startup therefore does not explain these calls.
Invocation intervals overlap. CPU includes validation, encryption, serialization,
and protocol work. It does not isolate the Yao algorithm.

## Confirmed code costs

1. **Repeated root-share admission.** Both roles load the root share in preparation,
   then discard it. Both load it again during execution. All three wallet traces
   contain four `bound_root_d1_timing` events per pair. Each reports two round trips
   and five statements: eight round trips and twenty statements across both roles.
   These are counts of this subsystem only. A/B preparation already runs in parallel.
2. **B execution is separated from B state.** The Worker performs the protocol while
   its DO owns the pair record. Prepare, begin, and complete each cross that boundary.
   The WebSocket upgrade waits for the begin command. Completion also needs a durable write.
3. **Repeated validation and setup.** A's DO verifies both readiness receipts before
   calling `execute_deriver_a_role`, which verifies those same receipts again.
   The prepare and execute paths also recreate runtime/key configuration and reopen
   encrypted root state. The CPU cost of each operation is not yet isolated.
4. **Durability work extends beyond handler timers.** DO handlers write synchronous
   SQLite state. Cloudflare holds outgoing responses until writes persist.
   Our handler timer ends before response delivery and cannot capture that whole wait.
   This is a possible contributor, not a measured explanation for the entire gap.
   See [Cloudflare's output-gate description](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).

Both deployed role bundles have `profile: release` build stamps.
The captured location probes showed HKG in all observed contexts, with two complete
four-context pairs. Neither debug builds nor a demonstrated continental split
explains this run. Physical colocation and exact transport delay remain unproved.

## Proposed fixes, in order

The implementation checklist is now Phase 6B of `seams-wallet/docs/refactor-155B.md`,
committed on `dev` as `6b77a8122dc34c4a4d859468636b4714f6883df3`.
It defines validation, database, DO execution, optional material reuse, and hosted
acceptance steps. The implementation update below records completed changes.
The two-second target remains open. Structural call reductions are distinct from
measured latency savings.

1. **Remove duplicated validation within one trusted invocation.** Pass a validated
   execution context from A's boundary handler to its protocol function. Parse
   immutable runtime configuration once per instance where its lifetime permits.
   Keep independent checks at separate trust boundaries and all lifecycle checks.
2. **Reduce the bound-root loader to one coherent database transaction where possible.**
   Replace its preliminary row read plus admission batch with conditional admission
   and coherent result reads. Preserve active-epoch, cancellation, expiry, binding,
   and relocation checks. An invalid binding must never create an accepted admission.
   The structural target is four round trips instead of eight for these four loads.
   Exact SQL feasibility and savings require verification.
3. **Run B's protocol inside B's existing wallet DO.** Route its WebSocket to that
   object. Perform begin and complete through the local state engine. This removes
   the remote begin/complete command exchanges and returning prepared payloads to
   the Worker. Keep A and B in separate objects and keep their private service binding.
   Preserve durable claims, exact retries, cancellation, root retirement, and relocation fencing.
   This does not remove required persistence barriers.
4. **Then consider reusing prepared root material for the exact admitted pair.**
   This is conditional on a precise invalidation contract. Preparation currently
   pins root-use admission, but execution must still reject cancellation or fencing.
   Do not introduce a general root-share cache or bypass these checks to save reads.

Verify each change with the existing hosted registration flow and the custody E2E
for lost replies, retry, cancellation, and relocation races. Compare the same release
WASM locally and hosted. Record browser setup latency plus provider CPU/wall time.
Use correlated tracing for dispatch and storage waits instead of subtracting frozen-clock spans.
No numerical speedup is established yet. The complete setup target remains below two seconds.

[Sanitized provider evidence](evidence/r155b-custody-latency-diagnosis-20261007.json)
contains the invocation metrics and supporting events. The original benchmark
and deployment evidence remain in [the location report](r155b-custody-location-20261007.md).


## Phase 6B implementation update

Public `dev` commit `2ee2b6960e04ebfcc67085eb33d741ca1b8e5282` implements
A readiness verification once per execute invocation and B protocol execution in
its existing wallet Durable Object. A removes six repeated signature verifications.
B removes separate remote begin and complete exchanges. Claims, durable completion,
exact replay, cancellation, retirement, and ownership fences remain.

The two-trip bound-root loader remains. Its preliminary read authenticates fields
inside encrypted state before admission. The SQL projection cannot enforce those
checks in a single batch. Optional cross-step root-material reuse is deferred;
this change adds no cache or invalidation subsystem.

All five release Workers build. Local custody scenarios pass for four regions,
forged readiness, concurrent execution, lost replies, eviction, admission races,
root erasure, relocation, and fresh signing after return. Repeatable evidence is in
`seams-wallet/docs/evidence/near-custody-setup-optimization-20261007.json`.
The subsequent hosted comparison and local profile are recorded below.

## Phase 6B measured result

The candidate completed 12 fresh NEAR-only wallets and 84 verified signatures.
Three wallets ran per arm. Browser assets, harness, and all other deployments
stayed fixed. Only A and B changed. Exact original versions were restored.

| Setup HTTP request | Median | Minimum–maximum |
| --- | ---: | ---: |
| Control before | 5.808 s | 5.649–6.768 s |
| A validation consolidation | 5.723 s | 5.658–6.691 s |
| A consolidation plus B protocol inside its DO | **4.929 s** | **4.924–5.204 s** |
| Restored control after | 6.423 s | 5.006–6.720 s |

The full candidate improves the observed median by 15.1–23.3% against the two
controls. The two-second target remains unmet. These small sequential cohorts
provide no percentile guarantee. The earlier 6.173-second result is a separate cohort.

Provider A DO CPU/wall medians changed from 605/2,604 ms to 519/2,104 ms.
B protocol CPU/wall medians changed from 707/1,957 ms to 331/1,010 ms. B moved
from Worker execution to DO execution; the new scope includes local begin/complete.
The old scope excludes their separate DO CPU. Overlapping A/B wall times cannot
be added. Bound-root work remains eight D1 trips and twenty statements per pair.

Candidate SDK signing medians were 2.318 s warm, 1.916 s after unlock, and
2.013 s per consecutive signature. Routine-signing improvement is not established;
the restored control's consecutive median was 1.889 s. The complete evidence records
all workflow timers, SDK timers, ranges, maxima, and browser Gateway request counts.
Whole-system D1 counts, backend Console calls, and internal payload sizes are unavailable.

The same release WASM completed one profiled local Router setup span in 380 ms;
A's protocol span was 155 ms. The processes were warm after an interrupted wallet.
The profile exposes Yao, Curve25519 arithmetic, software AES, SHA-256, verification,
encryption, and JSON work. Inlining and async boundaries prevent complete attribution.
Sample weights are not provider CPU billing. This sample supports further hosted
boundary analysis; it does not justify a cryptographic protocol change.

The dedicated disconnect E2E interrupts a valid WebSocket exchange. Both roles
persist burned state. Exact retry cannot reconnect, and an independent wallet
then succeeds. The obsolete direct-reservation fixture was removed.

All thirteen tracked deployments match their starting versions after restoration.
No new resources or keepalive traffic were introduced. Raw provider logs remain
private local artifacts. [Sanitized comparison evidence](evidence/r155b-custody-phase6b-20261007.json)
records exact deployed versions, frozen harness/assets, bundle hashes, CPU/wall
telemetry, local profile summaries, and measurement limitations.

## Follow-up: background admission settlement

Public commit `ace09a0249433304eff94ad41c3283e8edacdaca` schedules A/B root-use
acknowledgements after durable completion, using each owning DO's context.
A now uses the physical object name for the current ownership generation.
Lost acknowledgements remain recoverable through retirement reconciliation.

Five local E2E scenarios and all five release builds pass. The hosted comparison
uses the preceding Phase 6B candidate as its control. Only two Rust source files
differ. All nine fresh NEAR-only wallets complete, with 63 verified signatures.

| Setup HTTP request | Median | Minimum–maximum |
| --- | ---: | ---: |
| Phase 6B control before | 6.540 s | 5.898–7.294 s |
| Background-settlement candidate | 5.898 s | 5.583–6.626 s |
| Phase 6B control after | 5.950 s | 5.834–6.283 s |

The candidate median is 642 ms below the preceding control and 52 ms below the
following control. The ranges overlap. A stable latency improvement is not established.
The previous 4.929 s sample remains a separate historical cohort. The two-second
target remains unmet. No new resources were created. All thirteen tracked deployments
were restored to their starting versions.

The D1 call count remains unchanged. Two settlement waits leave the success response
path. Provider invocation wall time can include those background writes, so it must
not be interpreted as response-delivery latency. [Sanitized evidence](evidence/r155b-custody-background-settlement-20261007.json)
records exact versions, source/bundle hashes, SDK signing results, and limitations.

Next, evaluate overlap between A's root read and B's connection/root preparation.
Both started operations must finish or close safely. Keep A's durable claim before
its first protocol output, and verify cancellation and connection failures first.
Router claim/finish dispatch remains another measurement target; its individual
cost is not established yet.

## Follow-up: overlapping root load and peer startup

Public `dev` commit `3152581198bafe21291cb3a29e6d28eaaac04a0c` implements the overlap
and connection cleanup. All five strict release builds and the bloat check passed.
Nine E2E checks passed: five peer-failure scenarios, four-region placement, admission
settlement/retirement, concurrent execution with relocation, and lost-reply replay.
The fault scenarios include cancelled root admission, refused upgrade, missing
acceptance, forged acceptance, and mid-protocol disconnect. Each scenario verifies
that an independent wallet can complete after the failure.

The controlled staging comparison used three fresh NEAR-only wallets per arm.
The control is Phase 6C before and after the candidate. All 167 browser assets and
the harness stayed fixed. Only the A/B custody deployments changed.

| Registration Yao execute request | Median | Observed range |
|---|---:|---:|
| Phase 6C control before | 5.856 s | 5.460–7.447 s |
| Overlapped-setup candidate | **5.416 s** | **5.118–6.492 s** |
| Phase 6C control after | 5.731 s | 4.959–5.798 s |

The observed median reduction was **315–440 ms (5.5–7.5%)**. The ranges overlap,
and each arm has only three samples. A stable gain remains unproven.
The two-second setup target remains unmet. These timings cover the registration
Yao execute request, excluding funding and blockchain confirmation.

All nine wallets completed and **63 signatures verified**. Each pair still has
four bound-root loads, eight D1 trips, and twenty statements in that subsystem.
This change overlaps waits and does not remove these database operations.
Warm and consecutive signing still use four browser Gateway requests per signature.
Candidate SDK signing medians were 2.684 s warm, 2.058 s after unlock, and 2.086 s
per consecutive signature. The later control was faster on warm signing, so these
samples do not establish a routine-signing improvement.

The runner restored and verified all thirteen original deployment versions.
Current role settings matched the deployment configurations before the experiment.
No new resources or keepalive traffic were introduced. The source comparison found
only the two intended Rust changes. Full timings, ranges, request counts, build hashes,
and sanitized provider observations are in
[the evidence](evidence/r155b-custody-overlapped-setup-20261007.json).

Next, measure the Router claim/finish object calls separately before changing their
execution boundary. Durable admission and completion must remain on the required
success path. No latency saving for that follow-up is claimed yet.
