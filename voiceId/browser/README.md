# Standalone native VoiceID evaluation

The current Wallet MVP runs entirely in the browser. Its implementation is in
`seams-wallet/packages/wallet/src/plugins/voiceid`. Browser enrollment, local
speaker inference, WebCrypto device keys, fresh-session unlock, and NEAR signing
need no service from this directory. Do not run the commands below for that flow.
These files remain a separate native-engine evaluation harness.


The browser Wallet can require a local voice approval for one reviewed NEAR
testnet transfer. The Wallet keeps its existing device, session, quota, and MPC
signing checks. VoiceID supplies only a short-lived approval for the pending
review.

The public Wallet integration lives on `codex/voiceid-browser` in
`seams-wallet`. The private native engine and loopback service live on
`codex/voiceid-native` here. Both branches use isolated worktrees.

## Current state

The Wallet activation, fresh-session unlock, and NEAR MPC contracts pass with
generated device keys and deterministic voice replies. The loopback transport
also passes a fake-host end-to-end test. It confirms origin rejection, one
persistent native process, attempt cancellation, and response binding. Approval
replies come from the production Rust serializer with synthetic values.

The current native host supports device-key activation and unlock. The manual
Wallet page uses the existing local enrollment and deliberate capture buttons.
Live spoken activation, unlock, and transfer remain qualification steps. A
clean-Mac package run remains open.

The first MVP assumes an authorized user controls the device. Spoof detection
and camera evidence remain outside this profile. Device-key activation and
fresh-session unlock use the server contracts in the Wallet SDK plugin.

## Local setup

Build Rust from the separate Wallet worktree. Use a fresh output directory for
each package build.

```sh
VOICEID_PRIVATE=/Users/pta/.codex/worktrees/voiceid/seams-monorepo
VOICEID_WALLET=/Users/pta/.codex/worktrees/voiceid/seams-wallet
VOICEID_MODELS="$VOICEID_PRIVATE/voiceId/verifier-spike/.cache/native-models/native-inputs.json"
VOICEID_PACKAGE="$VOICEID_PRIVATE/voiceId/engine/target/voiceid-macos-package"
cd "$VOICEID_WALLET"
cargo build --offline --locked --release --lib --bin voiceid-host \
  --manifest-path "$VOICEID_PRIVATE/voiceId/engine/Cargo.toml"
node "$VOICEID_PRIVATE/voiceId/browser/package.mjs" \
  --models "$VOICEID_MODELS" --output "$VOICEID_PACKAGE"
```

The model inputs must already be provisioned. See the
[native model instructions](../verifier-spike/README.md). The package contains
the native host, shared library, verified model files, loopback service,
enrollment page, licenses, and setup instructions. It contains no voice samples
or templates.

Follow [SETUP.txt](SETUP.txt). Enroll once through the local recording page.
Then start `node serve.mjs "$PWD"` from the package directory. Enable the
VoiceID plugin through the application SDK's `authMethods` configuration.
The service listens on `127.0.0.1:4318` and accepts the two pinned Wallet
origins at `https://localhost:4002` and `http://localhost:4313`.

The native process starts on the first valid Wallet request. It opens one
Keychain session and retains the namespace lease until the service stops.
Repeated status checks and voice attempts reuse that process. A native failure
stops the service's request path; it never restarts the host automatically.
Stop the service before changing or deleting enrollment.

Native Keychain queries use `LAContext.interactionNotAllowed`. A request that
needs OS authorization fails with a device-setup error instead of starting an
interactive authorization flow. This applies to enrollment, capture, and stored
device credentials. The package still uses an ad hoc signature. Stable signing
and one-time device authorization remain prerequisites for live qualification.
The current live host stays stopped until that setup is complete.

For a reviewed testnet transfer, select Confirm after checking the amount and
recipient. Wait for microphone readiness, then say “I approve this operation” or
“I cancel this operation.” The approval expires with that review and cannot
authorize another operation.

## Repeatable checks

The transport journey uses a fake native host and never opens Keychain:

```sh
node "$VOICEID_PRIVATE/tests/e2e/voiceid-local-bridge.e2e.mjs"
```

