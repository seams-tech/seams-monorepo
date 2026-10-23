# VoiceID wallet auth method

The target is an opt-in Wallet authentication method. VoiceID can issue a fresh
Wallet Session after the previous session expires. The SDK loads its browser
module only when an app selects `authMethods: [voiceIdAuthMethod()]` and a
VoiceID operation starts.

## First device profile

The user activates VoiceID while holding an existing owner Wallet Session from
a passkey or Email OTP unlock. The user then keeps physical possession of an
open, active Mac or phone. The device and its OS are trusted for this first
profile. The native implementation starts on Apple Silicon macOS; another native
adapter can implement the same contract on iPhone.

This profile does not evaluate spoofed or replayed recordings. The user is
assumed present and able to notice an attempted recording replay. The protocol
still rejects a reused assertion, a changed wallet, a changed origin, and an
expired challenge. The product makes no spoof-resistance claim.

## Authority and custody

The native device holds a randomly generated authorization private key and a
separate random factor secret. Both are scoped to one wallet and one VoiceID
activation. Voice samples and embeddings never derive either value. The private
key never leaves the native device store. The factor secret crosses the local
bridge only after a successful, user-started VoiceID check.

The existing owner unlock authorizes activation. The server stores the
authorization public key as a new `voiceid` Wallet auth method bound to the
existing wallet authority. The Wallet custody worker reseals the existing wallet
custody seed under the random factor secret and binds the envelope to that
exact auth method. VoiceID never receives the custody seed or an MPC share.

The server alone verifies a VoiceID device assertion and creates verified
factor evidence. A local `approved` result cannot mint a Wallet Session. The
server checks the method's active status and authority before issuing a fresh
session and quota. Revocation blocks later issuance and retires sessions issued
by that method.

## Activation

1. Require an active owner Wallet Session from a different auth method.
2. Check enrollment on the selected physical device.
3. Create the device authorization key and random factor secret locally.
4. Reseal the existing custody seed under a VoiceID envelope in the Wallet
   custody worker.
5. Register the public key and envelope under one server-verified source
   authorization. Commit the method only when both records can be used.
6. Mark the local activation ready only after the server confirms the method.

An interrupted activation leaves no active VoiceID auth method. Retrying uses
the same activation identity or starts a fresh one. Replacement and removal
require another active owner method. A voice result alone cannot replace the
device key or enroll a new wallet.

## Unlock

1. The SDK requests an exact wallet, method, origin, and short-lived server
   challenge after a visible user action.
2. The native host checks the enrolled speaker while the device is open and
   active. Cancellation or capture failure ends the attempt.
3. After a match, the native host signs the challenge with its registered
   device key and releases the scoped factor secret to the Wallet origin.
4. The server verifies the key, signature, challenge, expiry, origin, wallet,
   method status, and single use. It issues a fresh Wallet Session and quota.
5. The Wallet custody worker opens the matching method-bound seed envelope.
   It verifies the wallet key manifest before activating owner signing roots.

The unlock result reports `authMethod: 'voiceid'` only after both server
issuance and custody activation succeed. A missing native host, lost device
key, stale template, revoked method, unavailable server, or envelope mismatch
fails closed. The user can recover with an existing owner method.

## Plugin loading

`voiceIdAuthMethod()` is a small SDK descriptor. It contains no callback or
native code. The SDK normalizes descriptors and sends them to the hosted wallet
iframe as configuration. The host imports the VoiceID browser module only for
an enabled request. Disabled applications fetch no VoiceID module and make no
loopback request. The native host and model assets are separate local files.

The Wallet branch has the descriptor, config boundary, on-demand browser
chunk, the earlier per-transaction approval flow, and an exact device-assertion
wire contract with server-only signature verification. The verifier rejects
replay through its atomic challenge-consumption port. The Wallet server now has
a tenant-scoped D1 store that issues exact challenges and consumes each one
once. Its E2E verifies replay rejection and concurrent consumption with two
store instances. No production issuance route calls the store yet.

The macOS host now creates a separate random authorization key and factor
secret for each wallet auth method. Its Keychain record binds both to the
current voice enrollment version. Activation and unlock bridge requests release
the factor secret only after a matching voice capture. An unlock also checks the
wallet, method, device key, Wallet origin, and challenge lifetime before it
signs the canonical challenge. The running host caches one credential after its
first Keychain read. A fake-host bridge E2E checks message routing, origin
rejection, and cancellation without microphone or Keychain access.

The Wallet now stores `voiceid` in its canonical auth-method record and D1
persistence. The D1 migration preserves existing methods, issued sessions,
operation triggers, and indexes. An E2E runs the migration against a real local
D1 database. The Wallet also has a `voiceid` custody-envelope factor in Rust
and TypeScript. Its binding includes the exact device key ID and factor
version. A cross-language E2E reseals a generated test seed in Rust, opens the
envelope in browser WASM, and rejects the wrong factor secret. It writes a
repeatable JSON report with no seed or factor secret.

The Wallet now has an activation HTTP route under an active full-owner
Passkey or Email OTP Wallet Session and the configured hosted wallet origin.
It binds the device public key to the method-bound seed envelope and commits
both in one D1 transaction. Commit-time guards recheck the source method,
authority, session, and quota. An exact retry returns the committed method.
The real-D1 E2E opens the stored envelope in browser WASM and proves that a
duplicate device key or retired source session rolls both writes back.

The Wallet server now issues and stores a short-lived VoiceID challenge
bound to the hosted wallet origin. After the registered device signs it, the
server checks the active method, full-owner authority, and custody envelope.
It consumes the challenge once and issues a fresh Wallet Session and quota.
The E2E retires the original owner session, then uses a generated test key to
issue and read a new VoiceID session. A changed origin and replayed assertion
fail. This test uses no microphone or Keychain access.

The Wallet browser now has typed native capture and server HTTP clients.
The native client checks the device key digest, Wallet origin, challenge
signature shape, expiry, and cancellation. The existing transaction approval
flow shares its NDJSON transport. A fake-host browser E2E covers those paths
without microphone or Keychain access. The HTTP client activates the method,
requests a challenge, and parses the fresh Wallet Session and exact custody
envelope. A real-D1 E2E uses that client for activation and unlock.

The Wallet host still needs to call both clients and the custody worker. It
must install the fresh session and activate signing lanes. A composed E2E with
the native host and a revocation E2E remain. Production voice-only signing is
pending those paths.
