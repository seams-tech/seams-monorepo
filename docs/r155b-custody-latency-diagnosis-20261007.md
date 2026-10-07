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

## Router claim and finish measurements

Diagnostic implementation `c09a7a89c8d9202588206507327339e864911bdf` labels Router
wallet operations and records caller dispatch time. It preserves registration behavior.
All five strict release builds, the bloat check, and three lifecycle E2E checks passed.
The tests cover four-region placement, lost-reply replay, concurrent execution,
eviction, and relocation. A stale capture assertion was updated in separate commit
`24439587b786c5c0589a269baea38a9c69525ad1`. The test still interrupts capture inside
its DO before the production transport advances several steps in one request.

Two staging rounds completed six fresh NEAR-only wallets and **42 verified signatures**.
Phase 6D A/B, the harness, and all 167 browser assets stayed fixed. All thirteen
original deployment versions were restored and verified. No resources were added.

| Router wallet operation | Caller median | Caller range | DO wall median | DO CPU median |
|---|---:|---:|---:|---:|
| Registration claim | **776 ms** | 596–1,101 ms | 75 ms | 22.5 ms |
| Registration finish | **56 ms** | 53–62 ms | 44 ms | 2.5 ms |
| Registration consume | **399 ms** | 59–537 ms | 51 ms | 10 ms |

Each row contains six samples. Claim plus finish, paired within each registration,
measured **832 ms median**, with a **649–1,154 ms** range. Consumption belongs to
subsequent registration finalization and is excluded from that total.

The browser Yao execute request measured **5.449 s median** across all six wallets
(range **4.808–7.463 s**). The two round medians were 5.200 s and 5.597 s.
This diagnostic run does not establish a new speedup. The two-second target remains unmet.

The existing Router spans measured 1.444 s median for parallel A/B preparation,
2.191 s for A execution, and 792 ms for Signing Worker delivery. Parse/authorization
measured 859 ms and includes the claim. These spans overlap or nest; their separate
medians must not be added into an end-to-end result. A zero clock span for receipt
verification does not mean zero CPU work.

**Finding:** claim dispatch is material. The caller/DO timing gap points toward
waiting outside the handler, including dispatch, placement, or startup. The clocks
do not separate these causes. The later consume call also has a substantial gap.
The current label cannot prove whether its live object instance survived between calls.

[Sanitized measurements and repeatable local evidence](evidence/r155b-router-dispatch-20261007.json)
include every range, request count, build hash, and the paired aggregate.

## Next bounded experiment: earlier Router wallet startup

The existing `/internal/prewarm` fan-out touches Workers. It does not address the
wallet's Router DO. Test one bounded wake-up after registration has a validated
reservation, canonical wallet identity, fixed home, and ownership generation.
It must overlap independent registration work to reduce user-visible waiting.

- Use the existing authenticated Gateway-to-Router binding and home routing.
  Add no new infrastructure, configuration flag, cron, or continuous keepalive.
- Address the same generation-specific object that the later claim uses.
  The wake-up must grant no authority, claim no registration, and consume no budget.
- Start once for newly admitted work through the existing background-work mechanism.
  Preserve normal claim and finish checks when startup fails or signing starts immediately.
- Record the object instance's first-command marker. Separate cold and already-running
  instances before attributing a result to startup.
- E2E must cover wrong home, rejected admission, lost warm-up reply, immediate execution,
  and concurrent exact registration retries.
- Repeat control/candidate/control measurements. Record total registration-to-first-signature
  time as well as claim latency, so a shifted wait cannot appear as an improvement.

The observed 832 ms includes required state work and transport. It is not a promised
saving. Evaluate this bounded change before moving the whole coordinator into the DO.


### Router startup experiment — 2026-10-08

The new Gateway starts the exact Router wallet object after it persists verified
registration intent. The request uses the fixed home and ownership generation.
It grants no authority and performs no storage mutation. Local correctness checks pass.
Public implementation commit: `eddb696a5912df6ef5e9dccadcc81b56718ef095`.

The hosted control completed three wallets and 21 verified signatures. Setup measured
**5.317 seconds median**, **4.998–5.332 seconds** range. The local Router HTTP boundary
measured **420–427 ms** across four homes. The local timer excludes browser and Gateway.

The first candidate attempt produced no hosted result. Tenant activation rejected the new Gateway.
Two unfinished US records belonged to the registration canary from the preceding
successful activation. Earlier diagnostic queries omitted US. The canary calls setup
and does not complete or cancel registration. Its unexpired records fail the runtime
inspection's zero-in-flight-ceremony requirement. Check all four regions before activation.
This observation explains a concrete readiness blocker; it does not prove every field
in the composite readiness check matched during every failed attempt.

After the records expired, GitHub returned HTTP 500 for workflow dispatch. The workflow
list showed no new run. All 13 original Worker versions were restored and verified.
`/healthz` and the tenant projection both returned HTTP 200. No new resources were created.

