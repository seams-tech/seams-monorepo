# Enclave readiness plan

Status: proposed hardening work, October 28, 2026. The minimal Nitro compatibility
adapter is implemented. This plan does not authorize cloud deployment or change
the current runtime's security claims.

## Objective

Run Deriver A and Deriver B in independently administered, attested environments.
Keep the existing two-party derivation protocols and client/SigningWorker signing
protocols. A candidate topology uses Google Confidential Space for A and AWS
Nitro Enclaves for B.

This work adds protection against a compromised host or one administrative
account. It must preserve wallet identity, recovery, and one-use protocol state.
SigningWorker protection is a separate, later extension.

## Starting point

| Area                   | Current evidence or limitation                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Google Confidential VM | Recorded runtime and Wallet checks exist for specific builds. They do not establish protection from guest administrators                 |
| Nitro adapter          | Existing Linux runtime, TCP/VSOCK forwarding, regional S3 access, metadata forwarding, and bucket durability                             |
| Local adapter check    | Real `celld`, simulated S3, and Unix sockets replacing VSOCK. Streaming, WebSockets, metadata access, and counter restart recovery pass  |
| Actual Nitro execution | Image boot, VSOCK, complete Wallet flows, and resource limits remain unverified                                                          |
| Secret loading         | The renderer writes secrets into deployment configuration. The Nitro launcher sources a parent-provided Bash environment file            |
| Role placement         | The runtime loads dependency Workers into a cohosted graph. Existing fleet takeover does not establish independent A/B enclave ownership |
| Attestation            | No complete attestation-controlled secret-release path is qualified                                                                      |

References: [runtime qualification](README.md), [provider runbook](provider-runbook.md),
[Nitro adapter](nitro/README.md), and [local adapter evidence](evidence/nitro-adapter.json).

## Security contract

- A host administrator may inspect, modify, replay, or withhold external files
  and network traffic. The enclave must retain its assigned plaintext secrets.
- One role's account, deployment credentials, or recovery credentials must not
  grant access to both tenant-root shares.
- Secret access must depend on approved code, role, tenant scope, and current
  authorization. A running enclave or a valid cloud identity alone is insufficient.
- Each role must verify the operation and peer identity before processing secrets.
- Restart, failover, upgrade, and recovery must retain role separation and current
  ownership. Consumed material must remain consumed.
- Host denial of service remains possible. Two-of-two derivation cannot continue
  when either required role is unavailable.

Different providers can reduce some common failure modes. Shared application
bugs, shared administrators, and shared recovery authority can still affect both
roles. This plan makes no general superiority claim over three-of-five systems.

## 1. Qualify runtime compatibility

Keep this work separate from the stronger isolation claims below.

- [ ] Build an EIF from the exact reviewed runtime and record its architecture,
      binary hash, image measurements, and platform configuration.
- [ ] Run the existing Wallet scenarios through actual Nitro VSOCK. Cover
      provisioning, Ed25519/ECDSA signing, export, and recovery with disposable wallets.
- [ ] Exercise credential refresh, peer disconnects, process termination, and
      restart with empty enclave-local storage.
- [ ] Measure memory, startup, steady-state latency, and recovery after lease expiry.
- [ ] Choose and qualify the Google protected environment. Existing Confidential
      VM evidence does not qualify Confidential Space packaging or secret release.

Acceptance: reproducible provider-specific evidence for runtime compatibility.
Use the existing [E2E directory](../../tests/e2e/celld/). Local adapter results
remain useful controls, with their narrower scope recorded.

## 2. Establish independent role deployment

Start with the existing Worker bindings and protocol transports. Add only the
transport and placement changes needed to cross the new boundary.

- [ ] Separate A and B deployment access, fleet state, role databases, backups,
      wrapping-key permissions, and operator endpoints.
- [ ] Replace cross-role cohosting with authenticated remote role calls where
      the current dependency graph requires it. Preserve streaming and WebSockets.
- [ ] Restrict each enclave to its approved role. Loading a dependency must not
      load the other role's secrets or grant access to its storage.
- [ ] Constrain takeover to replacement instances within the same role boundary.
      A's workload must never fail over onto B's host, or vice versa.
- [ ] Bind each peer channel to a verified role identity. Establish that identity
      through attestation-bound keys or an equivalent reviewed enrollment path.
- [ ] Recheck the exact tenant, wallet, operation, recipient, and epoch inside
      the protected role. Parent routing must not supply signing authority.

Acceptance: A cannot obtain B's material, even after a forced ownership change.
An unauthorized host, wrong-role peer, or cross-role deployment is rejected.

## 3. Bind secret release to the complete workload

Use the provider's existing attestation and key-management facilities where they
express the required policy. Avoid a new general-purpose attestation service
unless a demonstrated integration gap requires one.

- [ ] Define the approved identity: runtime, Worker JavaScript, WASM, executable
      dependencies, and configuration that can affect secret use.
- [ ] Prefer an immutable image containing those artifacts for the first hardened
      deployment. If dynamic loading remains necessary, measured code must verify
      approved digests before loading code or releasing secrets.
- [ ] Replace the sourced parent environment file with data-only configuration.
      Restrict accepted fields. Parent input must not execute shell commands, change
      executable search paths, or inject libraries into the approved process.
