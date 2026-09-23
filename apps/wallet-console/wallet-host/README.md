# Hosted wallet settings

The `wallet-host` frontend build serves this application at `/` and
`/wallet-settings` on each configured wallet origin, including `sign.seams.sh`.
The same artifact serves all lanes: the browser origin selects the matching
network, and tenant discovery supplies its registration credentials and RP ID.
An unavailable mainnet lane displays an error; it never opens the testnet wallet.

`/wallet-service/index.html` and `/sdk/*` remain the exact installed SDK's embedded
runtime and assets. The settings app connects to that same-origin wallet service.

Build and deploy through the existing frontend workflow with `surface: wallet-host`
(or `all`). Before deployment, publish the SDK release containing
`WalletSettingsPage` and `TransactionReviewHost`, then update the exact
`@seams/wallet` dependency pins and lockfile in this repository. Version 0.5.33
does not contain these exports. The build rejects it explicitly.

Validation includes root/settings HTML smoke checks alongside the existing SDK
version and iframe asset checks. A local candidate-package build is useful for
verification, but deployment always consumes the installed release.