The hosted **1–2 second** setup target remains unmet. The later comparison below
kept the Gateway fixed and checked unfinished ceremonies before cleanup activation.
[Sanitized measurements](evidence/r155b-router-startup-20261008.json) preserve all boundaries.

### Controlled Router startup result — 2026-10-08

The later activation and restoration succeeded. Nine fresh NEAR-only wallets
completed **63 verified signatures** with fixed Gateway, A/B, Signing Worker, and
browser assets. Only the Router version changed.

| Arm | Browser Yao setup median | Range | Router claim median |
|---|---:|---:|---:|
| Control before | 4.893 s | 4.337–5.210 s | 660 ms |
| Exact Router startup | 4.644 s | 4.237–4.756 s | 455 ms |
| Control after, two matching wallets | 4.148 s | 4.060–4.236 s | 611 ms |

All three candidate claims used already-started object instances. The claim improved
by 156–205 ms. Complete setup improvement remains unproven because the later control
was faster. All thirteen original Worker versions were restored and verified.
The first final-control wallet served the preceding Router DO version during rollout.
It completed successfully and is excluded from this version-matched comparison.

### Parallel startup and narrower APAC placement — 2026-10-08

Implementation `cf2c270628482f2bf38a129af9265969a5a2b967` starts the exact Router, A,
B, and Signing Worker wallet objects in parallel after verified registration intent.
Fourteen fresh wallets completed **98 verified signatures**. One additional wallet
completed Yao, then failed during first-sign funding with an upstream NEAR RPC 408.
Its complete browser timing sample is unavailable. Server traces include its Yao work.

| Arm | Complete browser samples | Yao setup median | Range |
|---|---:|---:|---:|
| Router-only startup, control before | 3 | 3.965 s | 3.563–5.375 s |
| Parallel startup, broad APAC | 3 | 2.455 s | 2.266–3.837 s |
| Parallel startup, `apac-ne` | 3 | 4.083 s | 4.018–4.847 s |
| Parallel startup, repeated broad APAC | 2 | 3.852 s | 3.847–3.857 s |
| Router-only startup, control after | 2 | 4.239 s | 4.205–4.273 s |

The first repeated broad-APAC wallet served the preceding B DO version during rollout.
It completed successfully and is excluded from the version-matched table and aggregate.
The pooled broad-APAC parallel median is **3.837 s** across five samples. The pooled
Router-only control median is **4.205 s** across five: an observed **8.7% reduction**.
The repeat does not support a stable 2.455 s result. The **1–2 s target remains unmet**.
Keep broad `apac`; the narrower hint was slower than both parallel-startup arms.

All nine parallel-startup wallets reused already-started instances in all four roles.
The first broad-APAC preparation median was 344 ms, versus 1,269 ms in the initial
Router-only control. Signing Worker delivery measured 137 ms, versus 701 ms.
Its first object call used 24 ms median CPU and 120 ms median wall time.
The larger caller durations show remaining work or waiting outside that handler.
The clocks cannot isolate exact network time. Nested stage medians must not be added.

Moving coordination into the Router DO would still need the initial dispatch. The
directly removable finish call is approximately 50 ms. Larger placement gains remain
unmeasured, so this result does not justify that larger rewrite.

All thirteen original Worker versions were restored and verified. No new resources
or keepalive traffic were added. [The evidence](evidence/r155b-parallel-startup-20261008.json)
records deployment hashes, counts, the failed funding attempt, and timing limitations.

### Read prepared root admissions during execution — 2026-10-08

The isolated comparison tested `fa9efc2897221ead980e69f95f8abdc654220861`.
Execution reads the prepared admission and root state in one primary-backed batch.
It preserves cancellation and erasure checks. All five release builds and seven
E2E scenarios pass. Nine fresh wallets completed **63 verified signatures**.
The original Gateway, Router, Signing Worker, SDK, and broad APAC hint stayed fixed.
That Gateway did not invoke early startup.

| Arm | Wallets with matching versions | Yao setup median | Range |
|---|---:|---:|---:|
| Control before | 3 | 4.735 s | 4.597–4.985 s |
| Read the prepared admission | 2 | 4.196 s | 4.039–4.353 s |
| Control after | 3 | 4.351 s | 4.030–4.383 s |

One candidate wallet served new A and preceding B during rollout. Its 4.178 s setup
completed but is excluded. The two matching wallets each recorded **6 bound-root
D1 round trips and 16 statements**, down from **8 and 20** in each control wallet.
The mixed wallet recorded 7 and 18. These counts exclude other stores.

Database work decreased. The small sample and overlapping ranges do not establish
a stable latency saving. The combined startup and read-only implementation passes
local verification; its combined hosted latency has not been measured. Do not add
the gains from these separate comparisons. The **1–2 s target remains unmet**.

All thirteen original Worker versions were restored and verified. No Gateway
activation or new resource was required. [The evidence](evidence/r155b-prepared-root-admission-20261008.json)
records actual serving versions, exclusions, raw results, D1 counts, and E2E commands.
