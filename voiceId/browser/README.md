# Browser VoiceID prototype

The browser wallet can require native voice approval before its existing NEAR
signing boundary. The first profile accepts one reviewed testnet transfer.
The existing wallet session, device linking, authorization, quota, and MPC flow
still supply signing authority.

The public integration lives on `codex/voiceid-browser` in `seams-wallet`.
The private native host and extension live on `codex/voiceid-native` here.
Neither branch is integrated into `dev` yet.

## Current acceptance

The composed journey uses real Chromium, the real extension, Chrome native
messaging, Moonshine, ECAPA, and a disposable macOS login Keychain namespace.
It replays synthetic speech in real time. Native inference runs with network
access denied. The journey registers a wallet, rejects three voice attempts,
checks quota exhaustion, and unlocks with its owner passkey. Approval then produces
a real Ed25519 Yao signature, which the test verifies against the registered key.
The final stage funds the disposable wallet and confirms a one-yoctoNEAR transfer
on NEAR testnet. The automated passkey is a browser virtual authenticator.
Live microphone qualification remains the next acceptance step.

The [testnet report](../verifier-spike/reports/browser-wallet-testnet-2026-10-23.json)
records the transaction, signature digest, funding, and cleanup. Its
[confirmed transaction](https://testnet.nearblocks.io/txns/5FDPRQykY9XXRfBJBh5UQ3ifQnWdBem8uBTdFc34piZE)
is independently visible on testnet.

Spoof detection, camera evidence, authenticated capture, and a new server factor
remain outside this MVP. The user controls the device and OS.

## Local setup

Use the two isolated VoiceID worktrees. Build Rust from the public Wallet
repository. Set these paths to your checkouts:

```sh
VOICEID_PRIVATE=/Users/pta/.codex/worktrees/voiceid/seams-monorepo
VOICEID_WALLET=/Users/pta/.codex/worktrees/voiceid/seams-wallet
VOICEID_MODELS="$VOICEID_PRIVATE/voiceId/verifier-spike/.cache/native-models/native-inputs.json"
cd "$VOICEID_WALLET"
cargo build --offline --locked --release --lib --bin voiceid-host \
  --manifest-path "$VOICEID_PRIVATE/voiceId/engine/Cargo.toml"
pnpm -C packages/wallet build:sdk
```

A fresh Wallet worktree needs `pnpm install --frozen-lockfile` and
`pnpm -C packages/wallet build:sdk-full` first. Model provisioning follows the
[native model instructions](../verifier-spike/README.md). The host checks the
provisioned model and library hashes before use.

Record three deliberate enrollment samples:

```sh
"$VOICEID_PRIVATE/voiceId/engine/target/release/voiceid-host" enroll "$VOICEID_MODELS"
```

Each capture requires Enter. Grant microphone permission when macOS requests it.
Only the template remains in the local Keychain. `voiceid-host status` checks the
enrollment. `voiceid-host delete` removes it.

Choose the Chrome or Chromium profile that will run the prototype. Register the
native host for that profile:

```sh
node "$VOICEID_PRIVATE/voiceId/browser/install.mjs" \
  --models "$VOICEID_MODELS" --profile /absolute/path/to/Chrome-profile
```

Open that browser profile. Enable Developer mode at `chrome://extensions`.
Select **Load unpacked** and choose `voiceId/browser/extension` from this worktree.
The pinned extension ID is `ackhkimailmgolplljlhgoclgdjcgdba`.

Serve this Wallet build through the existing local wallet origin,
`https://localhost:4002`. Run the existing Caddy configuration directly with
`SEAMS_WALLET_PUBLIC_ROOT="$VOICEID_WALLET/packages/wallet/dist/public"`.
The normal `run_caddy.sh` selects the installed package and replaces that value.
The private site's existing `VITE_SEAMS_WALLET_DIST_ROOT` setting separately
selects `"$VOICEID_WALLET/packages/wallet/dist"` for application imports. Open
`https://localhost:4002/sdk/voiceid.html` in a top-level tab. Select **Enable
VoiceID**. An application iframe cannot change this setting.

Use a wallet already authorized on this device, or complete its existing physical
QR linking flow. Submit one NEAR testnet transfer with a transaction review,
`uiMode: 'modal'`, `behavior: 'requireClick'`, and an `expires_at` deadline.
Review the amount and recipient. Select Confirm. Wait for **Microphone is ready**,
then say exactly:

- “I approve this operation”
- “I cancel this operation”

Capture and consumption share a maximum 25-second deadline. A failure requires
a new review. Disable VoiceID through the same wallet settings page when finished.

## Repeatable evidence

The public approval contract runs without private models:

```sh
cd "$VOICEID_WALLET"
SEAMS_TEST_FRONTEND_URL=http://localhost:4316 pnpm -C tests test:wallet-browser \
  wallet-ui/voiceid-approval.browser.test.ts --project chromium
```

The public MPC contract is
`tests/e2e/intended-behaviours/passkey.voiceid-near.contract.test.ts` in
`seams-wallet`. Run it through the existing intended-test service runner.
It uses a deterministic voice transport and RPC response. It writes
`voiceid-near-mpc.json` under its Playwright result directory.

The composed journey uses the synthetic fixtures produced by the existing
`local_host_journey`. Build and run that journey if `local-host.e2e.media` is absent.
Then run:

```sh
cd "$VOICEID_WALLET"
cargo build --offline --locked --release --example browser_host_journey \
  --manifest-path "$VOICEID_PRIVATE/voiceId/engine/Cargo.toml"
pnpm exec tsx --tsconfig tests/tsconfig.wallet-intended.json \
  "$VOICEID_PRIVATE/tests/e2e/voiceid-browser.e2e.mjs" "$VOICEID_WALLET"
```

The journey requires free ports 4312, 4313, 4510, and 4512–4516. It starts the
existing Wallet services with disposable local state. Set the existing
`SEAMS_INTENDED_SKIP_BUILD=1` only when those Wallet builds are current.
It creates a disposable browser profile and Keychain namespace. It deletes those
and the local Wallet service state before reporting success.

The final stage needs the public testnet faucet and RPC. Each run creates one
disposable faucet account. It funds the wallet with 0.05 testnet NEAR, then deletes
the funder and returns its remaining balance to the faucet. The funder key stays
in process memory. The disposable wallet's remaining testnet balance stays on-chain
after its local signing authority is deleted. No personal funds or keys are used.
The helper waits for account-creation finality before reading its access key.
The [official faucet implementation](https://github.com/near/near-contract-helper/blob/master/src/middleware/createAccount.js)
defines account creation.

Evidence appears under `voiceId/engine/target/browser-journey/`:
`wallet-report.json` and `wallet-transfer.png`. The report separates the first
MPC check with a deterministic RPC from the real testnet confirmation.
No live microphone capture occurs.

## Remaining acceptance

1. Enroll with deliberate live microphone samples on the intended Mac and browser.
2. Qualify approval, cancellation, another speaker, and background noise with live speech.
3. Measure end-to-end delay and tune the speaker gate from those results.
4. Package the native host and extension for installation on a clean Mac.
5. Integrate the isolated branches after concurrent work is ready.

Replay and targeted synthesis detection remain outside the selected MVP.

## Transport boundary

The extension accepts only `https://localhost:4002` and the isolated journey's
`http://localhost:4313` wallet origin. It checks the sender origin, URL, tab,
frame, document, and versioned port name. Each connection accepts one request.
Chrome's host manifest and the native process both pin the extension origin.

The wallet freezes the full request and execution configuration before hashing.
The bridge sends an attempt ID, SHA-256 operation hash, and expiry. The host
reports capture readiness after starting the microphone. The event carries the
same binding and grants no approval. The final result carries that binding and
`approved`, `cancelled`, `rejected`, or `failed`.
The native process accepts no audio, file paths, wallet keys, or template fields
through this protocol. Disconnect closes the attempt. Model setup checks
cancellation before acquiring the enrollment lease.

The implementation follows Chrome's
[native messaging protocol](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).
The public Wallet contract owns request binding and signing admission. The
private engine remains usable independently of wallet protocol types.
