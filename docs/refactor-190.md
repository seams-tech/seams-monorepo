# R190 — One Workers backend for managed and self-hosted deployment

Status: the classic Wallet hosts are removed. The local 0.11.0 candidate passes all 16 selected Wallet contracts on celld and workerd. Console composition also passes. The same candidate passes on ordinary and SEV-SNP Google VMs. Distributed Wallet, release promotion, and live cutover gates remain open.
Updated: October 14, 2026. Production rollout remains pending.

## Decision and purpose

Use one Workers backend implementation for Cloudflare and self-hosted deployment.
Run the self-hosted backend through celld on Google Cloud VMs. AWS qualification is outside this refactor.
Remove the application adapters that exist to host the backend in Node.js,
Express, or the separate native VM server.

The primary goals are correctness and less code.
Completion requires a net reduction in maintained code across both repositories.
Count application source, tests, deployment scripts, handwritten configuration, and the complete private runtime patch.
Exclude documentation, generated files, lockfiles, and binaries. Moves receive zero reduction credit.
New acceptance and deployment code must be outweighed by deletion of the retired implementations. A lifecycle change should have
one application implementation. Hosting should not require us to reproduce
service bindings, object execution, SQL behavior, or background-task handling.
The refactor must add no latency to application request paths. Do not add sequential database reads, blocking calls,
or extra validation to compensate for a hosting change. Preserve the existing call order and concurrency.
Test-only fault injection, inspection, and restart waits stay outside production artifacts. Hosting cost remains an optional measurement.

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
                        Google Cloud
