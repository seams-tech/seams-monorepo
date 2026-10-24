# NEAR 0.21.0 baseline — October 24, 2026

Hosted registration measured **3,322.4 ms** at the median for the full SDK call.
The interval after passkey completion measured **1,815.5 ms**.
First NEP-413 signing measured **745.3 ms**, including automated confirmation.
This run establishes a baseline. It provides no causal estimate of an optimization gain.

The **553.6 ms local registration median** comes from localhost services and automated
passkeys. The historical approximately 1,600 ms result measures hosted registration
after passkey completion. Those figures have different environments and timing boundaries.
They cannot establish a speedup. No production performance behavior changed in this work.

The [generated evidence](near-current-baseline-20261024.json) contains source identities,
per-sample timings, public signature proofs, deployment IDs, and the failure ledger.

## Environment and controls

- Wallet source: `cb7fd391`, with SDK/server version `0.21.0`.
- Private source: `1542df3a` before the diagnostic changes described below.
- All five local role builds use release WASM with the existing SIMD settings.
- The SDK input hash is `167d91c18d6172a204618c79c3d64dea36b79fe87e59403f66802f64b419560c`.
- The run retained 4,035 source hashes, 3,755 frozen SDK hashes, and role build hashes.
  All matched after baseline collection, before diagnostic source changes.
- Hosted browser assets came from a frozen local HTTPS site at the approved staging origins.
  Gateway, custody, and transaction RPC requests used the real network.
  No Playwright request interception bypassed CORS or browser caching.
- The staging iframe manifest reported `0.21.0`. All 14 backend deployment IDs
  matched the initial snapshot, the later recheck, and the completed remaining cohorts.
- Local tests stubbed chain RPC. Local and hosted timing runs ran sequentially after compilation.
  Existing machine activity and unrelated hosted traffic remained uncontrolled.
- Every sample used a fresh browser context. Runtime cold state remained unknown.
  Playwright retries were zero. Every failed attempt remains in the evidence.

The local two-case qualification and one hosted qualification remain separate.
The hosted qualification ran during compilation and contributes no baseline timing.
This work deployed no service, provisioned no resource, and changed no provider.
Independent signature verification follows each timed SDK call.

## Local baseline

All 40 registrations and 80 verified transaction signatures passed.
Each registration kind has 20 wallets, with first and warm signing per wallet.
Every measured signature issued zero separate session-status requests.
Signing times include automated confirmation and exclude broadcast.

| Local SDK measurement, ms | Median | p95 | Maximum |
| --- | ---: | ---: | ---: |
| NEAR-only registration through durable readiness | 553.6 | 606.9 | 742.5 |
| NEAR-only first transaction signing | 347.2 | 360.9 | 362.9 |
| NEAR-only warm transaction signing | 338.5 | 341.0 | 341.1 |
| Mixed registration public return | 749.6 | 769.0 | 769.5 |
| Mixed first NEAR transaction signing | 345.8 | 350.1 | 350.7 |
| Mixed warm NEAR transaction signing | 339.5 | 343.6 | 352.2 |

Mixed public return retains ECDSA readiness while NEAR continues.
Its separate harness timer through NEAR readiness includes automation and polling.
Do not substitute that timer for a complete SDK NEAR-readiness measurement.

Four existing NEAR contracts passed. They cover session observations, quota exhaustion,
delegate step-up, message signing across refresh, and replay after a lost finalize reply.
The Email OTP case initially lacked its Google test token before registration.
The existing helper refreshed the configured identity. The isolated lifecycle rerun passed.
This is correctness evidence for Email OTP, with no latency distribution claimed.

## Hosted message baseline

All 20 primary registration/message workflows passed.
Values below describe successful SDK calls. The p95 uses nearest rank.
Twenty samples provide descriptive percentiles and cannot establish p99 acceptance.

| Hosted measurement, ms | Median | p95 | Maximum |
| --- | ---: | ---: | ---: |
| Full SDK registration | 3,322.4 | 4,573.9 | 4,670.8 |
| Registration after passkey completion | 1,815.5 | 2,591.4 | 2,781.4 |
| First NEP-413 signing, including confirmation | 745.3 | 1,469.4 | 1,626.6 |
| Registration plus first signing | 4,091.1 | 5,927.5 | 5,967.2 |

No first message signature exceeded two seconds.
Post-passkey timing uses the observed completion timestamps of the authentication
and SDK-registration console events. Console delivery can add overhead.
The October 21 comparison used a remotely served iframe and different backend versions.
The current results do not establish a release regression or improvement against that comparison.

| Current stage, ms | Median | Maximum |
| --- | ---: | ---: |
| Registration setup | 935.1 | 2,380.3 |
| Registration respond, including Yao | 1,193.9 | 2,122.6 |
| Registration finalization | 464.7 | 1,636.8 |
| Preparation before signing confirmation | 6.5 | 10.1 |
| Client signature share | 3.4 | 3.8 |
| Signing finalize exchange | 372.0 | 1,306.2 |

