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

### Combined startup and prepared-admission baseline — 2026-10-08

Three fresh NEAR-only wallets completed **21 verified signatures** with both changes
enabled. Yao execute measured **3.466 s median**, with a **2.276–3.802 s** range.
All captured Router, A, B, Signing Worker, and Gateway versions matched the candidate.
Each role reused its already-started wallet object. Each wallet used six bound-root
D1 round trips and sixteen statements. These counts exclude other stores.

Registration through the first verified signature measured **16.611 s median**,
with a **15.830–19.003 s** range. That boundary includes funding and provisioning.
Prepared and consecutive signatures each used four browser Gateway requests.
This three-wallet baseline has no concurrent control arm. It does not establish
a stable gain over earlier isolated comparisons. The two-second setup target remains unmet.

Signing Worker's package-delivery handler used **1–3 ms CPU**. Its complete request
took **124–637 ms**, and the wallet object's first required call took **113–135 ms**.
The large variation occurs around the object call. These measurements do not
isolate transport, scheduling, and placement individually. They do not support a
large expected saving from serialization changes.

All thirteen original Worker versions were restored and verified. Both tenant
activations passed. No resources or keepalive traffic were added.
[Sanitized evidence](evidence/r155b-combined-startup-admission-20261008.json) records
the timing boundaries, counts, actual serving versions, and limitations.

### Continuous Deriver A ceremony — rejected on 2026-10-08

The candidate combined A preparation and execution in one wallet-object request.
A started local preparation and B preparation in parallel. It verified both signed
readiness receipts before the existing durable execution claim. The candidate
passed five release builds, twelve local E2E scenarios, and the bloat check.

Nine fresh wallets completed **63 verified NEAR signatures** across three arms.
Every captured serving version matched. SDK assets, APAC hints, B, and Signing
Worker remained fixed. Only Router and A changed for the candidate arm.

| Arm | Fresh wallets | Median Yao execute HTTP | Observed range |
| --- | ---: | ---: | ---: |
| Combined baseline, before | 3 | **3.548 s** | 3.217–4.854 s |
| Continuous A ceremony | 3 | **3.379 s** | 3.208–3.986 s |
| Combined baseline, after | 3 | **3.354 s** | 2.788–3.802 s |

The candidate improved on the first control by 169 ms and exceeded the second by
25 ms. This does not establish a repeatable latency gain. The candidate was reverted.
Its source remains reproducible at public Wallet commit
`3cdcce98cc1316eb6f1a2f0cb93b5dbabc253c1f`. The two-second Yao setup target remains unmet.

All roles reused already-started wallet objects. Bound-root work stayed at six D1
round trips and sixteen statements per setup. Removing one A object entry left
that work intact and made B preparation depend on the initial A dispatch.

Signing Worker delivery medians were **572 / 553 / 529 ms** in arm order. Its first
object-work medians were **123 / 99 / 129 ms**. Package-handler CPU medians were
**5 / 2 / 3 ms**, with one 77 ms control outlier. The trace does not identify a
serialization fix for the larger delay around the object call. Overlapping clocks
do not permit an exact network-time subtraction.

Router finish-dispatch medians were **49 / 54 / 52 ms**. A larger gain from moving
coordinator placement remains unmeasured. This comparison does not justify another
coordinator rewrite or additional regional resources.

All thirteen original deployments were restored and verified. Initial activation
`37705691755` and restoration activation `37706751098` passed. No infrastructure
resources, production deployments, or npm releases were added.
[Sanitized evidence](evidence/r155b-continuous-ceremony-20261008.json) retains every
workload, request count, timing boundary, serving-version audit, build hash, and
E2E reproduction command. Raw data and frozen sources remain in local artifacts.

## Object-dispatch isolation — 2026-10-08

Warm no-op calls stayed fast across separate incoming requests. This disproves a
universal half-second penalty for the first object call in every request. Fresh
handles, APAC hints, and named lookups did not reproduce that penalty.

The experiment used six existing wallet objects and temporarily wrapped two
existing staging Workers. Three arms each sent 36 probe requests and 108 object
calls. All **324 calls** returned the expected object identity and counter. Each
object retained one instance per arm. Signing Worker probes passed through the
Router's existing service binding.

| Lookup | Warm first call: Router, reused / fresh | Warm first call: Signing Worker, reused / fresh |
| --- | ---: | ---: |
| Object ID | 56 / 56 ms | 55.5 / 57 ms |
| Object ID with APAC hint | 55.5 / 55 ms | 53.5 / 56 ms |
| Object name with APAC hint | 56.5 / 54 ms | 56 / 55 ms |

These are medians, with six reused-handle samples and nine fresh-handle samples
per cell. Warm first calls ranged from 51–67 ms. Later calls in each request had
medians of 51–56.5 ms. Each object's first probe cost 471–655 ms in the first arm
and 140–196 ms in the later arms. Existing routing caches may survive between
arms. These observations cannot separate routing and object reconstruction costs.

The no-op handlers performed no storage or protocol work. This experiment does
not establish a Yao speed improvement. The real setup still has longer dispatch
spans. The next targeted measurement must correlate startup, claim, and delivery
for the same wallet. Record payload sizes and response-header/body-read boundaries.
Observe actual execution locations separately from latency measurements.

All three local E2E runs passed. Hosted probes rejected missing credentials and
unknown objects. All captured versions matched, although object tails were
incomplete. Each arm restored and verified all thirteen original Worker versions.
The initial Python-client attempt received Cloudflare error 1010 before reaching
the Workers and also restored exact versions. The successful runs used browser
HTTP headers. No production code, infrastructure, or npm release changed.

Keep the existing lookup and placement implementation. These results do not
justify a global handle cache or another coordinator rewrite.
[Sanitized evidence](evidence/r155b-object-dispatch-probe-20261008.json) records
all samples, coverage limits, source hashes, local checks, and reproduction commands.

## 2026-10-08: verified root reuse and B start simplification

Wallet commit `c80586cdbe7e7bd8dc40658ee9fe045531b4f3ac` reuses an authenticated
root row within one request only when its fresh ciphertext and metadata match.
It removes duplicate receipt signature checks and repeated state parsing from B's
start path. Fresh cancellation, active-root uniqueness, revision checks, and
parallel A/B preparation remain enforced.

Five release builds and twelve local E2E scenarios passed. The added fault case
forges A's receipt during the WebSocket handoff. B refuses it before claiming the
pair. No protocol data is sent, and a fresh wallet can still complete afterward.

| NEAR-only Yao setup HTTP request | Median | Range |
| --- | ---: | ---: |
| Control before | 3.194 s | 2.295–4.238 s |
| Candidate | 3.584 s | 2.817–4.165 s |
| Control after | 4.171 s | 3.456–4.262 s |

Each arm completed three fresh wallets and verified 21 signatures. All captured
versions matched. All thirteen original staging versions were restored. The
restore activation passed in GitHub run `37714533805`.

Preparation DO CPU medians were **144 → 84 → 172 ms** for A and
**146 → 110 → 202 ms** for B. These are whole-invocation measurements. The candidate
reduced observed preparation CPU. The variable controls do not establish a
repeatable end-to-end setup improvement. The first control ran while the local
release build finished. The candidate and final control ran after local checks.

Signing Worker delivery carried about 5.5 KB and returned less than 0.9 KB. Median
wait for headers was 537 ms, and median body reading was 4 ms. The wait includes
processing and storage completion, as well as transport. Application clocks freeze
during CPU work, so zero-millisecond decode and B-start spans are not CPU measures.

Bound-root reads still require **six D1 calls / sixteen SQL statements per setup**.
This excludes root creation and other database work. Each role makes two calls
before preparation finishes and one before execution. The initial read verifies
the encrypted row before admission. The follow-up reads preserve cancellation and
uniqueness. The six-to-four proposal was not applied because it lacked an atomic,
verified admission guard. Actual execution locations remain unmeasured.

Retain the CPU reduction and simpler state path. The next candidate was a single
A connection while B preparation started independently. The earlier combined-call
experiment put B preparation behind the initial A dispatch. The following
experiment evaluates connection reuse. The 1–2 second setup target remains unmet.

[Sanitized evidence](evidence/r155b-bound-root-start-20261008.json) retains every
sample, build hashes, HTTP counts, bounded D1 counts, payload sizes, local checks,
serving-version audits, and restoration evidence.


## 2026-10-08: one A connection — rejected

The connection candidate did not establish an end-to-end improvement. It was
removed from `dev`. The retained implementation is the Phase 6M baseline.

| NEAR-only Yao setup HTTP request | Median | Range |
| --- | ---: | ---: |
| Baseline before | 4.136 s | 4.057–5.026 s |
| Candidate | 3.932 s | 3.445–3.987 s |
| Baseline after | 3.589 s | 3.043–3.934 s |

Each arm used three fresh wallets and verified 21 signatures. All five release
builds, the other Workers host check, and twelve local E2E scenarios passed before
hosted testing. The local placement test held A dispatch until B preparation
finished. It proved independent B dispatch in all four homes. Cancellation,
forged messages, concurrency, lost replies, root erasure, and relocation state
remained enforced.

The candidate removed one Router-to-A HTTP dispatch and one A Worker-to-object
dispatch. It preserved the logical preparation and start exchanges. The Router
still had to receive both readiness receipts before starting execution.
Bound-root work stayed at six D1 calls and sixteen statements per setup.
Browser request counts stayed at four per warm or consecutive signature, and
nine for unlock through the first verified signature.

A's execution-stage medians were 1,567 / 1,431 / 1,733 ms in arm order. Preparation
medians were 1,153 / 988 / 843 ms. Signing Worker delivery medians were
582 / 595 / 494 ms. Stage medians cannot be added to reconstruct whole latency.
These spans include processing and storage waits. They do not isolate network time.
The candidate's A invocation includes both preparation and execution, so its CPU
is not comparable to a baseline preparation invocation alone.

All captured versions matched. Every first required object call reused an
instance observed during startup. Physical execution locations remain unmeasured.
No resources were added. The 1–2 second setup target remains unmet.

Candidate: `9eab3375e10d33477ac793ce108c219efedecfce`. Removal:
`9d808eb233a5928b6c7728f9eeba63d7ea07d2f3`. The removal restores the exact previous
source tree. Avoid repeating this transport-only change without new evidence.

[Sanitized evidence](evidence/r155b-ceremony-connection-20261008.json) contains all
63 verified signature results, source and build hashes, HTTP and bounded D1
counts, version audits, local checks, limitations, and restoration evidence.