It writes `voiceId/engine/target/local-bridge-journey/report.json`. The
package journey extracts an archive outside the checkout and checks its idle
service, model hashes, signatures, and origin filter. It also avoids Keychain:

```sh
node "$VOICEID_PRIVATE/tests/e2e/voiceid-package.e2e.mjs" \
  "$VOICEID_PACKAGE.tar.gz"
```

The public browser and MPC contracts run from `seams-wallet`. They use
deterministic voice replies and do not open the native host:

```sh
SEAMS_TEST_FRONTEND_URL=http://localhost:4316 pnpm -C tests test:wallet-browser \
  wallet-ui/voiceid-approval.browser.test.ts --project chromium
```

The composed journey in `tests/e2e/voiceid-browser.e2e.mjs` uses real native
models, synthetic speech, a disposable Keychain namespace, real Wallet MPC,
and one reviewed testnet transfer. Run it only during a deliberate live
qualification session after device setup permits noninteractive Keychain access. It writes
`voiceId/engine/target/browser-journey/wallet-report.json` and a screenshot.

## Transport boundary

The Wallet sends an attempt ID, SHA-256 operation hash, and expiry to its local
service. The service accepts only a bounded request from the pinned Wallet
origin. The native host reports microphone readiness and a result bound to the
same attempt. The Wallet consumes an approved result once before signing.

The protocol carries no audio, wallet key, template, or speaker score. A browser
abort sends cancellation to the native session. An expired or mismatched result
cannot approve the review. The native process holds an exclusive namespace
lease, so another VoiceID process cannot change the enrollment during a check.

## Manual Wallet test

The Wallet worktree includes `/voiceid?authMethod=voiceid` in
`tests/intended-app`. Select Create test wallet to use the SDK's default wallet
ID allocation. The page saves the returned ID in its URL for later unlocks.
A `walletId` query selects an existing wallet and does not name a new wallet.
Passkey unlock stays disabled until that wallet has a NEAR signer. Transfer
review uses only the wallet displayed on the page.

The page exposes owner registration, VoiceID activation, lock, voice unlock,
and a reviewed one-yoctoNEAR transfer to the same testnet account.

Use the current `voiceid-host` binary. The older approval-only package cannot
activate a device key or sign an unlock challenge. Build the host from the
Wallet worktree before a live test, then run one persistent loopback service.
Keep the existing enrollment namespace. A status request confirms enrollment
without recording. All capture starts from a user click inside the Wallet.

Create the wallet with a passkey. Select Save recovery codes, then View recovery
codes inside the Wallet. Save and acknowledge the codes. Activate VoiceID once
under that owner session. After testnet funding, lock the wallet, unlock
with VoiceID, and review the transfer. Say “I approve this operation” when the
Wallet reports that the microphone is listening. The native host keeps its
Keychain session and device credential in memory for subsequent attempts.

The [2026-10-24 live funding receipt](../../docs/evidence/voiceid-live-funding-20261024.json)
records 0.05 testnet NEAR sent to the manual wallet. The disposable funder was
deleted and its remaining funds returned to the faucet. No private key was
persisted. The user's live activation returned a generic native rejection.
The original browser error incorrectly called every rejection a speaker mismatch.
The SDK now reports an unverified spoken approval. Exact live failure attribution,
voice unlock, and the user's reviewed transfer remain open.

The [native wire check](../../docs/evidence/voiceid-native-wire-20261024.json)
reproduced a truncated HTTP stream when approved native replies used snake_case
fields. The browser bridge requires camelCase fields. The native serializer now
emits that exact shape. The same bridge journey passes activation and unlock with
production serialization. It opens no Keychain session and captures no audio.
A later live attempt produced five Keychain prompts and another native exit.
The user confirmed all five prompts belonged to one activation. The previous
host discarded stderr, so that exit's exact cause remains unknown. The service
now logs only bounded error categories and returns a complete setup error for
Keychain denial. It never logs native stderr or restarts a failed host.
The noninteractive boundary compiles. Synthetic bridge and browser tests pass;
actual macOS permission behavior remains unverified. The live host is stopped.
