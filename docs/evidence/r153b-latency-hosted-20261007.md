# R153B return latency correction

The hosted round trip passed the unchanged 60-second limit in both directions.
Return pause through fresh unlock and first signature fell from **73.811 seconds
to 43.326 seconds**. This closes the timing gap recorded in
[the preceding run](r153b-capacity-hosted-20261007.md).

| Measurement | APAC → US | US → APAC |
| --- | ---: | ---: |
| Preparation before pause | 25.728 s | 31.479 s |
| Freeze, including final capacity block | 11.626 s | 14.252 s |
| Copy and verify | 11.588 s | 13.970 s |
| Ownership commit | 0.288 s | 0.314 s |
| Destination activation | 6.938 s | 6.188 s |
| Pause through activation | 30.440 s | 34.724 s |
| Pause through unlock and first signature | **43.845 s** | **43.326 s** |
| Cleanup after activation | 18.859 s | 156.642 s |

These are single observations from a browser in Japan. Both ECDSA transaction
signing and NEAR message signing passed in each destination. Cleanup completed
separately and did not block destination signing. The test observed the normal
five-minute cooldown before the return move.

The correction groups up to eight existing ECDSA segments per Runtime export/import
request. Each native segment retains its durable import and receipt. A lost reply
resumes from the destination's saved cursor, including after a partial batch.
The return's ECDSA authorization calls through activation fell from 51 to 11.

ECDSA freeze and Deriver capture advance up to eight local steps per authorization.
A draining participant returns immediately so admitted work can settle. Return
freeze fell from 26.860 to 14.252 seconds. Return copy fell from 27.373 to
13.970 seconds. The D1 snapshot still uses one export and one import per direction.

Native custody wire formats, schemas, credentials, regional placement, and routine
signing/refill routes remain unchanged. The matching Runtime and Console candidates
are deployed in staging. [Activation and readiness passed](https://github.com/seams-tech/seams-monorepo/actions/runs/37631869120).
All 13 recorded runtime versions stayed unchanged during the hosted test.

The composed relocation E2E passed with a lost reply after a partial ECDSA batch
and a restarted coordinator. Wallet Server, Runtime, and Console builds passed.
Scoped type checks and the public bloat check passed. No unit tests were added.

Implementation commits on `dev`: public `b3db1161`, private `654f65a`.
The browser used the same frozen SDK assets as the preceding runs.

The [JSON receipt](r153b-latency-hosted-20261007.json) records deployed versions,
bundle hashes, stage durations, signing/refill observations, and artifact hashes.
Reproduce with `.artifacts/r153b/latency/reproduce.sh` after starting Console tail
capture. Hosted artifacts are under `.artifacts/r153b/latency/hosted/`.
