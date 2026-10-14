# Private celld runtime build

Status: `.7` passes local binding, WebSocket passthrough/relay/rejection, and all 16 selected Wallet contracts. Its Linux build and Clippy pass. Timed live-claim owner loss and clean drain pass across ordinary and Confidential Google VMs. The earlier `.5` release has full Google Wallet and Console evidence. Broader distributed lifecycle, release promotion, and upgrade qualification remain open.

The user selected a private runtime patch to preserve the current Wallet call structure.
No upstream issue, pull request, public fork, or maintainer contact is part of this work.

## Source and build identity

- Upstream: `https://github.com/denoland/celld.git`.
- Base: `90b43017241f81189453d326d05948f388b34652` (`v0.6.2`).
- Private version: `0.6.2-seams.7`.
- Patch: [workers-runtime.patch](workers-runtime.patch).
- Patch SHA-256: `df1dab7009abf9dc8bcbbb07f694ff96a5106235927bfef9a63d770d14736bc7`.
- Wallet lifecycle build: macOS ARM64, `rustc 1.97.1`, `cargo 1.97.1`, Cargo `dev` profile.
- Current Linux candidate: `.7`, x86-64, Ubuntu 24.04, Rust 1.97.1. Build, Clippy, and timed Google live-claim qualification pass.
- Earlier `.6` evidence covers interrupted-pair takeover. Later testing found WebSocket passthrough defects corrected by `.7`.
- Previous qualified Linux release: `.5`, x86-64, Ubuntu 24.04, Rust 1.97.1, verified on Google ordinary and SEV-SNP VMs.
- Historical Linux release: `.4`, ARM64, Debian Bookworm, upstream Dockerfile. See its separate qualification record below.
- Historical object-only build identity: [original build record](evidence/runtime-build.json).

The patch applies to a clean archive of the pinned source. The build command verifies the patch hash before applying it.
The build retains the upstream locked dependencies. The lockfile changes only the private package version.

## What changes

The deployment parser preserves `script_name` and separates external references from local class declarations.
The loader follows external object dependencies, including cycles and references without service bindings.
Before startup, it verifies that the named owner declares the requested class.
The caller receives a namespace derived from the owner's script name.
The existing class registry selects the owner's code and environment when the object executes.

The patch preserves the existing object-ID derivation and persistent storage scope.
It introduces no Router forwarding endpoint and no Wallet provider branch.
Deployments with external references require `external-durable-objects-v1` through celld's existing manifest feature mechanism.
An older runtime rejects those deployments before serving traffic.

The service and R2 bindings expose the `Fetcher` and `R2Bucket` constructor names that workers-rs validates.
The existing service Proxy and RPC dispatch remain in use. These deployments require `workers-rs-binding-brands-v1`.
Streaming `Response.clone()` uses the existing stream split operation. Both response bodies remain readable.
Locked and disturbed bodies reject cloning. Status, headers, type, URL, and redirect state remain attached to the copy.
New deployments require `streaming-response-clone-v1`. The preceding private runtime refuses that feature before loading the application.

Raw ECDH/ECDSA public-key import and export use the existing P-256, P-384, and P-521 point decoders.
Malformed points fail validation. Public keys export as uncompressed SEC1 points. Private and nonextractable keys refuse raw export.
Ed25519 and X25519 raw round trips remain supported. New deployments require `raw-ec-public-keys-v1`.
The preceding `.4` runtime refuses that feature before serving traffic. No cryptographic dependency was added.

Cross-node Durable Object WebSockets complete their internal HTTP upgrade handshake.
Accepted sockets use the peer tunnel to the object's owner. Failed or cancelled attachment releases the native socket registration.
New deployments require `peer-durable-websockets-v1`. The `.5` runtime must reject this feature before serving.
The local echo and real two-node Yao controls pass on `.6`. See [diagnosis and qualification limits](yao-diagnostics.md).
The [`.6` qualification record](evidence/peer-websocket-runtime.json) identifies each checked executable and its measured scope.

## Deliberate limit

Each application Durable Object class must still have one owner in a fleet.
Two independent Workers exporting the same class name remain unsupported and fail startup.
Our current Router, Deriver A, Deriver B, and SigningWorker classes have distinct names.
The patch adds external references within this constraint. It does not implement all Cloudflare namespace semantics.