All thirteen original staging versions were restored. Tenant activation passed
in [run 37718977503](https://github.com/seams-tech/seams-monorepo/actions/runs/37718977503).

## 2026-10-08: target preparation overlap and runtime reuse

The implementation passed verification. The hosted comparison did not establish
a setup speedup. Its median exceeded both controls. The **1–2 second Yao setup
target remains unmet**.

Wallet commit `ff2c4aecb864bea39ea5b35615ba336b4733cdc7` removes repeated runtime
parsing within Signing Worker installation and B's command handlers. A now prepares
and encrypts its target proof while B connects. It sends the proof only after
acceptance verification and the durable execution claim. Fresh cancellation
reads, signed readiness checks, and relocation checks remain in place.

The target-proof exchange remains required. Putting A's proof in the opening
request would delay B's connection until the fresh root read and proof preparation
finish. The implemented overlap avoids that added dependency. It changes neither
the protocol exchange count nor the HTTP request count.

Five strict release builds, the other Workers host check, thirteen local E2Es,
and the exact-tree bloat check passed before hosted testing. The added E2E delays
B acceptance until A prepares its proof, then forges the acceptance signature.
A sends zero protocol messages. Both connections close and both pair states burn.
An exact retry does not restart execution. A separate wallet still completes.

| Complete Yao execute HTTP request | Median | Observed range |
| --- | ---: | ---: |
| Control before | **3.863 s** | 3.141–4.760 s |
| Candidate | **4.206 s** | 2.523–4.233 s |
| Control after | **3.728 s** | 2.653–4.290 s |

Each arm used three fresh NEAR-only wallets and verified twenty-one signatures.
The measurements exclude funding, NEAR provisioning, and the first signature.
A separate placement arm verified seven signatures for one additional wallet.
Its outbound probes affect latency, so its timings are excluded from comparison.

In arm order, A execution-stage medians were **2,021 / 1,656 / 1,784 ms**.
Signing Worker delivery medians were **581 / 539 / 606 ms**. B connection medians
were **744 / 755 / 386 ms**. The shorter candidate stage does not establish a
complete setup gain. Stage medians describe different requests and cannot be added.
Application clocks freeze during CPU work. Provider CPU covers whole invocations.
Even unchanged A preparation code showed CPU variation across these arms.

Bound-root loading remains **six D1 calls and sixteen SQL statements per setup**.
This excludes other D1 operations and local DO SQL. Warm and consecutive signing
each use four Gateway requests. Unlock through the first verified signature uses
nine. Registration through the first signature uses fourteen or fifteen requests.
The difference is one session-status poll. Candidate samples use five polls.
Control samples use four or five. All workload timings remain in the evidence.

Cloudflare analytics located all **40 matched wallet object IDs in HKG**. These
cover A, B, the Signing Worker, and the Router across all ten wallets. For critical
Worker requests, 51 of 60 matching second-level buckets resolved to HKG. Nine
were unavailable. The buckets also match script version. Adaptive sampling and
bucket granularity limit request-level conclusions. Other registration and
management calls appeared in FRA in the broader windows.

Separate read-only D1 queries reported the following primary locations:

| Database | Region | Site code |
| --- | --- | --- |
| Deriver A private D1 | APAC | KIX |
| Deriver B private D1 | APAC | SIN |
| Signing Worker private D1 | APAC | ICN |

Replication was disabled for all three. These snapshots preceded the benchmark.
They are not location traces for every setup query. Cloudflare defines
`served_by_colo` as the site that handled the query. A shared APAC label does not
establish same-site D1 placement.
[D1 metadata definition](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/raw/).

Retain the simpler runtime handling and verified overlap without claiming a
hosted speedup. All 70 signatures verified, and all captured serving versions
matched. All thirteen original staging versions were restored. Activation passed
in [run 37724107697](https://github.com/seams-tech/seams-monorepo/actions/runs/37724107697).
No new resources, production deployment, or npm release was required.

[Sanitized evidence](evidence/r155b-overlapped-target-20261008.json) contains source
and build hashes, individual samples, request counts, local checks, placement
correlations, version audits, limitations, and restoration evidence.

## 2026-10-08: initialize role storage during wallet startup

The startup correction is implemented and verified. Its hosted median was
**3.679 s**. The sample does not establish a repeatable setup gain. The **1–2 second
Yao setup target remains unmet**.

Wallet commit `b517d64d35716b8c1153648528ab88b42128b06b` initializes A, B, and
Signing Worker tables during their existing startup calls. Previously, startup
returned before table creation. Normal commands keep their initialization path
when startup never ran. This adds no table, flag, authority record, or cache.

Five strict release builds, the other Workers host check, thirteen local E2Es,
and the exact-tree bloat check passed. The four-home E2E verifies empty storage
after startup: five tables for A, five for B, and twenty-four for the Signing
Worker. All contain zero rows. Concurrent execution, lost replies, forged receipts,
and replay checks pass. The same check fails against old binaries because startup
leaves all three stores uninitialized. Hosted builds contain no inspection wrapper.

| Yao execute HTTP request | Successful wallets / attempts | Median | Range |
| --- | ---: | ---: | ---: |
| Control before | 3 / 3 | **3.908 s** | 3.871–4.881 s |
| Candidate | 3 / 3 | **3.679 s** | 3.065–4.161 s |
| Control after | 2 / 3 | **4.428 s** | 4.324–4.532 s |

Setup excludes funding, NEAR provisioning, and the first signature. The failed
control lost its D1 connection while A loaded its bound role share. The Gateway
returned a retryable HTTP 503, and the browser surfaced it. This infrastructure
failure occurred on the baseline. The evidence retains the attempt. The final
control timings include only its two completed wallets.

The candidate median was 229 ms below the first control. Startup medians were
850 / 1,117 ms, and Signing Worker delivery medians were 519 / 444 ms.
These small samples do not establish a repeatable saving. Stage medians cannot be
added. Application clocks freeze during CPU work, and provider CPU spans whole
invocations. The final control's server-stage statistics include its failed attempt.

Bound-root work remains six D1 calls and sixteen SQL statements per successful
setup. Other D1 work and local DO SQL are excluded. Warm and consecutive signing
still use four Gateway requests each. Unlock through the first signature uses
nine. Registration through the first signature uses fourteen or fifteen.
Admission, cancellation, execution claims, and relocation checks remain in place.

Eight of nine attempted wallets completed, and **56 signatures verified**.
All three candidate wallets passed. All captured serving versions matched.
All thirteen original staging versions were restored. Activation passed in
[run 37727820202](https://github.com/seams-tech/seams-monorepo/actions/runs/37727820202).
The final version audit passed after refreshing the local Cloudflare login.
An optional replacement control was cancelled before any live change because new
unfinished registration records remained after restoration. Those records were
preserved. No extra resources, production deployment, or npm release was required.

Retain the small startup correction without claiming a hosted speedup. Next,
evaluate repeated session-status reads and sequential D1 waits under the existing
admission rules. Actual Worker, DO, and D1 placement was not remeasured in this run.
The preceding placement evidence remains the available source.

[Sanitized evidence](evidence/r155b-storage-startup-20261008.json) records all
attempts, the failure and cancelled retry, local checks, build hashes, HTTP and
bounded D1 counts, serving versions, and restoration.

## 2026-10-08: remove redundant NEAR signing status reads

Repeated NEAR signing now uses **three Gateway calls instead of four**. Lane
discovery uses the SDK's existing session observation. Prepare still checks live
authority and quota before the client creates its signature share. Missing or
mismatched observations require a fresh status read. Export retains its exact
authorization reader. No backend code changed.

The comparison completed **63 verified signatures across nine fresh wallets**.
It served baseline/candidate/baseline SDK assets only to the test browser. Each
arm used three wallets against the same staging backend. All thirteen Worker
versions stayed unchanged, and every captured serving version matched. No
deployment, activation, new resource, or npm publication occurred.

| SDK signing, per signature | Control before: median (range) | Candidate: median (range) | Control after: median (range) |
| --- | --- | --- | --- |
| Warm, 6 signatures per arm | 3.165 s (2.473–4.022) | **2.423 s (1.963–2.901)** | 3.132 s (2.338–3.595) |
| Three-signature sequences, 9 signatures per arm | 2.189 s (1.487–2.457) | **2.130 s (1.399–2.693)** | 2.168 s (1.604–2.815) |
| Both repeated workloads, 15 signatures per arm | 2.355 s (1.487–4.022) | **2.195 s (1.399–2.901)** | 2.384 s (1.604–3.595) |

SDK timing includes automated confirmation and required nonce/RPC work. It ends
at signed output, before blockchain submission or confirmation. It excludes the
browser harness's later verification overhead. Sequence timings measure each
signature, rather than the sum of all three.

The isolated authorization probe fell from **199.8 / 198.1 ms** in the controls
to **3.5 ms** in the candidate. The removed HTTP request measured **195.1 / 192.2 ms**.
Every repeated candidate signature used owner lane, prepare, and finalize, with
zero status calls. Other requests and confirmation varied across the arms.
The sample establishes the request reduction. It does not establish a guaranteed
whole-flow saving or percentile.

Registration through verified signature measured **19.122 / 20.685 / 20.523 s**
median across the three arms. Candidate range was **20.659–22.230 s**. Unlock
through verified signature measured **5.710 / 5.006 / 5.717 s**, with a candidate
range of **5.000–5.704 s**. These lifecycle values include browser automation.
Registration also includes funding, provisioning, and Yao setup. This change does
not optimize those stages, and the **1–2 second Yao setup target remains unmet**.

Candidate registration used thirteen Gateway calls, compared with fourteen or
fifteen in the controls. Unlock used eight, compared with nine. Lifecycle counts
include background requests that overlap their windows. D1 and Gateway-to-Console
counts were unavailable. Browser-to-Console requests were zero.

Both SDK builds, Wallet and intended-test type checks, two local browser E2Es,
and the exact-tree bloat check passed. The E2Es preserve quota step-up, fresh
reads after reload, and rejection of changed prepare authority before finalize.
Both valid transaction and message signing passed after that rejection. Review
found no additional issue in the changed path.

The next candidates are the repeated owner-lane request (**167 ms median**),
nonce-lease recovery (**0 ms median, 345 ms maximum wait**), and prepare/finalize
server work (**427 / 519 ms median**). Each change must retain identity, placement,
admission, revocation, concurrent-tab safety, and recovery checks.

[Sanitized evidence](evidence/r155b-signing-observation-20261008.json) preserves
all samples, request counts, build hashes, local evidence, and version audits.

## 2026-10-08: remove the separate NEAR owner-lane preflight

The SDK retains its exact local material and sealed-authority checks. Prepare
and finalize retain live authority, active material, policy, and operation admission.
The unused NEAR projection hydration and endpoint branch were removed. ECDSA
keeps its existing preflight. This change adds no cache or invalidation policy.

Repeated NEAR signing now makes **two Gateway POST requests: prepare and finalize**.
Both controls made three. All **63 signatures verified across nine fresh wallets**.
Each arm used three wallets and loaded only the NEAR signer. All thirteen staging
Worker versions stayed unchanged. Every captured serving version matched.

| SDK signing, per signature | Control before: median (range) | Candidate: median (range) | Control after: median (range) |
| --- | --- | --- | --- |
| Warm, 6 signatures per arm | 2.698 s (2.396–3.270) | **2.626 s (1.960–3.102)** | 2.824 s (1.796–3.500) |
| Three-signature sequences, 9 signatures per arm | 2.145 s (1.613–2.448) | **1.829 s (1.328–2.367)** | 2.321 s (1.700–3.010) |
| Both repeated workloads, 15 signatures per arm | 2.357 s (1.613–3.270) | **2.063 s (1.328–3.102)** | 2.417 s (1.700–3.500) |

SDK timing includes automated confirmation and required nonce/RPC work. It ends
at signed output, before blockchain submission or confirmation. The table excludes
the harness's later verification overhead. Each range ends at the observed maximum.

The lane-preparation stage fell from **214.4 / 206.0 ms** in the controls to
**3.5 ms**, with a candidate maximum of **7.6 ms**. The removed HTTP request
accounts for most of that stage. Combined signing medians fell by **12.5–14.6%**.
These sequential samples establish the request reduction and observed timings.
They do not establish a percentile or guaranteed whole-flow saving.

Candidate prepare and finalize measured **507.0 / 530.1 ms median**, with maxima
of **1,128.7 / 1,032.2 ms**. Prepare, client share creation, and finalize together
measured **1.178 s median**, range **0.929–1.955 s**. Approval through signed output
measured **1.305 s median**, range **0.931–1.957 s**. Durable nonce-lease recovery
wait remained **0 ms median**, with a **339.1 ms maximum**. Material-resolution
wait was at most **0.1 ms**. Stage medians must not be added.

Candidate registration through verified signature measured **19.289 s median**,
range **19.155–21.418 s**. Unlock through verified signature measured **5.728 s**,
range **5.028–5.752 s**. These lifecycle values include browser automation.
Registration also includes funding, provisioning, and Yao setup. Registration used
thirteen Gateway calls. Unlock used seven, compared with eight in both controls.
Lifecycle counts include overlapping background requests. D1 and Gateway-to-Console
counts were unavailable. Browser-to-Console requests were zero.

Four local browser scenarios passed with the matching candidate SDK and Gateway.
They verify quota step-up, reload, changed prepare authority, session retirement,
fresh unlock, transaction/message signing, and the retained ECDSA path across a
lost add-signer finalize reply. Retirement returned HTTP 401 and caused zero
finalize requests. Step-up using the retired credential also failed. Fresh unlock
then produced a verified signature. Wallet, server, and intended-test type checks
passed. Review found no additional issue in the changed production path.

The composed regional budget test completed NEAR step-up, then timed out during
ECDSA confirmation. Two candidate runs and the unchanged baseline reproduce that
failure. It remains an independent verification limitation. The retired NEAR
preflight assertion was removed from that test. No production behavior was changed
to accommodate the timeout.

The hosted comparison changed only browser SDK assets. The Gateway endpoint
removal was verified locally. No deployment, activation, new resource, or package
publication occurred. Yao setup and its unmet **1–2 second target** are unchanged.

Next, trace the remaining prepare/finalize storage and transport waits. Then
investigate nonce-lease recovery outliers while retaining concurrent-tab and
reload safety. Recovery already overlaps confirmation, so additional overlap
alone would not address that wait.

[Sanitized evidence](evidence/r155b-direct-prepare-20261008.json) preserves the
samples, request counts, build hashes, retirement result, version audits, and
baseline-reproduced regional failure.

## Phase 6S — NEAR nonce recovery, 2026-10-08

Recovery repeated the same access-key RPC for each saved nonce reservation.
The SDK now shares one fresh observation per exact wallet/key lane within a
recovery pass. Later passes query again. Failed reads retain unexpired reservations.
Lane locks, expiry, and EVM behavior remain unchanged. Commit: `fa0648d8` on public `dev`.

Baseline/candidate/baseline testing verified **63 signatures across nine fresh
NEAR-only wallets**. Thirteen staging Worker versions stayed unchanged. All captured
serving versions matched. No deployment or live infrastructure changed.

| SDK signing, per signature | Control before: median (range) | Candidate: median (range) | Control after: median (range) |
| --- | --- | --- | --- |
| Warm, 6 signatures per arm | 2.384 s (2.134–3.609) | **2.385 s (1.704–2.635)** | 1.885 s (1.702–2.331) |
| Three-signature sequences, 9 signatures per arm | 1.676 s (1.217–2.790) | **1.636 s (1.280–2.480)** | 1.819 s (1.598–2.516) |
| Combined, 15 signatures per arm | 2.249 s (1.217–3.609) | **1.829 s (1.280–2.635)** | 1.885 s (1.598–2.516) |

The candidate made **28 NEAR access-key RPC calls** over fifteen repeated signatures;
each control made **33**. Third signatures used **two calls instead of three**.
Maximum recovery wait after confirmation was **0 ms**, versus **353.8 / 330.8 ms**
in the controls. All arms had a zero median recovery wait. Two Gateway POST calls
per repeated signature remain: prepare and finalize.

The request reduction is confirmed. A consistent warm-signing latency gain is
unproven: the candidate matched the first control and was slower than the last.
These small sequential samples include network and confirmation variation.
SDK timings include automated confirmation and nonce/RPC work. They exclude
blockchain submission, confirmation, and the harness's later signature verification.

Candidate prepare/finalize medians were **432.2 / 692.5 ms**; maxima were
**952.5 / 976.2 ms**. The three MPC stages together measured **1.204 s median**,
range **0.782–1.902 s**. Approval through signed output was **1.207 s median**,
range **0.787–1.905 s**. Registration through verified signature was **20.583 s**,
range **18.273–23.096 s**; unlock was **4.921 s**, range **4.230–5.746 s**.
Lifecycle times include automation. Registration includes funding and provisioning.
No Yao setup gain is claimed. Its 1–2 second target remains unmet.

D1 and Gateway-to-Console counts were unavailable; browser-to-Console calls were
zero. Only the NEAR signer loaded. A local browser scenario verified nonces 2, 3, 4
through a failed RPC and reload within one unlocked session. Type checks and the
implementation bloat check passed. Concurrent tabs were not newly tested.
The existing lock path clears durable nonce reservations; that lifecycle behavior
is outside this optimization. The prior ECDSA confirmation timeout also remains.

Next: remove finalize's duplicate authorized-operation read while retaining live
authority and transactional checks. Then evaluate sharing the fresh recovery
observation with transaction-context acquisition. Both require new measurements.

[Sanitized evidence](evidence/r155b-nonce-recovery-20261008.json) contains all samples,
request counts, waits, build hashes, local verification, and version audits.
The public `docs/refactor-155B.md` Phase 6S records the complete implementation result.

## Phase 6T — NEAR finalize operation read, 2026-10-08

The Gateway now uses one standalone lookup for a reusable session's prepared
operation before transactional revalidation.
The old path read it by ID, then read it again by fingerprint. The remaining ID
lookup checks identity, fingerprint, operation kind and all digests. Fresh
transactional admission still checks active authority, material, replay and quota.
The obsolete lookup helper and its inputs were deleted. The unchanged transactional
revalidation moved to a focused module; the main route is now below 2,000 lines.
Implementation: `a3a2bd2c` on public `dev`.

This removes **one D1 batch per normal reusable-session finalize**. In the hosted
Gateway, that batch contains the deployment-writer check and the operation SELECT.
This is a source-level count. Hosted D1 counters remain unavailable. Prepare and
step-up behavior remain unchanged. Browser signing still uses **two Gateway POSTs**.

The baseline/candidate comparison verified **42 signatures across six
fresh NEAR-only wallets**. One frozen SDK, private Gateway source, and custody/runtime
versions served all arms. Only the existing APAC Gateway deployment changed.
All thirteen original Worker versions and tenant activation were restored afterward.
No resource, migration, keepalive or package release was added.

| Workload / stage | Baseline before: median (range) | Candidate: median (range) |
| --- | --- | --- |
| Warm, 6 per arm | 2.567 s (1.944–3.654) | 2.200 s (1.559–2.979) |
| Three-signature sequences, 9 per arm | 1.585 s (1.284–2.095) | 1.700 s (1.208–2.088) |
| Combined, 15 per arm | 1.603 s (1.284–3.654) | 1.974 s (1.208–2.979) |
| Prepare stage, 15 per arm | 0.443 s (0.375–1.099) | 0.556 s (0.376–1.123) |
| Finalize stage, 15 per arm | 0.514 s (0.409–1.326) | 0.477 s (0.398–0.904) |
| Prepare + client share + finalize, 15 per arm | 0.966 s (0.849–2.244) | 1.045 s (0.836–2.030) |

SDK signing includes automated confirmation and nonce/RPC work. It excludes
blockchain submission and confirmation. Protocol stage timings use the existing
SDK events; stage medians must not be added. The range includes each maximum.
These sequential samples do not establish a percentile or a guaranteed latency gain.

Candidate registration through independently verified signature measured
**22.739 s (22.046–23.669)**. Unlock through verified signature measured **5.102 s (4.981–5.723)**.
Those lifecycle timings include automation; registration also includes funding
and account provisioning. This change does not optimize Yao setup. Its two-second
setup target remains unmet.

Four local browser scenarios passed. They cover transaction/message signing,
reload, changed prepare authority, budget exhaustion, fresh unlock, missing and
altered receipts, and session retirement. The lost-reply scenario discarded a
successful finalize reply, then verified the exact retry at zero remaining uses.
It retained one operation claim and one audit event. A later retry after retirement
returned HTTP 401. Missing and altered receipts returned 409 and 400. The final
scenario passed again after a test-adapter type correction. Server builds,
intended-test type checking, and the exact implementation bloat check passed.

The first candidate activation failed with `readiness_invalid`. One unfinished
US registration, stored in two records, existed before the benchmark started.
The admitted baseline was restored while those records expired normally.
Activation then passed. The failed activation supplied no candidate samples.
A later unfinished US registration blocked the next activation window. The return-baseline
arm was omitted. These interruptions and the missing return baseline limit latency
attribution. Finalize improved by 37.3 ms at the median (7.3%), while full SDK signing
did not improve consistently. This establishes a smaller request path, with no
guaranteed whole-flow latency improvement.
Browser-to-Console calls were zero. Backend Console and D1 counters remain unknown.
The separate ECDSA confirmation timeout recorded in Phase 6R remains outside this change.

Next candidates:

1. Share a fresh access-key observation between nonce recovery and transaction
   preparation for the exact wallet/key lane. Keep chain freshness, reload and
   nonce-reservation checks. Measure any removed RPC separately.
2. Profile remaining session/material queries in prepare and finalize. Combine
   queries only where one database batch preserves the existing deployment,
   authorization and material checks. No further latency saving is assumed.

[Sanitized evidence](evidence/r155b-finalize-read-20261008.json).

## Phase 6U — implicit registration and first signature, 2026-10-08

**Registration remains above the required 3–4 seconds. Yao setup remains above
1–2 seconds.** These tests already use implicit accounts derived from the Ed25519
public key. The `near-provisioning` request installs wallet authority, signer
records, recovery material and a session. Its latency does not represent named
NEAR account creation.

The Gateway now reads a fresh finalization's ceremony twice instead of five times.
The operation executor passes its fresh record through the remaining steps.
Expiry, live identity reads, setup verification, operation receipts and database
commit checks remain. This count excludes other records and deployment checks.
No cross-request cache was added. Public implementation: `e62c1513` on `dev`.

The combined candidate includes all accepted custody changes through Phase 6P.
Earlier experiments restored the original custody deployments between runs.
The comparison therefore measures the combined changes. It does not isolate the
three removed reads. Both arms use the same NEAR-only SDK.

Across **six fresh candidate wallets**, SDK registration measured **10.409 s median**,
range **8.873–11.017 s**. Yao execute measured **4.530 s**, range **3.038–4.836 s**.
Server finalization measured **2.510 s**, range **1.936–3.593 s**. Registration is
identical before the two cohorts perform their different first-signing operations.

| Measurement, three wallets per arm | Restored control: median (range) | Combined candidate: median (range) |
| --- | --- | --- |
| SDK registration | 12.769 s (12.679–15.895) | 10.422 s (8.873–11.017) |
| Yao execute HTTP | 5.852 s (5.663–6.339) | 3.304 s (3.038–4.836) |
| Server finalization HTTP | 2.932 s (2.569–3.140) | 2.684 s (2.277–3.593) |
| Registration through first verified message | 16.041 s (15.271–19.185) | 13.181 s (12.079–14.497) |

The new message workload verifies an SDK Ed25519 signature independently and rejects an
altered message. It asserts a 64-character implicit account ID, NEAR-only assets,
and no funding request. Background access-key reads can still occur. This workload
cannot serve as a direct comparison with the earlier funded transaction totals.

The original funded transaction workload used three further candidate wallets.
Registration through the first verified transaction measured **18.619 s median**,
range **18.363–18.972 s**. Funding measured **3.772 s**, range **2.800–3.847 s**.
Yao execute measured **4.539 s**, range **4.522–4.744 s**. The first signature's
prepare, client share and finalize stages together measured **1.355 s**,
range **1.336–1.831 s**. Browser lifecycle timings include automation and UI settlement.

Yao still incurs substantial work around the protocol. Median A/B preparation
measured **573 / 1,075 ms** in the message and transaction cohorts. B connection
measured **804 / 984 ms**. A protocol spans measured **512 / 503 ms** and B protocol
spans measured **571 / 801 ms**. Final package delivery measured **112 / 531 ms**.
Application clocks can freeze during CPU work. Provider CPU covers whole invocations.
Stage medians must not be added. Gateway-wide D1 counts and backend Console counts
remain unknown. APAC home hints do not establish physical colocation.

Six relevant local browser scenarios passed, including loss/retry, refresh, quota,
deferred finalization, and ECDSA/mixed activation recovery. A local lost-reply wrapper
bypassed the home-aware binding. The unchanged baseline failed identically.
Public commit `3b1a169b` fixes that fixture. An additional terminal-burn scenario
requires a fault hook absent from the selected release build. Its classification
is `environment_or_infrastructure_failure`. Server builds and exact-tree bloat checks passed.

The hosted run verified **27 signatures across nine fresh wallets**. All three
serving-version audits passed. All thirteen original staging Worker versions were
restored, followed by successful tenant activation in run `37749204515`. No additional
resource, production deployment or npm release occurred. Fresh wallets do not prove
cold Worker/DO starts. These samples do not establish percentile or maximum guarantees.

The next structural cuts are pure-NEAR activation/finalization consolidation,
passkey response/admission consolidation, and reduced role preparation/B connection
delay. Preserve identity, recovery, session, home, replay and role-isolation checks.
These changes remain unimplemented. The public plan's Phase 6U records their scope.

[Sanitized registration evidence](evidence/r155b-near-registration-critical-path-20261008.json)
contains all samples, available request counts, protocol spans, source hashes,
verification limits and restoration evidence.

### Phase 6V hosted result — 2026-10-08

NEAR-only registration now makes **four registration requests instead of six**.
It receives Yao admission with the authenticated response and commits the wallet,
signer, custody and session through one finalization. The removed activation had
created a signerless pending wallet before the same flow finalized it. Its request,
receipt and checkpoint variants are deleted. ECDSA and mixed activation remain.
Implementation: public `dev` commit `dadf80a2` (507 net production lines removed).

Three fresh implicit wallets ran per arm on existing staging testnet resources.
Both arms used the same custody Worker versions. The baseline used the preceding
SDK/Gateway pair. The candidate used the matching new pair. Each wallet produced
an independently verified SDK Ed25519 message signature. Both arms loaded only the
NEAR signer and excluded funding and named-account creation.

| Metric | Matched baseline median (range) | Candidate median (range) |
| --- | --- | --- |
| SDK registration | **10.175s** (9.749–13.957s) | **9.788s** (9.123–11.918s) |
| Registration → first verified message | **12.958s** (12.150–16.911s) | **12.882s** (12.021–14.474s) |
| Yao execute HTTP request | **3.758s** (3.408–4.987s) | **4.237s** (3.866–4.491s) |
| Authenticated response + Yao admission/execution HTTP | **5.188s** (4.787–7.047s) | **5.457s** (4.843–5.549s) |
| Wallet activation + finalization HTTP | **3.552s** (3.523–4.615s) | **2.898s** (2.870–4.099s) |
| Registration protocol requests | **6** | **4** |
| All observed Gateway requests through first signature | **11** | **9** (9–10) |

The combined wallet-commit median fell **18.4%**, or **654ms**. SDK registration
fell **3.8%**, or **387ms**. Registration-to-first-signature changed by only **76ms**.
These samples establish no material first-signature improvement and no Yao speedup.
The **3–4s registration-to-signature** and **1–2s Yao** targets remain unmet.

The largest changed protocol span was A's WebSocket connection to B:
**345ms → 809ms** median. A's reported protocol span stayed similar at
**419ms → 401ms**. A's complete execution invocation used **752ms → 529ms** median
provider CPU. These clocks measure different boundaries. The changed connection
span identifies a remaining delay, but three sequential samples cannot establish
its cause or attribute it to the SDK/Gateway change. Actual colocation was not
remeasured. Existing APAC home hints remained.

The table combines related HTTP durations **within each sample** before computing
medians. This prevents the admission move into `respond`, or the wallet projection
move into finalization, from appearing as an artificial saving. Browser totals
include automation and UI settlement. Fresh wallets do not establish cold Workers
or Durable Objects. Gateway-wide D1 and backend Console call counts remain unknown.

Nine local browser checks passed, including both authentication methods, admission
replay, credential-free finalization replay, lost-reply recovery after reload,
verified signing, quota enforcement, and ECDSA/mixed activation recovery. Type
checks and the exact-tree bloat check passed. The lost-reply check validates the
same persisted wallet commit across retries and verifies a fresh unlock before
signing. Temporary session-seal data is deliberately absent from that recovery
request. Both hosted serving-version audits passed. Six hosted signatures verified.

All thirteen original Worker versions were restored. Normal tenant activation
succeeded in run `37759708600`. No new resources, production deployment
or package release occurred. Raw artifacts remain in `.artifacts/r155b-phase6v`
(public) and `.artifacts/r155b-phase6v-hosted` (private).

[Sanitized samples, signature proofs and deployment audits](evidence/r155b-near-registration-joined-commit-20261008.json).

## Registration identity query comparison — 2026-10-08

Implementation: `8c4a7d546f3a52d7b0de4796614bdea3ec73f6a7` on `dev`.

Registration session issuance previously read the authentication method, read its
authority, then read the same authority again. The new query joins the exact method
and authority within their namespace, organization, project, environment and wallet.
It preserves credential checks, active-state checks and canonical authority-digest
verification. The session insertion still checks active method and authority state
in its transaction. The obsolete authority-only wrapper is removed.

- [x] Replace the sequential identity reads with one coherent SQL query.
- [x] Keep the earliest matching method selection. A revoked method cannot fall
  through to a later matching method or another wallet.
- [x] Retain fresh reads at each registration stage. Add no authorization cache.
- [x] Pass nine local browser scenarios: both authentication methods, NEAR signing,
  admission and finalization replay, lost-response recovery, quota enforcement,
  and ECDSA/mixed activation recovery.
- [x] Pass the server build, TypeScript checks and exact-tree bloat check.
- [x] Compare three fresh implicit wallets per hosted arm with one SDK, harness,
  private Gateway source, and custody cohort. Change only the Gateway identity read.
- [x] Audit serving versions, verify signatures, restore staging and record results.

The bounded source-level reduction is **three D1 reads to one** during registration
session issuance and mixed continuation identity lookup. Other callers of the
identity reader use one joined read instead of up to two sequential reads. This
does not describe total registration D1 calls or promise an end-to-end saving.

The A-to-B connection still includes B's durable execution claim and signed
acceptance. Earlier connection-reuse experiments did not establish a repeatable
setup improvement. This change preserves that protocol and its trust boundaries.
The registration and Yao targets remain unmet until hosted evidence establishes them.

### Phase 6W hosted result — 2026-10-08

The joined query removes database work, but this comparison establishes **no
finalization speedup**. Its median increased by **293ms (12.4%)**. Keep the single
coherent identity read for its smaller database workload and consistent snapshot.
Do not claim that it produced the observed decrease in total registration time.

Three fresh implicit wallets ran per arm. The SDK, browser harness, private
Gateway source, and custody Worker versions stayed fixed. Only the Gateway's
registration identity query changed. Each wallet produced one independently
verified SDK Ed25519 message. Funding and named-account provisioning were absent.

| Measurement | Baseline median (range) | Candidate median (range) |
| --- | ---: | ---: |
| SDK registration | 9.385s (8.151–10.808s) | 8.972s (7.824–9.130s) |
| Browser registration | 9.949s (8.402–11.619s) | 9.339s (8.475–9.985s) |
| Registration → verified message | 12.946s (9.852–14.648s) | 11.545s (11.451–12.208s) |
| Yao execute HTTP, unchanged custody code | 4.169s (3.784–4.540s) | 3.176s (2.825–4.127s) |
| Finalization HTTP | 2.364s (2.123–3.264s) | 2.657s (2.570–3.193s) |
| Registration protocol requests | 4 | 4 |
| All Gateway requests through first message | 9 | 9 (9–10) |

The measured finalization side-effect span increased from **1.261s to 1.738s**.
That span includes persistence and session issuance. It does not isolate the joined
query. A's connection to B measured **757ms → 735ms** median. No custody code
changed, so the faster complete Yao sample is not an effect established by this
query optimization. No protocol exchange or Worker dispatch was removed.

The source-level reduction applies specifically to the registration identity
lookup. Gateway-wide D1 and backend Console counts remain unavailable. Local query
plans confirm existing indexes serve both joins. No migration or index was added.
Application clocks omit some CPU work. These three sequential samples per arm
establish neither a percentile nor a guaranteed maximum. Browser totals include
automation and UI settlement. Physical colocation was not remeasured.

All nine local browser scenarios passed, along with TypeScript, server build and
bloat checks. The frozen copy initially lacked unchanged generated WASM packages.
Those environment failures were resolved by copying the matching build artifacts.
No production repair was needed. Both hosted serving-version audits passed.
The **3–4 second registration target and 1–2 second Yao target remain unmet**.

All thirteen original Worker versions were restored and verified. Tenant activation
passed in run `37765469066`. No new resources, production deployment or package
release occurred. Raw artifacts remain in `.artifacts/r155b-phase6w` (public) and
`.artifacts/r155b-phase6w-hosted` (private).

[Sanitized samples, query plans and deployment audits](evidence/r155b-near-registration-joined-identity-20261008.json).

## Session commit and readback comparison — 2026-10-08

Implementation: `40120cddf020e65f823875eed2a1450d18572907` on `dev`.

Direct Wallet Session creation previously sent a six-statement write batch, then
made a separate request to read the exact committed session. The candidate appends
that read to the same batch. Both ordinary mint reads and transaction readback use
one query builder and one row parser. The parser still checks the stored columns,
capability subjects, exact wallet identity and credential digest.

The bounded source-level change is **two D1 calls to one** for session commit and
readback. Both versions execute seven SQL statements. This saves a network round
trip; it does not remove a persistence check or reduce the number of browser calls.
Active authority and method checks remain inside the write transaction. Quota and
session changes must agree. Strict and replayable issuance retain their existing
identity, credential and retry rules. No cache, migration or new resource was added.

- [x] Append exact mint readback to the existing direct-issuance batch.
- [x] Reuse the query and row parser; remove the separate post-commit request.
- [x] Keep the six-statement builder used by linked-device installation unchanged.
- [x] Pass nine browser scenarios covering lost replies, reload recovery, NEAR
  signing, quota exhaustion, Email OTP and ECDSA/mixed registration.
- [x] Pass the server build, intended TypeScript and exact-tree bloat check.
- [x] Compare three fresh implicit wallets per arm on staging.
- [x] Audit serving versions, restore staging, and record measured results.

### Phase 6X hosted result — 2026-10-08

The saved D1 round trip produced **no measured finalization speedup** in this
comparison. Finalization changed by **+11.9ms (0.45%)**. Its internal side-effect
span changed from **1.647s to 1.640s**. Keep the single D1 request and transactional
readback, without claiming a latency gain from this change.

Three fresh implicit wallets ran per arm. One SDK and browser harness served both
arms. Private Gateway source and all four custody Worker versions stayed fixed.
Only the Gateway session-commit implementation changed. All six wallets produced
independently verified SDK Ed25519 messages. Funding and named-account provisioning
were absent.

| Measurement | Baseline median (range) | Candidate median (range) |
| --- | ---: | ---: |
| SDK registration | 9.232s (8.279–12.245s) | 8.912s (8.506–9.539s) |
| Browser registration | 10.028s (8.486–12.457s) | 9.235s (9.171–10.176s) |
| Registration → verified message | 13.018s (11.495–14.706s) | 12.207s (11.377–13.182s) |
| Yao execute HTTP, unchanged custody code | 4.428s (3.433–5.166s) | 4.048s (3.584–4.127s) |
| Finalization HTTP | 2.649s (2.380–3.704s) | 2.661s (2.531–2.963s) |
| Registration protocol requests | 4 | 4 |
| All Gateway requests through first message | 10 (9–10) | 9 (9–10) |

The total median decreased by **811ms**, while unchanged Yao execution also ran
faster. These sequential samples cannot attribute the total decrease to batching.
No browser request was removed. The varying total request count includes the
surrounding browser flow; registration uses four requests in every sample.
The **3–4 second registration target and 1–2 second Yao target remain unmet**.

All nine local browser scenarios passed. The server build, intended TypeScript and
exact-tree bloat check passed. Both hosted serving-version audits matched all five
participating Worker versions. The row parser still rejects disagreement between
persisted columns, the serialized session, its capability subjects and the caller's
identity. The linked-device six-statement transaction builder is unchanged.

The remaining dominant measured work is custody setup and finalization persistence.
In the baseline, the Router's parallel A/B preparation span measured **899ms** median,
and its A execution call measured **1.779s**. These nested spans must not be added to
end-to-end stage medians. A smaller session-write request count alone has not met
the registration target.

Three samples per arm establish neither percentiles nor a maximum guarantee.
Browser totals include automation and UI settlement. Fresh wallets do not prove
cold Workers or Durable Objects. Application clocks omit some CPU work. Gateway-wide
D1 and backend Console counts remain unknown. Physical colocation was not remeasured.

All thirteen original Worker versions were restored and compared with the saved
versions. Tenant activation passed in run `37770282730`. No new
resources, production deployment or package release occurred.

Raw artifacts remain in `.artifacts/r155b-phase6x` (public) and
`.artifacts/r155b-phase6x-hosted` (private).

[Sanitized samples, signature proofs and deployment audits](evidence/r155b-near-registration-batched-session-20261008.json).

## Parallel registration finalization — 2026-10-08

Implementation: `2924ad8099bea46b1b033ca6754aa630f3d9559e` on `dev`.

Finalization awaited several database and service operations in sequence. The
candidate reads founding authority and authentication-method records in one D1
batch, while the global passkey credential claim runs. Once the wallet and signer
records commit, capability installation runs alongside custody-envelope storage.
Both operations settle before the result is returned or retried. Custody and
recovery data still have to be durable before the SDK reports successful setup.

The founding-record preflight uses **one D1 request instead of two**, with two SQL
statements in both versions. Credential uniqueness, active authority checks,
fixed-home fencing, commit receipts and exact replay checks remain. Detailed
measurements use `Server-Timing`; persisted receipt and SDK formats are unchanged.

### Hosted comparison — 2026-10-08

Finalization HTTP decreased from **3.581s to 3.047s median**, an observed reduction
of **534ms (14.9%)**. Its measured persistence/session span decreased from
**2.469s to 1.775s**. These are three sequential samples per arm. The earlier
Phase 6X candidate measured 2.661s in a different run, which shows why each change
needs its own matched baseline. This result does not establish a stable maximum.

Both arms used one SDK, browser harness, private Gateway source and custody cohort.
Only Gateway finalization scheduling, its founding-record read batch and diagnostics
changed. The browser loaded only the NEAR signer. All six fresh implicit wallets
produced independently verified SDK Ed25519 messages, without funding or named-account
provisioning.

| Measurement | Baseline median (range) | Candidate median (range) |
| --- | ---: | ---: |
| SDK registration | 10.690s (9.904–11.943s) | 10.371s (8.373–10.916s) |
| Browser registration | 11.511s (10.614–12.254s) | 10.746s (9.206–11.614s) |
| Registration → verified message | 14.469s (13.598–14.528s) | 12.970s (12.964–15.396s) |
| Yao execute HTTP, unchanged custody code | 4.524s (3.935–4.701s) | 4.444s (3.912–4.880s) |
| Finalization HTTP | 3.581s (2.750–3.626s) | 3.047s (2.002–3.048s) |
| Registration protocol requests | 4 | 4 |
| All Gateway requests through first message | 10 (9–10) | 10 (9–10) |

The new candidate timings identify the remaining waits:

| Finalization operation | Median | Range |
| --- | ---: | ---: |
| Admit the reserved wallet home | 15ms | 11–17ms |
| Consume the Router activation | 123ms | 111–573ms |
| Install capability | 188ms | 154–229ms |
| Store custody and recovery data | 400ms | 241–537ms |
| Issue Wallet Session | 337ms | 232–737ms |
| Complete the wallet-home reservation | 403ms | 401–433ms |
| Delete the completed ceremony | 77ms | 61–138ms |

Capability installation and custody storage overlap. These nested timings and
stage medians must not be added together. They exclude parts of the request,
including surrounding Gateway work and Console wallet projection. Application
clocks also omit some CPU work. Total D1 and backend Console call counts remain
unknown. The browser total includes automation and UI settlement. Fresh wallets
do not establish cold Workers or DOs. Physical colocation was not remeasured.
The **3–4 second registration target and 1–2 second Yao target remain unmet**.

Nine local browser scenarios passed, including lost replies, reload recovery,
exact finalization replay, quota exhaustion, Email OTP and ECDSA/mixed registration.
Server build, intended TypeScript and exact-tree bloat checks passed. Both hosted
serving-version audits matched all five participating roles. A Cloudflare API
authentication failure interrupted the pause between arms. Refreshing the existing
credentials restored access. The runner verified all thirteen saved versions and
resumed without repeating or replacing the baseline samples.

All thirteen original Worker versions were restored and verified. Tenant activation
passed in run `37777018751`. No new resources, production deployment or
package release occurred. Raw artifacts remain in `.artifacts/r155b-phase6y`
(public) and `.artifacts/r155b-phase6y-hosted` (private).

[Sanitized measurements, signature proofs and deployment audits](evidence/r155b-near-registration-parallel-finalization-20261008.json).

## Phase 6Z — finish terminal ceremony cleanup in the background

Implementation: `18065d564d48902d2346a96b9de096340930f6c4` on `dev`.

After the completion receipt and wallet-home completion are durable, NEAR
finalization schedules ceremony deletion with the existing Worker `waitUntil`
callback. The cleanup retains its request-bound store and fixed home. The durable
receipt continues to handle retries and lost replies. Hosts without background
execution still await cleanup. Wallet, capability, custody, recovery and session
writes remain awaited before readiness.

This follow-up passed the same nine browser scenarios, server build, intended
TypeScript and exact-tree bloat check. It was committed after the Phase 6Y
measurement candidate was frozen. **Its hosted latency saving is unmeasured.**
Phase 6Y measured cleanup at 77ms median; that figure is a prior task duration,
not an established end-to-end saving. Verification artifacts remain in
`.artifacts/r155b-phase6z` and are included in the linked evidence.

## Phase 6AA — complete the wallet home in one Console command

Implementation: private `seams-monorepo` commit `eb8ff48` on `dev`.

The Gateway previously looked up the ceremony in Console before it sent the
completion command. Console then updated the directory and read the row again.
The Gateway now sends its authenticated tenant scope, local home, wallet and exact
ceremony in one command. Console validates the writer and returns the updated
row with `UPDATE ... RETURNING`.

Fresh directory completion uses **one Gateway-to-Console request and one directory
D1 request**, down from two and three respectively. These counts cover this
directory operation only. Regional execution-state writes and surrounding Console
admission are additional work. An unchanged update still reads the row to distinguish
an exact retry from a conflict.

The change preserves tenant scope, writer home, ceremony ownership, active placement,
timestamp ordering, terminal outcomes and the passkey cancellation guard. A lost
response can be retried without changing the completed record. Recovery and custody
data remain durable before successful registration. There is no old request format,
new database, migration, cache or environment variable.

- [x] Remove the Gateway directory preflight and completion readback.
- [x] Pass directory and relocation E2E scenarios against real local D1.
- [x] Exercise a lost completion response, exact replay, wrong ceremony and opposite outcome.
- [x] Pass regional session routing, passkey claim/cancellation races and Google login scenarios.
- [x] Build matching Gateway and Console bundles for both comparison arms.
- [x] Compare three fresh implicit wallets per arm on staging.
- [x] Independently verify SDK message signatures and serving versions.
- [x] Restore all 13 original Worker versions and all five changed placement settings.
- [x] Save sanitized final evidence.

The broad matching-SDK type check reports six existing integration errors. The
unchanged baseline reports the same errors. The ordinary installed-package check
also lacks the newer custody-binding export. This change adds no type diagnostics.

The comparison holds the SDK and custody versions constant. Both arms contain
Phase 6Z background cleanup. The comparison therefore isolates Phase 6AA, without
claiming a separate latency saving for Phase 6Z.

### Hosted comparison, 2026-10-08

Finalization fell from **2.543s to 2.405s median**, an observed reduction of
**137ms (5.4%)**. The changed home-completion stage fell from **375ms to 275ms
median**, a reduction of **100ms (26.7%)**. This improves one part of registration.
The total registration target remains unmet.

Each arm registered three fresh implicit NEAR wallets and signed one message per
wallet. Only the NEAR signer loaded. The test did not fund accounts or provision
named accounts. Both arms used the same SDK, public server source and custody
Worker versions. Gateway and Console bundles differed only in Phase 6AA code.

| Measurement | Matched baseline median (range) | Candidate median (range) |
| --- | --- | --- |
| Finalization HTTP | 2.543s (2.489–3.388s) | **2.405s (2.346–2.512s)** |
| Home completion | 375ms (356–400ms) | **275ms (250–279ms)** |
| SDK registration | 10.264s (9.038–10.693s) | 8.854s (7.691–9.070s) |
| Browser registration → verified SDK message | 13.778s (12.769–14.015s) | 11.447s (11.373–12.202s) |
| Yao execute HTTP, unchanged implementation | 4.629s (3.156–5.037s) | 3.256s (2.714–4.270s) |
| Registration protocol HTTP requests per wallet | 4 | 4 |

The unchanged Yao implementation also ran faster in the candidate arm. Thus the
full registration difference cannot be attributed to Phase 6AA. Three sequential
samples per arm establish neither percentiles nor a guaranteed maximum. Fresh
wallets do not establish cold Workers or Durable Objects.

Console tails recorded nine `find-by-ceremony` calls in the baseline and six in
the candidate. This confirms one removed lookup per wallet. Each arm still made
three completion calls and three wallet-projection calls. These are observations
within the test windows, rather than a complete D1 or Console call census.
Gateway-wide D1 counts remain unknown.

The candidate's remaining finalization spans are:

| Span | Median | Range | Relationship |
| --- | --- | --- | --- |
| Router activation consumption | 476ms | 116–606ms | Authenticated first-consumer claim and exact retry |
| Capability installation | 159ms | 145–179ms | Runs alongside custody commit |
| Custody commit | 285ms | 265–292ms | Must be durable before successful registration |
| Session issuance | 323ms | 309–565ms | Follows durable wallet and custody installation |
| Home completion | 275ms | 250–279ms | Phase 6AA operation |
| Registration service total | 1.901s | 1.647–1.916s | Includes nested spans above |
| Terminal cleanup | 71ms | 57–75ms | Background work from Phase 6Z |

These spans overlap or nest. Do not add their medians. The HTTP response also
awaits the Console wallet projection outside the service timer. Console-local
projection work measured 115ms median, excluding the Gateway-to-Console journey.
The remaining HTTP gap cannot be assigned wholly to that projection from this data.

The Router consumption boundary remains a concrete optimization target. Its
Worker-to-object dispatch measured **407ms median (76–523ms)** in the candidate.
The object's provider wall time was **53ms median (47–61ms)**; CPU was **10ms**.
The calling Router Worker used **4ms median CPU** and **419ms median wall time**.
All six consume calls across both arms were the fourth command on an already
running object instance. Candidate calls began 460–909ms after the previous command.
Thus object construction does not explain this repeated wait. The clocks do not
separate network, dispatch, response reading and other provider overhead precisely.

Phase 6L already ruled out a simple fresh-handle penalty in no-op probes. Do not
repeat that experiment or introduce a handle cache. The next measurement should
split the real consumption call into request serialization, response-header arrival,
response-body read and decode. Preserve the same wallet object and first-consumer
claim. The session issuer also rereads active authority and publishes the credential
route before its durable session commit. Measure these boundaries before removing
reads. Preserve revocation and exact replay. Console projection needs durable
delivery before it can leave the critical path.

All six SDK message signatures verified with an independent Node crypto check.
All six changed-message checks failed as expected. Serving-version audits matched
all six participating roles in both arms. Worker placement settings matched the
saved settings after each accepted deployment. Actual physical colocation was not
remeasured.

After the comparison, all **13 original Worker versions** and the original
placement settings of the four Gateways and Console were restored and verified.
Normal tenant activation and readiness passed in GitHub run `37786339927`.
No new infrastructure, production deployment or package release was performed.

Two earlier setup attempts are excluded. The first found a bundle output-path
error before Gateway upload. The second used the Cloudflare API placement format
in a Wrangler config, which removed placement. This was an experiment setup error.
Explicit Wrangler region settings and post-deploy readback checks fixed it. Both
accepted arms were then rerun. The excluded baseline is retained in local artifacts.

Raw artifacts: private `.artifacts/r155b-phase6aa-hosted` and
`.artifacts/r155b-phase6aa`. Committed evidence contains aggregate spans, request
counts, public signature proofs, bundle hashes and deployment audits. It excludes
raw request credentials, deployment secrets and tail logs.

### Separate finding: NEP-413 encoding does not match the standard

Classification: **pre-existing production regression**, found by an independent
standards check. This is separate from Phase 6AA directory completion.

The frozen SDK signs `message, recipient, nonce, state`. The
[NEP-413 specification](https://github.com/near/NEPs/blob/master/neps/nep-0413.md)
requires `message, nonce, recipient, callbackUrl`. The Rust encoder in
`crates/signer-core/src/near_threshold_ed25519.rs` and the browser harness both
use the SDK layout. Thus the existing E2E verification can pass while an external
standards verifier rejects the signature.

Node crypto verifies the captured signatures against the SDK payload and rejects
altered messages. It rejects the same signatures against an independently encoded
standard payload with no callback URL. The benchmark passes cryptographic
verification, but it does **not** prove NEP-413 interoperability. Earlier message
benchmark labels must be read with this correction. Transaction-signing measurements
are a separate workload.

The signing implementation is frozen in this latency comparison. The separate
repair is committed on public `dev` as `127dd7eca7ebb4346b14316832a462cd91dba31b`.
It updates the Rust, WASM, SDK and Router encoders to the standard field order.
It preserves `state` as transport data and removes the incorrect wire layout.

The repaired implementation passes the published NEP example, the existing browser
signing flow across refresh, and independent verification of both saved signatures.
The checks bind the callback URL, preserve empty/nonempty state and reject altered
signed fields. Six anti-drift checks, three Router vector checks, 33 Verus proofs,
type checks and the exact-tree bloat check pass. Generated bindings are unchanged.

This repair used local Workers, virtual WebAuthn and stubbed NEAR RPC. Its native
VM launcher was blocked by an unrelated schema checker, which remains unchanged.
No repaired SDK or Router was deployed during the latency comparison. The encoding
change requires a coordinated SDK and backend release. Repair artifacts remain in
public `.artifacts/nep413-standard-20261008`.

[Sanitized measurements, signature checks and restoration audit](evidence/r155b-near-registration-single-directory-completion-20261008.json).


## Router-to-DO transport diagnosis — 2026-10-08

The slow consume calls spend most of their elapsed time before the response
headers arrive. Body reading is small. The measured DO stays alive across the
registration. This run does not identify a safe transport change with a demonstrated
speedup, so it retains the protocol and its first-consumer guard.

- [x] Add separate request encoding, response-header, body-read and decode spans
  to the real Router wallet call. Record byte counts without logging payloads.
- [x] Pass the existing four-home E2E, including rejected credentials and homes,
  lost startup replies, immediate execution and exact replay without repeated custody.
- [x] Build all five strict release roles. Pass Rust formatting and exact-tree bloat checks.
- [x] Run three fresh implicit NEAR registrations with matching SDK and backend builds.
  Verify all three signatures independently with the standard NEP-413 payload.
- [x] Check captured invocation versions against the frozen candidate versions.

| Consume call boundary | Sample 1 | Sample 2 | Sample 3 |
| --- | ---: | ---: | ---: |
| Caller wait for response headers | 488 ms | 59 ms | 513 ms |
| Caller response-body read | 0 ms | 0 ms | 4 ms |
| DO provider wall time | 69 ms | 49 ms | 52 ms |
| DO provider CPU time | 15 ms | 8 ms | 8 ms |

Each consume was command four on its existing object instance. The previous
command started 885, 366 and 865 ms earlier. Requests contained 472–474 bytes;
responses contained 21,381–21,451 bytes. Claim response-header wait was
**496 ms median (466–507 ms)**. Finish wait was **56 ms (51–104 ms)**.

The difference points to dispatch or provider routing/scheduling outside the
measured handler. It does not prove a specific Cloudflare mechanism. Response-header
wait also includes receiver execution and storage completion. Separate clocks must
not be subtracted to claim precise network time. Worker clocks do not advance during
synchronous CPU work, so zero encoding/decode spans do not establish zero CPU cost.
Actual physical execution locations were not remeasured.

| Full workload | Median | Observed range |
| --- | ---: | ---: |
| Yao execute HTTP request | 3.903 s | 3.805–4.365 s |
| Finalization HTTP request | 2.272 s | 1.982–2.725 s |
| SDK registration | 8.765 s | 8.660–10.310 s |
| Browser registration → verified NEP-413 signature | 11.482 s | 11.449–14.732 s |

Only the NEAR signer loaded. Accounts were implicit and unfunded. The browser
observed 9–10 Gateway requests per sample; the evidence records each sample's
actual count. Gateway-wide D1 and backend Console counts remain unavailable.
This is a diagnostic arm, not a controlled latency improvement. Keep the Phase 6AA
comparison unchanged. The registration and Yao setup targets remain unmet.

The corrected NEP-413 SDK and backend were deployed together for this experiment.
Independent Node verification passed for all three saved signatures. Altered message,
recipient, nonce and callback fields were rejected. Transport state remained outside
the signed payload. These hosted messages had no callback URL; the earlier local
verification covers a signed callback URL and empty/nonempty transport state.

The next bounded optimization candidate is to combine Console home completion and
wallet display projection in one authenticated command. The current finalization
waits for both calls separately. Projection alone took 75–86 ms inside Console,
excluding its network wait. Keep required writes awaited, preserve exact retries,
and remove the separate projection request only after the combined command is verified.
This candidate addresses a separate avoidable round trip; it does not explain the
Router-to-DO delay. Its end-to-end saving is unmeasured. Avoid another handle cache,
keepalive loop, payload rewrite or protocol rewrite without supporting evidence.

Two setup failures produced no registration samples: an empty saved placement block
failed Wrangler validation, and the first browser launcher loaded two Playwright
installations. The placement block was removed, and the frozen SDK's launcher passed.
The artifacts retain both failures. No new resources or package release were required.

[Sanitized traces, standard signature proofs and deployment audit](evidence/r155b-near-router-transport-20261008.json).

All thirteen original Worker versions and the five regional placement settings were
restored and checked. Restoration activation run `37795353494` succeeded.
The timing instrumentation is committed on public `dev` as `fbc8be904fdeebb096a6ed055bb23d2ffdec6c30`.


### Phase 6AC — commit the Console display row with the wallet home (2026-10-09)

The fresh registration path now completes its home and creates its Console display
row in one authenticated call. One D1 transaction contains the guarded home update
and display insert. Both use the reserved tenant, wallet, ceremony and physical home.
The insert uses the stored completion time. Exact retries preserve later display
changes, including wallet status and balance. A failed insert rolls back home completion.
Cancelled or mismatched registrations cannot create the display row.

- [x] Combine home completion and display creation without a new schema or resource.
- [x] Remove the separate Gateway projection callback, Console endpoint and adapter.
- [x] Exercise lost replies, exact retries, rollback, cancellation and regional routing
  through the production Console home service and persistent local D1.
- [x] Recheck relocation and Console credential service behavior.
- [x] Build and type-check the public server; check the exact public Git tree for bloat.
- [x] Complete the controlled hosted comparison and restore the original deployment.

| Fresh completion plus display creation | Before | After |
| --- | ---: | ---: |
| Gateway → Console requests | 2 | 1 |
| Console D1 requests | 4 | 1 |
| SQL statements | 4 | 2 |

These counts cover this bounded path. The previous path ran a completion update,
environment lookup, display upsert and display readback. The replacement batches
its update and insert. These are implementation-derived counts, not Gateway-wide
D1 measurements. Required custody, capability, session and receipt writes still
complete before registration returns success.

Public code: `655ad03c734a1e6eeef1a9576c344e268b6bf400`.
Private code: `4ee9c31`.

Local directory, relocation and Console credential E2E checks passed. The public
server build, server type-check and intended-contract type-check passed. Six private
integration type errors are identical in baseline and candidate. Three public browser
contracts passed: mixed registration, overlapping NEAR admission and immediate owner
signing on NEAR and ECDSA. An initial attempt reached occupied default local Worker
ports and failed during bootstrap. The rerun used separate ports. Hosted verification
uses the frozen matching staging cohort.

The next candidate is session issuance. It currently reads the mint record and
ownership generation separately before its existing commit transaction. Check whether
one store operation can return the exact replay result or the current issuance context.
Preserve fresh authority checks, revocation, ownership generation and concurrent mint
replay. Router-to-DO response-header waits remain the larger unresolved transport cost.


The controlled staging comparison used three new implicit, unfunded NEAR wallets
per arm. Both arms loaded the same corrected NEP-413 SDK and used the same custody
versions and placement. The baseline private source matches the previous Phase 6AB
cohort. Only Console completion/projection and its Gateway call path changed.

| Workload | Baseline median (range) | Candidate median (range) |
| --- | ---: | ---: |
| Finalization HTTP | 2.427 s (2.230–2.595) | 2.297 s (2.049–2.386) |
| SDK registration | 10.452 s (9.243–10.532) | 9.856 s (9.263–10.141) |
| Browser registration → independently verified signature | 12.990 s (12.870–13.151) | 12.897 s (12.113–12.980) |
| Yao execute HTTP | 4.341 s (4.012–4.778) | 4.386 s (4.112–4.694) |

Finalization improved by **130 ms (5.3%)** in this small sample. Full-flow median
changed by only **93 ms (0.7%)**. This does not establish a material full-flow gain.
The 3–4 second registration-to-signature target remains unmet. Do not combine this
experiment's reductions with earlier experiments or attribute all SDK variation to
this change. Nested spans overlap and cannot be added.

Console tails recorded **three separate projection calls before, zero after**.
The home-completion span was 278 ms before and 295 ms after; it now includes the
additional display write. A hosted D1 read confirmed all three candidate homes had
exactly matching tenant-scoped display rows and identical completion/create/update
timestamps. All captured role invocation versions matched each arm's frozen versions.
Independent Node verification accepted all six standard NEP-413 signatures and
rejected altered messages, recipients, nonces and callback URLs.

Other candidate HTTP medians were setup **986 ms**, respond **1.127 s**, signing
prepare **870 ms** and signing execute **549 ms**. These are individual HTTP request
durations. They do not measure browser work between requests. Use the full-flow
samples for total time. Yao execute remains the largest single registration request
at **4.386 s**.

All thirteen original Worker versions and all five placement settings were restored
and verified. Restoration activation `37802617976` succeeded. Tail processes stopped.
No new Cloudflare resources were provisioned. Three samples per arm do not measure
percentiles, cold-start guarantees or a regional service-level objective.


[Sanitized timings, signature proofs, projection audit and restoration evidence](evidence/r155b-near-registration-atomic-console-completion-20261009.json).


### Phase 6AD — early A/B connection rejected (2026-10-09)

The candidate opened A's connection to B during pair preparation. Router also kept
its connection to A open across preparation and execution. It preserved fresh root
checks, signed readiness, admission claims, relocation fencing and durable replay.

Twelve local Worker/DO scenarios passed. These covered connection loss, forged
messages, missing admissions, cancellation, concurrent admission, lost replies,
replay after key erasure and complete signing. Nine fresh hosted wallets produced
independently verified NEP-413 signatures. Altered signed fields were rejected.

Three fresh implicit, unfunded NEAR wallets ran in each sequential arm. SDK,
Gateway, Runtime, Console, Signing Worker, configuration and requested APAC
placement stayed fixed. Only Router and A/B transport changed. The final control
restored the baseline custody versions.

| Workload | Baseline median (range) | Candidate median (range) | Final control median (range) |
| --- | ---: | ---: | ---: |
| Yao execute HTTP | 4.167 s (3.828–4.780) | 4.791 s (3.874–5.107) | 4.008 s (3.900–4.684) |
| SDK registration | 8.520 s (8.472–12.233) | 8.791 s (7.710–9.911) | 8.214 s (7.940–9.010) |
| Browser registration → verified signature | 11.483 s (11.427–15.432) | 11.347 s (10.499–13.106) | 10.832 s (10.594–11.459) |

**Reject this candidate.** Yao median increased by 624 ms (15.0%) against the
baseline and 783 ms (19.5%) against the final control. The full-flow result does
not establish a gain. No experimental transport code was merged.

The prepare-pair median increased from 1.106 s to 1.686 s. A execution decreased
from 1.699 s to 1.287 s. Opening B from A extended preparation enough to erase the
execution saving. The candidate's A-to-B opening took 755 ms (736–779 ms).
Nested span medians overlap and must not be added. Protocol spans include network
waits and do not measure cryptographic CPU time alone.

Changed execution paths used the intended candidate versions. Four Router
active-state reads reached the prior version during rollout. That endpoint's
source was byte-identical between arms. The evidence records this limitation.
Three samples per arm cannot establish percentiles or a regional latency guarantee.

All thirteen original Worker versions and all five placement settings were
restored and verified. Restoration activation `37810044293` succeeded. Tail
processes stopped. No new Cloudflare resources were provisioned.

The next experiment will open Signing Worker delivery during the complete Yao
ceremony. It will send packages only after role execution succeeds and retain
durable installation before success.

[Sanitized comparison and verification evidence](evidence/r155b-near-early-yao-connection-20261009.json).

### Phase 6AE — overlap Signing Worker delivery with Yao (2026-10-09)

**Retain this optimization.** Router starts the authenticated delivery request
before A/B preparation. Signing Worker forwards its headers to the exact wallet
DO before the package body exists. Router sends the body only after both role
outcomes pass validation. Success still requires durable installation and its
receipt. The request carries the exact wallet scope, home and ownership generation.

The implementation uses the existing HTTP endpoint with a streamed body. It adds
no infrastructure, environment variables or compatibility path. It preserves root
and revocation checks, admission, relocation fencing and exact replay. Source-
preserving operations retain their existing distinct protocol. Wallet implementation
commit: `e8a8d8fe31a73d0b738f7fa3ea25426c0d349d56` on `dev`.

Three fresh implicit, unfunded NEAR wallets ran in each sequential arm. The same
corrected NEP-413 SDK, Gateway, Runtime, Console, A/B versions and placement stayed
fixed. Only Router and Signing Worker delivery changed. The final control restored
the baseline versions. All captured invocation versions matched in all retained arms.

| Workload | Baseline median (range) | Candidate median (range) | Final control median (range) |
| --- | ---: | ---: | ---: |
| Yao execute HTTP | 3.764 s (3.716–4.183) | **3.088 s (2.848–3.449)** | 3.787 s (3.662–9.956) |
| Delivery wait after role execution | 476 ms (418–527) | **84 ms (66–91)** | 485 ms (428–710) |
| SDK registration | 7.848 s (7.361–8.066) | **6.505 s (6.488–7.375)** | 7.813 s (7.291–13.706) |
| Browser registration → verified signature | 10.738 s (9.934–11.590) | **9.194 s (9.164–10.826)** | 11.583 s (9.956–16.174) |
| Finalization HTTP | 1.524 s (1.482–1.646) | 1.546 s (1.243–1.806) | 1.696 s (1.538–1.823) |

The post-execution delivery median decreased by **392 ms (82.4%)**. The Yao HTTP
median decreased by **675 ms (17.9%)** against baseline and **698 ms (18.4%)**
against the final control. The candidate DO waited **1.631 s (1.571–1.713)** for
the body. That confirms that the request reached the DO during the ceremony.
The entire delivery exchange lasted 2.316 s, but most of it overlapped Yao work.
Do not add these nested spans.

The full-flow median improved by 1.544 s against baseline. Other stages varied,
so the entire difference cannot be attributed to delivery overlap. The final
control included a 6.894 s authorization outlier, which explains most of its
9.956 s maximum Yao request. This experiment did not reduce cryptographic CPU work.
The one-to-two-second Yao target and three-to-four-second full-flow target remain
unmet. Three samples per arm cannot establish percentiles or a latency guarantee.
Fresh wallets do not guarantee cold Workers.

Request counts stayed unchanged. Each retained sample used 9–10 observed Gateway
requests across registration and signing. Each arm recorded 33 Console HTTP calls
for the three registrations. A scheduled Console event in the control is separate.
Bound-root admission and execution still used **six D1 round trips and sixteen SQL
statements per registration**, across A and B. These counters cover that subsystem,
not every D1 call in the full flow. Per-path counts and raw timing samples are in
the evidence file.

Eight local Worker/DO E2E scenarios passed. They cover delivery failure, concurrent
admission, lost replies, erasure replay, admission settlement, cancellation, forged
acceptance and complete signing. A further in-flight test confirms that a pending
upload cannot install packages after relocation closes its destination. Header/body
mismatches for wallet, home and generation fail. Wrong service credentials fail.
Exact replay preserves the receipt. An early delivery failure preserves completed
role outcomes and reports a retryable service error; that test does not claim that
the entire registration recovered. Independent Node verification accepted all nine
retained NEP-413 proofs and rejected changes to signed fields. WASM checks, release
builds and the repository bloat check passed.

Review found a transport-error mapping that would have returned a client error.
The implementation now preserves the existing retryable HTTP 500 classification.
The failure scenario verifies that fix. The earlier rejected A/B connection code
from Phase 6AD remains excluded.

Rollout evidence is separate from the measured comparison. An early baseline
reached the previous Console version and failed home completion. Two first-attempt
candidate registrations reached the previous Router with the new Signing Worker.
The new receiver rejected their missing delivery address. One matching invocation
succeeded. These samples are excluded. The repeat checked Console serving traces,
allowed two minutes after custody version changes, and audited all captured role
versions. **Deploy matching Router and Signing Worker versions and verify actual
serving versions before admitting registration traffic.** A fixed wait alone does
not guarantee a correct rollout.

Deployment preparation also found that the registration canary leaves active
records until their ten-minute expiry. We preserved readiness checks and waited
for expiry. This deployment delay is excluded from registration timings. No live
records were deleted or rewritten to bypass readiness.

All thirteen original Worker versions and their placement settings were restored
and verified. Restoration activation `37825313247` succeeded. Tail processes
stopped. No new Cloudflare resources were provisioned.

The next measured bottlenecks are A/B execution (**1.434 s** median), pair
preparation (**749 ms**) and Router authorization (**552 ms**). These spans include
network waits. Further work should separate those waits from actual protocol CPU
before changing the protocol or its authority checks.

[Sanitized timings, version audit, proofs and restoration evidence](evidence/r155b-near-streamed-package-delivery-20261009.json).

### Phase 6AF — early Deriver A execution request (2026-10-09)

**Reject this candidate.** Opening A's execution request during preparation did
not produce a consistent latency gain. The accepted Phase 6AE implementation stays
on `dev`. Candidate source, builds and the patch remain in the local experiment
artifacts. None of the candidate production code or test helpers is retained.

The candidate sent authenticated wallet routing metadata before the execution
body. Router released the body only after validating both readiness receipts.
A forwarded the request to its wallet DO before reading the body. The DO checked
the exact address, bounded the body wait, and checked relocation again after the
wait. Root admission, revocation checks, protocol execution and durable replay
kept their existing behavior. The replaced internal execution route was removed
from the candidate.

Three fresh implicit, unfunded NEAR wallets ran in each sequential arm. Baseline
included accepted streamed Signing Worker delivery. The candidate changed only
Router and Deriver A. The final control restored their baseline versions. The SDK,
Gateway, Runtime, Console, B, Signing Worker and requested APAC placement stayed
fixed. All captured invocation versions matched. All nine registrations and
independent NEP-413 signature verifications succeeded. No sample was excluded.

| Workload | Baseline median (range) | Candidate median (range) | Final control median (range) |
| --- | ---: | ---: | ---: |
| Yao execute HTTP | 3.338 s (2.624–3.576) | 3.104 s (2.720–3.610) | 2.976 s (2.901–3.673) |
| A execution after readiness | 1.654 s (1.084–1.734) | 1.468 s (1.322–1.582) | 1.451 s (1.417–1.463) |
| A connection to B | 697 ms (257–717) | 764 ms (723–855) | 732 ms (639–739) |
| SDK registration | 7.263 s (6.515–7.753) | 6.952 s (6.317–8.293) | 7.322 s (6.332–7.326) |
| Browser registration → verified signature | 9.909 s (9.190–10.847) | 9.912 s (9.171–10.830) | 9.958 s (9.174–10.066) |
| Finalization HTTP | 1.624 s (1.620–2.012) | 1.694 s (1.436–1.760) | 1.494 s (1.364–1.920) |

A's DO waited **193 ms (72–220)** for the candidate body. The request therefore
arrived before preparation completed. However, remaining execution latency did
not beat the final control. Candidate Yao median improved by 234 ms against the
first baseline and worsened by 127 ms against the control. The full-flow median
stayed near 9.9 seconds. This evidence does not justify the added request contract
and deployment coupling. It does not establish that overlap can never help.

The candidate's A/B protocol spans had medians of **280/291 ms**. The final
control recorded **284/349 ms**. These spans include transport. Worker clocks also
do not advance during synchronous CPU work. These figures cannot establish pure
cryptographic CPU time. A's connection to B still took about **0.7–0.8 seconds**.
The one-to-two-second Yao target and three-to-four-second full-flow target remain
unmet. Three samples per arm do not establish percentiles or guarantees.

Each sample used 9–10 observed Gateway requests. Each arm recorded 33 Console
HTTP calls for registration. A separate scheduled event appeared in the control.
Bound-root admission and execution retained **six D1 round trips and sixteen SQL
statements per registration**, across A and B. These counts cover that subsystem,
not all backend D1 work. The candidate removed no request or D1 round trip.

All five role release builds and eight local Worker/DO E2E scenarios passed.
The tests covered concurrency, lost replies, erasure replay, admission settlement,
cancelled root use, forged acceptance, early delivery failure and complete signing.
The new test first expected a raw internal error, while production returns a
structured refusal. Its assertion was corrected without changing production.

Review also found that Miniflare's Node fetch proxy buffers request bodies.
A pending Node request therefore did not prove an in-flight DO race. The final
test constructed the stream inside workerd. DO command ordinals show execution
entered first, then relocation reserved the destination. The body wait lasted
254 ms, and execution failed after the reservation. Address mismatches also
failed, and exact replay preserved the prior outcome. The bloat check passed.

All thirteen original Worker versions and placement settings were restored and
read back. Restoration activation `37831446437` succeeded. Tail processes stopped.
No new Cloudflare resources were provisioned.

The next candidate should remove a setup round trip between A and B. Evaluate
carrying B preparation on the authenticated peer connection, with independent
B admission and signed readiness checks before protocol execution. Keep fresh
root checks and durable replay. The earlier eager-connection experiment remains
rejected. Compare the combined exchange against both baseline arms before keeping
its code. Registration-to-verified-signature time remains the acceptance metric.

[Sanitized timings, version audit, proofs and restoration evidence](evidence/r155b-near-early-deriver-execution-20261009.json).


## Router wallet coordinator comparison — 2026-10-09

**Reject this candidate.** It removed one Router-to-object request per registration,
but Yao setup was slower than both controls. The accepted Phase 6AE implementation
stays on `dev`. Candidate production code and its test changes remain only in the
local experiment archive. The one-to-two-second Yao target and three-to-four-second
registration-through-first-signature target remain unmet.

The candidate forwarded the authenticated ceremony into its existing Router wallet
DO. Claim and completion used the existing storage transactions inside that object.
Finalization still consumed the stored result through its separate authorized call.
The object checked the exact wallet and ownership generation before any transition.
A and B preparation stayed parallel. Root admission, fresh cancellation checks,
claim generations, replay, and relocation fences retained their behavior.

Three fresh implicit, unfunded NEAR wallets ran in each sequential arm. The baseline
included accepted streamed Signing Worker delivery. Only Router changed for the
candidate. SDK, Gateway, Runtime, Console, A, B, Signing Worker, bindings, and requested
APAC placement stayed fixed. Builds and local checks finished before timed runs.
Every captured invocation version matched its expected version. All nine registrations
and independent Node NEP-413 verifications passed. No timing sample was excluded.

| Workload | Baseline median (range) | Candidate median (range) | Final control median (range) |
| --- | ---: | ---: | ---: |
| Yao execute HTTP | 2.870 s (2.736–3.437) | 3.517 s (3.355–3.634) | 3.109 s (2.683–3.153) |
| SDK registration | 7.191 s (6.611–7.265) | 7.030 s (6.695–7.538) | 6.895 s (5.958–7.110) |
| Browser registration → verified NEP-413 signature | 9.960 s (9.147–10.093) | 9.949 s (9.173–10.829) | 9.306 s (8.378–9.930) |
| Finalization HTTP | 1.749 s (1.598–1.829) | 1.286 s (1.267–1.593) | 1.592 s (1.167–1.693) |

Yao median increased by **647 ms** against the first baseline and **408 ms** against
the final control. Parallel preparation measured **677 / 1,114 / 748 ms** across the
three arms. A execution measured **1,326 / 1,488 / 1,561 ms**. A's connection to B
measured **610 / 290 / 673 ms**. The faster candidate connection did not produce a
faster whole setup. These spans overlap and include transport. Worker clocks freeze
during synchronous CPU work. They do not identify the provider mechanism behind
the variation or isolate cryptographic CPU time.

The request reduction was real: claim, completion, and consumption previously used
three Router wallet requests per registration. The candidate used one execution
request plus one consumption request. The storage transitions remained unchanged.
Bound-root work retained **six D1 round trips and sixteen SQL statements** per
registration. This count excludes other D1 work and local object SQL. Gateway
requests were **9–10 / 10 / 9–10** per sample. Each arm recorded **33 Console HTTP
calls**. The final control also recorded one scheduled Console invocation.

All five role release builds, the generic Workers host check, and nine local E2E
scenarios passed. Checks covered concurrent claims, lost replies, erasure replay,
admission settlement, cancelled root use, forged acceptance, early delivery failure,
and all four homes. The four-home test rejected a valid request sent to another
wallet object before any claim. The exact-tree bloat check passed.

Two harness defects were corrected for this candidate. Miniflare's object binding
needed a URL and request fields instead of a Node Request instance. Recovery fault
bindings also needed to belong to the Worker hosting the executing wallet object.
Production authority rules were unchanged by those test repairs. The candidate's
source tree, patch, binary hashes, E2E artifacts, and file hashes remain reproducible.

An earlier setup attempt produced no timing samples. Its empty request failed body
validation before reaching Console, so an empty Console trace did not prove rollout
failure. That attempt restored staging and passed activation `37835795083`. The final
run audited actual benchmark invocation versions. Pending registration expiry guards
remained enforced throughout both attempts.

Combining B preparation with the peer connection was considered first. B preparation
already runs in parallel with A. Moving it after A preparation would serialize work.
That change was not implemented or measured. A future candidate needs a demonstrated
removable dependency while preserving admission, fresh cancellation checks, and replay.
These results do not support another coordinator-location or connection-reuse change.

Three samples per arm do not establish percentiles, statistical significance, or a
latency guarantee. Fresh wallets do not establish cold Worker starts. Requested APAC
placement does not establish physical colocation.


All thirteen original Worker versions and placement settings were restored and
checked. Restoration activation `37838708308` passed. All tail processes stopped.
No new Cloudflare resources were created.

[Sanitized timings, source hashes, proofs and restoration evidence](evidence/r155b-near-wallet-coordinator-20261009.json).

### Phase 6AH — remove repeated bound-root validation (2026-10-09)

Implementation: `b72d9c32e6570eee1a4929f2805afd2ead6b2eb5` on `dev`.

The bound-root loader now returns the sealed online share from the record it
already authenticated. It removes two repeated record checks and two repeated
activation-binding checks from each successful load. The patch deletes two
conversion methods and reduces the implementation by 32 net lines.

The database boundary still decrypts and validates the complete persisted row.
Exact custody matching still checks identity, lineage, epoch, role, commitment,
and activation receipt. Admission keeps its authenticated preliminary read and
conditional write. Execution keeps fresh cancellation, retirement, erasure, and
active-root uniqueness checks. The provider still decrypts the secret share and
verifies its public commitment. ECDSA settlement still races cancellation before use.

Five release Worker builds, the generic Workers check, eleven local Worker/DO E2E
scenarios, and the exact-tree bloat check passed. The E2E scenarios cover all four
homes, interrupted delivery, lost replies, replay after erasure, admission races,
settlement, cancelled roots, missing admissions, forged acceptance, and ECDSA
presignature handoff with verified signing. Existing tests required no repair.

**Keep the code simplification. No end-to-end speedup was established.** The
candidate removes real duplicate work without adding a cache, request, schema,
configuration setting, or resource. The three sequential samples per arm cannot
establish a latency guarantee or isolate provider scheduling effects.

Three fresh implicit, unfunded NEAR wallets ran in each arm. The corrected NEP-413
SDK, Gateway, Runtime, Console, Router, Signing Worker, configuration, and requested
APAC placement stayed fixed. Only Deriver A and B changed. All builds and local
checks completed before timing began.

| Workload | Baseline median (range) | Candidate median (range) | Restored control median (range) |
| --- | ---: | ---: | ---: |
| Yao execute HTTP | 3.223 s (3.181–4.357) | 3.275 s (2.966–3.925) | 2.962 s (2.892–2.997) |
| SDK registration | 7.472 s (7.114–7.873) | 7.740 s (6.566–7.854) | 6.687 s (6.492–7.001) |
| Browser registration → verified signature | 9.973 s (9.927–10.111) | 9.951 s (9.187–10.825) | 9.276 s (9.176–9.956) |
| Server finalization HTTP | 1.521 s (1.245–1.903) | 1.624 s (1.373–1.786) | 1.553 s (1.528–1.807) |

| Whole-invocation CPU median | Baseline | Candidate | Restored control |
| --- | ---: | ---: | ---: |
| A preparation object | 107 ms | 64 ms | 72 ms |
| B preparation object | 91 ms | 79 ms | 91 ms |
| A execution object | 594 ms | 382 ms | 391 ms |
| B execution object | 234 ms | 226 ms | 234 ms |

These CPU observations include the full object invocation. They do not isolate
validation. Parallel preparation measured 787 / 884 / 739 ms. A-to-B connection
measured 748 / 748 / 703 ms. Smaller CPU work did not produce a repeatable complete
Yao gain. Application clocks omit synchronous CPU work, and nested spans overlap.

Each arm retained **six bound-root D1 round trips and sixteen SQL statements per
registration**. These counts exclude other database work. Observed Gateway calls
were 9–10 / 10 / 9–10 per registration. Captured Console HTTP calls were 33 in
each arm. No claim is made that the total database or HTTP count fell.

All captured serving versions matched the intended cohorts. All nine signatures
passed independent Node.js Ed25519 verification with separate NEP-413 Borsh
encoding. Changed message, recipient, nonce, and callback fields were rejected.
Fresh wallets do not prove cold Workers or physical colocation.

The first setup attempt stopped before candidate deployment because GitHub's OIDC
token endpoint returned HTTP 504. It restored the original cohort and activation
before one retry. The failure was classified as infrastructure failure. Temporary
registration leases expired through the existing readiness guard. No guard was
bypassed. All thirteen original Worker versions and placement settings were restored.
Final activation [37844020524](https://github.com/seams-tech/seams-monorepo/actions/runs/37844020524)
passed. All six observation tails stopped. No new infrastructure was created.

The registration-to-signature target remains unmet. The next bounded investigation
is the backend dependency chain of registration setup and credential submission.
The preceding restored control measured those HTTP calls at 602 ms and 674 ms
median. Their internal waits require measurement before another request change.


[Sanitized evidence](evidence/r155b-near-bound-root-validation-20261009.json) retains
all samples, exact source and bundle hashes, invocation CPU and wall times,
independent signature checks, serving versions, reproduction commands, and
restoration evidence. Raw artifacts remain in the public `.artifacts/r155b-phase6ah` directory and
this repository’s `.artifacts/r155b-phase6ah-hosted` directory.

### Phase 6AI — remove repeated registration lookups (2026-10-09)

**Keep the request reduction. No full-flow latency improvement was demonstrated.**
The public implementation is `15b59d0c9997ead7846f997c54630acd87b0a9b6`.
The private Gateway implementation and E2E verification are `475d5d6`.
Both commits are on `dev`.

Registration setup now returns the exact canonical record after a successful first
insert. It keeps the stored-winner read when another request already inserted the
record. Expiry handling remains unchanged. For the two setup records, this removes
two immediate D1 readbacks: four database API calls become two on the fresh path.
This is a count of the exercised persistence path, not a hosted total-D1 measurement.

The Gateway consumes the home assignment that routing resolved within that request.
It uses that result once. The subsequent Console execution-admission call still
checks the current home, generation, registration identity, and terminal state.
A local Worker/D1 E2E test cancels the reservation between routing and admission.
Admission rejects it. Repeated admission reloads the assignment.

The hosted trace confirms **33 → 30 Console HTTP calls** across three registrations.
Home lookups fall from six to three. Fresh execution-admission calls remain three.
The browser still makes one setup request and one credential-submission request.
Captured Gateway totals were 9–10 calls per baseline wallet and 9 per candidate
wallet; variable background status calls explain that separate count.

Three fresh implicit, unfunded NEAR wallets ran in each measured arm. Only the
four regional Gateway bundles changed. The corrected NEP-413 SDK, Runtime,
Console, Router, Deriver A/B, Signing Worker, configuration, and requested APAC
placement stayed fixed. Builds and local tests finished before measurements.

| Workload | Baseline median (range) | Candidate median (range) |
| --- | ---: | ---: |
| Registration setup HTTP | 0.588 s (0.516–0.747) | 0.608 s (0.535–0.761) |
| Credential submission HTTP | 0.688 s (0.681–0.722) | 0.945 s (0.604–0.976) |
| Yao execute HTTP | 3.015 s (2.952–3.069) | 2.904 s (2.487–2.978) |
| Server finalization HTTP | 1.725 s (1.550–1.780) | 1.954 s (1.722–1.990) |
| SDK registration | 6.881 s (6.814–6.986) | 6.931 s (6.791–7.406) |
| Browser registration → verified signature | 9.950 s (9.923–10.024) | 9.980 s (9.176–10.074) |

Three samples per arm cannot establish a latency guarantee. These sequential arms
also have no restored-baseline measurement. The full-flow median rose by 29 ms.
The observed ranges overlap. Smaller request counts did not establish a faster
complete registration.

The first candidate submission reached its first Console invocation 282 ms after
the Gateway event. The baseline offsets were 47–50 ms. Its Gateway invocation used
133 ms CPU, against 30–63 ms in the baseline. These observations do not establish
cold-start or network causation. Invocation wall time includes background work.
Event offsets can include transit, scheduling, execution, and clock skew.

Finalization's Router consume step measured 602 ms median in the candidate.
Complete finalization measured 1.954 s. Neither path changed in this candidate.
The next investigation should measure the remaining credential-submission stages
and the Router consume dispatch boundary before another structural change. Setup
also still makes separate Console calls for application-key validation, active
project scope, and home reservation. Combining validation and scope resolution is
a smaller follow-up candidate; it must preserve fresh revocation and scope checks.
The 3–4 second full-registration target remains unmet.

The server build, server type-check, Gateway bundle, bloat check, formatting,
private production lint, and four targeted E2E scenarios passed. Browser scenarios
cover concurrent setup replay and reload, immediate owner signing, and NEAR-only
recovery after a lost finalization credential response. The private Worker/D1
scenario covers regional routing, persistence, restart, and fresh cancellation.
The private type-check reports the same six existing integration errors as its
baseline. No production behavior was changed to satisfy those diagnostics.

The first baseline log stream omitted Console events. Its three successful samples
remain in the evidence as an instrumentation failure. The Console stream restarted
once, and three fresh baseline wallets ran before candidate deployment. All six
Worker streams for the measured arms matched their expected serving versions.
All nine NEP-413 signatures passed independent Node.js Ed25519 verification with a
separate Borsh encoder. Modified message, recipient, nonce, and callback fields
failed verification. Only the NEAR signer loaded; no account funding occurred.

All thirteen original Worker version assignments and placement settings were
restored. Restoration activation [37848816704](https://github.com/seams-tech/seams-monorepo/actions/runs/37848816704)
passed. Registration leases expired through the existing deployment guard. No
guard was bypassed. All observation tails stopped. No new infrastructure was created.

[Sanitized evidence](evidence/r155b-near-registration-request-reuse-20261009.json) retains every sample, the incomplete observation
run, source and bundle hashes, invocation evidence, verification, and restoration.
Raw artifacts remain in the public `.artifacts/r155b-phase6ai` directory and the
private `.artifacts/r155b-phase6ai-hosted` directory.


### Phase 6AJ — read only the registration's ceremony (2026-10-09)

**Keep the data-access and CPU reduction. The complete flow did not become faster.**
Implementation `8aa7531edcf2be075c387700253f421a378aa8e2` is on public `dev`.
No SDK, private application, schema, or Rust protocol change was required.

The APAC shared capability record contained **580,085 bytes** of JSON. Registration
admission, execution, and activation consumption each loaded it, although each
operation needed only its own ceremony. The new registration snapshot exposes only
registration and authorization state. Commits retain that ceremony's recovery and
export records. They preserve record-version checks, wallet ownership fences,
root binding, expiry, and replay behavior. Shared capability operations retain their
existing coherent snapshot and transaction.

This removes three shared-row reads from existing database batches. At the measured
record size, it avoids handling **1.74 MB of unrelated JSON per fresh registration**.
These are implementation-derived row counts. Database API round trips and Console
HTTP counts do not change. The type fixture rejects shared state in direct literals
and broad spreads, and rejects commits without the original snapshot version.

Three fresh implicit, unfunded NEAR wallets ran per arm. Only Gateway code changed.
All six observed Worker streams matched their expected versions. The same NEAR-only
SDK, Console, Runtime, custody roles, and requested APAC placement served both arms.

| Workload | Baseline median (range) | Candidate median (range) |
| --- | ---: | ---: |
| Credential submission HTTP | 0.665 s (0.579–0.739) | 0.587 s (0.581–0.600) |
| Yao execute HTTP | 2.824 s (2.794–2.846) | 3.118 s (2.573–3.167) |
| Server finalization HTTP | 1.750 s (1.542–1.928) | 1.918 s (1.639–2.502) |
| SDK registration | 6.599 s (6.390–7.110) | 7.220 s (6.475–7.736) |
| Browser registration → verified signature | 9.219 s (9.162–10.075) | 10.733 s (9.195–10.815) |

Gateway CPU medians fell from **58 → 22 ms** for credential submission,
**21 → 11 ms** for execution, and **251 → 198 ms** for finalization.
Console calls remained **10 per registration**. Existing bound-root counters still
reported six database round trips and sixteen statements per registration. Those
counters do not cover every database operation in the complete flow.

The larger full-flow median is recorded as observed. Three sequential samples per
arm cannot isolate scheduling and network variation from a small code effect. There
is no restored-baseline measurement arm. The candidate's unchanged custody commit
included a **995 ms** wait, versus 169–176 ms in the baseline. Router consumption
rose from 450 to 539 ms median. Lower CPU does not establish faster registration.
The **3–4 second complete-flow target remains unmet**.

The Router boundary is now quantified for actual registration commands. Median
response-header waits were **405 → 529 ms** for the initial claim,
**50 → 52 ms** for completion in the same incoming request, and
**400 → 515 ms** for consumption in a later request. Consumption's DO invocation
itself took **50 → 52 ms** median and was the fourth command on the same live
instance. This places the large wait outside its short handler. It does not prove
which provider routing, scheduling, or connection step causes the wait. Worker
clock spans, invocation wall time, and HTTP boundaries remain distinct measures.

The next bounded experiment is native DO RPC for the real claim and consume
commands. Cloudflare [recommends direct RPC methods for DO calls](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/).
Whether it reduces this delay is unmeasured. Preserve ownership generation, claim
leases, relocation checks, and exact retries. Use the existing staging objects.
Phase 6L already tested handle reuse, object names, IDs, and placement hints. Its
results do not justify another global handle cache or keepalive loop.

The server build, server type-check, targeted type fixture, exact-tree bloat check,
Gateway bundle, and four browser E2E scenarios passed. Scenarios covered replayed
NEAR admission, lost finalization credentials, protocol rejection with reload, and
immediately usable owner sessions. Six private integration type errors were
identical to the baseline. All six hosted NEP-413 signatures passed independent
Node.js verification and signed-field tamper checks.

All thirteen original Worker version assignments and placement settings were
restored. Restoration activation [37853345386](https://github.com/seams-tech/seams-monorepo/actions/runs/37853345386) passed.
The existing registration leases expired normally. All observation tails stopped.
No new infrastructure was created.

[Sanitized evidence](evidence/r155b-near-registration-ceremony-scope-20261009.json) contains all samples, source and bundle hashes,
serving versions, request counts, independent proofs, reproduction commands, and
restoration checks. Raw files remain in public `.artifacts/r155b-phase6aj` and
private `.artifacts/r155b-phase6aj-hosted`.


### Phase 6AK — native Router wallet DO RPC comparison (2026-10-09)

**Reject the RPC candidate. Keep the existing HTTP command transport.**
The initial claim was faster in the small RPC sample. Complete registration did
not improve, and the later consumption call remained variable. The additional
adapter and build step were not added to `dev`.

The candidate used native Durable Object RPC for the existing claim, finish,
consume, freeze, and transfer commands. RPC carried the same Request and Response
and called the unchanged Rust transaction handler. Wallet identity, home,
ownership generation, claim leases, root authority, replay, and relocation checks
remained intact. Private startup and observation calls retained HTTP.

Three fresh implicit, unfunded NEAR wallets ran in each arm: HTTP baseline, RPC
candidate, then restored HTTP baseline. Only the Router changed between arms.
Gateway code included the accepted Phase 6AJ scoped reads. SDK, Console, Runtime,
Deriver A/B, Signing Worker, configuration, and requested APAC placement stayed
fixed. All six observed Worker streams matched their expected serving versions.

| Workload | HTTP baseline median (range) | RPC median (range) | Restored HTTP median (range) |
| --- | ---: | ---: | ---: |
| Yao execute HTTP | 3.123 s (2.936–3.262) | 3.267 s (2.653–4.149) | 3.425 s (3.116–3.507) |
| Server finalization HTTP | 1.424 s (1.383–1.685) | 1.738 s (1.569–1.993) | 1.852 s (1.831–1.903) |
| SDK registration | 6.614 s (6.544–7.193) | 7.336 s (6.229–8.010) | 7.474 s (6.981–7.575) |
| Registration → independently verified signature | 9.241 s (9.010–10.582) | 10.651 s (9.820–10.729) | 10.052 s (9.205–10.708) |

Router command response waits provide the narrower result:

| Command | HTTP baseline median (range) | RPC median (range) | Restored HTTP median (range) |
| --- | ---: | ---: | ---: |
| Initial claim | 493 ms (487–550) | 376 ms (374–395) | 599 ms (532–857) |
| Finish in the same request | 50 ms (49–52) | 53 ms (51–55) | 55 ms (48–55) |
| Consume in a later request | 58 ms (58–59) | 363 ms (63–383) | 516 ms (470–576) |

Consumption's DO invocation medians remained short: 51 ms for the baseline and
58 ms for RPC. These were later commands on already-running objects. Native RPC
did not remove the large wait outside the handler. The three sequential samples
per arm do not identify its provider routing, scheduling, or connection cause.
The restored HTTP results also show substantial variation without a code change.

Every arm used three Router wallet commands and ten Console HTTP requests per
registration. Existing bound-root counters reported six D1 round trips and
sixteen statements per registration. These counters cover part of the complete
database flow. Browser-observed Gateway requests ranged from nine to ten, with
session-status requests accounting for the variation. A's protocol span
medians were 321 ms for the baseline and 323 ms for RPC. Protocol spans include
transport and cannot be treated as isolated CPU measurements.

All five release builds, the deployment bundle, and the exact-tree bloat check
passed. Four browser E2E scenarios and four Worker/DO scenarios passed. They cover
four regional homes, owner signing, replay, lost replies, admission settlement,
and relocation. An additional historical replay scenario failed because it calls
a debug-only fault endpoint absent from release builds. This was classified as
`environment_or_infrastructure_failure`; no production behavior was changed for
that test. Existing replay scenarios passed. All nine NEP-413 signatures passed
independent Node.js verification and signed-field tamper checks.

All thirteen original Worker version assignments and placement settings were
restored. Restoration activation [37870318951](https://github.com/seams-tech/seams-monorepo/actions/runs/37870318951)
passed. Registration leases expired normally, and all observation tails stopped.
The experiment used existing staging resources. No infrastructure was added.

The **3–4 second registration target remains unmet**. The next bounded change is
to combine fresh publishable-key authentication and active environment resolution
during registration setup. They currently require two sequential Console requests.
Preserve origin, revocation, environment, and tenant-root checks. Remove one
request, then repeat the same controlled comparison. The latency saving remains
unmeasured. Avoid another transport wrapper or keepalive experiment without new
evidence.

[Sanitized evidence](evidence/r155b-near-router-wallet-rpc-20261009.json) retains all samples, exact source and
bundle hashes, serving versions, request counts, independent proofs, and cleanup.
The rejected source and repeatable scripts remain in public
`.artifacts/r155b-phase6ak` and private `.artifacts/r155b-phase6ak-hosted`.
