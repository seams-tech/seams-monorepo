# Refactor 105B: GitHub And Release Split

Date created: August 18, 2026

Last reconciled: September 12, 2026 (private-repository cutover and public Wallet validation)

Status: implementation in progress. This plan executes Refactor 105 Phase 8 after the in-monorepo
Console boundary is complete. R120 and R121 source integration have landed;
R121's September 11 acceptance closeout is `6f088d2dd`. Freeze a later `dev` commit that
also includes the R105 closeout changes. Outstanding R121 verification is
recorded below and remains distinct from completed feature implementation.

Implementation checkpoint: the retained repository and remote are now
`seams-tech/seams-monorepo`. The public tree was extracted from private source
commit `aa4c1220c`, committed with fresh history as `cdb1c4a`, and pushed to
public `seams-tech/seams-wallet`. Follow-up `c2bff78` removed the private CLI
release-signing and recovery-trust-signing workflows and installed the
credential-free public CLI build workflow. No signing secret or deployment
environment moved to the public repository.

The recorded extraction source is `aa4c1220c9a0877cd950fb40633488318f912b8e`.
The first SDK package version is `0.5.0`; TypeScript packages use MIT and the
Rust implementation and CLI use Apache-2.0. Public validation initially
exposed a missing Bun setup in the extracted workflow. Public commit
`973be81` and its matching private-source commit `44387ae24` install Bun for
both validation and npm publication.

The first extracted tree also carried the unrelated `voiceId/` evidence lab.
Public commit `f717bb8` removes it and its workspace lockfile importer. The
private monorepo retains that lab; `repository-split.json` no longer assigns it
to the Wallet repository.

The September 12 ownership reconciliation extracted current private commit
`f8199bd35` into a fresh 2,933-file Wallet tree and compared it with the public
repository. The only drift was the current ignored artifact directory and the
packed-package guard's names for the already-split deployment target files.
Public commit `91fe324` brings both into agreement; no private source or
deployment configuration appeared in the candidate tree.

The publication license inventory covers the 102 resolved runtime npm
dependencies of the two packages and the 412 distinct registry crate/version
pairs used by the distributed Worker, Wasm, and CLI manifests. The npm runtime
closure is MIT, BSD, ISC, 0BSD, or Apache-2.0. Every Rust dependency offers a
permissive license choice; there is no unknown or copyleft-only crate. The
statically linked and browser-bundled artifacts still require preservation of
third-party copyright/license notices. The deterministic notice generator
records all 514 dependency records, groups identical packaged license texts,
and writes the notice bundle consumed by both npm packages. Public CLI build
metadata carries the same notice; private signing adds it to the signed
manifest and GitHub release. Both npm packages also carry their own Seams MIT
`LICENSE`, and the packed-package check requires both files.

The CLI repository-move release is prepared as `0.4.1`. Public CI builds the
native binaries, SBOM, and release-manifest utility from one public revision.
Credential-free public run `34635301798` completed successfully for CLI source
revision `f717bb816a17edd1e645c6a8dc9c3685872ae797` across both macOS
architectures, Linux x86_64, and the release metadata tools.
Public docs run `34637364946` produced immutable artifact
`wallet-docs-b7fc5cb68e9151b2b6bc9edd2dbe32934b923448` from the isolated
VitePress workflow. Full SDK build and declaration validation remain in the
public repository validation and package-release workflows.
After notice packaging, public revision
`ac13393f75693811fc152750092b4a5943a83ef1` produced docs artifact
`wallet-docs-ac13393f75693811fc152750092b4a5943a83ef1` in successful run
`34641246614`. Its successful CLI run `34641246620` produced all three native
binaries plus release-tools artifact `10279952683`; the latter contains the
721,903-byte third-party notice, SBOM, and manifest signer.
Public revision `d07e13f4fb2fde7bb4fe1e7703e4b129b3ea62f1` subsequently
completed the credential-free `0.4.1` CLI build in run `34654577604`. Signing,
the public GitHub release, and npm launcher publication remain blocked on the
private `SEAMS_WALLET_RELEASE_TOKEN` operator input.
Public revision `56cc7adda4d4b054e4690cb41538ccfebd2da1ac` completed the
independent Wallet validation in run `34663386808`. The clean public checkout
built and type-checked, passed the representative browser, unit, and
Console-free intended-behaviour checks, validated the packed packages, built
the Wallet docs, example, and intended test app, and built and smoked the
self-host runtime. Reaching that gate required resolving the shared tenant-root
import through the public package boundary, extracting the committed signer
package fixture, and separating the Wallet role-worker inspector ports from the
Wallet asset host. The exact passkey registration contract also passed locally
against the corrected Console-free runtime before the replacement public run.
The private frontend workflows now require a full public Wallet revision,
resolve exactly one unexpired artifact whose workflow run has that head SHA,
record its artifact and run IDs, and use its contents for the docs deployment.
They no longer build VitePress from private source. A read-only
`SEAMS_WALLET_ARTIFACT_READ_TOKEN` is a frontend-publication credential; it has
no package publication, repository-write, or Cloudflare authority. Mounting
this downloaded artifact into the current wallet Pages output at `/docs/` is
complete. The existing standalone docs Pages output remains available during
the R123 hostname/redirect cutover; the artifact is mirrored beneath its
`/docs/` path because its VitePress base is `/docs/`.
The private `release-seams-cli.yml` accepts that revision and successful public
run ID, verifies both, signs with the private release root, publishes the assets
to `seams-wallet`, and then publishes the npm launcher. The empty
`npm-release` and `release-publication` GitHub environments have been created;
the one-time `SEAMS_NPM_BOOTSTRAP_TOKEN`, subsequent npm trusted-publisher
configuration, and scoped `SEAMS_WALLET_RELEASE_TOKEN` remain operator inputs.

