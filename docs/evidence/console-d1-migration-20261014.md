# Staging Console D1 migration — October 14, 2026

The staging Console now uses `seams-console-sin-candidate-20261014`
(`6b2e86ec-2295-4475-b405-40f5f774ca1a`). Its primary serves from Singapore.
The serving Console version is `97917595-5def-4b16-b393-9e11d7c7dfa3`.
It has byte-identical code to the previous 0.10.1 Console version
`835692e5-060f-4378-9f3d-7892575e9ffe`. Other bindings, credentials, runtime
settings, placement, and handlers were preserved.

## Data preservation

The migration paused Console requests and scheduled work, drained existing
requests, and fenced writes to all source tables. A fresh frozen comparison
verified **121 tables, 28,073 rows, 390 schema objects, and sequence values**.
Every table matched by typed content digest. An independent review also compared
complete typed values. Foreign-key checks passed. Both exported copies passed
local SQLite integrity checks. D1 does not support the remote `integrity_check`
command used by the initial verifier.

The SQL import creates tables and indexes before data, loads parent rows before
child rows, and installs triggers after the data. Statement comparison confirmed
that reordering preserved every exported statement except the 363 temporary
migration guards. The source contained no integers outside JavaScript's exact
integer range or text with embedded NUL, which could need special export handling.

The old database `seams-console-staging-sin`
(`802fa155-b740-4fc5-87fa-3c30e864d1f5`) remains write-fenced as a recovery copy.
The destination accepted new writes after activation. **Do not roll back to the
old database without reconciling those writes.** No source records were deleted.
All temporary diagnostic Workers and diagnostic tables were removed.

## Verification and latency

All 30 fresh NEAR registrations and first signatures passed. Independent Node.js
Ed25519 verification checked every signature and rejected altered signed fields.
Three initial canary wallets preceded the 27-wallet comparison. No server-side
HTTP 5xx responses were captured in either post-migration group.

The comparison uses 99 wallets from `day0101-c` before migration and 27 from
`console-migration-0101` afterward. The client build is the same `site-0100c` build
used by the preceding 0.10.1 backend benchmarks. All compared requests after the
passkey step entered through Japan. These are sequential measurements at different
times, not interleaved trials. They do not establish a p99 guarantee.

| Median, milliseconds | Before | After |
| --- | ---: | ---: |
| Console claim-passkey | 83 | 21 |
| Console publish-routes | 96 | 21 |
| Console complete | 97 | 21 |
| Console registration-setup | 213 | 88 |
| Browser registration after passkey | 1,626 | 1,458 |
| Browser registration, excluding passkey interaction | 2,394 | 2,171 |
| Browser finalization | 501 | 405 |
| First signature | 308 | 319 |
| Registration and signature, excluding interaction | 2,825 | 2,499 |

Post-migration Console p90 timings were 43 ms for claim, 35 ms for route
publication, and 52 ms for completion. Outliers remain: maximums were 268 ms,
1,323 ms, and 1,060 ms respectively. The maximum browser registration interval
after the passkey step was 2,482 ms. The three initial canaries had higher startup
timings and are retained separately in the evidence.

A one-row probe after importing the complete dataset measured a 13 ms write
median, range 12–14 ms. The write-and-read batch also measured 13 ms, range
11–16 ms. The separate empty-database experiment had an occasional 528 ms write,
so the migration removes the persistent write penalty without eliminating tails.

## Deployment and evidence

Commit `8a860643` updates the staging Console target and its existing identity
fixture. `pnpm test:scripts` passed: 53 tests passed and one was skipped.
The target update is committed locally on `dev`. Include it in the repository
ref used by the next staging deployment. Other sessions have unrelated local
commits, which this migration did not push.

Private artifacts, excluded from Git:

- `.artifacts/console-d1-migration-20261014/copy-verified.json`
- `.artifacts/console-d1-migration-20261014/source-final-digests.json`
- `.artifacts/console-d1-migration-20261014/candidate-final-digests.json`
- `.artifacts/console-d1-migration-20261014/comparison.json`
- `.artifacts/console-d1-migration-20261014/signature-verification.log`
- `.artifacts/r155h-singapore-anchor/proof-verification-console-migration-proof.json`
- `.artifacts/console-fresh-d1-20261014/summary.json`

The protected migration folder also holds the full SQL exports and import file.
These contain application data and must remain private. They are not repository
fixtures. The source recovery database must remain fenced while the new database
is authoritative.
