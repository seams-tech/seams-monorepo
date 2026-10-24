# NEAR hosted signing traces — October 24, 2026

All 21 transaction signatures passed across three wallets.
All 44 signing requests, including one separate message qualification, matched the complete downstream trace.
The captured wallet-object invocations took 7–31 ms in the transaction cohort.
Several slow requests also produced high CPU readings in stateless Router and SigningWorker events.
Those entry paths are the next profiling priority.

This diagnostic cohort estimates no optimization gain.
It has no matched control without instrumentation.
The [generated evidence](near-hosted-trace-20261024.json) retains each request, timing, version, signature result, and artifact hash.
The earlier [baseline registration failure](near-current-baseline-20261024.md#failed-registration-and-cause-limits) remains unresolved.
PostgreSQL integration and provisioning remain deferred.
The instrumentation described below is historical.
The user subsequently requested removal of every profiling addition from this investigation.

## Scope and restoration

The capture temporarily served two diagnostic candidates:

| Worker | Original version | Diagnostic version |
| --- | --- | --- |
| Router | `c1b2e6d7-de01-47e3-a77e-31f8851d2fa8` | `2912c789-c061-4c48-93c4-2954b348d0b2` |
| SigningWorker | `0c69e03c-9932-44ca-abf2-57ab4f7d3688` | `8d1f6964-5349-4102-81de-a9e4f6db844e` |

The other 12 recorded backend versions stayed unchanged.
The runner restored both original versions after capture.
The final snapshot matches all 14 original versions exactly.
All five owned tail processes stopped.
No PostgreSQL resource, database migration, tenant activation, or frontend deployment occurred.

Candidate source was wallet `9493c3a1` and private `2c78ee7f`.
Runtime settings, bindings, placement, handler exports, and uploaded module hashes passed comparison before serving.
The Router wrapper preserved the built WASM bytes and inherited entrypoint methods.
SigningWorker retained its configured Singapore placement target.
All four SigningWorker wallet objects recorded `SIN` from the existing outbound Cloudflare trace-page probe.
These observations do not independently identify each object's physical host.
Actual stateless execution locations and isolate identities remain unknown.

Gateway stayed on `bb63a3be-efff-46f6-b71d-51d68878e37a`.
Its version participates in tenant admission, which requires the protected cutover workflow for a replacement.
A locally built Gateway candidate was never uploaded or served.
The temporary Router wrapper converted the existing request Ray ID into a 32-character diagnostic trace ID.
It also logged ten allowlisted timing fields before Gateway completion readback discarded nested finalize headers.
It preserved response bodies and statuses.

Browser assets used the frozen `0.21.0` baseline site from wallet `cb7fd391`.
All 167 site files matched their saved hashes after capture.
The local HTTPS server supplied assets at the approved staging origins.
Gateway and chain requests used the real network, with ordinary browser CORS behavior.
The harness used fresh browser contexts, automated passkeys, automated confirmation, and zero retries.
This is a mixed-version diagnostic capture, with the original Gateway and frozen browser assets.

## Workloads and timing boundaries

Three existing hosted cases each performed registration, first transaction signing, two warm signatures, lock/reload/unlock, and four more signatures.
The final three signatures followed another unlock with a fresh grant.
The separate qualification registered one wallet and verified one NEP-413 message without funding.

| Transaction SDK signing, ms | Count | Median | p95 / maximum | Above 2 seconds |
| --- | ---: | ---: | ---: | ---: |
| First transaction, including implicit-account funding | 3 | 6,609.4 | 6,850.5 | 3 |
| Warm signing | 6 | 1,404.4 | 2,923.0 | 1 |
| First signing after unlock | 3 | 843.8 | 1,426.9 | 0 |
| Three consecutive signatures per wallet | 9 | 1,058.9 | 2,191.4 | 1 |

Each SDK interval includes automated confirmation and excludes the later independent verification.
Signing after unlock excludes the unlock call itself.
The separate unlock harness intervals were 4,748.8–4,799.5 ms and include automation.
They provide no isolated SDK unlock measurement.
These small descriptive distributions establish no p99 or general acceptance of the signing target.

The three first transactions spent 4,282.7–4,947.9 ms in transaction context.
Each also included a funding request lasting 2,581.0–3,213.4 ms.
Funding occurs inside this first-use workload and needs separate reporting in the next comparison.
These measurements do not describe signing an already funded account.

Five SDK samples exceeded two seconds: `near-1/1`, `near-1/2`, `near-1/7`, `near-2/1`, and `near-3/1`.
Four intervals from confirmation to signing exceeded two seconds: the three first transactions and `near-1/2`.
The latter measured 2,060.8 ms after confirmation.
The `near-1/7` interval measured 1,584.3 ms after confirmation and 2,191.4 ms for the complete SDK call.
Subtracting automated confirmation does not measure human wait or pure compute.

The three transaction-wallet registrations measured 2,683.0 ms at the full SDK median, with a 3,325.6 ms maximum.
Their observed interval after passkey completion measured 1,562.9 ms at the median and 2,158.0 ms at the maximum.
Those post-passkey intervals use timestamps from the same browser-console observer.
The separate qualification measured 4,560.7 ms for SDK registration and 1,475.1 ms for message signing.
These small, sequential diagnostic cohorts do not supersede the 20-wallet baseline or prove a registration improvement.

## Checked facts

| Fact | Observation | Instrument and check |
| --- | --- | --- |
| F1 | All 44 browser signing requests have unique Gateway, Router, SigningWorker, and wallet-object matches. | Ray/path match to Gateway and Router. Trace match to SigningWorker and object. Every event matches its expected version and returns 200. |
| F2 | The 42 transaction requests have object wall times of 7–31 ms. | Platform invocation records. All matched events are untruncated and report `ok`. |
| F3 | The slowest prepare has 979.3 ms browser elapsed, 739 ms Gateway proxy, and 22 ms SigningWorker-to-object call. | Request `a4f554175a3fe5d8`, belonging to `near-1/2`. |
| F4 | That prepare has Router CPU 143 ms and SigningWorker CPU 169 ms. Its object has 8 ms wall and 6 ms CPU. | The three matched platform invocation records. These readings have distinct boundaries. |
| F5 | The slowest finalize has 1,335.3 ms browser elapsed, 662 ms Gateway proxy, and 33 ms object call. | Request `a4f554924e93e5d8`, belonging to `near-1/7`. |
| F6 | That finalize has Router CPU 103 ms and SigningWorker CPU 173 ms. Its object has 12 ms wall and 10 ms CPU. | The three matched platform invocation records. |
| F7 | Seven internal timing fields report zero for every joined request. | The collector observes positive service and object-call spans, while platform CPU remains positive for the same requests. |
| F8 | Every joined object command reports `first_command_after_constructor: false`. | Existing object command log, with command number and object identity retained. This does not identify stateless Worker startup. |
| F9 | All three first transactions include funding. Later signing samples include none. | Browser Gateway records and SDK transaction-context spans. |
| F10 | All 14 original backend versions match after capture. | Saved deployment maps before, during, and after capture. |
| F11 | One matched object timestamp follows its caller's timestamp plus wall duration by 146 ms. | `near-1/2` prepare. Cross-runtime timestamps and invocation durations cannot reconstruct one shared clock. |

The transaction request distributions below contain 21 prepares and 21 finalizes.
The message qualification remains outside these distributions.

| Observation, ms | Prepare median / maximum | Finalize median / maximum |
| --- | ---: | ---: |
| Browser request elapsed | 242.1 / 979.3 | 263.9 / 1,335.3 |
| Gateway proxy span | 49 / 739 | 52 / 662 |
| Router service span | 31 / 422 | 36 / 374 |
| SigningWorker-to-object call | 19 / 40 | 23 / 48 |
| Wallet-object platform wall | 9 / 28 | 12 / 31 |
| Router platform CPU | 10 / 143 | 7 / 181 |
| SigningWorker platform CPU | 3 / 169 | 5 / 173 |
| Gateway completion span | — | 13 / 22 |

These observations overlap.
Their differences do not isolate transport, storage, scheduling, or durable acknowledgement.
Platform wall time can include work after a response and can differ from response-delivery time.
[Cloudflare describes those boundaries here](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#wall-time-per-execution).

The zero-only fields cover admission, dispatch setup, decoding, object schema initialization, object execution, and object handling.
They do not establish zero cost.
Workers clocks advance on I/O, which prevents these timers from measuring synchronous CPU work reliably.
[Cloudflare recommends CPU profiling for this case](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).

## Cause table and limits

| Possible cause | Evidence | Disposition |
| --- | --- | --- |
| Long object execution explains the captured prepare/finalize outliers | F2–F6 show short object invocations and short caller spans for the selected slow requests. | Contradicted within the measured execution boundary. Dispatch or durable acknowledgement outside that boundary remains unresolved. |
| Gateway operation completion explains the slowest finalize | Its completion span is 11 ms, versus 1,335.3 ms browser elapsed. | Contradicted as the main explanation for this request. |
| Transaction context explains warm-signing outliers | `near-1/2` and `near-1/7` report zero transaction-context wait and no funding request. | Contradicted for these samples. It remains a major first-use cost. |
| CPU work in stateless entry paths contributes | F4 and F6 show elevated CPU readings compared with ordinary requests. | Plausible. The responsible functions and removable work remain unknown. |
| Stateless startup, compilation, allocation, or platform scheduling contributes | No stateless isolate identity, startup marker, allocation profile, or function profile exists. | Unresolved. Object constructor evidence cannot decide this. |
| Code before dispatch or after response delivery contributes | Browser, Gateway, Router, and role spans have different boundaries. | Unresolved. A gap between them is insufficient attribution. |
| The instrumentation or recent deployment contributes | No matched control without the wrapper, detailed spans, and tails exists. | Unresolved. No optimization gain or instrumentation-overhead estimate is claimed. |
| D1 explains these outliers or the earlier registration failure | This capture does not isolate D1 execution or reproduce the earlier failure. | Unresolved. Storage replacement has no demonstrated gain. |

Measured results are the request joins, successful signatures, durations, and restored versions above.
The inference is to prioritize stateless-path profiling before changes to the small measured object or completion work.
The exact cause, deployment-warmup effects, provider waits, and the earlier registration failure remain unknown.

These are real hosted product journeys with diagnostic server versions.
Parity with an uninstrumented deployment is not established.
The capture collected no CPU profile or causal optimization comparison.
Do not interpret the zero timing fields as proof that schema initialization or execution is free.

## Next implementation gate and cleanup

1. Profile the existing Router and SigningWorker entry paths during the same hosted workload.
   Compare ordinary requests with the high-CPU requests.
   Retain an arm without detailed instrumentation to measure observer effects.
   Use exact served versions and retain request/version attribution.
2. Identify one repeated cost before changing dispatch, parsing, initialization, or response assembly.
   Preserve fresh authorization, quota, revocation, nonce ownership, and durable replay.
   Keep cryptographic changes outside this investigation unless profiles establish a need.
3. Compare that change with a matched control through the existing lifecycle E2Es.
   Report full SDK time, confirmation subspans, failures, and every two-second breach.
   Keep funding separate and add an already funded first-signing cohort.
4. Keep the completed profiling cleanup intact.
   Use existing platform tools and behavior tests for the next measurement.
   Check that the sampled execution matches the measured requests before changing implementation.

The owner is the Wallet runtime implementation, with hosted verification in this private repository.
Cloudflare's [profile API](https://developers.cloudflare.com/workers/observability/profiling-in-production/) can sample a loaded deployed isolate.
Its selected isolate and capture window still need attribution to the target traffic.
A local profile remains a local reproduction until it exhibits the hosted signal.
Measure the SDK unlock boundary separately before attributing its roughly 4.8-second harness interval.

The original Router version now serves requests, and all capture processes stopped.
The subsequent source cleanup removes the `timing` parameter from wallet `fetch_wallet_request`.
It removes all seven zero-only fields, their header plumbing, parser entries, and obsolete diagnostic assertions.
That first cleanup retained trace correlation and three call spans.
The final cleanup removes those additions as well, at the user's request.
Both cleanups follow the hosted capture and are absent from its measured candidate.

## Source cleanup verification

Wallet commit `c799bbf8` contains the cleanup and updated implementation plan.
The four affected local lifecycle E2Es passed with zero retries.
They covered delegates with quota step-up, adding an ECDSA signer across unlock and a lost reply, message signing across reload, and finalize replay.
The replay case also checked exhausted quota and retirement rejection.
Six request traces still matched one wallet-object command each and retained the three useful call spans.
Independent Node crypto verification passed both retained message proofs and rejected changes to signed fields.

All five release Worker builds, the server build, intended-test type checking, and 38 Cargo lockfiles passed.
Source hashes, build hashes, and the frozen SDK assets matched after verification.
The source cleanup remains local.
It establishes no hosted performance improvement.

The earlier tracing commit's claimed bloat pass omitted new untracked files.
A check of that complete commit found 13,779 duplicated Rust lines, above the unchanged 13,754 threshold.
Its parent passed at 13,740 lines.
The cleanup passes at 13,737 lines.
The earlier public report now withdraws that incomplete bloat claim.

The evidence JSON retains this follow-up under `sourceCleanup`, separate from the hosted measurements.
Its numeric artifacts live in `seams-wallet/.artifacts/optimization-11-near/20261024-trace-cleanup/`.

## Native CPU profiling follow-up

The next capture used the original deployed versions without a new wrapper or deployment.
One seven-signature workflow ran before profiling, one during profiling, and one afterwards.
All 21 transaction signatures passed with zero retries.
All 42 signing requests matched Gateway and Router events by request ID and path.
All 14 deployment versions stayed unchanged.

| Observation | Recorded evidence | Limit |
| --- | --- | --- |
| Unprofiled Router spike | The first control recorded 145 ms CPU on a finalize request. | The new detailed timing code and an active profile are unnecessary for this signal. |
| Router profile | One idle sample record, with no application frames. | It missed the known request activity. |
| Requests during the Router API call | Thirteen matched requests started during that window. Three recorded 127, 104, and 145 ms CPU. | API call time does not identify the profiler's exact execution window. |
| SigningWorker profile | Five garbage-collection records and one idle record. One record encodes 24,158.482 ms of weight. | Encoded weight does not establish request-attributed CPU consumption. |
| Profile attribution | No request labels, isolate labels, or absolute profile start time. | The captured execution cannot be matched to these requests. |

Both APIs returned 200 and valid protobuf data.
That establishes format validity, without establishing observation of the target request.
The profiles continued approximately 18.9 seconds after the profiled browser process ended.
The profiles identified no source function or removable dependency.
No garbage-collection optimization follows from these samples.

Three local inspector attempts also failed before any wallet workflow started.
They encountered a WebSocket connection failure, an unavailable default execution context, and stalled inspector commands.
These are `environment_or_infrastructure_failure` records.
The owned local profiler and service processes stopped.
The local attempts produced no profile result or performance comparison.

The raw profile data, request joins, and cohort results remain under `.artifacts/optimization-11-near/20261024-cpu-profile/`.
An independent review reproduced the signature counts, joins, versions, profile contents, and attribution limits.
The next CPU measurement needs a known nonzero control and a link between sampled execution and target requests.
First-use funding and transaction-context waits remain a separate measured opportunity.

## Final profiling cleanup

The user requested removal of all profiling additions, including scripts and tests.
The cleanup removes the added NEAR timers, trace forwarding, response headers, recorder fields, and profiling assertions.
The original ECDSA parser and collector names return, with their pre-existing behavior intact.
Production file splits remain where rejoining them would exceed the repository's file-size limit.
Functional tests, existing coarse Gateway timings, PostgreSQL adapter work, and unrelated UI work remain.

Cleanup removed temporary capture, analysis, verification, and inspector scripts, including nested copies and compiled Python files.
Cleanup removed copied SDK sites and profiling bundles after verification.
Documents, numeric evidence, raw profiles, and logs remain.
Historical hashes identify the removed capture inputs and do not imply those files remain present.

All four lifecycle cases passed after complete removal, with zero retries, failures, or skips.
All five release Worker builds, the server build, public/private type checks, and 38 Cargo lock checks passed.
The complete bloat check passed at 13,740 duplicated Rust lines against the unchanged 13,754 threshold.
The task-artifact audit found zero remaining profiling code files.
It removed 11,769 temporary or copied files, totaling 468,716,167 logical bytes.
The final numeric receipt is `seams-wallet/.artifacts/optimization-11-near/20261024-profiling-removal/evidence.json`.

## Verification, failures, and reproduction

The existing harness decoded each signed transaction and verified Ed25519 against its registered key.
It checked the transaction signer, public key, and encoded length.
All 21 checks passed after the timed SDK calls.
The artifacts retain those outcomes, but they omit complete signed transaction bytes for offline verification.

The qualification retains its public NEP-413 proof.
The harness verified the signature and rejected changes to signed fields.
A second verifier used Node crypto with an independent Borsh encoder.
It verified the proof and rejected changes to message, recipient, nonce, and callback URL.

Two instrumentation attempts remain in the ledger:

- An initial wrapper omitted the inherited `init` handler.
  Candidate validation rejected it before serving, with zero wallet journeys.
- An initial capture expected connection text that JSON tails do not emit.
  It stopped before wallet journeys and restored all 14 original versions.
  The corrected runner requires unique qualification traces and enforces a hard cohort timeout.

Both failures are `environment_or_infrastructure_failure`.
They are separate from wallet failures and remain outside latency distributions.
The successful retry used one qualification and three primary cases, with no retries or replacement samples.

The retired analyzer checked unique joins, serving versions, runtime outcomes, site hashes, sample counts, and restoration.
It generated the committed evidence JSON before the requested script removal.
Exact harness commands remain in each cohort's `run.json`.
Source hashes cover the deployed wrapper input and the runner.
Raw tail files remain in the protected local artifact directory.
The committed JSON contains only selected metadata, numeric timings, and the public message proof.
An independent review reproduced every join, distribution, breach count, and restored version.
It also verified the qualification proof and reviewed the cleanup source separately.
