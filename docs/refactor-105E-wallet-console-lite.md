# Refactor 105E: Public Wallet Console Lite

Date created: September 12, 2026

Status: planned follow-up. This plan begins after Refactor 105B has completed
the package, CI, and test-ownership handoff. It does not block the repository
split and it does not change the R105C hosted Wallet site or Console authority
cutover.

## Decision

Add `examples/wallet-console-lite` to the public `seams-tech/seams-wallet`
repository. It is the smallest complete local Wallet application: a developer
creates one local organisation, one project, and its `dev` environment, then
registers or unlocks a Wallet through `SeamsAuthMenu` and inspects the resulting
Wallet session and signer identities.

The example is a local SDK playground. It is not a public edition of the hosted
Seams Console and it is never deployed at `wallet.seams.sh`.

Selectively copy the useful presentation shell and onboarding interaction from
the private `apps/wallet-console`; author the runtime integration against public
package exports. Do not copy a directory wholesale. Every copied component must
be small, presentational, and free of private imports, API paths, data models,
product policy, and deployment assumptions.

The public repository continues to contain three deliberately different
consumer surfaces:

| Surface | Purpose |
| --- | --- |
| `examples/seams-auth-menu` | Smallest example of embedding only `SeamsAuthMenu` |
| `examples/wallet-console-lite` | Human-facing, locally runnable Wallet application |
| `tests/intended-app` | Comprehensive automated lifecycle harness |

Do not merge these surfaces. The small component example should remain easy to
read, and the intended app may remain test-oriented and exhaustive.

## Scope

### Included

- first-run local organisation name;
- first-run local project name;
- one `dev` environment created with that project;
- local Wallet-system startup and tenant-root bootstrap;
- generated local project environment ID and publishable key;
- Wallet Gateway and hosted-wallet iframe connectivity status;
- `SeamsWebProvider` configured from the local setup result;
- `SeamsAuthMenu` registration and unlock;
- lock and session refresh;
- current Wallet ID, active authentication method, NEAR account ID, and EVM
  address when those identities exist;
- one representative local signing check using an existing public SDK signing
  surface, without adding a test-only signing API or broadcasting funds;
- a single command that starts the local system, app origin, and Wallet origin.

### Excluded

- hosted Console sessions, Console-authentication passkeys, OAuth, or callback
  routes; Wallet passkey registration and unlock remain the central example;
- organisation membership, invitations, IAM, and RBAC;
- multiple organisations, projects, or environments in one local runtime;
- API-key administration beyond the generated local publishable key;
- production or staging targets, routes, hostnames, Cloudflare account values,
  and deployment workflows;
- billing, pricing, entitlements, sponsorship, approvals, webhooks, audit,
  observability, backups, recovery governance, and CLI approvals;
- operator controls, Router topology controls, role secrets, and tenant-root
  rotation administration;
- Console D1 schemas and private Console packages;
- compatibility layers for the private application.

If a feature requires `@seams-internal/console-*`,
`@seams-internal/wallet-console-*`, `/console/*`, a private migration, or a
private service binding, it is outside this example.

## Local Authority Boundary

Organisation and project setup in this example is local development setup. It
does not implement hosted customer governance.

The example-local controller owns exactly one local workspace:

```text
organisation name
  -> local organisation id
  -> project name and local project id
  -> dev environment id
  -> tenant-root bootstrap
  -> local publishable Wallet configuration
```

The controller binds to `127.0.0.1`, accepts requests only from the exact lite
app origin, and is not included in a production build. It calls the public local
Wallet runtime and tenant-root bootstrap commands. It must not import private
Console code or reproduce Console route handlers.

The browser receives only:

- organisation, project, and environment display identity;
- `projectEnvironmentId`;
- local publishable key;
- Gateway URL;
- Wallet origin;
- public signing Worker ID.

Role credentials, tenant-root issuer material, ceremony keys, the local secret
API key, D1 paths, and Worker bindings remain in the local controller/runtime
process and are never returned to browser code.

The local setup boundary parses raw form and process input once. Internal state
uses a discriminated union such as `empty | provisioning | ready | failed`;
ready state requires the complete public Wallet configuration. Do not represent
partially provisioned identity with optional core fields.

Default state is ephemeral beneath the existing public local-runtime temporary
root. An explicit `--root` may preserve it. Checked-in `.env` files and fixed
developer credentials are unnecessary.

## Local Topology

Keep the existing public local ports unless implementation finds an active
conflict:

```text
http://localhost:4201       wallet-console-lite application
http://localhost:4202       hosted Wallet iframe and SDK assets
http://127.0.0.1:4100       public local Wallet Gateway
http://127.0.0.1:4102-4106  isolated Wallet role Workers
```

Add a root command:

```sh
pnpm wallet-console-lite
```

It starts the example-local controller, the public local Wallet system, the
application origin, and the Wallet asset origin under one supervisor. SIGINT or
child failure stops the whole process. Startup prints each URL once and does not
continuously poll or repeat unchanged status.

