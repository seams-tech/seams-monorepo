# Wallet CLI release

The `@seams/wallet-cli` launcher runs only when two things exist: the GitHub release
`seams-cli-v<version>` in `seams-tech/seams-wallet`, and the npm package. The launcher
downloads `seams-release-manifest.json` and the native binary from that release and
verifies the manifest signature against the release root compiled into the binary
(`crates/seams-cli/trust/release-root.json`, key `seams-release-root-production-2026-10`).

## Who does what

| Step | Where | Credential |
| --- | --- | --- |
| Native build | public `build-seams-cli.yml`, on a push to `main` | none |
| Sign and verify | private `release-seams-cli.yml`, dispatched on `main` | `release-signing` environment: `SEAMS_RELEASE_SIGNER_KEY_ID`, `SEAMS_RELEASE_SIGNING_KEY` |
| GitHub release | the owner's `gh` session | the owner's GitHub login |
| npm launcher | `npm publish` of the packed launcher | the owner's npm login, approved in the browser |

The private workflow reads the public build with its own workflow token: the public
repository is readable without a separate credential. The signing key never leaves the
`release-signing` environment. The signed manifest is public data. The sign job saves it
as the `seams-cli-release-manifest-<version>-<public-revision>` artifact and records its
SHA-256 in the job summary. Artifact delivery avoids GitHub's log secret masking.

## Steps

1. Bump `packages/seams-cli/package.json` and `crates/seams-cli/Cargo.toml` (and
   `Cargo.lock`) in `seams-wallet`, merge to `main`, and wait for `Build seams CLI` to pass.
2. Dispatch the private workflow on `main`:
   `gh workflow run release-seams-cli.yml --ref main -f release_version=<v> -f public_revision=<sha> -f public_build_run_id=<run>`.
3. Download the public build artifacts of that run into an empty folder. Download the
   signed manifest artifact from the private signing run, then check its SHA-256
   against the job summary.
4. Verify each binary, the SBOM and the notices with the matching native binary:
   `seams-wallet-aarch64-apple-darwin release verify --manifest seams-release-manifest.json --artifact <file>`.
   Also confirm that an altered byte fails.
5. Create the release:
   `gh release create seams-cli-v<v> --repo seams-tech/seams-wallet --target <sha>` with the
   three binaries, `seams-release-manifest.json`, `seams-sbom.txt` and
   `THIRD_PARTY_NOTICES.md`.
6. Pack the launcher at the same public revision (`npm pack` in `packages/seams-cli`; the
   `prepack` script copies the release root), compare its `release-root.json` with the
   pinned one, and run `npm publish <tgz> --access public`. npm prints a browser link; the
   owner approves there.
7. Check: `npm exec --yes --package=@seams/wallet-cli@<v> -- seams-wallet version`.
8. Move `WALLET_CLI_PACKAGE` in
   `apps/wallet-console/src/products/wallet/derivation-root/recoveryKeySetupCommand.ts` and
   the public `recovery-cli.md` to the new version, then deploy the Console frontend.