These are separate stage distributions. Do not add their medians or nested spans.
The finalize exchange includes transport and server work.
Gateway completion persistence itself measured 19.5 ms at the median in that cohort.
Its proxy span measured 128.5 ms, with a 1,009 ms maximum.
The data favors tracing downstream waits before changing a small local completion step.

## Transactions, review time, and idle

The ordinary transaction cohort attempted three wallets.
Two completed seven verified signatures each. The third failed during registration
and produced no signing sample. Keep that failure outside successful-signing percentiles.

| Successful transaction SDK calls, ms | Count | Median | Maximum | Above 2 s |
| --- | ---: | ---: | ---: | ---: |
| Warm signing | 4 | 1,740.2 | 4,323.9 | 1 |
| First after unlock | 2 | 1,156.5 | 1,301.9 | 0 |
| Three-signature sequences | 6 | 1,176.9 | 2,032.1 | 1 |

The first transaction calls took 5,949.8 and 6,110.0 ms and included account funding.
They remain separate from funded signing. The 4,323.9 ms warm call spent 3,662.6 ms
after confirmation. Its prepare exchange took 2,633.4 ms, including a 2,255 ms
Gateway proxy span. The existing evidence does not split that span into role execution,
storage, dispatch, and reply delivery.

Three additional wallets passed the existing reviewed-transaction/delegate scenario.
Six funded transaction samples measured 700.6 ms from confirmation to assembled signature
at the median. Their remaining prepare wait had a zero median and a 245.3 ms maximum.
The test deliberately keeps review open until early prepare starts.
This measures overlap and does not establish immediate-confirm savings.
Six delegate samples measured 842.6 ms for signature execution after confirmation.

A separate wallet passed the 65-second idle scenario with one retained signing grant.
Its warm control took 857.2 ms. Its post-idle signature took 1,461.2 ms.
One pair cannot establish an idle penalty or justify a keepalive pool.

Independent Node crypto verification passed all 20 saved NEP-413 signatures and
all 12 saved reviewed transaction/delegate signatures. Altered signed inputs failed verification.
The other transaction signatures passed the existing harness's independent verification.
The counts describe separate evidence sets and are not one latency population.

## Failed registration and cause limits

One hosted transaction case failed during registration with `router_execution_burned`.
Its complete SDK registration took **47,542.9 ms**.
Setup accounted for 30,740.1 ms and respond for 16,141.8 ms.
The repeated error context describes one ceremony.

The browser ceremony matches Deriver B preparation metadata.
Its protocol-session bytes match the recorded attempt key.
Object identity and the corresponding request interval connect that attempt to the Router trace.
The trace identifier is `c20b8742e8f3e807114f0d6611337bb4`.

| Captured observation | Value | Meaning and limit |
| --- | ---: | --- |
| Deriver A protocol span | 14,782 ms, failure | Locates protocol waiting without identifying the blocked operation. |
| A invocation | 15,144 ms wall, 173 ms CPU | Supports a wait-dominated invocation. |
| Deriver B protocol span | 15,000 ms, failure | Does not establish why its deadline elapsed. |
| B invocation | 14,805 ms wall, 230 ms CPU | Uses a different boundary from the protocol span. |
| Captured execution admission waits | 16, 23, 29 ms | These recorded waits do not explain the protocol delay. |

Worker spans and platform wall readings have different boundaries.
Do not subtract them to infer exact network or storage cost.
The failed artifact lacks the browser request timing and response IDs needed to
attribute the 30.74-second setup interval. A nearby Gateway setup event alone cannot fill that gap.

| Possible cause | Evidence | Disposition |
| --- | --- | --- |
| CPU alone explains the execution delay | A and B used 173 and 230 ms CPU in the relevant invocations. | Insufficient explanation. |
| Recorded admission reads explain the execution delay | The captured execution waits were 16–29 ms. | Insufficient explanation. Other unobserved waits remain possible. |
| Transaction RPC or signature verification failed | Registration failed before signing started. | Excluded for this failure. |
| First activation or completed prewarm distinguishes the failure | Successful controls also reported first activation and completed prewarm. | Does not distinguish the failure. |
| Protocol handling, stream delivery, activation delivery, or an infrastructure wait | The protocol spans end in failure after roughly 15 seconds. | Unresolved. Per-stage progress and the exact failure reason are missing. |
| Measurement activity contributed | Tails also ran during successful controls, with no matched capture without tails. | Unresolved. |

An independent review confirmed the failure count, correlation chain, and clock limits.
Role trace coverage is incomplete. Runtime cancellation counts and HTTP 200 responses
cannot classify ceremony success. The Router can return a typed failure inside HTTP 200.
No production repair follows from an unproven cause.

Separately, a deployment-metadata request returned Cloudflare HTTP 500 after this cohort.
A later read matched all 14 initial deployment IDs.
This control-plane failure does not establish the cause of the registration failure.
The unstarted reviewed and idle cohorts then ran separately. The failed case was not replaced.

## Diagnostic change and next implementation gate