Reuse the existing `start-local-wallet-system.mjs` and Wallet asset-host logic.
Extract a shared public launcher helper only if it removes real duplication with
`start-wallet-intended-services.mjs`; do not introduce a general process
framework.

## Frontend Shape

The app has two screens.

### 1. Local project setup

Collect required organisation and project names. The environment is visibly
fixed to `dev`. Submission provisions the one local workspace and returns the
complete browser-safe Wallet configuration. Show one precise progress state and
one recoverable error state.

Do not expose credential controls, environment-variable editors, raw JSON,
deployment targets, or an imitation Console sidebar.

### 2. Wallet playground

Render:

- the organisation / project / `dev` context;
- Gateway and Wallet iframe readiness;
- `SeamsAuthMenu` while signed out;
- active Wallet identity and signer summary while signed in;
- `Refresh session`, `Lock wallet`, and one safe signing-check action.

The UI should be small enough that a developer can understand the complete
integration in one reading. Prefer direct components and local state over a
router, global store, dashboard registry, or copied private Console framework.

## Repository Layout

Expected public additions:

```text
examples/wallet-console-lite/
  README.md
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  src/
    main.tsx
    WalletConsoleLite.tsx
    localWorkspace.ts
    styles.css
  scripts/
    start-local.mjs

scripts/
  start-wallet-console-lite.mjs   # only if orchestration cannot stay in example/
```

Use public imports only:

```text
@seams/wallet
@seams/wallet/react
@seams/wallet/react/seams-auth-menu
@seams/wallet/react/styles
@seams/wallet-server local-runtime commands
```

No source aliases may cross from the example into `packages/*/src`. Local
workspace installation can use `workspace:*`; the example must also build in
public CI against the package export map.

## Implementation Plan

### Phase 1: Extract the minimal presentation

- [ ] Inventory only the private onboarding layout, form controls, status
      presentation, and Wallet identity summary worth retaining.
- [ ] Copy or rewrite those few presentational pieces into
      `examples/wallet-console-lite`.
- [ ] Remove private branding/config imports, Console HTTP clients, session
      providers, routing, dashboard composition, and product modules.
- [ ] Keep attribution/license notices required by any copied third-party code.

Exit: the example renders with no private package, `/console/*`, deployment, or
Console-schema reference.

### Phase 2: Add one local workspace setup boundary

- [ ] Add the loopback-only example controller with exact-origin validation.
- [ ] Normalize required organisation and project names into local identifiers.
- [ ] Provision one `dev` environment through the public tenant-root bootstrap
      and local Wallet runtime.
- [ ] Return only the complete browser-safe configuration listed above.
- [ ] Keep runtime secrets and state outside the browser and outside git.

Exit: a fresh invocation can create one usable local project without private
Console services or hand-written environment files.

### Phase 3: Connect the Wallet playground

- [ ] Configure `SeamsWebProvider` from the ready setup result.
- [ ] Render `SeamsAuthMenu` for registration/unlock.
- [ ] Render precise signed-out, connecting, ready, and signed-in states.
- [ ] Add lock, refresh, identity display, and the representative signing check.
- [ ] Use only public SDK methods and types.

Exit: a developer can create a local project, register a Wallet, reload/unlock
it, inspect its identities, and perform the signing check.

### Phase 4: One-command operation and documentation

- [ ] Add `pnpm wallet-console-lite` at the public repository root.
- [ ] Start and stop all local children as one process group.
- [ ] Document prerequisites, ports, persisted `--root` use, and recovery from
      an interrupted local run in the example README.
- [ ] Add the example to the public root README and R105 ownership inventory.
- [ ] Make the public example build command build both `seams-auth-menu` and
      `wallet-console-lite`.

Exit: the documented command starts a fresh local application with no manual
secret or env-file preparation.

## Verification

Keep verification proportionate:

1. Type-check and production-build `examples/wallet-console-lite` against the
   public package exports.
2. Run one local operating path: create organisation/project/dev, connect the
   iframe, register or unlock, and complete the signing check.
3. Assert the browser setup response contains no secret key, issuer material,
   D1 path, private binding, or private Console field.
4. Run the existing representative public Wallet lifecycle contract once to
   confirm the shared local runtime still behaves identically.

Do not duplicate the full intended-behaviour suite for this example.

## Definition Of Done

- `seams-wallet/examples/wallet-console-lite` is independently understandable
  and runnable with one command.
- A developer can locally create one organisation/project/dev context and use a
  real Wallet lifecycle through the public local runtime.
- The frontend and its build contain no private Console dependency or hosted
  deployment configuration.
- Browser-visible configuration contains no local runtime secret.
- `seams-auth-menu` remains the smallest component example and
  `tests/intended-app` remains the exhaustive test harness.
- The private `apps/wallet-console` remains the sole hosted Wallet Console and
  continues to own customer governance, data, and deployment authority.
