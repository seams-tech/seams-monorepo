# R155G staging completion — October 12, 2026

The code changes are committed on public `dev`. The registration comparison,
release sealing CPU probe, and hosted early-prepare verification use existing
staging resources. No production resources, keys, schemas or wallet records changed.

## Serving deployment

The verified October 12 deployment from published 0.9.0 packages is serving.
All 14 Worker versions match `.artifacts/r155g-remaining-20261012/before.json`.
The resource inventory is also in
`.artifacts/r155f-staging-deploy-20261012/after.json`.
The experimental SDK was served only to the test browser.

The first restore activation failed because two US registration ceremonies had
not expired. Read-only queries confirmed the pending count. No records were
removed. After natural expiry, activation run `38210795747` passed and Gateway
health returned HTTP 200. The comparison's `restored.json` distinguishes restored
Worker versions from successful tenant activation.

The protected synthetic CPU probe is no longer serving. Its uploaded version
`6fe7dc79-9d0c-43c1-b882-78c9de185470` remains in version history. Cloudflare refused
to delete it because it is the latest upload. **Do not activate that version.**
Use the coordinated deployment workflow with fresh build artifacts for the next
release. The API rejection is saved in `profile-version-cleanup.json`.

## Evidence

The public record is `docs/evidence/refactor-155g-final-staging.md` in seams-wallet.
Its JSON companion contains sanitized statistics. The raw private evidence is
`.artifacts/r155g-remaining-20261012/`:

- `arms.json`, `frozen-site.json`, `before.json`, `candidate-versions.json` and
  `restored.json`: sources, groups and serving versions.
- `analyse.py`, `analysis.json`: control, candidate and repeat, six wallets each.
- `verify-proofs.mjs`, `proof-verification.json`: independent verification of all
  27 NEP-413 proofs, including discarded warm-ups and altered-message rejection.
- `seal-profile-requests.json`, `seal-profile-tail.jsonl`: equal-output checks and
  Cloudflare CPU for the published and optimized release modules.
- `analyse-early.py`, `early-analysis.json`: delegate and funded-transaction
  preparation timing. The persistent browser scenario is
  `tests/e2e/hosted-product/near-early-prepare.test.ts`.

The initial early-prepare check assumed the transaction context always arrived
before automated confirmation. Hosted NEAR RPC disproved that assumption.
The SDK correctly used ordinary preparation after confirmation. The measured
scenario keeps review open until context-dependent preparation starts. It records
that deliberate wait and reports post-confirmation costs separately. The test
also closes both expanded and compact receipts before the next transaction.
No production behavior changed to accommodate the test.

## Release coordination

The R155G commits remain local. They do not alter Claude's frozen 0.9.2 release
candidate. Do not push `dev` before that release merges without coordinating its
candidate change. Production mainnet and testnet regional moves remain open until
the user chooses their deployment windows.
