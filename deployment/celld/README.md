# Private celld cross-script object proof

Status: local compatibility proof. This build is not approved for Wallet production deployment.

The user selected a private runtime patch to preserve the current Wallet call structure.
No upstream issue, pull request, public fork, or maintainer contact is part of this work.

## Source and build identity

- Upstream: `https://github.com/denoland/celld.git`.
- Base: `90b43017241f81189453d326d05948f388b34652` (`v0.6.2`).
- Private version: `0.6.2-seams.1`.
- Patch: [cross-script-objects.patch](cross-script-objects.patch).
- Patch SHA-256: `6c42d06498ffdc42cef489aaef17dee52a0dbe67c543cc0bd30b035122e3f4a0`.
- Tested build: macOS ARM64, `rustc 1.97.1`, `cargo 1.97.1`, Cargo `dev` profile.
- Tested executable SHA-256: `a7d2ec0f68f1bd6a762f4a300612d548de77ce5c9964eba9b9f6589cae1293fa`.

The patch applies to a clean archive of the pinned source. All ten resulting files match the compiled source.
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

The full Wallet role graph and WASM have not run on this build.
Managed upload paths, live reload, distributed relocation, crash recovery, and remote bucket durability remain unverified.
A/B backup-bucket separation remains unresolved. Linux, AWS, Google Cloud, and Confidential VMs remain untested.
No latency benefit or production security claim follows from this local proof.

## Build

Use a new directory for the source checkout. Run these commands from this private repository:

```sh
CELLD_PATCH_PATH="$PWD/deployment/celld/cross-script-objects.patch"
git clone --branch v0.6.2 --depth 1 https://github.com/denoland/celld.git /tmp/seams-celld-private
cd /tmp/seams-celld-private
test "$(git rev-parse HEAD)" = 90b43017241f81189453d326d05948f388b34652
git apply --check "$CELLD_PATCH_PATH"
git apply "$CELLD_PATCH_PATH"
cargo build --locked -p celld --bin celld
./target/debug/celld --version
```

Use the same Rust toolchain to reproduce the tested build conditions.
A different toolchain or platform produces a new candidate that needs its own evidence.
The upstream Apache-2.0 license and notices remain in the source checkout.

## Verify

From the `seams-wallet` R190 branch with locked dependencies installed:

```sh
node tests/e2e/celld-bindings.e2e.mjs \
  /tmp/seams-celld-private/target/debug/celld \
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
