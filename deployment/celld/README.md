# Private celld runtime build

Status: local compatibility proof. This build is not approved for Wallet production deployment.

The user selected a private runtime patch to preserve the current Wallet call structure.
No upstream issue, pull request, public fork, or maintainer contact is part of this work.

## Source and build identity

- Upstream: `https://github.com/denoland/celld.git`.
- Base: `90b43017241f81189453d326d05948f388b34652` (`v0.6.2`).
- Private version: `0.6.2-seams.2`.
- Patch: [workers-runtime.patch](workers-runtime.patch).
- Patch SHA-256: `3a4215a42282e6e83ae313df2c192e3cf9e68469712edb766bb1c9907a1957fe`.
- Tested build: macOS ARM64, `rustc 1.97.1`, `cargo 1.97.1`, Cargo `dev` profile.
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

## Deliberate limit

Each application Durable Object class must still have one owner in a fleet.
Two independent Workers exporting the same class name remain unsupported and fail startup.
Our current Router, Deriver A, Deriver B, and SigningWorker classes have distinct names.
The patch adds external references within this constraint. It does not implement all Cloudflare namespace semantics.

The five packaged role Workers and their release WASM pass the load check below. Successful wallet operations remain unverified.
Managed upload paths, live reload, distributed relocation, crash recovery, and remote bucket durability remain unverified.
Local physical bucket separation passes the storage scenario described below. Cloud bucket access and distributed behavior remain unverified. Linux, AWS, Google Cloud, and Confidential VMs remain untested.
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

Keep the classic hosts until the remaining R190 gates pass. A production rollout needs a separately validated build and maintenance procedure.

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
Linux and release-profile builds remain unverified.

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

## Current acceptance evidence

- [Pristine-source build identity](evidence/physical-build.json).
- [Object binding and upgrade checks](evidence/physical-bindings.json).
- [Concurrent physical-storage checks](evidence/physical-storage.json).
- [Packaged five-role graph](evidence/packaged-role-graph.json).

These records use the same rebuilt executable. The public storage test is committed as `0bf73248`.
An independent review found no blocking defect within the measured scope.
Each Deriver test Worker receives only its own R2 binding. Shared host credentials remain under the trusted operator model.
This does not establish protection against runtime compromise, cloud IAM isolation, or distributed durability.

Run the packaged graph check from the private repository:

```sh
python3 tests/e2e/celld/packaged-role-graph.py \
  /absolute/path/to/candidate \
  /absolute/path/to/installed/@seams/wallet-server \
  /tmp/celld-storage-test/bin/python \
  /absolute/path/to/esbuild
```

The successful run uses esbuild 0.28.1 and the exact installed Wallet Server 0.9.3 package.
It verifies all Worker artifact hashes, derives bindings from the packaged manifests, deploys to an isolated S3 emulator,
and loads all five roles. Router rejects GET with 405; the four private roles reject missing service authentication with 403.
No real secrets or wallet records enter the scenario. Runtime and emulator processes stop after the run.
This scenario excludes the Gateway, private Console composition, successful signing, and lifecycle persistence.

### Module-loading diagnosis

| Fact | Instrument and result |
| --- | --- |
| Unbundled entry fails | The original probe uploads the packaged shim and receives `instantiate: <none>` before listening. |
| Imported JS is absent | Pinned celld `deploy.rs` reads one JS entry plus sibling WASM in `no_bundle` mode. The shim imports another JS file. |
| Old bundler fails before upload | esbuild 0.21.5 rejects celld's required `es2024` target. |
| Normal bundle loads | esbuild 0.28.1 includes the imported module. The five packaged roles return their source-defined rejection responses. |

| Cause | Assessment |
| --- | --- |
| Missing imported JS in the probe configuration | Fits the unbundled failure and the successful bundled control. |
| Release WASM cannot execute on celld | Contradicted for these request-rejection paths by the successful responses. Other operations remain unverified. |
| Wallet requires application code changes to load | Contradicted by unchanged packaged artifacts passing the load check. |
| Probe response expectation is wrong | Confirmed for the initial 404/401 assumptions. Source defines 405 for Router GET and 403 for missing private service authentication. |

The earlier module-instantiation error was a probe configuration defect. It is not evidence of wallet lifecycle parity or a required application rewrite.
