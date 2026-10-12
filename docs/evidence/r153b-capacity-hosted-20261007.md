# R153B capacity block: hosted verification

The matching staging candidate is deployed. Hosted relocation, both signing curves,
and cleanup completed in both directions. The return exceeded the 60-second pause
requirement. This requirement remains open.

| Measurement | APAC → US | US → APAC |
| --- | ---: | ---: |
| Preparation before pause | 24.679 s | 29.055 s |
| Freeze, including final capacity block | 14.257 s | 26.860 s |
| Copy and verify | 13.287 s | 27.373 s |
| Ownership commit | 0.418 s | 0.318 s |
| Destination activation | 6.598 s | 5.561 s |
| Pause through activation | 34.560 s | 60.112 s |
| Pause through unlock and first ECDSA signature | **49.186 s** | **73.811 s** |
| Cleanup after activation | 18.064 s | 141.314 s |
| D1 payload | 152,860 bytes | 216,200 bytes |
| Snapshot exports / imports | 1 / 1 | 1 / 1 |

These are single observations from a browser in Japan. They are not percentiles.
The pause includes automated authentication and signing. The test also signed a
NEAR message in each destination. Cleanup stayed separate from signing. Cloudflare
cancelled return cleanup at its background-task limit. The existing cron resumed
and completed that cleanup.

Signer migration `0076` is applied to APAC, US, WEUR, and OC. Console migrations
`0089` and `0090` are applied. Gateway and Console retain existing service bindings,
regional placement, settings, and credential bindings. No environment variables were
added. [Activation and readiness passed](https://github.com/seams-tech/seams-monorepo/actions/runs/37626903530).
All 13 recorded runtime versions stayed unchanged during the hosted test.

Hosted D1 rejected one migration trigger's `CASE` expression. Equivalent conditional
`RAISE` statements fixed the parser failure. The authorization-transfer E2E passed
again. Wallet Server and Gateway/Console builds passed. The composed relocation E2E
had already passed for this runtime implementation.

The first hosted attempt exposed a stale E2E assumption: admission can now return
after destination activation. The test now accepts the required destination unlock
on that first response. The second attempt completed both moves and failed only
the return's timing assertion. The 60-second assertion remains unchanged.

Source commits: public `35415be9` and migration correction `7cf700aa`; private
`f34e48b` and `76842b5`. The hosted test correction is `69b128d`.
The browser used the same frozen SDK assets as the earlier R153B test.

The next performance investigation must isolate the return's freeze and copy delay.
These measurements do not prove which participant caused the delay. Routine signing
and refill routing remain outside that work.

The [JSON receipt](r153b-capacity-hosted-20261007.json) records runtime versions,
bundle hashes, signing/refill observations, and artifact hashes. Reproduce with
`.artifacts/r153b/capacity/reproduce.sh` after starting the Console tail capture.
The local hosted artifacts are under `.artifacts/r153b/capacity/hosted/`.