Private backend deployment is now split by authority. The Console workflow
uses the dedicated `staging-console`, `production-testnet-console`, and
`production-console` environments and owns Console D1 migration, deployment,
OAuth, session, email, webhook, and billing inputs. The lane workflows retain
Wallet-system migration and deployment only. Bulk
`DEPLOYMENT_SECRETS_JSON`/`DEPLOYMENT_VARS_JSON` preflight inputs have been
removed. Console and Wallet-system now have separate target files, generation
commands, protected backup manifests, GitHub environments, update commands,
and deployment dispatch commands. The generic `wallet-core`/`product`
commands, combined rotation command, cross-generation verification, and
Console secrets in Wallet-system manifests have been removed. The Console now
uses its private `WALLET_RUNTIME` binding for an exact allowlisted tenant-root
control port; MPC, control-plane, Deriver, and Wallet internal-auth bindings
remain solely in the Wallet-system deployment.
Each lane workflow now deploys its tenant-root control plane from the shared
Wallet-system build artifact and waits for it before deploying the Router. The
three obsolete standalone control-plane workflows have been removed.
Backend build, plan, migration, deployment, and smoke commands now require an
explicit `console` or `wallet-system` authority. Their workflows produce,
upload, deploy, and smoke only their own artifacts and endpoints.

The retained repository has been renamed `seams-tech/seams-monorepo` and made
private. The public `seams-tech/seams-wallet` repository remains available for
credential-free builds. This visibility cutover happened before the replacement
CLI release, so fresh installs of older launchers that still embed the historical
repository URL are unavailable until `0.4.1` is signed and published from
`seams-wallet`.

## R121 Extraction And Release Addendum

R121's dashboard product, Console routes, step-up/approval handling, scheduler,
audit, operation/restore journals, and `wallet-console-server-ts` migrations
stay private. Its generic Rust recovery protocol, `crates/seams-recovery-core`,
`crates/seams-cli`, role-private migrations, and portable protocol/CLI contracts
move public. Split mixed shared TypeScript models by actual consumers; a
`shared-ts` directory placement alone does not establish public ownership.

The native `seams-wallet` binary and `@seams/wallet-cli` npm launcher add a
release boundary alongside the SDK packages. Keep the
existing `release-seams-cli.yml` and signing authority private, as requested
for all existing Actions. Replace its source-checkout Cargo build with downloads
of immutable macOS/Linux artifacts built by credential-free public CI from the
recorded public revision. Include the existing release-manifest utility in the
public build outputs. Private publication verifies provenance, pinned public
trust and checksums, then signs and publishes the release assets to the public
`seams-tech/seams-wallet` repository using scoped publication credentials.
Update the launcher and CLI/runbook links before the old repository becomes
private. Production signing keys never enter
public CI. This adds no crates.io publication or second CLI implementation.

### Released CLI Cutover

