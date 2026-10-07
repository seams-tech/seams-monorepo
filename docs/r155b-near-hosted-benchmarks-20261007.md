# R155B: NEAR-only hosted benchmarks, 2026-10-07

The clean browser run used passkey registration and unlock. It verified 21 NEAR
signatures across three new wallets. No
ECDSA signer worker or ECDSA operation WASM loaded. A separate diagnostic run
verified seven signatures and collected Gateway database counters.

These measurements use the public SDK against the real staging Gateway, Runtime,
Console and custody Workers. Candidate frontend assets were served locally under
the staging application and wallet origins. The frontend itself was not published.

## Candidate and rollout

- Public source: `2bee39abb947a6524a42e8c74c6ff7b89c1a7acb`.
- Private source: `c0719a8e2f5467c70dd7052369bf87e6bac65a72`.
- The SDK and custody sources matched the audited `298ffc602aa6775b54ca0325d585b4a76e9c2c62`
  build. All 3,645 reused artifact files passed their recorded SHA-256 checks.
- Server, Gateway, Runtime and Console builds used the frozen sources.
- All four signer databases migrated through `0074_email_otp_relocation.sql`.
  Console migrated through `0087_wallet_relocation_dispatch.sql`.
- Custody deployment required the declared `DERIVER_B_WALLET_DO` and
  `SIGNING_WORKER_WALLET_DO` bindings. Their omission caused the initial registration
  failures. Those failed attempts are excluded from the latency tables.
- Runtime readiness fix `458b4f3` excludes terminal registration replay records from
  the in-flight count. The composed renewal E2E verifies pending-work rejection,
  terminal-record handling, regional failure and writer retirement. Its evidence
  digest is `917033cc3c7864661be0bb321a7b7485d6af04622af62ef7f26900353194af5b`.
  This fix changes deployment inspection only. The clean timing run preceded it.

Concurrent work remained outside the frozen candidate. No production deployment
or package publication occurred.

## Clean SDK signing measurements

The SDK timer includes automated confirmation and ends when the SDK returns the
assembled signature. The harness independently verifies the signature afterward.
The test does not broadcast the signed transfer or wait for its confirmation.

| Workload                                  | Signatures |  Median | Minimum–maximum |
| ----------------------------------------- | ---------: | ------: | --------------: |
| First signing call after registration     |          3 | 7.749 s |   6.642–9.047 s |
| Warm signing after registration           |          6 | 2.735 s |   1.999–4.535 s |
| First signing call after unlock           |          3 | 2.135 s |   2.036–2.179 s |
| Three consecutive signatures after unlock |          9 | 1.861 s |   1.532–2.531 s |

The first signing call includes implicit-account funding. Its funding request took
3.014–4.106 seconds. This onboarding measurement is not a pure MPC timing. Do not
subtract request durations from the SDK total to invent a measured MPC result.

Each registration used a fresh browser context and wallet. These are client-cold
onboarding samples. Worker and DO cold-start state was not independently controlled.
Warm samples reuse the wallet and session. NEAR uses an authorized signing lane;
these samples do not use an ECDSA presignature pool.

## Complete workflow measurements

These timers include browser automation, the registration or unlock operation,
and independent verification of the first signature.

| Workflow                                | Samples |   Median | Minimum–maximum | Gateway POST requests |
| --------------------------------------- | ------: | -------: | --------------: | --------------------: |
| Registration → first verified signature |       3 | 20.411 s | 19.752–23.909 s |                    16 |
| Unlock → first verified signature       |       3 |  5.705 s |   4.973–5.734 s |                    11 |

The maximum in each table is the upper end of its range. These small samples do
not establish production percentiles or latency guarantees.

## Separate diagnostic run

Temporary staging observers recorded D1 calls and Gateway-to-Console fetches.
Diagnostic timings are excluded from the clean tables. The database count covers
Gateway database access at response time, including forwarded Gateway access. It
excludes D1 access inside custody Workers, Runtime and Console. Browser HTTP counts
cover Gateway POST requests, excluding RPC requests to the NEAR network.

| Diagnostic workload                     | Samples | Gateway POST requests | Gateway D1 calls | Gateway-to-Console calls |
| --------------------------------------- | ------: | --------------------: | ---------------: | -----------------------: |
| Registration → first verified signature |       1 |                    17 |              129 |                       15 |
| Unlock → first verified signature       |       1 |                    11 |               80 |                        4 |
| Warm/consecutive signing                |       5 |                     6 |            39–40 |                        0 |