```

Both hosts execute the same released application code and WASM artifacts.
Provider-specific configuration supplies bindings, resources, secrets, ingress,
and process management. Core wallet code does not select a hosting provider.

Google Cloud must be a straightforward, documented deployment target. Use Compute
Engine VMs, attached disks, Cloud Storage, and HTTPS ingress with the same application
release. Celld supplies D1 and KV APIs, so this deployment requires no separate
Postgres or Redis service. The topology must preserve the role-isolation gates below.
Use project `seams-501403`; `eigen-413918` was deleted. Qualification uses region `us-central1`. Final ordinary and SEV-SNP runs use zone `us-central1-c`.
AWS is outside the current implementation and acceptance scope.

The same release should also run on a supported Google Confidential VM configuration
without a wallet-specific hosting adapter. Verify this compatibility during implementation.
Attestation-controlled key release and protection from the deployment operator are
separate security work, outside R190. Confidential VM compatibility alone establishes
neither claim. See [Google Confidential VMs](https://docs.cloud.google.com/confidential-computing/confidential-vm/docs/confidential-vm-overview).

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

| Area                  | Current files                                                                                                              | Planned treatment                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Console Express entry | `packages/wallet-console-server-ts/src/router/express-adaptor.ts`, `packages/wallet-console-server-ts/src/router/express/` | Removed. Existing Worker/fetch composition owns the retained behavior            |
| Hosted composition    | `packages/wallet-console-server-ts/src/router/cloudflare/`                                                                 | Keep Gateway, Runtime, and Console behavior shared across hosts                  |
| Deployment            | `scripts/deploy-backend.mjs`, `deployment/wallet-system/targets.json`                                                      | Extend existing deployment boundaries only as needed for celld                   |
| Local runtime         | `scripts/local-wallet/`                                                                                                    | Consume exact packaged Worker releases and the selected runtime configuration    |
| Private tests         | `tests/relayer/`, `tests/e2e/hosted-product/`, `tests/e2e/regional-real/`                                                  | Preserve Console/product invariants while removing dependency on Express hosting |

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

- [x] Record current commits, released package versions, runtime versions, and artifact hashes in the acceptance records.
- [ ] Trace active production, local-development, CLI, package-export, and test callers of each host adapter.
- [ ] Classify each candidate as host-only, shared domain code, external integration, or independent tooling.
- [x] Record initial candidate file counts and non-generated source lines below. The native hosting modules are removed. Independent initializer and protocol helpers remain.
- [ ] Inventory the exact Worker APIs, SQL features, migrations, and binding graph used by all roles and Console composition.
- [x] Pin a celld release and verify its artifacts. Recheck its compatibility documentation against that release.
- [x] Prove the five-role graph loads without changes to protocol or domain logic. Exact package `@seams/wallet-server@0.9.3` passes the load check; lifecycle acceptance remains open.

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

### October 13 stock-runtime compatibility result

The public branch adds `tests/e2e/celld-bindings.e2e.mjs` and an evidence record at
`docs/evidence/celld-bindings.md`. The probe uses the verified celld 0.6.2 release
at source revision `90b43017241f81189453d326d05948f388b34652`.

Local Durable Object persistence and service calls pass on celld. Adding an
external object binding causes startup to fail with a duplicate-class error.
The same two-worker object-ownership contract passes under workerd through Miniflare.
The runtime parser drops `script_name` and treats the external class as local.

Our Router, control plane, and Derivers require external bindings to the same
Router-owned namespace. This failure blocks the role-graph gate. Classify it as
`environment_or_infrastructure_failure`, with no Wallet production regression established.

The separate A/B backup-bucket gate also remains unresolved. Celld maps R2 bucket
names to prefixes in one fleet bucket. This mapping does not establish the storage
isolation required by our deployment contract.

No application adapter, dependency, export, or launch path was removed. AWS,
Google Cloud, and Confidential VM execution remain unverified. The straightforward
Google Cloud target remains a requirement. It is not yet an implemented capability.

Resume Phase 2 only after a supported runtime passes the external-binding gate
and preserves storage separation. A runtime fork or changed custody boundary
requires a separate design decision. No upstream contact was made.

Implementation stays on `codex/refactor-190-workers-backend` in both repositories.
Rebase these branches onto current `dev` before each resumed implementation checkpoint.
Record the resulting source revisions in each new evidence run.

### October 13 private runtime proof

The user selected a private celld patch to preserve direct object calls and avoid
an extra Router dispatch. The patch and build procedure live in
[`deployment/celld/README.md`](../deployment/celld/README.md).
No upstream PR or maintainer contact is authorized or required.

Private build `0.6.2-seams.1` passes the expanded local binding check. It preserves
object IDs and state created by stock celld. It resolves external owners, retains
their environments, handles dependency cycles, and rejects invalid owners.
Stock celld rejects the new deployment feature before serving traffic.

This proof retains celld's existing requirement for unique owned class names
across the fleet. It changes no Wallet protocol, application route, or secret boundary.
The complete Wallet graph, release WASM, distributed behavior, and provider deployment
still require evidence. The later `0.6.2-seams.2` proof verifies distinct physical buckets locally. Cloud permissions and distributed operation remain open.
Application adapter deletion still requires the lifecycle and provider gates below.

### Remaining implementation sequence

1. Rebase the isolated branches onto current local `dev` at each checkpoint.
2. Build the pinned private runtime through `deployment/celld/build.mjs` and rerun the binding acceptance test. The macOS debug run passes; Linux release qualification remains open.
3. Resolve separate physical A/B backup buckets before constructing the replacement deployment.
4. Load the complete role graph and release WASM, then run lifecycle and failure acceptance scenarios.
5. Verify Linux operation on Google Cloud and a supported Google Confidential VM.
6. Replace host consumers, delete classic-host code, and rerun acceptance on the final release.

Source inspection confirms that the pinned runtime has one R2 storage handle.
`crates/celld/r2_store.rs` selects that handle for all bindings and prefixes keys with the binding bucket name.
`crates/celld/deploy.rs` accepts bucket names without a physical bucket mapping.
The existing patch changes neither path. Separate physical buckets therefore need additional runtime work or a verified alternative topology.
The user authorized the remaining storage work. Private build `0.6.2-seams.2` adds explicit physical buckets and passes local storage acceptance. Cloud qualification remains open.

Current consumers also prevent immediate adapter deletion. Public lifecycle evidence reads SQLite through
`nodeSqlite.ts`, and the step-up-expiry and sponsored-account-ownership E2Es use the Node database path.
Private Console account-router and sponsored-call history tests now execute the Worker transport. The Express branches were retired with their implementation.
Preserve their behavioral assertions when changing their launch boundaries.
These are confirmed consumers, not an exhaustive deletion inventory.

## Phase 2 — Run the existing application artifacts on celld

- [x] Start with fresh test wallets and isolated test resources.
- [ ] Build Worker artifacts in `seams-wallet` and consume an exact package release in the private repository.
- [x] Reuse the packaged artifact inventory and existing configuration rendering. Add no competing resource manifest or general provider framework.
- [x] Render the celld-supported JSON/JSONC configuration from the established configuration inputs. Keep build steps outside that configuration where required.
- [x] Keep secrets out of bundles, committed configuration, and evidence artifacts.
- [x] Verify native binding access and application authentication between roles.
- [x] Run the shared fetch handlers and Durable Object implementations on both runtimes.
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

- [x] Document and verify Linux VM deployment on Google Cloud using the same application package.
- [x] Provide a repeatable Google Cloud setup covering VM image, disks, bucket permissions, secrets, ingress, and startup, without application changes.
- [x] Run the lifecycle acceptance scenarios on a supported Google Confidential VM configuration. Record its OS, machine type, and TEE technology.
- [ ] Use multiple celld nodes, persistent disks, and a qualified regional S3/GCS bucket for the distributed acceptance runs.
- [ ] Configure TLS ingress, trusted forwarded headers, private peer access, and network confidentiality.
- [x] Document fleet administrator access separately from application role permissions.
- [ ] Verify startup, health checks, drain, restart, backup, restore, and runtime upgrade procedures.
- [ ] Keep incompatible releases from serving the same lifecycle concurrently. Drain and fence them instead of adding permanent compatibility branches.
- [ ] Define rollback using durable-state compatibility. Never restore consumed signing material or revive an old ownership generation.
- [x] Record the complete topology and its failure scope. Do not infer automatic regional placement from Cloudflare location hints.

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

Exit: ordinary and Confidential Google Cloud VMs have repeatable deployment evidence. Every active
classic-host consumer has a verified replacement and a state-safe cutover path.

## Phase 5 — Delete the classic-host implementation

- [ ] Move all supported callers and test launchers to the shared Worker path.
- [x] Remove Express request/response conversion and classic-host HTTP bridges.
- [x] Remove the Node Gateway host, its task emulation, and host-specific WASM loader.
- [x] Remove native VM routing, persistence, scheduler, and server-startup code whose only consumer was the retired backend.
- [x] Remove host-selection interfaces and builders after their last alternative implementation disappears.
- [x] Remove obsolete package exports, build entries, environment options, scripts, dependencies, CI jobs, and documentation.
- [x] Preserve domain helpers that happened to be re-exported by an adapter. Import them from their owning modules.
- [x] Preserve CLI, cryptographic verification, and developer tools with independent consumers. Do not delete `router-ab-dev` wholesale without this check.
- [ ] Update the public deployment contract and release notes for removed Express/Node entrypoints. Update private consumers to the exact replacement package release.
- [x] Delete the replaced paths in the same change set that completes their replacement. Add no deprecated aliases or compatibility packages.

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
- [x] Google Cloud deployment requires no Node/Express application backend.
- [ ] Existing lifecycle and custody guarantees pass on both runtime implementations.
- [ ] Role isolation, persistence, failover, and cutover gates have evidence.
- [x] Classic-host code and its exclusive dependencies are removed.
- [ ] The final inventory shows a net reduction in maintained code across both repositories, including tests, deployment code, configuration, and the celld patch.
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

## October 13 physical-storage and packaged-graph checkpoint

Private build `0.6.2-seams.2` requires separate physical R2 buckets through operator configuration.
The deployment manifest records the mapping, and runtime startup refuses a missing or changed mapping.
The pinned-source build and the original object-binding acceptance test pass.
The storage scenario passes concurrent A/B streaming, multipart writes, conditional rejection, direct bucket reads,
restart, invalid configuration, downgrade refusal, and a failed write after physical bucket removal.
No application storage adapter or protocol change was introduced.

The exact installed `@seams/wallet-server@0.9.3` artifact files pass manifest hash verification.
All five role Workers load with their release WASM on one celld process using an S3 emulator fleet bucket.
Router rejects GET with 405. The four private roles reject missing service authentication with 403.
This establishes module loading and request dispatch, not successful wallet lifecycle operations.
The Gateway and private Console composition are outside this five-role check.

Celld must bundle the packaged entry shims. Its `no_bundle` path does not follow imported JavaScript.
The installed esbuild 0.28.1 supports celld's `es2024` target; the older 0.21.5 executable does not.
These are deployment-boundary requirements. No Worker source change was required.

An independent reviewer checked the patch and raw evidence. The final storage run includes the requested concurrent upload check.
See [runtime build, reproduction commands, and evidence](../deployment/celld/README.md).
Remaining work includes complete wallet operations and failure scenarios, Linux release qualification,
cloud credentials and permissions, distributed durability, Confidential VMs, migration inventory, and adapter deletion.
That checkpoint preceded provider selection. Current qualification uses Google project `seams-501403` in `us-central1`. Task-owned resources are recorded in the provider evidence.

## October 13 Wallet lifecycle checkpoint

Private build `0.6.2-seams.4` runs the same Wallet Server and Wallet SDK 0.9.3 artifacts without an application adapter.
The complete role graph and Gateway apply their D1 migrations, provision a tenant root, and preserve its result after a forced process kill.
Exact saved-grant replay refuses access while the prior lease remains authoritative, then returns the original durable result.
Six unchanged browser contracts pass: mixed registration and signing, lost-response retry, quota contention,
stored-signature replay, unlock/export/shared-budget signing, and recovery after response loss.
The harness verifies the exact six titles and rejects skipped tests.

Runtime fixes now cover external object ownership, explicit physical R2 buckets, workers-rs binding identities,
and unread streaming response copies. The focused stream probe reproduces the real browser failure on `.3` and passes on `.4`.
The preceding private runtime refuses the `.4` clone feature before serving a new deployment.
See [build inputs, diagnostic controls, commands, and result records](../deployment/celld/README.md).

These are single-process, emulator-backed Wallet checks. The recovery contract resets the browser runtime.
It does not prove celld process recovery during that flow. VM-only direct ledger assertions in the existing contracts remain unmeasured.
The remaining lifecycle matrix, private Console composition, distributed failures, provider permissions,
Confidential VM operation, active-deployment inventory, and state-safe cutover still block host retirement.

### Initial host inventory

Counts include all source lines, including comments and blank lines. They exclude generated files, documentation, and lockfiles.
These are candidate counts, not claimed deletions. Counts come from `Path.read_text().splitlines()` over the listed paths.

| Source group                                                              | Files |  Lines | Classification and next action                                                                                                                |
| ------------------------------------------------------------------------- | ----: | -----: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Public `packages/wallet-server/src/router/node/*.ts`                      |     6 |    684 | Host HTTP, SQLite, migrations, WASM loading, checks, and process lifecycle. Replace test and VM-launch consumers.                             |
| Public Express Router and signing-session-seal transports                 |     2 |    304 | Transport conversion and Express route registration. Move callers to the existing fetch surface.                                              |
| Public `storage/syncSqlite.ts`                                            |     1 |    114 | Node-host SQL facade. Production consumers are in the Node Gateway group. Preserve each test invariant through D1.                            |
| Public `crates/router-ab-dev/src/**/*.rs`                                 |    35 | 22,302 | Mixed ownership. Includes VM hosts, initializer, evidence tools, fixtures, and cryptographic helpers. Do not claim or delete the whole count. |
| Private Console Express Router, observability routes, and re-export entry |     3 |  5,248 | Transport and composition. Preserve each domain helper and Worker behavior while replacing route callers.                                     |
| Private `sponsorship/evmRelay.ts`                                         |     1 |    363 | Mixed domain helpers and Express registration. Remove only the retired transport after callers move.                                          |

The nine public TypeScript candidates total 1,102 lines.
Confirmed consumers include `node-http-body-limit.e2e.mjs`, `step-up-expiry.e2e.mjs`,
`sponsored-account-ownership.e2e.mjs`, `tests/r150-hosted/gateway/admissionPolicy.e2e.mjs`,
public intended-behavior evidence readers, package build entries, and the VM intended-services launcher.
The published `@seams/wallet-server/router/express` export requires an intentional release change.
External deployments and state ownership still need an operator inventory.

The native initializer remains required by packaged Worker configuration preparation.
`ed25519-signing-evidence.mjs` uses the `cloudflare_private_d1_fixture` example to construct signing inputs for independent signature verification.
Cloudflare private-D1 fixtures and the Ed25519-Yao client registration test also use native-crate helpers.
Preserve these tools or move their independently required code before deleting native hosting modules.

Four private Console tests now import domain services from their owning modules.
They retain their Express and Worker behavior assertions. The unused 51-line Express re-export entry was deleted after its last callers moved to the owning modules.
This removes a misleading dependency before the transport replacement. The existing 19 selected checks pass.
No application host was removed in this checkpoint.

### Net reduction requirement

The [current source-size checkpoint](../deployment/celld/evidence/source-size-checkpoint.json) measures the R190 changes against each branch's current `dev` merge base.
This excludes concurrent SDK work from R190's reduction claim.
It includes the complete maintained patch file, including diff context, and the added acceptance code.
The checkpoint currently removes 33,713 maintained lines in aggregate. It includes the complete patch and acceptance code. Other completion gates remain open.
The final aggregate must be negative after the classic hosts and their exclusive support code are removed.
Run the existing public bloat gate as well; its ratchets do not replace this net-line requirement.

## October 13 expanded lifecycle and Google checkpoint

Private runtime `0.6.2-seams.5` adds validated raw EC public-key import/export to the existing runtime patch.
All 16 selected unchanged browser contracts pass on celld and workerd with no skips.
The candidate retains the released Wallet Server/SDK 0.9.4 Worker and WASM artifacts.
It rebuilds the Server's local delayed-request hooks and their validation export after the instance-affinity diagnosis.
These are local test hooks. The change removes in-memory Maps and uses the existing tenant-scoped D1 store.
The matching delayed-finalize and superseded-recovery contracts pass on both runtimes.
See the [diagnostic record and current limitations](../deployment/celld/README.md#raw-ec-and-delayed-request-diagnostics).

A native Linux x86-64 release builds and passes Clippy with locked dependencies on Google Cloud.
The same executable passes external-object access, raw EC operations, concurrent A/B streams, multipart writes,
conditional rejection, direct bucket checks, and forced-kill recovery with fresh node caches.
It passes on an ordinary `n2d-standard-4` VM in `us-central1-a` and a SEV-SNP `n2d-standard-2` VM in `us-central1-c`.
The kernel reports active AMD SEV, SEV-ES, and SEV-SNP features. This establishes compatibility for that configuration.
It does not establish attestation-controlled key release.
A separate Google IAM test denies B bucket access, observes application failure, and confirms A remains writable.
The task-owned B grant was restored. These are runtime primitives, so full Wallet and distributed qualification remain open.

The implementation still requires classic-host removal and a net reduction in maintained lines.
No reduction from concurrent SDK work counts toward R190. The later Console deletion makes the current aggregate negative.

## October 13 Console host removal

The private Wallet Console now has one Worker/fetch implementation.
The 5,085-line Express router and 112-line Express observability routes are removed.
The earlier 51-line re-export facade is also gone.
The sponsored-EVM module loses 120 lines of unused Express registration and retains its execution functions.
Its direct Express dependency, type dependency, build external, and TypeScript alias are removed.
The generic Console package retains independently used Express support outside this Wallet backend.

The account-router and sponsored-call history cases keep their Worker behavior assertions.
Obsolete Express transport checks are deleted. The existing route declaration ownership checks remain.
Eight retained route checks and both production Worker composition E2Es pass.
The package builds, and `pnpm check` passes with existing lint warnings.
A missing workspace dependency link caused the first check failure; an isolated locked dependency install resolved it.
See [Console Worker evidence](../deployment/celld/evidence/console-worker.json).

Google full-Wallet qualification remains open. One run reached an Ed25519 export failure;
the two linked-device contracts then passed six repeated diagnostic runs without reproducing that error.
A later full run lost the remote runtime listener after seven successful contracts.
Kernel logs show no OOM event. The SSH session record does not establish the process exit cause.
The next run uses systemd with automatic restart disabled, warning logs enabled, and recorded exit status.
No application failure has been dismissed because a repeat run passed.

## October 13 Google Wallet and object ownership checkpoint

All 16 selected unchanged browser contracts pass on an ordinary Google VM and a SEV-SNP VM.
Each run uses real GCS, the same private `.5` executable, and the frozen 0.9.4 candidate described above.
Systemd disables automatic restart and records process state and shutdown.
These passes do not qualify the final R190 package.

The two-VM object scenario preserves counter 1 across ownership epochs 1, 2, and 3.
A paused owner is replaced. The resumed process exits with status 3.
A peer partition refuses the sampled request, and the healed connection reads the same state.
After the current owner is killed, the survivor takes ownership, increments to 2, and reads the same value through an alias.
This checks one object with sequential requests. Wallet one-use material, concurrent writes, and restore remain open.

The review found a stale initial provider hash and an omitted replacement-controller hash.
A separate record hashes both actual deployment archives and the effective controller.
The ordinary runtime log was unavailable after the scheduled VM stop. Google zone capacity prevented its restart.
The measured process status does not establish the precise exit reason.
Both task VMs are stopped. Task-owned disks, buckets, and the service account remain recorded.

The earlier export error, unmanaged listener loss, and local browser HTTP error remain unexplained.
The later successful runs do not identify those causes.
See [Google Wallet and object evidence](../deployment/celld/evidence/google-wallet.json).

## October 14 final local package checkpoint

The implementation branch prepares Wallet Server and SDK version 0.11.0. Version 0.10.0 is already published.
Both packages build from the rebased source and fresh release WASM. The package boundary checks pass.
All 16 selected unchanged Wallet contracts pass without skips on celld and workerd using the exact packed archives.
The preceding private `.4` runtime refuses the `.5` raw-EC requirement before serving.
The private Console passes its onboarding/replay scenario through celld and both production composition E2Es through workerd.
See [final local package evidence](../deployment/celld/evidence/final-local-packages.json).

The native Rust HTTP servers, SQLite hosts, scheduler, controller and host-specific tests are removed.
The retained initializer and independent Cloudflare fixture builder execute successfully.
All 18 retained helper tests, 10 client registration tests and 209 Workers binding/ownership checks pass.
All 38 Cargo locks pass, and the public bloat gate passes.

Console qualification exposed an initialization bug shared by both hosts.
The account bundle disabled schema creation, but billing still created dependent schema.
The shared constructor now honors that setting. All 74 unchanged migrations and onboarding pass afterward.
See the [measured diagnosis](../deployment/celld/console-diagnostics.md).

The deployment renderer consumes the existing Wrangler configuration and explicit protected per-Worker secret values.
It bundles Worker code and copies unchanged SQL into one protected deployment directory.
The production Console E2E exercises this renderer. It adds no resource authority manifest.
The single-VM unit and HTTPS example pass operational qualification on Google Cloud.
The ordinary-VM proof verifies a fresh acknowledged counter write across SIGKILL and automatic restart.
See [single-VM evidence and limits](../deployment/celld/evidence/google-single-vm.json).
Version 0.11.0 remains unpublished, and the private production package pins remain unchanged until release promotion.

## October 14 final Google package checkpoint

The rebased 0.11.0 archives pass all 16 selected Wallet contracts on an ordinary Google VM and an AMD SEV-SNP VM.
Both runs use the same Linux runtime digest and production deployment renderer. They require no application host branch.
The ordinary VM uses `e2-standard-4` in `us-central1-c` after repeated AMD capacity failures in zone a.
The Confidential VM retains `n2d-standard-2` with SEV-SNP in zone c.
Each process remains active without automatic restart until recorded cleanup.
The evidence verifies the exact package and contract source hashes for each run.
See [final Google package evidence](../deployment/celld/evidence/google-wallet-final-packages.json).

The retired native-VM SQLite test inspections are removed. Their three Workers signing contracts pass on both local runtimes.
They still verify quota contention, stored signing replies, wrong-wallet refusal, and exact replay.
Private `pnpm check` passes, including 53 deployment-script checks and one existing skip.
The public package boundary and bloat gates also pass.

The two-node Wallet process-loss scenario passes its three-contract control and three-contract fault run.
The fault interrupts the ingress node after a committed reply and preserves the survivor process and storage.
Stored reply replay and wrong-wallet refusal pass across that fault. Quota contention and Router replay pass afterward.
Signer owner placement and signing-effect counts were not measured.
See [one-node failure evidence and limits](../deployment/celld/evidence/google-wallet-one-node-failure.json).

Production Console onboarding and all 75 migrations also pass on the Confidential VM with real GCS.
See [Google Console evidence](../deployment/celld/evidence/google-console.json).
Release promotion, state-safe deployment procedures, and the remaining distributed restore/lifecycle matrix remain open.
The deployment inventory was subsequently confirmed below.

## October 14 local Yao failure checkpoint

The real Yao peer-disconnect scenario passes on workerd and celld through one shared object proxy.
The proxy disconnects on B's second message. Both roles retain burned state, exact retry opens no new connection,
and an independent wallet completes registration. Celld preserves the burned pair after a local restart.
The runtime patch and application code remain unchanged.
See [Yao evidence](../deployment/celld/evidence/yao-peer-disconnect.json) and [diagnosis and limits](../deployment/celld/yao-diagnostics.md).
Distributed Yao recovery remains open. The sampled Worker-created WebSocket handoff also remains unqualified.

## October 14 deployment inventory

The operator confirms that only Workers are deployed. No deployed wallet uses the retired Express, Node Gateway, or native VM hosts.
R190 therefore requires no live migration from those retired hosts.
Existing Workers deployments retain their durable state. A future move from Cloudflare to celld still requires the authorized relocation or recovery flow.
This inventory closes the classic-host consumer gate. It does not establish distributed restore correctness.

## October 14 cross-node runtime qualification

Private celld `.6` fixes two measured cross-node WebSocket defects without changing Wallet handlers or persisted Wallet records.
The build-time patch completes the peer handshake and attaches accepted sockets to the remote owner's tunnel.
Failed or cancelled attachment releases native socket registration. New manifests require `peer-durable-websockets-v1`.
The `.5` runtime rejects those manifests before serving.

The clean `.6` macOS build passes bindings, all three echo controls, real two-node Yao owner loss, and all 16 selected Wallet contracts.
The Linux release passes real Yao interruption across ordinary and SEV-SNP Google VMs in `seams-501403`.
Both roles retain burned state after B-owner SIGKILL. The exact retry opens no new connection.
B moves to the surviving VM with epoch 2. The survivor keeps its process ID and reports zero restarts.
Both VMs are stopped. Temporary peer rules are removed. Cleanup reports no errors.
See [the exact build and qualification record](../deployment/celld/evidence/peer-websocket-runtime.json).

Both R190 branches are rebased onto current local `dev`: public `2f634225` and private `c02d6c58`.
The public rebase changes documentation only relative to the tested tree. The private rebase preserves the celld and Wallet test sources.
Post-rebase private checks and public bloat checks pass. The maintained source reduction remains 33,713 lines.
The earlier full Google Wallet and Console evidence uses `.5`; the new `.6` Google proof covers this distributed Yao scenario.

## October 14 tenant-root restore and offline upgrade

The existing workerd restore scenario is now shared with the private celld acceptance runner.
The scenario removes exactly one active Deriver A share, obtains dual authorization, restores from managed backup,
and performs the mandatory forward refresh. A later refresh erases epoch 1 and leaves epoch 2 retired and epoch 3 active.
An exact restore retry keeps its original activation receipt and lifecycle revision after the later refresh.

The local celld check uses unchanged 0.11.0 Worker artifacts and synthetic S3 storage.
It also checks an offline `.5` to `.6` runtime upgrade and a subsequent restart against the same durable state.
Temporary owner-unreachable refusals are recorded during lease recovery. HTTP readiness alone does not prove object readiness.
The final restart records 25 temporary ownership refusals over 6.743 seconds before replay succeeds.
The maintained source reduction is now 33,275 lines, including the new acceptance runner.
See [the restore and upgrade evidence](../deployment/celld/evidence/tenant-root-restore.json).

This is a single-node availability restore with one missing share. Provider partitions, both-share loss, relocation,
in-flight work during retirement, consumed signing material across upgrades, and mixed-version rollout remain separate gates.

## October 14 burned-pair upgrade checkpoint

The existing real Yao fault runner now checks an offline `.5` to `.6` upgrade and another restart.
It disconnects after B's second protocol message. Both roles report burned state before and after each runtime transition.
Exact retries return 503 and open zero additional protocol connections. An independent wallet registers before the upgrade.
The runner uses the same 0.11.0 packaged Workers and the shared public fault proxy.
See [the Yao upgrade evidence](../deployment/celld/evidence/yao-runtime-upgrade.json).

This closes the local burned-Yao-pair upgrade check. ECDSA consumed presigns, mixed-version serving,
ownership-generation preservation during upgrade, provider partitions, and rollback remain open.
The aggregate maintained source reduction is now 33,258 lines.

## October 14 ECDSA upgrade checkpoint

The existing restore runner now creates and verifies a real ECDSA signature before tenant-root restore.
After the offline `.5` to `.6` upgrade and another restart, it requires the same stored signature.
Changed finalization input must fail with an effect-identity conflict.
The captured prepare request must fail with a stale-revision conflict while its original deadline is still valid.
These checks keep the original request deadline and require the specific consumed-state conflict.
The same packaged Worker artifacts and assertions run through the address-aware workerd test boundary.
See [the ECDSA upgrade evidence](../deployment/celld/evidence/ecdsa-runtime-upgrade.json).

The public scenario needed its current Gateway credential for ECDSA activation.
Its old all-purpose workerd entrypoint also omits required wallet object addresses and remains outside this qualification.
The focused control supplies runtime-issued addresses. Production authentication and request paths are unchanged.

The R190 public branch includes `dev` commit `8c77470f`, which updates CLI versions and documentation.
This rebase changes no packaged Worker code. No new live request, database validation, or blocking call was added.

Earlier records called these upgrades “drained.” The stop helper can send SIGKILL after eight seconds.
The evidence proves the old process stopped before deployment, with no test request in flight. Graceful drain remains unqualified.
The final old process exited through SIGKILL (`-9`). Restart recovery recorded 22 temporary refusals over 6.006 seconds.
The aggregate maintained source reduction is now 33,051 lines, including all new test code and the full runtime patch.

## October 14 rebase after Console query optimization

Both isolated R190 branches rebase cleanly onto local `dev`: public `66262a36` and private `072f28ba`.
Private `dev` supplies Console query optimizations, migration `0099`, and exact Wallet package pins at `0.10.1`.
Public `dev` changes a CLI error message. The packaged Wallet Worker code and celld patch remain unchanged.

The private frozen-lockfile install and `pnpm check` pass, including 53 script tests and one existing skip.
The public bloat check passes. Both production Console composition E2Es pass on workerd.
The binding E2E initially failed because its bundler omitted the runtime-provided `cloudflare:workers` module.
This was `valid_test_needs_update`. Its external-module setting now matches the production renderer.
The targeted rerun passes. Production request paths remain unchanged.

Celld `.6` passes Console onboarding, exact replay, and all 76 migrations with the existing `0.11.0` candidate.
The raw result is `.artifacts/celld-console-sm_0b2ha/result.json`.
Its SHA-256 is `0dbc1616b1e3e1c71b7e57be726168db6592716c71153eb53ceb584018a0e1d3`.
The aggregate maintained source reduction remains 33,051 lines against the new `dev` bases.
Earlier Google results retain their recorded revisions and migration counts. This rebase adds local qualification only.

## October 14 shutdown qualification

The local upgrade runner now allows the deployment service's existing 45-second stop bound.
The preceding helper forced a stop after eight seconds. The unchanged runtimes exit normally in about 15.1 seconds in the control.
The new scenario holds an admitted observer request before it invokes the Router.
After SIGTERM, a fresh application request must receive the explicit draining refusal.
The held request then completes the exact stored-signature replay, and the process must exit with status zero.
These checks run before upgrade and after both `.6` checkpoints.

The incompatible `.5` executable refuses the `.6` required feature against the same manifests and durable state.
The subsequent `.6` restart must preserve the signature, consumed-material refusals, restore receipt, and root retirement state.
This establishes refusal of an incompatible downgrade. Compatible rollback and mixed-version operation remain open.
The test does not claim that a fresh SigningWorker claim was already executing when shutdown began.
No production handler, runtime patch, database call, or deployment timeout changed.
See [the shutdown evidence](../deployment/celld/evidence/shutdown-runtime-upgrade.json).
The aggregate maintained source reduction is now 32,946 lines.

| Fact | Instrument and scope |
| --- | --- |
| Earlier stop exited through SIGKILL (`-9`) | Archived `utv_v_pp` E2E result and the eight-second helper |
| Longer SIGTERM control exited zero three times at about 15.1 seconds | Archived `j01xmzgg` result with unchanged runtimes |
| One early held-request run failed on a health 503 before its second stop | Archived `c1g6c2sw` traceback; readiness was an invalid admission precondition |
| Final admission probe requires the exact draining response | E2E checks a fresh application request while the held request remains pending |

| Candidate cause | Evidence | Conclusion |
| --- | --- | --- |
| The test stopped the runtime too early | Exit `-9` at the old bound; exit zero after about 15.1 seconds at the longer bound | Supported for these runs |
| SIGTERM was ignored | The control exits without SIGKILL | Contradicted for these runs |
| The runtime cannot finish the measured shutdown | Three control exits and exact durable-state checks pass | Contradicted for this scenario |
| Health readiness directly measures request admission | Application state checks passed before the health 503 | The test now measures application admission directly |

## October 14 backup-read refusal checkpoint

The existing restore runner now denies real object reads from the local A backup bucket.
It first proves that A's object is readable. During denial, A returns 403 and B remains readable.
The authorized restore returns a backup-lookup failure. Selected role-share identity, lineage, epoch, and lifecycle metadata remain unchanged.
After the policy is removed, A becomes readable and the identical authorized request completes restore and forward refresh.
The subsequent shutdown, upgrade, incompatible-downgrade refusal, and stored-signature checks also pass.
See [backup-read refusal evidence](../deployment/celld/evidence/backup-read-refusal.json).

The first fault instrument used HEAD, which the local emulator allowed despite the GET denial policy.
An isolated control measured GET 200 before denial, HEAD 200 under denial, and GET 403 under denial.
This was `valid_test_needs_update`. The corrected test uses GET for its access controls.
No production request path, runtime patch, database call, or blocking validation changed.

| Candidate cause of the initial fault-check failure | Measurement | Conclusion |
| --- | --- | --- |
| The deny policy does not block reads | GET returns 403 under the same policy | Contradicted |
| HEAD does not exercise the denied action in this emulator | HEAD remains 200 while GET becomes 403 | Supported |
| Wallet restore bypasses the denied backup | The initial instrument failed before calling restore; the corrected run reports backup lookup failure | Not supported by either run |

This covers local simulated read denial with one missing A share. GCS IAM, provider outages, retirement failures, and both-share loss remain open.
The metadata comparison excludes share bytes and other restore tables.
The aggregate maintained source reduction is now 32,829 lines.

## October 14 retirement-deletion refusal checkpoint

The local provider test now also denies deletion of B's actual retired epoch-1 backup.
An independent DELETE receives 403. The next refresh returns 409 `tenant_root_retirement_pending`, with B pending.
Active-share metadata does not advance, and the selected retired backup remains readable.
After the deny policy is removed, the identical refresh succeeds. A direct GET of that selected backup then returns 404.
The shared restore, refresh, shutdown, downgrade-refusal, and restart assertions pass afterward.
See [retirement-deletion evidence](../deployment/celld/evidence/retirement-delete-refusal.json).

The assertion intentionally permits erasure of an old local share before its backup deletion succeeds.
The existing contract keeps the retirement pending until provider cleanup finishes.
GET 404 establishes that this selected object is no longer retrievable. It does not establish cryptographic erasure.
No production request path, runtime patch, database call, or blocking validation changed.
The aggregate maintained source reduction is now 32,734 lines.

A preceding local attempt crashed before provider fault injection.
The macOS report identifies SIGILL in the `.5` binary by UUID. Its cause remains unknown.
The same-source repeat passed. That success does not explain the crash or eliminate a runtime defect.
The failed attempt also recorded a cleanup permission error; later inspection found no matching test processes.

| Fact | Instrument |
| --- | --- |
| Native process received SIGILL at 12:27:36 JST | macOS crash report for PID 92320 |
| Crashed image matches `.5`, while `.6` has a different UUID | Crash report and `dwarfdump --uuid` |
| No backup-policy requests or saved signing replay existed in the crashed attempt | Failed `8aw4izec` log and artifacts; passing control logs four policy requests |
| Same-source repeat passed with no cleanup errors | Archived final run `2mmw3zzi` |

| Candidate explanation | Evidence | Conclusion |
| --- | --- | --- |
| Injected provider deletion triggered this crash | Crash preceded provider fault artifacts and injection | Contradicted for this attempt |
| The `.6` executable crashed | Report UUID matches `.5` | Contradicted |
| A specific runtime, compiler, or application defect caused SIGILL | JIT/Wasm frames identify execution context without the cause | Unresolved; reproduction or a symbolized native diagnosis is needed |

## Remaining rollout gates

1. Finish the distributed lifecycle matrix: in-flight claim failure and partition, relocation, and retirement/authorized restore with provider failures. The local one-share restore and retirement scenario is recorded above.
2. Promote the reviewed 0.11.0 package candidates, update private consumers to exact published versions, and repeat deployed product acceptance.
3. Complete provider upgrade and rollback qualification, including ownership generations, active claims, and mixed-version serving. Local upgrades cover root records, burned Yao pairs, consumed ECDSA presigns, admitted stored-response replay during shutdown, and incompatible-downgrade refusal. No classic-host state migration is required.

The branch implementation and selected qualification checks are committed. Production rollout remains pending.
