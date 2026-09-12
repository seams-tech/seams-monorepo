# R121: browser-approved CLI recovery-key enrollment

Updated: September 11, 2026

Status: implemented and locally accepted through pair commitment, backup creation,
and verified recovery ZIP download. CLI 0.4.0 is published. All four rotation E2Es now pass locally. Hosted acceptance remains in the
[execution checklist](./refactor-121-remaining-steps.md).

## Outcome

A tenant runs one command, approves the request in the Console, and saves a
private wrapper key on their computer. The CLI uploads only the public key
and completes the existing proof-of-possession challenge automatically. The
browser session and private recovery key never cross into the other component.

This extends [R121](./refactor-121-tenant-derivation-root-security.md).
Keep delivery evidence in [remaining steps](./refactor-121-remaining-steps.md).

## Tenant experience

The dashboard presents one prefilled command per recovery-key holder. The published package is `@seams/wallet-cli`:

```sh
npx @seams/wallet-cli@0.4.0 derivation-root recovery-key setup \
  --console-url https://console.seams.sh \
  --environment <environment-id> --role deriver-a
```

The UI fills in the released version, Console API URL, environment
and role. It explains that Node.js 22 or newer and an internet connection are
required. Offer the native release download for users without Node. No manual CLI installation,
file-descriptor flags, session-token copying, or shell-script wall is required.

1. The package obtains the verified native binary for the supported OS/CPU.
2. The CLI creates the private-key file at the displayed path without a
   passphrase. Password protection is optional when downloading the ZIP. An existing file
   can be explicitly reused after checking its role; it is never overwritten.
3. The CLI starts an enrollment request bound to that public key, opens the
   dashboard, and displays a confirmation code. If opening fails, it prints the
   approval URL for the user to open manually.
4. The dashboard requires sign-in, displays the matching code, organization,
   environment, role, and public-key fingerprint, then asks for explicit approval
   with fresh custody verification. Visiting the URL alone grants nothing.
5. The CLI waits, receives narrowly scoped enrollment authority, uploads the
   public key, decrypts the server's challenge locally, and sends the proof.
6. Terminal reports enrollment success and the saved file location. The dashboard
   updates automatically. After both holders finish, commit the verified pair
   through the existing custody policy and enable backup creation.

Generation is local and can run offline through the existing create command.
Downloading the tool, browser approval and enrollment require connectivity.
Each holder runs their role's command separately. Single-owner governance still
requires two distinct recovery keys, stored separately.

## Smallest server design

Implement an enrollment-specific device approval flow. Reuse the existing Console
login, custody step-up, recipient challenge/confirmation, audit and pair-commit
logic. Do not issue a general Console session to the CLI.

- Start returns a high-entropy polling secret, request identifier, human comparison
  code, approval URL, expiry and polling interval. The browser URL contains only
  the request identifier; it never contains the polling secret or issued authority.
- Bind the request to the exact public key, role, intended deployment and
  environment. Resolve organization, project and active custody lineage from the
  authenticated browser on approval; reject any scope mismatch.
- Store the polling-secret hash, binding and lifecycle in D1. Use explicit
  `pending`, `approved`, `denied`, `expired`, and `completed` states with required
  branch fields. Expiry is checked by every handler; no cleanup scheduler is
  required for correctness.
- Approval requires current membership, the existing custody permission and fresh
  browser step-up. Preserve two-owner requirements wherever the existing policy
  requires them. Browser assurance authorizes this bound request; it does not
  turn the CLI into the browser session.
- Polling requires the secret. Approved requests yield short-lived authority for
  that key's enrollment challenge and confirmation only. Keep it in process
  memory. Enforce its binding at every use, including current membership and
  lineage. It cannot rotate shares, download backups or enroll another key.
- Persist issuance so a lost poll response can be retried until expiry without
  minting broader authority. Confirmation consumes the operation atomically;
  identical retries return the recorded outcome. Changed requests are refused.
- Denial and expiry stop the CLI with a clear message. Restarting approval reuses
  the encrypted local key. Rate-limit anonymous starts, polling and approval-code
  attempts using the existing service patterns. Never log credentials or secrets.

Use HTTPS and the CLI's existing redirect refusal. Local development must trust
its development CA through the supported transport configuration; never add an
insecure TLS bypass. Show destination and key details to prevent approving an
unexpected terminal request. The confirmation code is a comparison aid, not a
bearer credential.

## Implementation order

