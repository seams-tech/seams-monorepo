# Browser Wallet VoiceID prototype

The browser Wallet can require a local voice approval for one reviewed NEAR
testnet transfer. The Wallet keeps its existing device, session, quota, and MPC
signing checks. VoiceID supplies only a short-lived approval for the pending
review.

The public Wallet integration lives on `codex/voiceid-browser` in
`seams-wallet`. The private native engine and loopback service live on
`codex/voiceid-native` here. Both branches use isolated worktrees.

## Current state

The Wallet's browser boundary and real MPC contract pass with deterministic
voice replies. The new loopback transport passes an end-to-end test with a fake
native host. That test confirms origin rejection, one persistent native process,
attempt cancellation, and response binding. It opens no Keychain or microphone.

The native bridge compiles. A direct live status check reached the enrolled
template before the persistent-host change. Live spoken approval through the
new service remains to be checked. The synthetic full Wallet-to-native journey
has been updated for the loopback service and has not been rerun. The packaged
service has not been qualified on a clean Mac.

The first MVP assumes an authorized user controls the device. Spoof detection,
camera evidence, and a new server VoiceID factor remain outside this profile.

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

macOS may ask for access when a newly built host first opens the existing
Keychain items. The package uses an ad hoc code signature. Stable distribution
signing and clean-Mac qualification remain open. The loopback service cannot
dismiss or suppress an OS permission prompt.

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
qualification session, because macOS may ask for Keychain access. It writes
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