The five packaged role Workers, release WASM, and Gateway pass the local acceptance scenario below.
The historical `.4` run passes six contracts with Wallet Server and Wallet SDK 0.9.3.
The earlier `.5` run passes all 16 selected contracts with frozen SDK 0.9.4 and a Server 0.9.4 local test-hook candidate.
A forced node kill also preserves the tenant-root result after lease expiry and exact grant replay.
The browser run uses one process and an S3 emulator. It does not establish distributed takeover.
Separate real-GCS primitive checks pass on Google ordinary and Confidential VMs. They also cover denied bucket access.
Broader factor, revocation, relocation, refresh, and retirement behavior remains open.
AWS is outside the current scope. Full cloud Wallet, managed uploads, and distributed deployment remain open.
No latency benefit or production security claim follows from this local proof.

## Build

Use the committed build command with an upstream checkout and a new output directory:

```sh
git clone --branch v0.6.2 --depth 1 https://github.com/denoland/celld.git /tmp/celld-upstream
node deployment/celld/build.mjs /tmp/celld-upstream /tmp/celld-candidate release
```

The command extracts the pinned commit independently of checkout edits, checks the patch hash,
applies the patch, and builds with locked dependencies. It verifies the resulting version.
The output contains `celld`, `runtime-build.json`, the source archive, and the patched source with upstream license notices.
The build record includes source, patch, archive, executable, platform, profile, and toolchain identity.
A failed build produces no success record. Keep failed output for diagnosis and use a new directory for retries.

Use `dev` instead of `release` for a local capability check. `CARGO_TARGET_DIR` can reuse an existing Cargo cache.
These profiles produce separate candidates. A debug pass does not qualify a release executable.
The command uses the installed Rust toolchain. Reproduce the versions above for the original proof conditions.
Each different toolchain or platform requires new acceptance evidence.
The build command does not deploy or approve the executable.

## Verify

From the `seams-wallet` R190 branch with locked dependencies installed:

```sh
node tests/e2e/celld-bindings.e2e.mjs \
  /tmp/celld-candidate/celld \
  /absolute/path/to/verified-stock-celld-0.6.2
```

The second executable is the verified upstream release for the host platform.
The test creates state with that binary, then continues with the private build.
It uses synthetic data, loopback listeners, and local storage without cloud credentials.

The resulting `result.json` records source and harness identity, executable hashes, responses, object IDs, and expected startup refusals.
The retained evidence lives in `seams-wallet/docs/evidence/celld-private-patch/`.
The local proof checks:

- Workerd reference behavior through Miniflare.
- Stock-to-private state and object-ID continuity.
- Direct and service access to one object, including binding aliases and `idFromString`.
- Owner environment selection and persistence after restart.
- External-object-only dependencies and a Router-to-control-plane dependency cycle.
- Rejection of missing owners and owners that do not declare the requested class.
- Recovery after rejected deployments.
- Stock-runtime refusal of the patched manifest without rebuilding it.

The private Console Express host and public classic hosts are removed. The final package candidates pass selected Wallet contracts on both runtimes and both Google VM types. Distributed lifecycle, package promotion and live cutover gates remain open.

## Repeatable build verification

On October 13, the build command extracted the pinned source, applied the patch, and built a fresh macOS ARM64 debug candidate.
The binding acceptance scenario passed using that executable and the verified stock executable.
This run includes stock-state upgrade, object ownership, aliases, restart, dependency cycles, invalid-owner rejection, and downgrade refusal.

- [Generated build identity](evidence/runtime-build.json).
- [Generated acceptance evidence](evidence/bindings.json).

The acceptance record identifies Wallet revision `8c12c9eb2516a7c2585b001f6a3a5d7c2bb67969`, rebased onto `dev` revision `ab91d575d46a13be28deccb95660d6517c9164f3`.
The private branch already contains local `dev` revision `26f9d01c3497365adacd261bff32bfe2d469abda`.
The existing deployment-script suite passed: 53 tests passed and one was skipped.
The build script also passed syntax, lint, and formatting checks.
That original record covers the object-only debug build. The [current Linux x86-64 Google record](evidence/google-runtime.json) identifies the `.5` executable.

## Separate physical backup buckets

The user authorized the remaining storage work on October 13.
This private build requires explicit physical buckets for R2 bindings. It has no fallback to the fleet bucket.
Set `CELLD_R2_BUCKETS` when deploying and on every node, for example:

