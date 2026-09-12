# Deployment Tooling

This guide covers the private repository commands for preparing GitHub
environments and dispatching Console, Wallet-system, site, and documentation
deployments.

## Prerequisites

Run from the repository root:

```bash
pnpm install --frozen-lockfile
gh auth login
```

Worker deployment also requires Wrangler authentication, Rust with the
`wasm32-unknown-unknown` target, and the pinned WASM tooling used by the
workflows. GitHub apply commands require permission to administer Actions
environments, variables, and secrets in `seams-tech/seams-monorepo`.

## Deployment Authorities

Console and Wallet-system configuration have separate target files, manifests,
commands, GitHub environments, and deployment workflows.

| Authority     | Checked-in targets                      | Protected local values                         | GitHub environments                                                                                  |
| ------------- | --------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Console       | `deployment/console/targets.json`       | `~/.seams/console/<lane>-deployment.env`       | `staging-console`, transitional `production-testnet-console`, and `production-console`               |
| Wallet system | `deployment/wallet-system/targets.json` | existing lane-specific files under `~/.seams/` | lane/role environments such as `staging-gateway`, `staging-mpc-router`, and `staging-signing-worker` |

Site and private-docs values retain their existing private environments. They
are outside the Wallet-system secret inventory.

The Console pipeline owns Console Worker and D1 configuration, session and
invitation secrets, OAuth, email, webhook and billing values, and its
grant-signing authority. The Wallet-system pipeline owns Gateway, Runtime,
Router A/B, signer, tenant-root control plane, protocol keys, ceremony and
signing-session material, relayer credentials, and Wallet network values.

Each apply operation writes only its selected authority's environments. There
is no combined rotation or shared generation check. The read-only handoff from
Console to Wallet consists of the generated grant-authority verifying-key set;
all other cross-authority deployment handoffs are public origins, service
names, and artifact versions.

## Console Environment Setup

Create an owner-only values file for the selected lane. It contains existing
operator-provided values such as Cloudflare, Stripe, Resend, and OAuth:

```bash
mkdir -p "$HOME/.seams/console"
chmod 700 "$HOME/.seams/console"
chmod 600 "$HOME/.seams/console/staging-testnet-deployment.env"
```

Prepare one Console manifest:

```bash
pnpm console:deploy:env-prepare -- --lane staging-testnet
```

The command generates fresh Console session, invitation, webhook, and
grant-authority values. It writes an owner-only manifest under
`~/.seams/backups/console/` and prints the non-secret Wallet-system verifying
key handoff. Preparing Console configuration does not generate Wallet protocol
or custody material.

Apply the exact saved manifest:

```bash
pnpm console:deploy:env-apply -- \
  --lane staging-testnet \
  --manifest-file "$HOME/.seams/backups/console/<manifest>.json" \
  --repo seams-tech/seams-monorepo
```

Preview or apply changes to externally owned Console values without rotating
generated identities:

```bash
pnpm console:deploy:env-update -- --lane staging-testnet
pnpm console:deploy:env-update -- --lane staging-testnet --apply
```

## Wallet-system Environment Setup

Prepare an independent Wallet-system manifest:

```bash
pnpm wallet-system:deploy:env-prepare -- \
  --lane staging-testnet \
  --repo seams-tech/seams-monorepo
```

This generates Router A/B identities, ceremony and signing-session material,
and the role-specific values required by the Wallet services. Tenant root
shares are created and rotated by the role-separated tenant-root protocol; they
are never deployment secrets. Preparation writes one owner-only manifest under
`~/.seams/backups/`.

Apply that exact manifest:

```bash
pnpm wallet-system:deploy:env-apply -- \
  --lane staging-testnet \
  --manifest-file "$HOME/.seams/backups/<wallet-system-manifest>.json" \
  --repo seams-tech/seams-monorepo
```

Use `--rotate` on prepare and apply only for an intentional Wallet identity
rotation. Staging and each production lane have independent generations.

Preview or apply externally owned Wallet-system values without rotating
identities:

```bash
pnpm wallet-system:deploy:env-update -- --lane staging-testnet
pnpm wallet-system:deploy:env-update -- --lane staging-testnet --apply
```

The updater accepts `--variables-only`, `--secrets-only`, and
`--only NAME,NAME`. It cannot address Console environments or Console-owned
values.

Site-owned Pages and browser values use their separate updater:

```bash
pnpm site:deploy:env-update -- --site staging
pnpm site:deploy:env-update -- --site staging --apply
```

## Deployment Dispatch

The repository commands select only the workflow belonging to their authority:

```bash
pnpm console:deploy -- --lane staging-testnet
pnpm wallet-system:deploy -- --lane staging-testnet
```

Staging defaults to `dev`; production lanes default to `main`. Pass `--ref`
only when intentionally selecting another revision. The workflow branch gates
still enforce the canonical branch.

The frontend workflows remain explicit:

```bash
gh workflow run deploy-staging-frontend.yml --repo seams-tech/seams-monorepo --ref dev
gh workflow run deploy-production-frontend.yml --repo seams-tech/seams-monorepo --ref main
```

Before dispatch, push the complete branch and verify local/remote SHA parity.
Production uses one staging-tested `main` revision. Do not deploy partial
cherry-picks or mixed revisions.

## Individual Wallet Generators

The complete Wallet-system environment generator is the normal path. These
lower-level commands are reserved for controlled inspection or rotation:

| Command                                               | Purpose                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm router:deploy:keygen -- --lane staging-testnet` | Generate Router A/B public/private deployment identities.         |
| `pnpm router:deploy:root-share-keygen`                | Generate matched Deriver A and B MPC PRF root-share wire secrets. |

Do not combine independently generated low-level output with an applied
Wallet-system manifest unless the complete related identity set is being
rotated deliberately.

## Router A/B Build Diagnostics

Validate Worker bundles without deploying traffic:

```bash
pnpm router:deploy:dry-run -- --env staging
pnpm router:deploy:dry-run -- --env staging --role router
```

Capture startup measurements and upload a non-serving Worker version:

```bash
pnpm router:deploy:upload -- --env staging
pnpm router:deploy:upload -- --env staging --role router
```

Supported roles are `router`, `deriver-a`, `deriver-b`, and
`signing-worker`. Reports are written under
`crates/router-ab-cloudflare/reports/startup-latencies/`.

## D1 Operations

Use authority-specific migration commands:

```bash
pnpm deploy:backend migrate --lane staging-testnet --component console
pnpm deploy:backend migrate --lane staging-testnet --component wallet-system
```

Remote operations require deliberate Cloudflare credentials. Record secret
names, resource IDs, versions, bookmarks, and pass/fail summaries in deployment
evidence. Never record secret values.

## Troubleshooting

If apply fails before writing values, verify `gh auth status`, repository
administration permission, the selected lane/site, and the owner-only mode of
the values or manifest file. If it fails midway, fix the cause and reapply the
same saved manifest. Preparing again creates a new authority generation.

Use `pnpm --silent` when piping a command's JSON output. Keep generated
manifests under the approved secret backup policy and never commit them.
