# Hosted NEAR registration and first-signing comparison

The candidate improved first-sign preparation. Median first signing fell from
604.2 ms to 513.0 ms, a 15.1% reduction. Registration after passkey completion
stayed at 1.08 seconds. The combined SDK median fell by 7.5%, but this experiment
does not establish a reliable combined improvement.

Staging serves `0.15.7-staging.a48231b6` from public commit
`a48231b68c7175aeff0d1b8aae3a50db6989a331`. The baseline was published SDK `0.15.6`.
The final Pages deployment is `4cb4310e-3b89-4300-85f0-c5e1068b93b2`.
This is a staging-only artifact. It was not published to npm. The private package
pins remain `0.15.6`. A normal frontend deployment from those pins replaces the
candidate. No backend deployment or production frontend deployment was performed.

## D1 latency follow-up — October 22, 2026

The later [D1 investigation](d1-write-path-diagnosis-20261022.json) reproduced
selective waits outside reported SQL execution on both Deriver databases.
Recorded calls took 888 ms on B and 754 ms on A, with less than 0.5 ms of SQL each.
Independent client measurements confirmed real waits while the other database
responded and the caller continued sending heartbeats. The exact internal cause
remains unresolved. The fixed five-second phase prediction failed its prospective test.

These separate probes identify a remaining storage latency risk. They do not
attribute this comparison's registration variation entirely to D1.
The [future PostgreSQL and Hyperdrive plan](../future-plan-wallet-postgresql-preparation.md#potential-latency-upgrade-postgresql-through-hyperdrive)
describes a potential upgrade using RDS or Google Cloud SQL while keeping Workers
on Cloudflare. It records the required storage ports, disabled query caching,
transaction guarantees, and hosted comparison. No latency improvement from that
upgrade is established.

## Results

Each version has 20 fresh-context registrations in two blocks. All 40 registrations
and first signatures passed. Values are milliseconds. The p95 is the nearest-rank
sample percentile, with only 20 observations per version.

| Measurement | Baseline median | Candidate median | Baseline p95 | Candidate p95 |
| --- | ---: | ---: | ---: | ---: |
| SDK registration, including automated passkey | 2418.5 | 2283.4 | 3426.7 | 3257.9 |
| Registration after passkey completion | 1080.5 | 1080.0 | 1919.0 | 1537.0 |
| First NEP-413 signing, including confirmation | 604.2 | 513.0 | 831.3 | 814.6 |
| Registration plus first signing, SDK calls | 3101.2 | 2868.6 | 4035.2 | 3742.5 |
| First signing with confirmation time removed | 421.9 | 242.9 | 703.7 | 550.4 |
| Preparation before the signing prompt | 86.8 | 7.2 | 168.0 | 9.1 |
| SDK flow with both interaction times removed | 2597.6 | 2074.7 | 3482.6 | 2928.1 |
| Harness start through verified signature | 4623.6 | 3769.7 | 5426.0 | 4653.0 |

The combined SDK median is calculated from each sample's registration-plus-signing
sum. It is not the sum of the two marginal medians.

The descriptive 95% bootstrap interval for the combined median change is
−749.5 to +165.7 ms. This interval includes no improvement. First signing's interval
is −158.0 to −17.2 ms. These intervals assume independent observations. Sequential
network and backend effects can violate that assumption.

The repeated blocks show why the combined result needs caution:

| Block, in execution order | Registration median | First-sign median | Combined median |
| --- | ---: | ---: | ---: |
| 03-baseline | 2188.0 | 541.9 | 2750.2 |
| 04-candidate | 2380.4 | 542.5 | 3072.9 |
| 05-baseline-repeat | 2647.6 | 668.2 | 3450.0 |
| 06-candidate-repeat | 2199.2 | 506.9 | 2777.1 |

The first candidate block did not improve combined latency. The repeated candidate
block did. Registration and server variation are larger than the saved preparation
time. Confirmation automation also varied: its median rose from 205.7 to 268.0 ms.
Automated passkey time rose from 415.6 to 529.8 ms. Interaction-subtracted results
are useful diagnostics; they are not a human-observed stopwatch measurement.

The complete browser harness improved from 4,623.6 to 3,769.7 ms at the median.
That clock includes Playwright interaction, polling and independent verification.
Its 853.9 ms reduction must not be attributed entirely to the optimization.
Use the SDK measurements to assess the application change.

## What changed

The existing NEAR signer worker starts during passkey registration. No new worker
type was added. All 20 candidate samples requested it before registration completed.
All 20 baseline samples requested it afterward. Preparation before confirmation
fell from 86.8 to 7.2 ms. This directly supports the intended mechanism.

The custody ceremony worker already existed. It derives owner signing roots and
verifies the wallet key manifest during registration and recovery. It retains WASM
state across server round trips. Its URL names its browser script. A separate
worker allows ceremony code to load when needed, at the cost of another worker
and module initialization. It is a design choice, not a requirement introduced by
this optimization.

The session-sealing build change only improves development builds. Production WASM
was already optimized. This comparison reused the published production WASM, so it
does not count that development improvement as a deployed gain.

## Controls and verification

- The staging wallet iframe and its SDK assets were served by Cloudflare Pages.
- The fixed test application was served locally at its approved staging origin.
- Gateway and signing services were remote. All 14 backend version IDs matched
  before and after the comparison.
- Each sample used a fresh browser context. No request interception or artificial
  delay was applied. Browser and backend cold state must not be conflated.
- The source snapshot came from `git archive`. Other agents' Rust edits were excluded.
- Candidate JavaScript used the published release workflow's `build:sdk` settings.
  Unchanged worker files and WASM bytes were reused from exact package `0.15.6`.
- The first sample in every block stayed in the results. Server cold state is unknown.
- All 50 retained signatures, including the supplemental block, passed independent
  Node crypto verification and signed-field tampering checks.
- The candidate manifest, wallet service, host runtime, registration chunks and
  signer script passed serving checks. All five candidate readiness checks passed.

Block 01 failed before registration because another benchmark occupied the test
port. Block 02 completed while that benchmark ran and remains supplemental.
The primary block selection was fixed before candidate measurements. No failed
product flow was removed from the primary comparison.

The final backend check needed a Wrangler OAuth refresh after HTTP 401. The repeat
check matched all backend IDs. The default smoke command expects the installed
package version, so it was stopped. The same readiness functions passed with the
explicit staging candidate version. These are infrastructure and configuration
events, not production regressions.

## Artifacts and interpretation

The [machine-readable evidence](near-hosted-speed-20261021.json) contains every
primary sample, block statistics, deployment IDs, asset hashes and signature proofs.
Raw browser timings, build logs, the frozen deployment archive, verification scripts
and reproduction instructions are retained in
`.artifacts/near-hosted-speed-20261021/` in the private repository.

Run `node .artifacts/near-hosted-speed-20261021/verify-proofs.mjs` to recheck all
50 signatures. Run `python3 .artifacts/near-hosted-speed-20261021/analyze.py` to
reproduce the statistics. The artifact README records the deployment sequence.

This workload measures fresh implicit-wallet registration followed by the first
NEP-413 message signature. It does not measure funded transaction submission,
chain finality, physical passkey response time or production p99.

The evidence supports a small first-sign preparation improvement. It does not
support a claim that registration became faster. A reliable combined-latency claim
needs more randomized, interleaved samples under stable load and controlled prompt
response timing.