```json
{
  "router-ab-deriver-a-tenant-root-managed-backup": "gs://wallet-backup-a",
  "router-ab-deriver-b-tenant-root-managed-backup": "gs://wallet-backup-b"
}
```

Each value must name a whole `s3://` or `gs://` bucket. Prefix mappings, duplicate physical destinations,
and reuse of the fleet bucket are rejected. Credentials use the existing cloud credential chain and stay on the node.
The manifest records each binding's physical destination. Startup and reload reject a missing or changed node mapping.
Deployments require `physical-r2-buckets-v1`; the original runtime refuses them before serving.
All R2 operations, including streaming, multipart uploads, and the R2 CLI, use the selected physical store.
Changing a mapping requires a verified data migration and coordinated restart. Existing fleet-prefix R2 data is not migrated automatically.
The deployment operator still controls the node and its bucket credentials. This adds no protection from that operator.

The storage E2E uses Moto 5.1.14 in a temporary virtual environment, the AWS CLI, and synthetic data on loopback listeners:

```sh
python3 -m venv /tmp/celld-storage-test
/tmp/celld-storage-test/bin/pip install 'moto[server]==5.1.14'
node tests/e2e/celld-storage.e2e.mjs /absolute/path/to/candidate /absolute/path/to/stock-celld /tmp/celld-storage-test/bin/python
```

Run the Node command from the public Wallet repository. The scenario writes repeatable evidence under `.artifacts/celld-storage-*`.
It verifies role bindings, distinct bucket contents, conditional writes, streamed and multipart writes, restart,
missing and changed mappings, duplicate destinations, fleet-bucket reuse, old-runtime refusal, and failed writes after bucket removal.
The peer role remains readable after the failure. This is emulator evidence, not cloud durability qualification.

## Earlier physical-storage evidence

- [Pristine-source build identity](evidence/physical-build.json).
- [Object binding and upgrade checks](evidence/physical-bindings.json).
- [Concurrent physical-storage checks](evidence/physical-storage.json).
- [Packaged five-role graph](evidence/packaged-role-graph.json).

These records use the same rebuilt executable. The public storage test is committed as `0bf73248`.
An independent review found no blocking defect within the measured scope.
Each Deriver test Worker receives only its own R2 binding. Shared host credentials remain under the trusted operator model.
This does not establish protection against runtime compromise, cloud IAM isolation, or distributed durability.

## Current Wallet acceptance

- [Pristine-source build identity](evidence/workers-build.json).
- [Object bindings and streamed response copies](evidence/workers-bindings.json).
- [Physical bucket behavior](evidence/workers-storage.json).
- [Packaged Wallet lifecycle result](evidence/packaged-wallet.json).
- [Current Google Linux x86-64 runtime results](evidence/google-runtime.json).
- [Historical Linux ARM64 release identity](evidence/linux-release.json).
- [Linux object and stream behavior](evidence/linux-runtime.json).

Run the Wallet scenario from the private repository:

```sh
python3 tests/e2e/celld/packaged-wallet.e2e.py \
  /absolute/path/to/candidate \
  /absolute/path/to/installed/@seams/wallet-server \
  /tmp/celld-storage-test/bin/python \
  /absolute/path/to/esbuild \
  /absolute/path/to/private-celld-0.6.2-seams.4 \
  /absolute/path/to/seams-wallet-checkout \
  /absolute/path/to/installed/@seams/wallet
```

The preceding `.4` private version is reproducible from commit `4aaeb6bc` and its build command.
The current run uses esbuild 0.28.1, frozen SDK 0.9.4, and the recorded Server 0.9.4 local test-hook candidate.
It verifies the role artifact hashes before deployment. It derives configuration from the packaged preparation scripts.
Generated secrets and grants stay in a private temporary directory. Commit only the result record, never configuration or browser traces.
The result records the SDK distribution digest, contract source hashes, exact test names, and each passing outcome.
The harness requires all 16 named contracts to pass without skips. It stops the process groups that it starts.
Set `GOOGLE_OIDC_CLIENT_ID` and `SEAMS_INTENDED_GOOGLE_ID_TOKEN` for the Email OTP contract. Never store the token in Git.
The harness snapshots both packages and records their hashes. It preserves the existing local port-offset guard.
It adopts the Gateway deployment on the running node through celld's supported pointer polling. This avoids an unrelated ownership takeover during browser setup.