Registration status polling accounts for the differing clean and diagnostic HTTP
counts. Do not combine the two populations. Total system-wide D1 counts remain
unmeasured.

Every observed routine signature made two session-status calls and two owner-lane
calls. Each status call used four Gateway D1 calls. Each owner-lane call used six.
Prepare used eight. Final signing used 11–12. Thus the repeated status and lane
requests account for 20 of the 39–40 Gateway D1 calls per signature.

Seven diagnostic signatures recorded these SDK stages. Stages can overlap.

| Stage                    | Median | Minimum–maximum |
| ------------------------ | -----: | --------------: |
| Authorization probe      | 143 ms |      126–211 ms |
| Lane preparation         | 286 ms |      265–455 ms |
| Material-resolution wait |   0 ms |          0–0 ms |
| Prepare                  | 784 ms |    364–1,344 ms |
| Final signing            | 379 ms |    332–1,040 ms |

## Regional verification

The existing probe reports Hong Kong (`hkg13`), London (`lhr01`) and Chicago
(`ord12`). It forwards only staging Gateway traffic. Browser execution remains
local. Browser elapsed time includes the extra probe hop; regional HTTP durations
exclude that hop. Their sum is request work, not an independently measured native
browser signing latency.

The completed travel run verified 12 signatures from one APAC-home wallet. Every
observed home header remained `APAC`. The first signature included funding and is
excluded from this warm travel table.

| Client proxy | Signatures | Browser median | Browser minimum–maximum | Regional HTTP sum median | Regional HTTP sum minimum–maximum |
| ------------ | ---------: | -------------: | ----------------------: | -----------------------: | --------------------------------: |
| Hong Kong    |          5 |        3.047 s |           2.242–3.056 s |                  0.740 s |                     0.717–0.811 s |
| London       |          3 |        5.389 s |           5.333–6.133 s |                  2.524 s |                     2.208–3.276 s |
| Chicago      |          3 |        4.616 s |           4.571–6.150 s |                  2.301 s |                     2.148–3.518 s |

The first funded APAC signature took 7.547 seconds through the probe. Its summed
regional HTTP time was 4.093 seconds. These proxy measurements verify fixed-home
routing and expose travel overhead. They do not replace the clean SDK measurements.
Each warm travel signature made six Gateway POST requests. D1 and Console counters
were disabled for this clean travel run and remain null in its evidence.

## Cleanup and deployment evidence

Final staging activation passed in GitHub Actions run `37568838587`. All four
regional Gateways use the clean candidate after diagnostic observers were removed.
All three benchmark Containers returned `stopped: true`. Their original pinned
images were restored. Probe access was expired and returned HTTP 403. Owned Worker
tails were stopped. No new Worker, D1 database or Container application was created.

An activation canary left pending registration state with a ten-minute expiry.
The next activation waited for expiry. No pending records were deleted or bypassed.

The committed [JSON evidence](evidence/r155b-near-hosted-20261007.json) records
summary distributions, deployment versions, cleanup and hashes of raw results.

## First-sign diagnosis

Funding is a separate user step for the intended application. Exclude it from
the MPC optimization target. Keep its original measurement above for provenance.
The accepted NEAR provisioning budget is approximately two to three seconds.
The immediate optimization target is the hosted Yao setup path.