- [ ] Replace plaintext custody secrets in rendered deployment variables with
      encrypted material or role-specific references. Decrypt only inside the
      approved environment. Public configuration can retain the existing path.
- [ ] Implement Nitro attested KMS requests with the response encrypted to a key
      generated inside the enclave. Implement the corresponding Google release path.
- [ ] Verify trusted attestation signatures, workload identity, role binding,
      freshness, and acceptable platform state. Reject debug or disallowed images.
- [ ] Bind fresh attestation evidence to the recipient/channel key, using the
      provider-supported mechanism. Reject replay or substitution of that binding.
- [ ] Keep instance-role credentials limited to fetching ciphertext and requesting
      policy-controlled operations. Those credentials must not independently decrypt
      the custody material outside the approved environment.

Acceptance: changing the runtime, Worker, WASM, bootstrap configuration, or
recipient key prevents secret release. A parent administrator can relay traffic
but cannot recover the role's plaintext material.

## 4. Preserve state freshness and one-use guarantees

Bucket durability protects acknowledged writes against loss. Encryption and
durability alone do not prevent a hostile host or storage administrator from
replaying an older valid record.

- [ ] Identify authoritative epochs, execution claims, cancellation records,
      ownership fences, and consumed-material records used by each protected role.
- [ ] Decide where freshness authority lives outside the host's rollback control.
      Reuse the current control plane where its trust and atomicity guarantees fit.
- [ ] Define how an enclave checks that authority before opening restored state
      and before admitting secret operations. Include stale clocks and expired leases.
- [ ] Reject old snapshots and duplicate enclave instances that would revive an
      obsolete owner or consumed protocol material. A fresh process ID is insufficient.
- [ ] Fail closed when current authority cannot be established. Preserve the
      existing reconciliation behavior for operations with uncertain outcomes.

Acceptance: replay an earlier valid encrypted snapshot after completing an
operation. The role must reject reuse and preserve the recorded terminal result.
Repeat with two instances racing to restore the same role. KMS decryption alone
does not satisfy this acceptance condition.

## 5. Separate administration, updates, and recovery

- [ ] Use separate account identities and hardware security keys for A and B.
      Review email recovery, backup authenticators, CI credentials, and break-glass
      access for shared authority that can control both roles.
- [ ] Separate workload deployment from permission to approve secret-release
      policies. Record who can change approved image digests or image-signing keys.
- [ ] Define a bounded upgrade overlap. Drain old work, preserve operation claims,
      activate approved replacements, and retire obsolete secret-release permissions.
- [ ] Prevent rollback to revoked images, credentials, or authorization epochs.
      A software rollback must not roll back durable protocol history.
- [ ] Restore each tenant-root share only into its own approved role boundary.
      Verify the expected public identity before activation and retire the source
      through the existing authorized process.
- [ ] Preserve the latest signed recovery revocation history. Never substitute an
      older or empty snapshot during enclave restoration.

Follow [recovery trust operations](../../docs/recovery-trust-operations.md) before
changing recovery trust or deploying its control plane. Keep the private recovery
signing key outside runtime Workers. No recovery trust rotation is implied by
this plan.

Acceptance: complete an authorized role replacement and recovery. Reject an
old image, old snapshot, revoked signer, wrong-role destination, and replayed
activation. The wallet public identity must remain unchanged.

## 6. Review evidence and release the hardened profile

Use a small set of composed E2E scenarios with disposable material. Extend
existing scenarios rather than adding unit tests or source-text guards.

| Scenario                                     | Required result                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Modified artifact or bootstrap input         | No unauthorized code execution with custody secrets and no secret release |
| Compromised A account                        | No access to B's secret material or release policy                        |
| Parent intercepts or modifies peer traffic   | No secret disclosure or unauthorized operation                            |
| Kill, partition, and role takeover           | Same-role recovery, preserved claims, and no duplicate operation          |
| Replay old storage or start duplicate owners | No rollback of authority or one-use state                                 |
| Upgrade, revoke, restore, and retire         | Identity continuity and rejection of obsolete authority                   |
| Complete Wallet flows under load             | Measured latency, memory, throughput, and recovery cost                   |

Each run must produce an artifact with the source revision, runtime and workload
hashes, public policy identities, provider configuration, commands, and observed
results. Exclude secrets. Record local simulation and provider execution as
different evidence. Obtain focused review of the new trust boundaries before
claiming protection from the host operator.

## Implementation order and ownership

1. Qualify the existing adapter on Nitro before expanding runtime support.
2. Resolve role placement, remote calls, and administrative ownership.
3. Implement workload binding and attested secret release as one complete boundary.
4. Establish freshness, upgrade, and recovery behavior before enabling real custody.
5. Complete the composed evidence and review before deployment promotion.

Private packaging, provider configuration, and composed acceptance tests belong
in this repository. Changes to Wallet role admission, wire contracts, or core
custody state belong in `seams-wallet` and enter this repository through exact
package releases. Preserve the existing two-party algorithms throughout.

SigningWorker attestation remains a follow-up after these Deriver requirements
pass. It needs separate signing-latency, presignature-state, and client-boundary
validation. General threshold signing is outside this plan.
