# Registration completion comparison — October 14, 2026

The combined SDK/Gateway candidate passed correctness checks and hosted signing.
The original staging deployment is restored. No package was published.

The public record is `seams-wallet/docs/evidence/registration-completion-20261014.md`.
It contains the diagnosis, limits, full tables, and the link from R155J.

## Candidate

- Public control: `9f57952c`.
- SDK fix: `7caae2fa`; informational startup parity no longer delays session observation.
- Combined server candidate: `8b4dcf5f`; Yao admission joins the initial finalization D1 batch.
- Contract refinement: `e97be4be`.
- Frozen private host: `7e0b2fac`.
- Both SDKs use published 0.10.1 WASM binaries and production JavaScript builds.
- No Console, Runtime, custody, database, placement, or credential change.

## Measurements

Tokyo client, Singapore staging, fresh NEAR-only implicit wallets. All 42
registrations and independently verified NEP-413 signatures passed.

| Median, milliseconds | Initial control, 12 | Candidate, 18 | Repeat control, 12 |
| --- | ---: | ---: | ---: |
| After passkey | 1,738 | 1,752 | 1,771 |
| Registration with setup, without passkey interaction | 2,676 | 2,597 | 2,456 |
| Registration plus first signature, without interaction | 3,097 | 2,922 | 2,980 |
| Browser finalization | 571 | 480 | 566 |
| Server activation consumption | 87.5 | 38.5 | 53 |
| Session publication and return | 13.46 | 13.12 | 13.87 |

The first control overlapped a local negative test. Treat it as supporting evidence.
The candidate and repeat control had no such local test. The full-registration
median has no consistent gain. The code removes one D1 round trip and a demonstrated
completion dependency. The normal return time was already about 13 ms.

Candidate maximums: 3.549 s after passkey; 4.765 s including setup; 5.877 s through
the first signature. No completion stall occurred in the candidate sample.
The sample is too small to establish p99.

## Deployment and restoration

- Original APAC Gateway: `007f559b-17c7-4b31-b71e-41ff3197346f`.
- Candidate APAC Gateway: `af416b4f-4828-4ac3-993c-b3c4179e4eee`.
- Candidate activation: GitHub Actions `38517492323`, success.
- Original-version activation: `38518245449`, success on attempt 2.
- Attempt 1 returned HTTP 409 `readiness_invalid`. A fresh check found zero
  unfinished registrations in all four regional databases. The exact failed
  readiness predicate is unknown. No database edits were needed for the retry.
- All 14 original Worker versions match the starting snapshot. Readiness and
  health checks pass. The restored lane passed 12 registrations and signatures.
- Console remains on `97917595-5def-4b16-b393-9e11d7c7dfa3`, using the migrated
  Singapore database. The old write-fenced database was never rebound.

## Reproduce the analysis

Raw records, frozen sources, build logs, version snapshots, and scripts:
`.artifacts/registration-completion-20261014/`.

```sh
python3 .artifacts/registration-completion-20261014/report.py
node .artifacts/registration-completion-20261014/verify-runs.mjs control-run candidate-run repeat-control-run
```

`comparison.json`, `proof-verification-control-run.json`, `restoration.json`, and
`state.json` record the final result. The experiment used existing resources and
was capped at 42 hosted wallets. No production deployment was performed.