The hosted recorder now retains signing operation IDs from existing timing events.
The shared Gateway recorder retains the `cf-ray` response header.
Both fields contain correlation metadata. The change adds no request-body logging.

One separate existing lifecycle case passed seven signatures with the new recorder.
Each signature retained one operation ID and both prepare/finalize request IDs.
All 14 request IDs matched captured Gateway events.
This case validates diagnostics and remains outside the baseline distributions.
Public intended-test type checking and the narrow hosted-test type check passed.

The next work is to correlate slow proxy spans with role events and capture the
last completed protocol stage for a failed ceremony. Reuse the existing diagnostics.
Keep the PostgreSQL trial conditional. The independent D1 probes justify investigating
that path, while this registration failure does not establish D1 as its cause.

P0 remains open for warm-message distributions, dedicated step-up latency,
bounded NEAR concurrency, and broader factor/device/geographic coverage.
The original signing target is not accepted across all workloads.

## Gateway-to-Router trace follow-up

All 14 diagnostic requests now match one Gateway POST and one Router POST by request ID and path.
These are the same seven verified signatures from the diagnostic workflow above.
The [generated trace evidence](near-signing-trace-20261024.json) retains the joins, source hashes, and individual timings.
This follow-up adds no signing samples or latency comparison.

| Router invocation, ms | Count | Wall median | Wall maximum | CPU median | CPU maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Prepare | 7 | 45 | 303 | 16 | 72 |
| Finalize | 7 | 137 | 320 | 13 | 108 |

SigningWorker requests lack the corresponding Ray identifier.
All 14 browser records have null D1 and Gateway placement fields.
The evidence therefore cannot split downstream persistence, dispatch, and response delivery.

Cross-worker timestamps also fail a synchronized, nested-timeline interpretation.
For Ray `a4f2096e5a3f815c`, Router timestamp plus wall duration ends 78 ms after the corresponding Gateway sum.
For `a4f209ddce55815c`, that difference is 132 ms.
These arithmetic contradictions constrain the measurement model. They are not measured network delays.
Do not subtract browser, Gateway, Router, or object durations to assign a removable cost.

| Candidate explanation | Observation | Remaining conclusion |
| --- | --- | --- |
| Missing Gateway-to-Router correlation prevents attribution | Each of 14 request IDs matches both Workers. | This gap is closed. Downstream correlation remains missing. |
| Cross-worker duration differences measure network overhead | The two timestamp-plus-wall examples violate the expected nesting. | The proposed arithmetic attribution is unsupported. |
| D1 dominates these signing requests | The diagnostic records contain no D1 timing or trip observations. | Unknown. Existing standalone D1 probes describe a separate workload. |
| SigningWorker persistence or dispatch dominates | The request identifier does not reach those events. | Unknown. Extend existing identifiers and measure those boundaries. |
| Runtime startup explains the slower samples | A fresh browser context does not identify Worker cold state. | Unknown. A correlated runtime observation and matched control are required. |

An independent review reproduced every join and confirmed the timestamp contradiction from the raw records.
The trace supports further instrumentation. It does not justify a routing or persistence change yet.
The [temporary follow-up implementation](../../../seams-wallet/docs/evidence/near-signing-trace-propagation-20261024.md)
propagated a request trace through SigningWorker and its wallet object.
Four local lifecycle contracts passed. A separate diagnostic repeat matched six browser traces to object commands.
Those responses retained ten downstream timing fields after Gateway completion readback.
This local evidence establishes no hosted speedup.
The [subsequent hosted capture](near-hosted-trace-20261024.md) completed that measurement.
All profiling additions were then removed at the user's request.

The independent PostgreSQL work completed WASM adapter and retry-timer support.
Its [native and local Worker E2Es](../../../seams-wallet/docs/evidence/postgres-role-worker-20261024.md) pass.
Deployed Derivers still use D1. Hosted Hyperdrive correctness and performance remain unverified.

## Reproduction and artifacts

Public artifacts: `seams-wallet/.artifacts/optimization-11-near/20261024-p0/`.
Private artifacts: `seams-monorepo/.artifacts/optimization-11-near/20261024-p0/`.
The saved run receipts retain the environment and commands.
The task-specific capture and verification scripts were removed at the user's request.

From `seams-wallet`, reproduce the local summary from the saved Playwright report:

```sh
node tests/scripts/analyze-near-local-latency.mjs \
  .artifacts/optimization-11-near/20261024-p0/local/baseline/playwright.json \
  .artifacts/optimization-11-near/20261024-p0/local/baseline/summary.json
```

Independent verification results and public signature proofs remain in the private evidence JSON.
Historical hashes identify removed scripts and frozen inputs, without implying those files remain present.

Protected Worker tails stay in the private artifact directory.
The generated JSON contains allowlisted evidence and public signature material.
The failure ledger also records invalid build-stamp JSON and the missing Google
token as environment failures. The normal release build regenerated the stamps with
color disabled. No generated stamp or fixture was hand-edited.