The scenario applies real role and Gateway D1 migrations. It provisions a tenant root, kills the owning process,
starts a fresh node, and retries the saved grant while the former lease remains authoritative.
Every refused attempt is retained. The successful replay must preserve identity, lineage, revision, and commitment.
The initial response also says `replayed: true`: the coordinator calls creation again after activation.
Fresh emulator buckets establish initial creation. That response field does not establish an earlier external request.

The unchanged browser contracts verify mixed registration and NEAR/Tempo/Arc signing, concurrent signing retries,
last-quota contention, Router stored-signature replay, unlock/export/shared-budget signing, and recovery after response loss.
The recovery test resets the browser runtime. It does not kill a celld process during recovery.
The original Workers test branch omits VM-only direct SigningWorker ledger counts. Those internal counts remain an acceptance gap.
Private Console composition and the complete intended-behavior suite remain open.

For the local emulator, set both `AWS_ENDPOINT_URL` and `S3_ENDPOINT`.
The pinned celld bucket client uses the first variable, while the LTX replica uploader uses the second.
An omitted `S3_ENDPOINT` caused durability timeouts by sending replica writes to AWS with synthetic credentials.
The control reproduces that failure on stock and patched runtimes. With both variables, each control commits its durable marker.
This is a probe environment failure. No Wallet or runtime change was required.

### Workers compatibility diagnosis

| Fact                                        | Instrument and result                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Released Rust service binding fails on `.2` | Tenant-root bootstrap reports that `DERIVER_A` is `Object` instead of `Fetcher`.                                 |
| workers-rs checks the constructor name      | worker 0.8.4 `EnvBinding` validates `binding.constructor.name`; its R2 binding requires `R2Bucket`.              |
| Binding identities unblock bootstrap        | `.3` provisions the tenant root and serves the Gateway without application changes.                              |
| Browser signing fails on `.3`               | Registration succeeds; the first ECDSA signature returns `Cannot clone a streaming response before consumption`. |
| Focused clone control reproduces the signal | Identical Worker fixtures fail on `.3` at unread stream cloning and pass on `.4`.                                |
| Real lifecycle passes on `.4`               | All six named browser contracts pass on the same released application artifacts.                                 |

| Cause                                                           | Assessment                                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Celld bindings lack workers-rs constructor identities           | Fits the cast error and the `.3` bootstrap control.                                     |
| Celld rejects unread streamed response copies                   | Fits the browser error, focused old-runtime failure, and fixed-runtime result.          |
| Wallet needs a provider-specific application adapter            | Contradicted within these scenarios by unchanged artifacts passing after runtime fixes. |
| The test reports success without running the selected contracts | Excluded in the final run by exact JSON-report title and outcome checks.                |

