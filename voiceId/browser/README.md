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
access denied. Its report distinguishes signing admission from transaction
broadcast. Live microphone qualification and a funded testnet transaction remain
the next acceptance steps.

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

The public contract runs without private models:

```sh
cd "$VOICEID_WALLET"
SEAMS_TEST_FRONTEND_URL=http://localhost:4316 pnpm -C tests test:wallet-browser \
  wallet-ui/voiceid-approval.browser.test.ts --project chromium
```

The composed journey uses the synthetic fixtures produced by the existing
`local_host_journey`. Build and run that journey if `local-host.e2e.media` is absent.
Then run:

```sh
cd "$VOICEID_WALLET"
cargo build --offline --locked --release --example browser_host_journey \
  --manifest-path "$VOICEID_PRIVATE/voiceId/engine/Cargo.toml"
cd "$VOICEID_PRIVATE"
node tests/e2e/voiceid-browser.e2e.mjs "$VOICEID_WALLET"
```

The journey reserves port 4313. It creates a disposable browser profile and
Keychain namespace. It deletes both before reporting success. Evidence appears
under `voiceId/engine/target/browser-journey/`: `report.json`, `review.png`, and
`listening.png`. No microphone capture or transaction broadcast occurs.

## Transport boundary

The extension accepts only `https://localhost:4002` and the isolated journey's
`http://127.0.0.1:4313` wallet origin. It checks the sender origin, URL, tab,
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
