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

## Reproduction and evidence

Use [the hosted benchmark instructions](../tests/e2e/hosted-product/README.md).
Run `near-signing-latency.test.ts` for the clean comparison. Use
`SEAMS_INTENDED_SIGNING_SESSION_DEBUG=1` for stage diagnostics. Use
`SEAMS_HOSTED_NEAR_ONLY=1` and select `regional-travel --grep 'apac home:'` for travel.

The local evidence directory is `.artifacts/r155b-near-hosted-20261007/`. It contains
frozen sources, build hashes, deployment and migration logs, workflow results,
raw benchmark samples and `analyze.py`. Failed diagnostic attempts remain separate.
Protected probe credentials and raw Worker tails are not published in this report.
