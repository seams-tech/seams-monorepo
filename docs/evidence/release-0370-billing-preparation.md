# v0.37.0 billing rollout

Status: published and deployed. Final verification passed on November 1, 2026 (JST).

Wallet, Wallet Server, and VoiceID are published as `0.37.0`. Staging, production
testnet, production mainnet, and the Seams-hosted GetSignal runtime use the release.
The Wallet iframe protocol remains `22.0.0`. The wallet-management protocol remains
`5`, and the signed recovery CLI remains `0.29.0`.

## Verified source

- Public package revision: `b2f0053c7d3503363970bac561d4c723062bb524`.
- Production application revision: `93ac4954b8bb25850734a081c7cb3a0cf43c4619`.
- All three npm package records report the pinned public revision as `gitHead`.
- Console consumers use exact `0.37.0` versions and a frozen lockfile.
- The later Wallet module refactor `94e224f40` is outside this release.

## Release and deployment checks

| Check | Result | Evidence |
| --- | --- | --- |
| Wallet clean build, types, billing admission, browser and lifecycle acceptance | Passed | [Wallet validation](https://github.com/seams-tech/seams-wallet/actions/runs/41213492500) |
| Signed npm publication | Passed | [Package release](https://github.com/seams-tech/seams-wallet/actions/runs/41213492804) |
| Private repository checks and billing acceptance | Passed | [Dev validation](https://github.com/seams-tech/seams-monorepo/actions/runs/41218999990), [main validation](https://github.com/seams-tech/seams-monorepo/actions/runs/41219732547) |
| Corrected staging backend, migrations, activation, readiness | Passed | [Backend jobs](https://github.com/seams-tech/seams-monorepo/actions/runs/41218770530) |
| Final staging frontend | Passed | [Frontend deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41219458087) |
| Production testnet full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41219732499) |
| Production mainnet full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41219735235) |
| GetSignal runtime and activation | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41219738023) |

The corrected staging backend used `d6fc442a`. The final revision adds only the
prepaid-warning UI correction. All backend jobs passed before the superseded
frontend job was cancelled. The separate final frontend deployment used `93ac4954`.

CI found two account-lifecycle regressions before production promotion. Checkout
needed to create a payer before the first project. Empty-account deletion needed
to remove the new payment-policy row. Commit `4061599d` fixes both and preserves
billing visibility before a project exists. Commit `d6fc442a` updates historical
schema fixtures and the retired USD 3 resource-charge expectation. Commit
`93ac4954` confines prepaid balance warnings to prepaid accounts.

## Billing acceptance and preservation

The deployed staging test used an isolated account and Stripe test-mode objects.
It verified concurrent MAU credit admission, repeated login, monthly collection,
failed-payment grace, card replacement, one-time payment posting, and a Free request.
Two additional USD 0.004 MAUs fit one remaining cent. A third was refused.
The rendered billing page showed the rules without a prepaid warning on a postpaid account.

Wallet migration `0088` and Console migrations `0114`/`0115` were applied through
the configured deployment workflows. Historical production ledger hashes matched
after migration: one entry and two postings on testnet, and three entries and six
postings on mainnet. Recovery trust bundles, signed revocation snapshots, and
Console recovery certificates remained byte-for-byte unchanged on staging and mainnet.

All 23 final live readiness checks passed. The three public Wallet host manifests
reported SDK `0.37.0` and iframe protocol `22.0.0`.

Repeatable local evidence is under `.artifacts/release-0370/`:

- `staging-billing/acceptance.json` and the committed runner
  `tests/e2e/console/platform-staging-billing.e2e.mjs`.
- `billing-rules-staging.png` and `billing-page.json`.
- `npm-packages.json`, including package integrity values and source revisions.
- `*-ledger-preserved.json` and `*-recovery-preserved.json`.
- `readiness-staging-testnet-production-testnet-production-mainnet-getsignal-testnet.json`.

## Account policy

Deployment did not approve production credit limits or convert customer accounts
to postpaid. Readback confirmed one prepaid account on production testnet and three
on mainnet. Pro pricing, production credit approvals, tax treatment, and Stripe
recovery settings remain business-policy gates before postpaid activation.
No live customer payment was initiated by the acceptance test.

Before a future 1.0 release, review the public API and define its stable compatibility policy.
Version 0.37.0 does not make that stability commitment.