### 1. Make the native flow work locally

Add the D1 approval lifecycle and scoped enrollment admission at the existing
custody boundary. Mount the same implementation in local and hosted Console
Workers. Add the dashboard approval view and native `recovery-key setup` command.
Use the existing native release/build directly while proving the operating path.

Integrate with `crates/seams-cli/src/command.rs`, `run.rs`, `console.rs` and its
transport; Console route definitions and policy; and
`packages/wallet-console-server-ts/src/tenantRootSecurity/`.
Keep the new grant parser at the request boundary and pass precise authorized
scope into the existing enrollment logic. Preserve regular Console admission.

Demonstrate one real local browser approval followed by successful key enrollment
without copying credentials. Then demonstrate the second role, pair commitment
and backup creation. Approval must not silently bypass pair governance.

### 2. Package the working CLI

Add a thin npm launcher for the existing Rust binary, using the repository's
release-signing pipeline and verified release artifacts. Pin the native release,
verify it before execution, fail on unsupported platforms, forward arguments and
signals, and preserve the native exit code. Avoid a second crypto implementation.

Confirm package-name ownership and publishing credentials before publication.
Test the package tarball locally before publishing. The npm package and native
release must contain the same enrollment flow. This delivery step is complete:
the recorded initial launcher release was 0.1.1, and the current release is 0.2.3.

### 3. Replace the dashboard commands and ship

Replace the current generated shell bootstrap with the prefilled versioned
`npx` command and brief instructions. Show each key's enrolled state,
approval waiting/denial/expiry, and pair-commit status. Preserve progress across
reload. Remove obsolete manual-token instructions from this setup path.

Deploy persistence and server support first, publish the matching CLI/package,
then deploy the dashboard commands. Staging recovery trust was provisioned on
September 10; verify the deployed configuration before the staging ceremony.
Promote after one successful staging setup. Record one production ceremony with the tenant's
chosen key holders, without uploading their private keys or ZIP passwords.

## Focused validation

After the operating path works, retain one end-to-end contract for approval →
enrollment → pair commitment → backup. Add targeted boundary checks for a wrong
polling secret, expired/denied approval, changed key/role/environment, revoked
membership, and concurrent confirmation replay. Verify an enrollment grant is
rejected by unrelated Console operations. Exercise interrupted setup using the
same key file and package execution on the supported release platforms.

## R118 and scope limits

Initially use the existing passkey step-up. Authenticator choice becomes active
only when [R118](./refactor-118-console-2FA.md) implements and explicitly authorizes
TOTP for this custody approval purpose. Ordinary login 2FA cannot implicitly
satisfy custody approval. Keep the coming-soon option honest until then.

This work excludes general CLI login, persistent CLI sessions, browser key
generation, private-key uploads, desktop applications and restore redesign.
Completion means a tenant can perform the advertised setup command through
backup readiness without manual tokens, undocumented flags, or placeholder
values. A launcher alone does not complete the feature.

## Delivery evidence — September 10

- Local browser-approved enrollment succeeded for both disposable test keys. The
  Deriver B CLI completed with exit 0 after passkey approval and proof confirmation.
  Both keys were staged; pair commitment and backup creation still need acceptance.
- Native CLI/enrollment tests: 15 passed. D1 custody, enrollment-store and Console
  route/policy tests: 15 passed. Frontend and server typechecks passed at implementation.
- PR #114 is merged. The signed native v0.1.1 release is published; the launcher
  verified its signature and downloaded binary and ran successfully.
- `@seams/wallet-cli@0.1.1` was the initial public launcher release. Direct npm
  tarball installation runs successfully. `npx @seams/wallet-cli --help` now also
  installs and exits successfully through normal package-name resolution.
- The former `@seams/cli` package was unpublished at the owner's request.
- September 10 publication check: GitHub Releases and npm `latest` both identify
  [0.2.3](https://github.com/seams-tech/seams-sdk/releases/tag/seams-cli-v0.2.3).
  This establishes publication; the execution evidence above remains scoped to
  the versions and operating paths actually exercised.
- Enrollment backend and dashboard implementation remain on dev; publication of
  the CLI does not establish hosted enrollment support.
- The broader test typecheck previously encountered an unrelated TS4094 error in
  `tests/unit/helpers/syncAccountResponse.fixtures.ts` (`retainProof`).

The remaining delivery checklist is maintained in
[remaining steps](./refactor-121-remaining-steps.md). R118 remains outside this change.