Earlier [local custody measurements](https://github.com/seams-tech/seams-wallet/blob/2bee39abb947a6524a42e8c74c6ff7b89c1a7acb/docs/near-custody-profiling.md)
recorded a 316 ms median Router execution and 325–327 ms custody join.
Those runs used local Workers and stubbed chain RPCs. They establish a useful
local reference, but do not establish hosted transport or storage latency.

The three clean hosted registrations produced the following spans. Rows nest;
the protocol and WebSocket rows are part of Deriver A execution.

| Yao setup stage                         |    Run 1 |    Run 2 |    Run 3 |
| --------------------------------------- | -------: | -------: | -------: |
| Browser execute request                 | 7,475 ms | 6,400 ms | 5,752 ms |
| Router authorization and root admission |   885 ms |   749 ms |   946 ms |
| Prepare both parties, in parallel       | 1,773 ms | 1,643 ms | 1,642 ms |
| Deriver A execution HTTP                | 3,327 ms | 2,877 ms | 2,319 ms |
| A-to-B WebSocket establishment          |   848 ms |   836 ms |   692 ms |
| Deriver A protocol span                 | 1,414 ms |   353 ms |   184 ms |
| Signing-worker delivery                 | 1,130 ms |   911 ms |   627 ms |

In run 3, authorization, pair preparation, execution and delivery account for
5,534 ms of the 5,752 ms browser request. Only 184 ms lies inside the named
Deriver A protocol span. That span includes peer I/O and is not a CPU-only timer.
The first run's slower protocol span means cold-state effects remain possible.
The current evidence does not isolate Worker startup, DO startup and network delay.

Code inspection identifies repeated storage work around the protocol:

- Each party loads its bound root share during preparation, then loads it again
  during execution. Preparation opens the share and then drops it.
- The active-epoch success path in `TenantRootRoleShareStoreV1::load_bound`
  executes five sequential D1 calls: read the epoch, admit the attempt, read the
  admission, reread the epoch, and read the active share. This is 20 calls across
  two loads per party, before other custody persistence. This is a static count;
  the earlier Gateway counters exclude these custody calls.
- Router authorization includes wallet-DO admission and a tenant-root activation
  receipt lookup. Signing-worker delivery follows execution and persists its result.
- Deriver B's run-3 preparation call took 1,370 ms; its DO handler took 622 ms.
  The later begin call took 542 ms; its handler took 52 ms. These boundaries expose
  substantial overhead outside the handlers. They do not identify network,
  scheduling and startup costs separately.

A read-only D1 probe returned primary locations KIX for Deriver A, SIN for
Deriver B, and ICN for the signing worker. All report APAC. These current locations
do not prove where the Workers or DOs ran during the benchmark. The wallet DO call
sites use `get_by_name` without a location hint. Regional labels alone therefore
do not establish physical colocation for this custody path.

Unlock has a separate source of overhead. Each clean sample made a challenge
request, a verification request, five session-status requests, two owner-lane
requests, prepare and final signing. Challenge plus verification took
1.275–1.320 seconds. The four signing preflight requests took 0.481–0.557 seconds
in summed browser request time. They ran before prepare. The diagnostic verify
request made 25 Gateway D1 calls, and unlock still made four Console calls.

The median-total unlock sample illustrates the 5.705-second measurement:

| Phase                                                   | Approximate duration |
| ------------------------------------------------------- | -------------------: |
| Harness runtime reset, unlock and checks before signing |              2.720 s |
| Signing action through SDK completion                   |              2.199 s |
| Automation drain and confirmation settlement            |              0.785 s |

The SDK signing timer itself was 2.179 seconds in that sample. The first phase
includes a full page reload because `unlockPasskeyWallet` resets runtime state.
Its first network request starts 452 ms into the measured window. Registration
and unlock SDK-only durations were not retained by this observer. Do not present
the workflow timer as either SDK duration, or subtract all unexplained gaps as
test overhead.

The next targeted change should consolidate bound-root admission and retrieval
while preserving epoch retirement, cancellation and replay checks. Measure this
against the same hosted setup spans. Then address DO call overhead and signer
delivery with separate handler and caller timings. For unlock, remove repeated
session/lane resolution within one signing operation while preserving fresh
authorization. A 250–500 ms hosted setup remains an unverified target.

The [diagnostic evidence](evidence/r155b-near-first-sign-diagnosis-20261007.json)
contains sanitized request timelines, custody spans, handler durations and the
read-only database probe. No live deployment changed during this diagnosis.

## Reproduction and evidence

Use [the hosted benchmark instructions](../tests/e2e/hosted-product/README.md).
Run `near-signing-latency.test.ts` for the clean comparison. Use
`SEAMS_INTENDED_SIGNING_SESSION_DEBUG=1` for stage diagnostics. Use
`SEAMS_HOSTED_NEAR_ONLY=1` and select `regional-travel --grep 'apac home:'` for travel.

The local evidence directory is `.artifacts/r155b-near-hosted-20261007/`. It contains
frozen sources, build hashes, deployment and migration logs, workflow results,
raw benchmark samples and `analyze.py`. Failed diagnostic attempts remain separate.
Protected probe credentials and raw Worker tails are not published in this report.