The focused reference has one recorded difference. The pinned workerd permits cloning after a partial read and reader release.
The patched celld rejects that disturbed body, as the [Fetch body rule](https://fetch.spec.whatwg.org/#body-unusable) requires.
Both runtimes preserve the complete unread stream in the original and copy, and reject locked or fully consumed bodies.
This establishes the measured behavior only. It does not establish general API parity.

## Historical ARM64 Linux release qualification

The following commands reproduce `.4` from its recorded patched-source archive and matching fixture revision.
Use the `.4` source referenced by [its build record](evidence/workers-build-seams4.json). The current `.5` source has a separate build identity.

```sh
docker build --platform linux/arm64 \
  --build-arg RUST_VERSION=1.97.1 \
  --build-arg CELLD_PROFILE=release \
  --build-arg CELLD_COMMIT=90b43017241f81189453d326d05948f388b34652 \
  --build-arg CELLD_VERSION=0.6.2-seams.4 \
  --tag seams-celld-r190:0.6.2-seams.4-linux-arm64-runtime \
  /absolute/path/to/seams4-candidate/source
python3 tests/e2e/celld/linux-runtime.e2e.py \
  seams-celld-r190:0.6.2-seams.4-linux-arm64-runtime \
  /absolute/path/to/seams-wallet-checkout \
  /absolute/path/to/passed-celld-bindings-result.json
```

The upstream image build runs locked release compilation and Clippy with warnings denied.
Its default Cargo test commands discover zero tests in this source configuration. Their exit status is not behavioral coverage.
The Linux scenario reuses the public Worker fixtures and their measured stream result.
It checks one container, external object ownership, binding aliases, service calls, persistence after restart, and streaming copies.
It does not run the six browser lifecycle contracts on Linux or establish a distributed deployment.
ARM64 evidence does not qualify an x86-64 Google Confidential VM. Build and run acceptance on the selected VM architecture.
The current `.5` x86-64 Google results are separate from this historical ARM64 record.
See the [provider runbook](provider-runbook.md) for the current cloud qualification.

### Module-loading diagnosis

| Fact                            | Instrument and result                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Unbundled entry fails           | The original probe uploads the packaged shim and receives `instantiate: <none>` before listening.                     |
| Imported JS is absent           | Pinned celld `deploy.rs` reads one JS entry plus sibling WASM in `no_bundle` mode. The shim imports another JS file.  |
| Old bundler fails before upload | esbuild 0.21.5 rejects celld's required `es2024` target.                                                              |
| Normal bundle loads             | esbuild 0.28.1 includes the imported module. The five packaged roles return their source-defined rejection responses. |

| Cause                                            | Assessment                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Missing imported JS in the probe configuration   | Fits the unbundled failure and the successful bundled control.                                                                       |
| Release WASM cannot execute on celld             | Contradicted for these request-rejection paths by the successful responses. Other operations remain unverified.                      |
| Wallet requires application code changes to load | Contradicted by unchanged packaged artifacts passing the load check.                                                                 |
| Probe response expectation is wrong              | Confirmed for the initial 404/401 assumptions. Source defines 405 for Router GET and 403 for missing private service authentication. |

The earlier module-instantiation error was a probe configuration defect. It is not evidence of wallet lifecycle parity or a required application rewrite.

## Raw EC and delayed-request diagnostics

The `.4` runtime failed linked-device credential sealing at raw P-256 public-key import with `NotSupportedError`.
The same released packages completed that contract under workerd. The focused raw-key fixture reproduced the same error on `.4`.
The `.5` fixture passes three curves, invalid-point rejection, usage checks, extractability checks, and authenticated peer decryption.
Both linked-device contracts and Email OTP revocation now pass in the 16-contract run.

The broader run also found a local fault hook that retained requests in module-global Maps.
A diagnostic labeled each Worker instance and hashed each fault token. It recorded these events:

| Observation                                       | Checked evidence                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Two requests were captured in instance A          | Both hashes had capture events and `found: true`.                                       |
| One release ran in instance A                     | The same hash had `found: true`, which provides a positive control.                     |
| The other release ran in instance B               | Its captured hash had `found: false` and returned the hook's 404 before calling Router. |
| The fixed hooks preserve the lifecycle assertions | Both unchanged delayed-recovery contracts pass on celld and workerd.                    |

The failure is `valid_test_needs_update`. The hook required cross-request instance affinity that Workers do not promise.
The fix removes both Maps and reuses the existing tenant-scoped D1 ceremony store.
The first captured request wins. A versioned delete permits one release. Stored requests are parsed once when read.
The ten-minute expiry blocks later reads. It does not guarantee proactive erasure of abandoned rows.
Loopback guards remain in force. No wallet protocol or authorization behavior changed.
An independent reviewer checked the measurements and the four-file fix.

A separate setup run failed registration with `owner_unreachable` immediately after the harness restarted the Gateway node.
That run never reached the recovery hook. It is `environment_or_infrastructure_failure`.
The harness now adopts the Gateway deployment on the running node. The subsequent complete run passes all 16 contracts.

Private Console Worker composition passes after its Express host removal. See [Console evidence](evidence/console-worker.json).
The [current source inventory](evidence/source-size-checkpoint.json) includes the complete runtime patch and acceptance code.
The final 0.11.0 candidates pass all 16 selected Wallet contracts on both Google VM types. Google Console onboarding also passes.
Classic-host code is removed. The operator confirms that only Workers are deployed, so no classic-host state migration is required.
Remaining gates cover the distributed lifecycle matrix, release promotion, and state-safe upgrade and rollback procedures.
See [the current plan](../../docs/refactor-190.md#remaining-rollout-gates).

## Yao peer-disconnect check

The shared Durable Object fault proxy passes the real Yao interruption check on both runtimes.
The local runner checks burned state across a offline runtime upgrade and a later restart.
Use the exact qualified Wallet Server package, the public Wallet checkout and the supplied Moto Python environment:

```sh
python3 tests/e2e/celld/yao-peer-disconnect.e2e.py CELLD WALLET_SERVER_PACKAGE MOTO_PYTHON ESBUILD WALLET_CHECKOUT PREVIOUS_CELLD
```

Use `.5` for `PREVIOUS_CELLD` and `.6` for `CELLD` to repeat the qualified upgrade.
The runner stops the old process before deploying the new manifests.
Moto supplies local synthetic S3 storage. This check uses no AWS account.
The result records runtime/package/source hashes, the fault, pair states, retries, the independent wallet and cleanup.
See [Yao interruption evidence](evidence/yao-peer-disconnect.json), [runtime upgrade evidence](evidence/yao-runtime-upgrade.json), and [diagnosis and limits](yao-diagnostics.md).
A Worker-created socket currently loses its handoff across the sampled celld service binding.
The verified Wallet peer path uses object-owned sockets. General Worker WebSocket handoff remains unqualified.

## Composed relocation check

Run the shared mixed Ed25519/ECDSA scenario with real celld custody Workers:

```sh
python3 tests/e2e/celld/relocation.e2e.py \
  /path/to/celld /path/to/moto-venv/bin/python \
  /path/to/seams-wallet /path/to/packed/@seams/wallet-server
```

The runner requires release Worker builds that match the supplied package manifest.
It starts isolated loopback services and writes a protected `.artifacts/celld-relocation-*` directory.
The result records source snapshots, source-tree hashes, generated deployment hashes, proof files, and runtime cleanup.
Run the workerd control separately because both variants generate the same public fixture modules:

```sh
SEAMS_RELOCATION_OUTPUT=/path/to/new-proof-directory \
SEAMS_WALLET_SERVER_CANDIDATE=/path/to/seams-wallet/packages/wallet-server \
ROUTER_AB_WORKER_BUILD_PROFILE=release \
node tests/e2e/relocation-custody.e2e.mjs --with-ecdsa
```

Both variants pass generation-1-to-2 relocation, lost-response recovery, replay after eviction, and destination signing.
See [the recorded results and limits](evidence/relocation-celld.json).
Destination class exports use distinct aliases to satisfy celld's co-hosting restriction.
Router and SigningWorker stores are separate. Deriver role stores and tenant-root authority are shared.
Directory/Runtime handlers remain in Node. Directory storage remains in Miniflare.
The relay covers the exercised JSON-safe D1 operations and buffered HTTP callbacks.
This check adds no production calls. Hosted deployment, distributed relocation, and latency qualification remain separate gates.

## WebSocket passthrough and active claims

Private build `.7` corrects remote socket ownership tracking and an HTTP-body drain pin on upgraded responses.
It also releases rejected tunnels and uses the existing splice path for forwarded remote sockets.
The fixes add no Wallet request, database call, or network round trip.
See [the diagnosis, controls, and limits](evidence/websocket-passthrough.json).

Run the repeatable two-node fixture with isolated loopback services:

```sh
python3 tests/e2e/celld/websocket-passthrough.e2e.py /path/to/celld /path/to/moto-venv/bin/python
```

It checks local and remote owners, a remote relay, rejected upgrades, and successful runtime shutdown.
The identical fixture reproduces the ownership panic on `.6` and passes on `.7`.
The full post-takeover Wallet scenario also drains on `.7`; simple local echo did not reproduce its earlier stall.

The Google runner now holds the second Yao reply, reads both claims as running, and kills the B-owner process.
It requires execute submission through confirmed SIGKILL to take less than the 15-second ceremony timeout.
It also rejects a shutdown handoff stall regardless of process exit code.
The first trial lacked the timing bound and logged a stall, so it remains unqualified.
The corrected `.7` run confirms SIGKILL within 6,195 ms, below the 15,000 ms ceremony timeout.
Both roles stay burned after takeover, and an exact retry opens no new protocol connection.
Independent registration succeeds on the unchanged survivor. Both VMs stop, and temporary peer rules are removed.
The fresh post-rebase package candidates pass all 16 selected contracts on celld and workerd.
Shared storage remains available during this scenario; provider partitions and all-replica loss remain open.