Signed GitHub release `seams-cli-v0.2.5` was the earlier release checkpoint.
The standard command is `seams-wallet`; the npm package is
`@seams/wallet-cli`, sourced from `packages/seams-cli`. The September 11 R121
closeout records published CLI/launcher 0.4.0 and owner-accepted local backup,
ZIP download, restore, activation, and rotation. Setup uses
`--wrapping-key-file`, and the CLI discovers the dashboard URL from Console.
Automated wallet-continuity acceptance now passes locally. Hosted recovery
acceptance remains open; repository extraction does not certify hosted outcomes.

All four September 11 rotation E2Es now pass: signing during interrupted
rotation, warm Tempo/Arc signing, cold unlock with original keys, and recovery
with a pre-rotation code preserving original Ed25519/ECDSA keys. Preserve the
landed launcher isolation (`5dfb89356`), authoritative environment identity
resolution (`4ebff154c`), and custody payload boundaries (`74b8fc835`). In
particular, keep the Console adapter/service binding that resolves environment
keys to IDs before exact tenant-root lookup, explicit WASM EVM null fields,
and chain-specific recovery parsing. Retain the four contracts and existing
invariance vectors through extraction. The
[R121 closeout](./refactor-121-remaining-steps.md#closeout-and-r105-handoff--september-11)
owns detailed evidence and hosted/provider follow-up. These passing local
results supersede the earlier blocked-E2E handoff.

Published launchers before `0.4.1` embed the historical repository release URL.
GitHub rename redirects do not preserve anonymous downloads after that
repository becomes private. The visibility cutover has occurred, so complete
these steps without further delay:

- Move `packages/seams-cli`, its preparation script, public release trust,
  native CLI/recovery source, and required build inputs into `seams-wallet`.
- Publish a new CLI/launcher version whose signed native assets are publicly
  downloadable from `seams-tech/seams-wallet`. Keep `seams-wallet` and
  `@seams/wallet-cli` as the command and package names. Existing published
  versions and signed manifests remain immutable.
- Preserve the release-verification trust anchor and the runtime deployment
  trust retained for offline recovery. Preserve OS HTTPS verification,
  dashboard-approved scoped restore access, and recovery ZIP support with
  optional password encryption. A repository move does not rotate trust or
  change recovery formats, capabilities, or deployment authority.
- Update dashboard-generated installation commands, download links, npm
  metadata, and recovery instructions to the new release. Require users of
  launchers embedding the old repository URL to upgrade before privacy cutover;
  cached offline execution does not establish fresh-install availability.
- Demonstrate one clean installation with an empty cache and no GitHub login
  from the new npm package, verifying its public signed download. Reuse the
  existing offline and restore drill for any changed launcher/trust paths.

The original repository is already private. Treat replacement CLI publication
as an active fresh-install availability gap.
The existing private release workflow publishes the signed public assets;
credential-free public CI builds them. SDK npm versions and CLI versions remain
independently versioned. R121 retains ownership of its outstanding tenant-flow
acceptance and npm promotion requirements.

Generic CLI and self-host recovery instructions belong with the public source;
Seams provider setup, trust-root ceremonies, incident procedures, and deployed
evidence remain private. Split the current recovery runbook on that boundary.

R120 managed-backup KMS credentials and R2 bindings belong to Wallet-system
role environments. R121 tenant-controlled recovery retention is a distinct,
currently deferred provider setup. Console grants/step-up credentials, Wallet
issuer/role keys, and CLI release-signing credentials have separate owners;
no combined generation or rotation command may write across those boundaries.

## Decision

Use exactly two repositories:

| Repository                  | Visibility | Ownership                                                                                                                                                                                                                      |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `seams-tech/seams-monorepo` | private    | The current `seams-tech/seams-sdk` repository, renamed in place. It owns Console, future private products, deployment topology, environment configuration, secrets, provider configuration, and staging/production operations. |
| `seams-tech/seams-wallet`   | public     | One fresh-history repository containing the Wallet client and server SDKs, their Rust/Wasm implementation, public docs, public examples, and a generic self-hostable runtime.                                                  |

The current repository keeps its history and is renamed. Do not create a
second private repository. The public repository starts with one initial commit
created from a fixed source revision; private history is not copied.

Rust remains in `seams-wallet` beside the TypeScript packages that use it.
Refactor 105B creates no additional Rust repositories and publishes no crates
to crates.io. Carried crate manifests use `publish = false` unless a later,
separately approved plan changes that decision.

Private deployment remains in `seams-monorepo`, with Console and Wallet-system
secrets and environment variables managed by separate pipelines and disjoint
write credentials.

## Repository Ownership

### Public `seams-wallet`

Move the complete public Wallet implementation:

- `packages/wallet`, published as `@seams/wallet`;
- `packages/wallet-server`, published as `@seams/wallet-server`;
- `packages/seams-cli`, published as `@seams/wallet-cli`, and the native
  `seams-wallet` binary with its Rust recovery implementation;
- Wallet-only shared packages required by those packages;
- the required `crates/`, `wasm/`, generators, and checked-in bindings;
- the R120 tenant-root protocol and generic control-plane, Router, and Deriver
  runtime source, role-private migration sets, binding contracts, and generic
  self-host configuration;
- Wallet-owned tests that run without Console or private infrastructure;
- Wallet API, protocol, self-hosting, and development documentation under
  `docs/`, with the VitePress source configured for publication at `/docs/`;
- `examples/seams-auth-menu`, containing the minimal `SeamsAuthMenu` consumer;
- `examples/self-host-cloudflare-worker` and the generic local/self-host
  runtime;
- package build configuration and newly authored credential-free CI and npm
  publishing workflows.

The public repository contains no Seams production/staging topology, account
IDs, customer data, provider registrations, environment values, deployment
secrets, private runbooks, or Console source.

### Private `seams-monorepo`

Keep:

- `apps/seams-site`, `apps/seams-console`, `apps/web-server`, and the private
  operational portion of `apps/docs`;
- Console core, Wallet Console, Admin, and future private product packages;
- every current `.github/workflows/*` file;
- deployment scripts, Cloudflare/Wrangler configuration, domains, routes,
  environment declarations, account identifiers, provider configuration,
  secrets, and production/staging runbooks;
- R120 plans, architecture-selection and deployment evidence, real
  tenant-root target rendering, role-key operations, and incident procedures;
- the separate Console and Wallet-system target files, environment/secret
  generators, update/rotation commands, and deployment entrypoints;
- Console, deployment, staging, and composed-stack tests;
- internal architecture and refactor plans.

Wallet documentation that belongs to the public SDK receives one canonical
source in `seams-wallet`, including the VitePress site configuration. Public CI
builds an immutable, versioned artifact with `base: '/docs/'`. The private
wallet-site workflow consumes that exact artifact and assembles it at
`wallet.seams.sh/docs/*` alongside marketing and dashboard. Private Console,
Admin, deployment, provider, topology, and operational documentation remains in
the monorepo. A separate `docs.wallet.seams.sh` deployment is outside R105.

## Consumption And Deployment Contract

The private monorepo imports exact published versions of `@seams/wallet` and
`@seams/wallet-server`. It uses no workspace link, path or Git dependency,
submodule, sibling checkout, or fallback to public source.

`@seams/wallet` ships the browser SDK and `SeamsAuthMenu` exports needed by the
private frontend. `@seams/wallet-server` ships the generic executable Worker
modules, Wasm assets, signer and R120 role-private migrations, types, and the
artifact manifest needed by the private backend. The manifest identifies the
exact tenant-root control-plane, Router, Deriver, and Signing Worker artifacts
plus every migration set's head and fingerprint.

The packages contain generic runtime artifacts only. Private workflows add the
real Cloudflare bindings, routes, database IDs, service names, provider
configuration, environment values, and secrets when they deploy. Private
deployment does not run Cargo or `wasm-pack` and does not check out
`seams-wallet` source.

The public package owns a generic local signer-migration command and reads its
own versioned migrations directly. The private local-runtime and remote
migration managers invoke that installed command or manifest. They do not copy,
rewrite, or discover signer/role migration files through Console package paths.
The private remote manager keeps partial-application checkpoints and records
the fingerprint supplied by the exact installed package version.

All existing GitHub Actions remain in `seams-monorepo`. The public repository
gets new workflows for public validation, native CLI builds, and npm publishing. Those
workflows require no Seams deployment credential or private environment.

Public CI also builds the Wallet VitePress site as a versioned static artifact.
The private wallet frontend workflow selects an exact artifact revision and
places it under its output's `/docs/` directory. This artifact handoff grants no
deployment authority and creates no build-time source dependency between the
repositories. The wallet-site release remains one Pages artifact and workflow
for marketing, dashboard, and public Wallet docs.

The two npm packages may be released together, but their package manifests are
the version authorities. The private lockfile records the exact compatible
pair. Do not add a second release-version manifest.

### Private Secret And Environment Pipelines

The repository split also makes private deployment ownership explicit. Replace
the current paired `wallet-core`/`product` generation with two independent
private pipelines:

```text
deployment/console/targets.json
  console:deploy:env-prepare
  console:deploy:env-apply
  console:deploy:env-update
  console:deploy

deployment/wallet-system/targets.json
  wallet-system:deploy:env-prepare
  wallet-system:deploy:env-apply
  wallet-system:deploy:env-update
  wallet-system:deploy
```

The Console pipeline owns Console Pages/Worker/D1, Console session and OAuth
secrets, Console email/webhook/billing configuration, Console routes, and
Console origins. The Wallet-system pipeline owns Wallet Gateway/Runtime,
hosted Wallet Pages, signer and Router A/B infrastructure, protocol keys, root
shares, ceremony/signing-session material, relayer credentials, Wallet network
configuration, Wallet origins, and the R120 tenant-root control plane. R120
online-sealing, managed-backup, role-creation, and issuer keys remain scoped to
their owning Wallet role.

The two generators have different manifest schemas and output files. Each can
write only its own protected GitHub environments and owned variable/secret
names. Preparing or rotating Console configuration never generates Wallet
cryptographic material. Preparing or rotating Wallet infrastructure never
reads or writes a Console secret.

Use distinct environment names. Console uses `staging-console` and
`production-console`. Wallet-system environments remain lane/role-specific,
for example `<lane>-gateway`, `<lane>-tenant-root-control-plane`,
`<lane>-mpc-router`, `<lane>-deriver-a`, `<lane>-deriver-b`, and
`<lane>-signing-worker`. The tenant-root issuer private key exists only in its
control-plane environment. Deriver A and B keep distinct online, backup, and
role-creation keys. The Signing Worker receives none of these values. No GitHub
environment belongs to both pipelines. Site/docs environments keep their
existing private owner and are outside the Wallet-system secret set.

Deploy workflows follow the same boundary. Remove the combined backend
sequence that deploys Wallet Runtime, Console, and Gateway under one secret
inventory. Do not pass a repository environment's complete secret map into a
cross-authority deployment process. Each workflow receives the narrow list of
values owned by its GitHub environment and a Cloudflare token scoped to its
resources.

The only cross-pipeline handoff is read-only deployment identity: network
names, public origins, service binding names, and deployed Wallet
artifact/runtime versions. The frontend publication workflow additionally
holds a token scoped only to reading public Wallet Actions artifacts. Neither
pipeline can invoke, rotate, or overwrite the other pipeline.

## Test Ownership

Move a test when it can run against the generic Wallet runtime with generated
fixtures and no Console, provider account, private service, or deployment
secret. Keep a test private when it exercises Console, private bindings,
staging/production topology, deployment behavior, or composed product flows.

Split mixed files by behavior. Avoid a cross-repository test package or any
test helper that recreates a source dependency between the repositories.

Recent test refactors establish two useful authorities:

- `pnpm test:console`, `tests/playwright.console.config.ts`, and
  `tests/e2e/console/*.operating.test.ts` are the private Console/composed
  operating suite;
- `tests/scripts/run-wallet-intended-isolated.mjs` gives each credential-free
  Wallet intended-behaviour case fresh managed state and moves with the public
  Wallet tests.

The public `start-wallet-intended-services.mjs` manager now starts the static
Wallet Gateway, signer-only D1, five Wallet role Workers, Wallet asset origin,
and independent `tests/intended-app` origin. It starts no Console, company site,
Caddy, or Console D1. The private `start-intended-services.mjs` manager remains
the Console/composed authority. Google-token recovery and the R121 Console
tenant-root rotation contract remain outside the credential-free public suite.
Wallet authority, device-linking, and tenant-root domain-state type fixtures
also run from the public test workspace; Console operation and dashboard type
fixtures remain private.

The required checks are intentionally small:

- public: install, build both packages and required Wasm, run the Wallet-owned
  tests, and start the generic runtime once;
- private: install the exact npm versions, build Console/backend artifacts, and
  run one composed Wallet flow before deployment.

Existing Rust/Wasm checks move with their owning source. This plan does not add
an exhaustive new test matrix or formal-verification gate solely for the split.

## Extraction Contract

Update `repository-split.json` and `scripts/extract-repositories.mjs` for one
public output named `seams-wallet`. The existing repository is the retained
private source and is not an extraction output.

Extract from one recorded commit into an empty directory. The manifest must
explicitly include public paths and reject unassigned or private deployment
paths. After extraction, inspect the final tree for secrets and private
configuration before its first push. This is a one-time source movement tool;
delete it from the private repository after the split unless it still has a
concrete owner.

## Phases

### Phase 0: Freeze Ownership

- [x] Record the landed R120 and R121 integration (`6f088d2dd` acceptance closeout), then
      freeze a `dev` descendant containing the finished R105 boundary work.
      Reconcile the R121 additions against the addendum above.
- [x] Complete the Refactor 105 in-monorepo boundary and classify unfinished
      Refactor 99B paths as private.
- [x] Reconcile the ownership inventory against the current tree. Fresh extraction
      from `f8199bd35` contained 2,933 files; public `91fe324` resolved the only
      two file-level drifts without adding a private path.
- [x] Classify every deployment variable, secret, target, generator output,
      GitHub environment, and Cloudflare token as Console or Wallet-system.
- [x] Confirm the public docs, VitePress configuration, examples, tests,
      Rust/Wasm inputs, and package artifacts required for an independent Wallet
      build and `/docs/` static artifact.
- [x] Classify all R120 additions: tenant-root protocol/runtime and generic
      Worker artifacts public; real targets, workflows, secrets, key
      operations, implementation plans, and deployment evidence private.
- [x] Record the landed Refactor 117 Console suite as private and classify
      `start-intended-services.mjs` as a mixed manager that must be split.
- [x] Record extraction source
      `aa4c1220c9a0877cd950fb40633488318f912b8e`, initial SDK package version
      `0.5.0`, MIT for TypeScript, and Apache-2.0 for Rust and the CLI.
- [x] Confirm whether any extracted dependency or redistributed artifact
      requires a third-party notice beyond the two public license files. The
      inventory confirms that bundled/static artifacts require one; no
      dependency blocks publication under the selected permissive licenses.

Exit: every moved path has a destination and the extraction source is no longer
changing.

### Phase 1: Rename And Extract

- [x] Rename `seams-tech/seams-sdk` to `seams-tech/seams-monorepo` in place and
      update its remote, package metadata, links, and badges.
- [x] Create `seams-tech/seams-wallet` as an empty private repository
      (September 8 preparation).
- [x] Reconcile the split manifest to the two-repository decision and extract
      the public tree from the fixed source commit.
- [x] Check the extracted tree for private configuration, secrets, and missing
      public dependencies.

Exit: the private repository is intact and the candidate public tree contains
only the intended Wallet source.

### Phase 2: Make `seams-wallet` Independent

- [x] Give the public repository its own workspace manifest, lockfile, package
      metadata, README, license, security policy, docs, and examples.
- [x] Configure the public VitePress build with `base: '/docs/'` and emit one
      immutable, versioned static artifact for private wallet-site assembly.
- [x] Set every carried Rust crate to `publish = false`.
- [x] Make `@seams/wallet-server` package the Worker, Wasm, migrations, types,
      and generic runtime artifacts consumed by private deployment, including
      the R120 tenant-root control plane, Router/Deriver artifacts, role-private
      migration sets, and their manifest heads/fingerprints.
- [x] Add credential-free CI and npm trusted-publishing workflows.
- [x] Include generated third-party notices in both npm packages and the native
      CLI release artifacts.
- [x] Move the isolated Wallet runner and Wallet intended Playwright
      configs to a Wallet-only service manager with no Console, site, or
      Console-D1 startup. The Wallet test app is already public-owned and no
      longer comes from `apps/seams-site`. Generic service-binding dispatch,
      Ed25519 Wallet-session signing, and signer-Wasm loading are now public
      Wallet runtime. The exact Wallet Console binding protocol and Gateway-side
      client are public-owned. The public Wallet Gateway assembly now owns API
      credential adapters, usage metering, environment lookup, normal-signing
      admission, and the exact relay route/proxy contract; the Console-side
      handlers and policy execution remain private. Wallet runtime operations,
      their Gateway-side handler, and the tenant-root control binding allowlist
      are also public-owned. Runtime-scope tenant-root lineage resolution now
      lives beside the public Gateway and reaches Console only through the exact
      environment/active-lineage client; only the Console-side runtime client
      remains private. The public role-worker supervisor now starts the Router,
      both Derivers, SigningWorker, and tenant-root control plane without
      Console, and the Gateway's authenticated scheduled Router prewarm now
      runs from the public Wallet runtime. The complete hosted
      Gateway composition is now a public `@seams/wallet-server` entrypoint;
      the private staging worker has become a thin Console route, billing,
      provider-delivery, and cron host around it.
      Tenant-root creation grant encoding and signing now live in the public
      Wallet runtime, so a self-host manager can bootstrap its own root without
      importing the private Console grant service. The public Router role package
      also provides `bootstrap:local-tenant-root`, which derives its grant
      authority from the isolated local role root and creates the root directly
      through the authenticated MPC Router control route.
      Generic Worker environment readers have also moved out of the private
      Console session module, removing another private import from the Gateway
      composition seam.
      A provider-neutral `hosted-wallet-gateway-worker` entrypoint is published
      with `@seams/wallet-server`; private deployments wrap the same composition
      when they need hosted email-provider configuration.
      The public local entrypoint replaces `WALLET_CONSOLE` with a validated
      static deployment registry in-process, preserving credential origin/scope,
      environment, lineage, and usage operations without a Console service or
      Console D1.
      `wallet-system:local` now composes that entrypoint with the five public
      role Workers, direct tenant-root bootstrap, and signer-only D1 migration.
      The public intended manager composes this backend with independent app
      and Wallet asset origins on ports `4201` and `4202`. One passkey
      registration contract exercises the complete Console-free path.
      The Wallet iframe and Lit component suites, their browser setup, and the
      one shared ECDSA fixture are now extracted with a public-only Playwright
      config and blank Vite host. Representative router teardown and export
      surface tests execute against the built public SDK without the private
      site or Console test manager.
      The first public unit family now covers SDK configuration, domain IDs,
      exact browser authority, delegated authority, committed signer packages,
      and authorization capability kinds under the same Console-free config.
      Public unit coverage also owns canonical serialization, authorization
      operation fingerprints, credential redaction, email hashes, CSP/header
      construction, and Keccak vectors.
      Capability selection, canonical lane inventory, exact owner-lane scope,
      and passkey credential observations form a third public state family.
      Portable CLI installation, trust, backup verification, and restore
      instructions now live in the public VitePress tree. The private tenant
      recovery runbook identifies its remaining provider and destination
      operating scope and no longer advertises historical CLI releases.
- [x] Install, build, run the Wallet-owned tests, start the generic runtime,
      and build `examples/seams-auth-menu` from a clean public checkout.

Exit: `seams-wallet` builds and runs without the private repository or private
credentials.

### Phase 3: Publish The Public Repository And Packages

- [x] Push one fresh initial commit with the extraction source SHA recorded.
- [x] Make the repository public after the final tree review.
- [ ] Add a one-time granular `SEAMS_NPM_BOOTSTRAP_TOKEN` to the public
      `npm-release` environment. Use it only to create the two new package
      records with provenance.
- [ ] Publish `@seams/wallet` and `@seams/wallet-server` to public npm using
      the release workflow and provenance.
- [ ] Configure both package records to trust
      `seams-tech/seams-wallet` / `release-wallet-packages.yml` /
      `npm-release`, remove the bootstrap-token preflight and environment
      bindings from the workflow, and delete `SEAMS_NPM_BOOTSTRAP_TOKEN`.
- [x] Publish the versioned `/docs/` static artifact from the same recorded
      public revision (`ac13393f75693811fc152750092b4a5943a83ef1`, run
      `34641246614`).
- [ ] Confirm a clean install resolves the intended package versions and all
      documented runtime artifacts.

Exit: the public source and both npm packages are independently consumable.

### Phase 4: Rewire The Private Monorepo

- [ ] Replace Wallet workspace ranges and source aliases with exact npm
      versions, then regenerate the private lockfile.
- [ ] Rewire frontend builds to import `@seams/wallet`.
- [x] Make private frontend releases resolve and consume the exact public docs
      artifact for an explicit full Wallet revision, with a recorded artifact
      and workflow-run identity, and assemble it at `/docs/` in the current
      wallet Pages output.
- [ ] Rewire backend, migration, local-runtime, and deployment scripts to use
      artifacts from `@seams/wallet-server`.
- [ ] Replace the Console-owned local signer-migration adapter with the public
      package command. Keep remote application and fingerprint checkpointing in
      the private Wallet-system deployment manager.
- [x] Split `deployment/targets.json`, environment generation, update/rotation
      commands, GitHub environments, and deploy entrypoints into the Console
      and Wallet-system owners described above.
- [x] Keep R120 control-plane, Router, Deriver A, Deriver B, and Signing Worker
      environments role-specific inside the Wallet-system pipeline. Retain
      generic key-generation primitives with the public implementation and keep
      Seams target generation/application private.
- [x] Remove the paired generation manifest, shared generation ID, generic
      `product` component, combined rotation command, and cross-authority
      `DEPLOYMENT_SECRETS_JSON` input.
- [ ] Remove Cargo, `wasm-pack`, and public-source build steps from private
      deployment workflows.
- [ ] Keep `pnpm test:console` and its five operating tests private, point them
      at the private composed manager, and run that manager against the exact
      installed Wallet packages.
- [ ] Run the private build and one composed Wallet flow before deleting moved
      source.

Exit: private development and deployment use only installed public artifacts.

### Phase 5: Delete Moved Source And Deploy

- [ ] Complete the released CLI cutover above: sign and publish the successful
      `0.4.1` public build, publish the npm launcher, update dashboard/install
      links, and demonstrate a fresh anonymous download. The retained
      repository is already private.
- [ ] Delete public Wallet source, public tests/docs/examples, and obsolete
      public build/extraction paths from `seams-monorepo`.
- [ ] Remove stale workspace entries, aliases, forwarding packages, and source
      fallbacks. Keep private Console, Admin, deployment, and composed tests.
- [ ] Deploy the staging Wallet system and staging wallet site/Console through
      their separate private workflows using the exact npm and docs-artifact
      pins. Deploy production only after both staging paths succeed.

Exit: the private repository owns product composition and deployment; the
public repository owns the Wallet implementation; neither depends on the
other's source tree.

## Failure Handling

Do not delete moved source until the public packages are published and the
private build works against their exact versions. Before deletion, a failed
phase leaves the private tree unchanged. After deletion, revert the private
rewiring/deletion commit and restore the previous exact package pins if needed.
Published npm versions remain immutable; publish a corrected version instead of
overwriting or unpublishing one.

## Definition Of Done

- `seams-tech/seams-monorepo` is the renamed private historical repository;
- `seams-tech/seams-wallet` is the only new repository and has fresh history;
- Console, future private products, all existing workflows, environment and
  secret configuration, provider configuration, and staging/production
  deployment remain private;
- the public repository owns both Wallet npm packages and all Rust/Wasm needed
  to build them, including the R120 tenant-root runtime and role-private
  migrations;
- Rust crates remain co-located and unpublished;
- the public repository includes Wallet docs, a minimal `SeamsAuthMenu`
  example, and a working generic self-host runtime;
- the public repository produces an immutable VitePress artifact for
  `/docs/`, and the private wallet-site release consumes an exact revision in
  its single marketing/dashboard/docs Pages artifact;
- the private monorepo exact-pins the public packages and deploys their prebuilt
  artifacts without public source access or Rust tooling;
- Console and Wallet-system secrets, variables, targets, rotations, GitHub
  environments, Cloudflare tokens, and deployment workflows are disjoint;
- neither private pipeline can generate, apply, rotate, or deploy the other
  authority's configuration;
- the Wallet-system pipeline preserves the R120 control-plane, Router, Deriver,
  Signing Worker, online-sealing, and managed-backup role boundaries;
- the public intended-behaviour runner starts no Console service, while the
  private `test:console` suite runs against exact installed Wallet packages;
- no compatibility package or duplicate repository remains.

## Related Plans

[Refactor 105](./refactor-105-split-console.md) owns the Console/Wallet source
boundary. [Refactor 105C](./refactor-105C.md) starts after this split and owns
the private unified Console deployment. [Refactor 99B](./refactor-99B-MPC-control-plane.md)
owns the private Admin control plane. [Refactor 120](./refactor-120-rotate-tenant-secrets.md)
is the mandatory pre-R105 Wallet-runtime baseline.
