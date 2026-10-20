# Local Gateway registration — October 14, 2026

The local composition now supplies the SDK's existing registration reservation
authority. It also initializes the wallet's stored object addresses and applies
the authenticated local home to custody calls.

## Changes

- Public commit `40a5dbb4` exports `LocalRegistrationSetupAuthority` from
  `@seams/wallet-server/cloud-host`. The class already ships inside 0.10.2.
  Its implementation and the wire protocol are unchanged.
- The private Gateway reads its active tenant deployment before constructing
  the authority. The deployment determines the organization, project, and
  environment key. Missing deployment state refuses construction.
- Existing `WalletHomeCustodyBinding` wrappers supply the local US home and
  retrieve the stored addresses for the exact wallet generation.
- Setup initializes addresses through `D1WalletObjectAddresses`. Pair preparation
  uses the existing backend through the request's `waitUntil` continuation.

## Verification

Two fresh mixed NEAR/ECDSA registrations completed in Chromium with a virtual
passkey. The final repeatable scenario recorded HTTP 200 for setup, respond,
activation, and NEAR provisioning. A fresh NEAR-only unlock also succeeded.

The registered wallet signed a NEP-413 message through the public SDK and its
normal confirmation surface. Node's independent Ed25519 verifier accepted the
signature. Modified message, recipient, and nonce values failed verification.
Server type checking and targeted lint pass. Lint retains two pre-existing
unused-import warnings. The public repository's bloat check passes.

Artifacts are in `output/playwright/registration-authority/`:

- `proof.json`: registration stages, signature proof, source revision, and hashes.
- `register.browser.js` and `sign.browser.js`: repeatable Playwright CLI scenarios.
- `verify-signature.mjs`: independent signature verification.
- `composition.patch`: the private source change.

The first test candidate used stale custody binaries from the public checkout.
Those binaries rejected `ownership_generation`. The successful candidate instead
uses all 15 custody JS/WASM files from published Wallet Server 0.10.2, unchanged.
No Cloudflare resource or blockchain transaction changed during verification.

## Dependency handoff

Published Wallet Server 0.10.2 does not export the authority class. The proposed
patch release is 0.10.3. Publication and the exact private dependency update remain
pending authorization. The private source patch remains uncommitted until that
released dependency is available.

Local validation currently uses this temporary SDK candidate:

`.artifacts/local-registration-authority/candidate-package`

The original installed package is preserved at:

`.artifacts/local-registration-authority/installed-wallet-server-0.10.2`

`node_modules/@seams/wallet-server` points to the candidate. Replace that temporary
link with the exact published package when the release and private pins are ready.
The candidate contains the rebuilt TypeScript package and the unchanged published
custody binaries. No dependency pin or lockfile was changed for this test.
