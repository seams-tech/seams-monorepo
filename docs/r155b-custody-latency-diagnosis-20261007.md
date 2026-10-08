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

The new message workload verifies a NEP-413 signature independently and rejects an
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
