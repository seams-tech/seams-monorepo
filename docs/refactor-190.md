# R190 — One Workers backend for managed and self-hosted deployment

Status: planned. No runtime migration or adapter removal has started.
Date: October 11, 2026.

## Decision and purpose

Use one Workers backend implementation for Cloudflare and self-hosted deployment.
Run the self-hosted backend through celld on ordinary AWS or Google Cloud VMs.
Remove the application adapters that exist to host the backend in Node.js,
Express, or the separate native VM server.

The primary goals are correctness and less code. A lifecycle change should have
one application implementation. Hosting should not require us to reproduce
service bindings, object execution, SQL behavior, or background-task handling.
Latency and hosting cost are optional measurements. Neither determines whether
this refactor succeeds.

The shared contract is the Workers programming model: fetch handlers, bindings,
Durable Objects, and the storage APIs the wallet uses. Celld and workerd currently
remain separate implementations. Their announced integration is future work.
Standalone workerd's single-instance Durable Objects do not establish distributed
self-hosting support. See the [Cloudflare announcement](https://blog.cloudflare.com/deno-joins-cloudflare/).

This plan owns the cross-repository transition. Public Wallet implementation and
normative behavior documents remain in `seams-wallet`. Private Console composition,
deployment targets, and composed acceptance tests remain in `seams-monorepo`.

## Final architecture

```text
Wallet cryptography and domain state machines
                    |
       One set of Worker entrypoints
       and Durable Object implementations
                    |
          +---------+---------+
          |                   |
 Cloudflare hosting     Celld on Linux VMs
                        AWS or Google Cloud
```

Both hosts execute the same released application code and WASM artifacts.
Provider-specific configuration supplies bindings, resources, secrets, ingress,
and process management. Core wallet code does not select a hosting provider.

The final supported deployment model excludes embedding this backend in Express
or starting the classic Node/native VM backend. Node remains available for build
tools, the CLI, browser automation, and independent signature verification.

Keep the cryptographic crates, typed domain state, transaction operations, and
request/persistence parsers. Keep interfaces that express authority, ownership,
or a real external service boundary. Remove interfaces whose only purpose was
switching between the retired host implementations.

Do not merge A and B, combine their secrets, redesign the protocol, or move
records between D1 and Durable Objects as part of this refactor. Do not rename
working Cloudflare-specific source paths merely to make them sound portable.

## Existing code and ownership

Paths in the first table are relative to `seams-wallet`.

| Area                   | Current files                                                                                                                                  | Planned treatment                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Shared Gateway         | `packages/wallet-server/src/hosted-wallet-gateway.ts` and Worker entrypoints                                                                   | Keep the shared handlers as the application path                                                                     |
| Node Gateway host      | `packages/wallet-server/src/router/node/`                                                                                                      | Remove host HTTP, filesystem WASM loading, binding substitution, and task-drain code after callers move              |
| Express transport      | `packages/wallet-server/src/router/express-adaptor.ts`, `packages/wallet-server/src/threshold/session/signingSessionSeal/transport/express.ts` | Replace callers with the existing fetch/Worker surface, then delete                                                  |
| SQLite host adaptation | `packages/wallet-server/src/storage/syncSqlite.ts`, `packages/wallet-server/src/router/node/nodeSqlite.ts`                                     | Remove classic-host implementations after checking remaining CLI and test consumers                                  |
| Native VM runtime      | `crates/router-ab-dev/src/local_*.rs` and its server binaries                                                                                  | Inventory host-only routing, storage, scheduling, and startup code for deletion. Preserve independently used tooling |
| Worker implementation  | `crates/router-ab-cloudflare/` and `packages/wallet-server/src/router/cloudflare/`                                                             | Retain role implementations, state owners, and persistence semantics                                                 |
| Published surfaces     | `packages/wallet-server/package.json`, `packages/wallet-server/rolldown.config.ts`, artifact packaging scripts                                 | Remove obsolete exports, bundles, dependencies, and launch commands                                                  |
| Local launchers        | `crates/router-ab-cloudflare/scripts/`, `scripts/build-local-tools.mjs`, `scripts/start-local-router.mjs`                                      | Reuse existing Worker launch paths. Remove retired native-host selection                                             |
| Lifecycle verification | `tests/e2e/intended-behaviours/` and existing Rust protocol verification                                                                       | Retain behavioral coverage and independent cryptographic verification                                                |

The Node Gateway already calls the shared handler. Its additional work substitutes
SQLite for D1, HTTP for service bindings, filesystem WASM loading, and a task set
for `waitUntil()`. These are concrete deletion candidates.

`packages/wallet-server/src/router/ror-adaptor.ts` contains WebAuthn Related Origin Requests helpers. Its
name does not identify a classic-server host. Preserve those functions where used.

Paths in this table are relative to `seams-monorepo`.

| Area                  | Current files                                                                                                              | Planned treatment                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Console Express entry | `packages/wallet-console-server-ts/src/router/express-adaptor.ts`, `packages/wallet-console-server-ts/src/router/express/` | Move consumers to the existing Worker/fetch composition, then remove obsolete routes and re-exports |
| Hosted composition    | `packages/wallet-console-server-ts/src/router/cloudflare/`                                                                 | Keep Gateway, Runtime, and Console behavior shared across hosts                                     |
| Deployment            | `scripts/deploy-backend.mjs`, `deployment/wallet-system/targets.json`                                                      | Extend existing deployment boundaries only as needed for celld                                      |
| Local runtime         | `scripts/local-wallet/`                                                                                                    | Consume exact packaged Worker releases and the selected runtime configuration                       |
| Private tests         | `tests/relayer/`, `tests/e2e/hosted-product/`, `tests/e2e/regional-real/`                                                  | Preserve Console/product invariants while removing dependency on Express hosting                    |

Some tests import domain services through Express re-exports. Move those imports
to their owning modules. An import through an adapter does not prove that the
test needs that adapter. Check shared `packages/console-server-ts` consumers before
removing a shared dependency or public symbol.

## Correctness contract

Runtime consolidation must preserve these application guarantees on both hosts:

- Exactly one accepted lifecycle transition wins each contested operation.
- An exact retry recovers the permitted result after a lost response.
- One-use signing material cannot become reusable after restart, restore, or rollback.
- Cancellation and relocation reject stale owners and superseded work.
- A durable outcome exists before the application exposes an irreversible effect.
- A and B receive only their own plaintext inputs, private stores, and secret material.
- Wallet identity, key manifests, authority, quotas, and generation checks remain unchanged.
- Recovery and export retain their existing factor and authorization requirements.

The runtime supplies execution and persistence mechanics. The application retains
authorization, replay, and protocol checks. Identical source code reduces duplicate
implementation risk. It does not prove identical behavior across runtimes.

## Phase 1 — Establish the compatibility and deletion inventory

- [ ] Record current commits, released package versions, runtime versions, and artifact hashes.
- [ ] Trace active production, local-development, CLI, package-export, and test callers of each host adapter.
- [ ] Classify each candidate as host-only, shared domain code, external integration, or independent tooling.
- [ ] Record candidate file counts and non-generated source lines using the existing bloat report where available.
- [ ] Inventory the exact Worker APIs, SQL features, migrations, and binding graph used by all roles and Console composition.
- [ ] Pin a celld release and verify its artifacts. Recheck its compatibility documentation against that release.
- [ ] Prove the complete role graph loads without changes to protocol or domain logic.

Celld's general service support is insufficient evidence for our deployment.
Resolve these specific gates before building a replacement host path:

| Gate                     | Required evidence                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Multiple role Workers    | Router, A, B, SigningWorker, and the tenant-root control plane retain distinct entrypoints, bindings, and secret environments       |
| Cross-script objects     | The control plane and Derivers reach the Router-owned object namespace correctly. They do not create replacement namespaces         |
| Role-private storage     | Distinct databases and required A/B backup-bucket isolation remain enforceable                                                      |
| Rust/WASM                | Exact release shims and WASM load. The workers-rs calls used by our application execute correctly                                   |
| D1 and object storage    | Transactions, conditional writes, constraints, result shapes, and output durability preserve the lifecycle contract                 |
| Object addressing        | Stored namespace-issued IDs, ownership generations, startup, and relocation work without assuming Cloudflare ID portability         |
| Scheduling and transport | Alarms, scheduled refresh, WebSockets, streaming, cancellation, and background work preserve existing outcomes                      |
| Regional routing         | Authenticated home selection remains authoritative without relying on Cloudflare location metadata or unsupported jurisdiction APIs |
| Host dependencies        | WebAuthn/OIDC libraries, cryptographic APIs, request metadata, and trusted proxy handling work on the pinned runtime                |

Celld currently documents beta status and one application per fleet. Its R2
bindings use separate prefixes within the fleet bucket. Our deployment requires
separate A/B backup buckets. A shared prefix must not silently replace that
boundary. Resolve the topology with supported runtime configuration and prove
its binding and access rules. Independent fleets are a candidate to investigate.
Cross-fleet service and object bindings are unverified.

If the runtime cannot preserve the required role graph and storage separation,
record the blocker here and leave existing hosting support intact. Do not create
a second wallet runtime, long-lived compatibility adapter, or protocol bypass to
make the experiment pass. A changed custody boundary requires a separate design
decision. Do not open upstream issues or PRs without the user's instruction.

Sources: [celld limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md),
[R2 mapping](https://github.com/denoland/celld/blob/main/docs/services/r2.md),
[WASM support](https://github.com/denoland/celld/blob/main/docs/wasm.md),
[API compatibility](https://github.com/denoland/celld/blob/main/docs/cloudflare-compat.md).

Exit: every required binding and behavior has a runnable check or a recorded
blocker. No classic-host deletion occurs while a required gate remains blocked.

## Phase 2 — Run the existing application artifacts on celld

- [ ] Start with fresh test wallets and isolated test resources.
- [ ] Build Worker artifacts in `seams-wallet` and consume an exact package release in the private repository.
- [ ] Reuse the packaged artifact inventory and existing configuration rendering. Add no competing resource manifest or general provider framework.
- [ ] Render the celld-supported JSON/JSONC configuration from the established configuration inputs. Keep build steps outside that configuration where required.
- [ ] Keep secrets out of bundles, committed configuration, and evidence artifacts.
- [ ] Verify native binding access and application authentication between roles.
- [ ] Run the shared fetch handlers and Durable Object implementations on both runtimes.
- [ ] Make any necessary API change once in shared code, only when it preserves both hosts' behavior.

Provider differences belong in deployment configuration or external process
management. Core functions must not branch on `cloudflare`, `celld`, `aws`, or
`gcp`. Validate deployment inputs once at the boundary. Use precise types for
resolved configuration. Do not introduce optional identity or lifecycle fields.

The replacement may coexist with the old deployment during validation. It is a
separate test deployment, with no request-time fallback or legacy runtime flag.
Keep one canonical application implementation throughout the transition.

Exit: fresh wallets register and sign on both hosts with the same application
release. This is functional evidence, not production or migration acceptance.

## Phase 3 — Prove lifecycle correctness on the shared implementation

Reuse the public intended-behavior contracts and private composed E2E scenarios.
Change launch and provisioning at the test boundary. Keep test bodies and expected
wallet outcomes common across hosts. Add no unit tests or source-text guards.

Run medium-to-hard scenarios that cover:

| Scenario                    | Required result                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Mixed NEAR/ECDSA wallet     | Register, unlock, refill ECDSA presigns, and verify repeated signatures independently                                              |
| Lost committed response     | Drop a registration or signing response after durable completion. Exact retry preserves the original outcome and consumption count |
| Concurrent signing          | Race valid requests and exact retries. Quota and one-use material consumption remain correct                                       |
| Yao connection loss         | Interrupt a real exchange. The pair cannot be reused improperly, and an independent wallet still succeeds                          |
| Runtime failure             | Stop the owning node after a durable claim. Restart or fail over, then verify the contract-defined recovery or rejection           |
| Factor and device lifecycle | Add a factor, link and revoke a device, recover, and verify that revoked credentials cannot sign                                   |
| Relocation                  | Interrupt transfer, retry, activate the destination, and prove the old ownership generation cannot authorize work                  |
| Tenant-root lifecycle       | Refresh, retire, and restore through the existing authorized flow. Replay and incomplete delivery remain safe                      |
| Private product composition | Verify Console admission, session publication, unavailable-Console signing, and regional completion retry                          |

Run celld failure scenarios on multiple nodes with a supported remote bucket.
Single-node local development cannot establish distributed durability or takeover
behavior. Include a partition or failed persistence operation: an unproved write
must not produce a successful application outcome. Verify alarm-driven cleanup
after restart and deployment replacement during an active operation.

Each scenario writes repeatable evidence: exact command, source and runtime
versions, artifact hashes, topology, public wallet identifiers, fault position,
signature proofs, durable outcomes, and resource cleanup status. Reuse existing
evidence formats and independent verifiers. Exclude secret material and tokens.

Classify failures before repair under the repository testing policy. Preserve
behavioral assertions from adapter tests when they own a real invariant. Delete
obsolete shape fixtures and transport-only checks after replacing their callers.
Retain existing Rust vectors, formal verification, and type fixtures where they
own independent guarantees. Add type fixtures if shared domain state changes.

Exit: all supported wallet operations pass on both hosts, including the failure
scenarios. Record any unsupported operation explicitly. It blocks retiring the
host path that currently provides it.

## Phase 4 — Make self-hosted operation repeatable

- [ ] Document and verify Linux VM deployment on AWS and Google Cloud using the same application package.
- [ ] Use multiple celld nodes, persistent disks, and a qualified regional S3/GCS bucket for the distributed acceptance runs.
- [ ] Configure TLS ingress, trusted forwarded headers, private peer access, and network confidentiality.
- [ ] Document fleet administrator access separately from application role permissions.
- [ ] Verify startup, health checks, drain, restart, backup, restore, and runtime upgrade procedures.
- [ ] Keep incompatible releases from serving the same lifecycle concurrently. Drain and fence them instead of adding permanent compatibility branches.
- [ ] Define rollback using durable-state compatibility. Never restore consumed signing material or revive an old ownership generation.
- [ ] Record the complete topology and its failure scope. Do not infer automatic regional placement from Cloudflare location hints.

Celld's fleet credentials control its deployment and durable state. The private
listener includes operator capabilities. Bindings alone do not isolate a role
from a fleet administrator. Preserve the documented trusted-operator model and
the agreed role-storage boundaries. See [celld security](https://github.com/denoland/celld/blob/main/docs/security.md).

An in-place Cloudflare data migration is not a prerequisite for fresh self-hosted
deployments. Before deleting a host used by existing wallets, inventory those
deployments and move their state through a verified migration or recovery flow.
Do not assume historical test-only status permits a reset today.

Allocate destination object IDs through that runtime. Preserve wallet identities,
keys, replay records, consumption state, and ownership generations. Fence source
writes before destination activation. Keep migration logic at the persistence
boundary and remove it when the migration finishes. A code rollback must never
undo a completed authority transfer.

Exit: both cloud VM targets have repeatable deployment evidence. Every active
classic-host consumer has a verified replacement and a state-safe cutover path.

## Phase 5 — Delete the classic-host implementation

- [ ] Move all supported callers and test launchers to the shared Worker path.
- [ ] Remove Express request/response conversion and classic-host HTTP bridges.
- [ ] Remove the Node Gateway host, its task emulation, and host-specific WASM loader.
- [ ] Remove native VM routing, persistence, scheduler, and server-startup code whose only consumer was the retired backend.
- [ ] Remove host-selection interfaces and builders after their last alternative implementation disappears.
- [ ] Remove obsolete package exports, build entries, environment options, scripts, dependencies, CI jobs, and documentation.
- [ ] Preserve domain helpers that happened to be re-exported by an adapter. Import them from their owning modules.
- [ ] Preserve CLI, cryptographic verification, and developer tools with independent consumers. Do not delete `router-ab-dev` wholesale without this check.
- [ ] Update the public deployment contract and release notes for removed Express/Node entrypoints. Update private consumers to the exact replacement package release.
- [ ] Delete the replaced paths in the same change set that completes their replacement. Add no deprecated aliases or compatibility packages.

Recompute the inventory after deletion. Report removed and added files, source
lines, runtime dependencies, build targets, and host-specific branches. Exclude
generated files, documentation, lockfiles, and moved code from claimed source
reductions. Explain retained adapters by their remaining domain responsibility.

Exit: the repository has one application hosting path. The retired Node/Express
and native VM backends have no remaining supported consumers or launch commands.

## Validation and completion

Run builds and protocol checks from `seams-wallet`. Run private composition and
deployment checks from `seams-monorepo`. Use existing commands and test selectors.
Record any new runtime launch command beside its evidence.

- Public: `pnpm build:workers`, affected package builds, the intended-behavior
  suite through `pnpm test:intended`, and applicable type/protocol checks.
- Public before committing implementation: `pnpm report:bloat --check`.
- Private: composed lifecycle E2Es and `pnpm check` after shared API changes.
- Private deployment/script changes: run the existing `pnpm test:scripts` checks.
- Both hosts: repeat the failure scenarios against the final packaged release
  after adapter deletion. A pre-deletion pass alone is insufficient.

Completion requires all of the following:

- [ ] One released set of handlers and WASM artifacts serves both hosting models.
- [ ] AWS and Google Cloud deployment require no Node/Express application backend.
- [ ] Existing lifecycle and custody guarantees pass on both runtime implementations.
- [ ] Role isolation, persistence, failover, and cutover gates have evidence.
- [ ] Classic-host code and its exclusive dependencies are removed.
- [ ] The final inventory shows a net reduction in host-specific application code.
- [ ] Public specs, package exports, local commands, and private deployment docs agree.
- [ ] E2E evidence is independently verifiable and repeatable from the recorded inputs.

Do not mark this complete after a successful registration demo or a smaller
bundle. Correctness evidence and completed code deletion are both required.

## Related work

- `seams-wallet/docs/intended-behaviours.md` — normative public lifecycle behavior.
- `seams-wallet/docs/router-ab/deployment.md` — current topology and custody boundaries.
- `seams-wallet/docs/refactor-150-supported-operations.md` — historical host parity inventory. Revalidate against current code.
- `seams-wallet/docs/refactor-155D-registration-critical-path.md` and `refactor-155F-registration-round-trips.md` — ongoing latency work.

Coordinate with current registration work and preserve its edits. Reuse its
accepted release baseline when freezing a candidate. R190 adds no latency target
and does not repeat those optimization experiments.
