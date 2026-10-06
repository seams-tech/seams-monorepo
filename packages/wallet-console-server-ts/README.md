# Wallet Console Server TypeScript Package

This private composition package combines Console core with Wallet runtime
services. It owns hosted Wallet-system Workers, composed migrations, and local
and staging operations.

Deployable server applications live under `apps/`.

## Local D1/DO Development

The D1 migration work uses Wrangler and Miniflare as the local source of truth.
From this package:

```sh
pnpm run d1:local:prepare
pnpm run d1:local:paths
pnpm run d1:local:restore:drill
pnpm run d1:local:dev
```

`d1:local:dev` applies the local console and signer migrations before starting
the Worker. `d1:local:prepare` performs that preparation independently, creates
friendly live links at `sqlite/seams_console.sqlite` and
`sqlite/seams_signer.sqlite`, then checks that the expected tables exist.
Run `d1:local:paths` independently to refresh those links after changing the
local Wrangler persistence root. The command honors
`SEAMS_D1_LOCAL_PERSIST_TO` and `SEAMS_D1_LOCAL_SQLITE_DIR` when custom paths
are needed.
To wipe the local console and signer D1 databases plus Durable Object state,
stop the local Worker and run:

```sh
pnpm run d1:local:reset -- --yes
pnpm run d1:local:prepare
```

The reset removes the entire configured local Wrangler persistence root and
preserves the friendly SQLite symlinks. Run `d1:local:prepare` afterward to
repoint them. It does not seed application data.
`d1:local:restore:drill` backs up the local
console and signer SQLite databases, restores them into fresh SQLite files,
checks `PRAGMA integrity_check`, verifies expected table counts, and writes a
manifest under `.wrangler/d1-local-restore-drills`. `d1:local:dev` starts the
minimal local Worker from `wrangler.d1-local.toml` with persistent state under
`.wrangler/state/seams-d1`. It loads local configuration from the repository
root `.env.local`. Use `dev.vars` in this package for Wallet-system entries and
`../console-server-ts/dev.vars` for Console-specific entries.
To enable GitHub dashboard sign-in, register a GitHub OAuth App with
`https://localhost/dashboard/login` as its callback URL, then set
`GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, and
`GITHUB_OAUTH_CALLBACK_URL` in the root `.env.local`.
Set `STRIPE_API_SK` in the root `.env.local` to make Billing
create real Stripe Checkout Sessions. Without that server-side key, the local
billing provider remains an in-process test double and must not be used to
exercise the hosted Stripe Checkout page. Set `STRIPE_WEBHOOK_SECRET` to the
signing secret for the Stripe endpoint forwarded to the local Worker.
Use `GET /readyz` on the local Worker to verify the D1 table set and the
Durable Object normal-signing admission path:

```sh
curl http://127.0.0.1:4100/readyz
```

Open `sqlite/seams_console.sqlite` or `sqlite/seams_signer.sqlite` in TablePlus
with the SQLite driver when manual inspection is useful. The files are stable
symlinks to Wrangler's live hashed D1 files, so the D1 runtime and manual
inspection use the same database. Treat local inspection as read-only. Remote D1
inspection should use Wrangler, Cloudflare dashboard tools, exports, or a
purpose-built admin route.

Local EVM signing is client-funded. Sponsored EVM execution is optional and
uses Console D1 pricing rows, never request-time backfill or Worker env pricing.
For local sponsorship-route tests only, seed static Tempo pricing explicitly
with `seedD1ConsoleStaticEvmSponsorshipPricingRule`.

## Staging D1/DO Preflight

Before applying remote D1 migrations, copy
`wrangler.d1-staging-console.toml.example` to
`wrangler.d1-staging-console.toml` and `wrangler.d1-staging-gateway.toml.example`
to `wrangler.d1-staging-gateway.toml`. These concrete staging config files are
gitignored; keep the `.example` templates as the tracked source of structure. The
examples already point at the staging entrypoints:

- `src/router/cloudflare/d1ConsoleStagingWorker.ts`
- `src/router/cloudflare/d1GatewayWorker.ts`

Fill in the remote D1 database IDs, relayer public key, and Wrangler secret
declarations, then run:

```sh
pnpm run d1:staging:check
```

The check is static and credential-free. It rejects local-only Worker config,
wrong staging entrypoints, Postgres env tokens, placeholder D1 IDs, missing
profile bindings, signer/DO bindings on the console Worker, plaintext session
secrets, plaintext sponsored-EVM executor config. Gateway configuration must
declare the registration, recovery, and export admission-cutoff/drain pairs;
each pair may remain empty before cutover, and populated pairs must contain
ordered non-negative millisecond timestamps.

After the check passes, generate the credential-free staging deployment log:

```sh
pnpm run d1:staging:runbook -- \
  --output ../../docs/deployment/refactor-82-staging-log.md \
  --r2-bucket <staging-r2-backup-bucket> \
  --console-origin <console-staging-origin> \
  --gateway-origin <gateway-staging-origin>
```

The generated log contains the exact Wrangler 4.111.0 command sequence for
remote migrations, Time Travel bookmark capture, fixture import, Worker deploy,
staging smoke, and R2 export/restore drills. Record command output summaries,
bookmarks, object keys, and pass/fail evidence there; never paste secret values.

Capture resource inventory before remote changes:

```sh
pnpm run d1:staging:resources -- --mode dry-run
pnpm run d1:staging:resources -- --mode remote
```

The inventory script records config-derived Worker names, D1 database IDs,
Durable Object bindings, required secret names, and remote D1/Worker JSON
metadata under `.wrangler/d1-staging-resource-inventory`.

Apply remote D1 migrations through the manifest-producing staging script:

```sh
pnpm run d1:staging:migrate -- --mode dry-run
pnpm run d1:staging:migrate -- --mode remote
```

The migration script checks the console and Gateway staging Wrangler profiles,
hashes the local console/signer migration files, lists unapplied remote
migrations, applies them with `CI=true` for noninteractive Wrangler execution,
lists again after apply, and writes command evidence under
`.wrangler/d1-staging-migrations`.

Capture D1 Time Travel bookmarks before fixture import and before route changes:

```sh
pnpm run d1:staging:bookmark -- \
  --mode dry-run \
  --purpose before_fixture_import
pnpm run d1:staging:bookmark -- \
  --mode remote \
  --purpose before_fixture_import
pnpm run d1:staging:bookmark -- \
  --mode dry-run \
  --purpose before_route_switch
pnpm run d1:staging:bookmark -- \
  --mode remote \
  --purpose before_route_switch
```

The bookmark script checks the staging Wrangler profiles, captures console and
signer D1 bookmark JSON with `wrangler d1 time-travel info`, and writes a
manifest under `.wrangler/d1-staging-bookmarks`.

Fixture import is a named script so staging does not run ad hoc SQL:

```sh
pnpm run d1:staging:import-fixtures -- \
  --mode dry-run \
  --console-fixture ./staging/fixtures/console.sql \
  --signer-fixture ./staging/fixtures/signer.sql
pnpm run d1:staging:import-fixtures -- \
  --mode remote \
  --console-fixture ./staging/fixtures/console.sql \
  --signer-fixture ./staging/fixtures/signer.sql
```

The script requires readiness-clean staging configs, accepts data-only SQL
fixtures, rejects schema DDL and cross-domain table writes, writes a hash
manifest, and runs the remote import only with `--mode remote`.

Run staging smoke after deploy:

```sh
pnpm run d1:staging:smoke -- \
  --mode dry-run \
  --console-origin <console-staging-origin> \
  --gateway-origin <gateway-staging-origin>
pnpm run d1:staging:smoke -- \
  --mode remote \
  --console-origin <console-staging-origin> \
  --gateway-origin <gateway-staging-origin>
```

The smoke script checks the actual staging readiness endpoints:
`/console/readyz` on the console Worker, `/readyz` and `/healthz` on Gateway,
Worker, and the configured signer custody health routes
`/router-ab/ed25519/healthz` and `/router-ab/ecdsa-derivation/healthz`. It writes a
JSON evidence manifest under `.wrangler/d1-staging-smoke`.

Run read-only D1 reconciliation after staging smoke passes:

```sh
pnpm run d1:staging:reconcile -- --mode dry-run
pnpm run d1:staging:reconcile -- --mode remote
```

The reconciliation script checks dashboard billing balances, prepaid reservation
summary totals, sponsored-EVM billing links, sponsored settlement amounts, and
signer custody health. It writes evidence under `.wrangler/d1-staging-reconciliation`
and fails when any mismatch query returns rows.

Run the fixture-backed signer custody route drill after fixture import and
reconciliation:

```sh
export SEAMS_STAGING_ECDSA_WALLET_SESSION_JWT="<fixture-wallet-session-jwt>"
pnpm run d1:staging:signer-custody -- \
  --mode dry-run \
  --gateway-origin <gateway-staging-origin> \
  --origin <console-staging-origin> \
  --export-share-fixture ./staging/fixtures/ecdsa-export-share.json \
  --wallet-session-jwt-env SEAMS_STAGING_ECDSA_WALLET_SESSION_JWT
pnpm run d1:staging:signer-custody -- \
  --mode remote \
  --gateway-origin <gateway-staging-origin> \
  --origin <console-staging-origin> \
  --export-share-fixture ./staging/fixtures/ecdsa-export-share.json \
  --wallet-session-jwt-env SEAMS_STAGING_ECDSA_WALLET_SESSION_JWT
```

The signer custody script calls the configured threshold route health endpoints
and the production `/router-ab/ecdsa-derivation/export/share` route with the
success fixture. It writes redacted evidence under
`.wrangler/d1-staging-signer-custody` and never stores the wallet-session JWT or
server export share in the manifest.

Run the remote R2 export/restore drill after staging smoke passes:

```sh
pnpm run d1:staging:r2-restore-drill -- \
  --mode dry-run \
  --r2-bucket <staging-r2-backup-bucket>
pnpm run d1:staging:r2-restore-drill -- \
  --mode remote \
  --r2-bucket <staging-r2-backup-bucket>
```

The drill exports the console and signer D1 databases, uploads both SQL exports
to R2, downloads them into a restore workspace, creates timestamped restore-drill
D1 databases, imports the downloaded SQL, runs `PRAGMA integrity_check`, and
writes an evidence manifest under `.wrangler/d1-staging-r2-restore-drills`.

After every remote Phase 6 command has produced a manifest, verify the evidence
set before production planning:

```sh
pnpm run d1:staging:evidence -- \
  --resources <resource-inventory-remote-manifest.json> \
  --migrations <migrations-remote-manifest.json> \
  --bookmark-before-fixture-import <before-fixture-import-bookmark-manifest.json> \
  --fixture-import <fixture-import-remote-manifest.json> \
  --bookmark-before-route-switch <before-route-switch-bookmark-manifest.json> \
  --smoke <smoke-remote-manifest.json> \
  --reconciliation <reconciliation-remote-manifest.json> \
  --signer-custody <signer-custody-remote-manifest.json> \
  --r2-restore-drill <r2-restore-drill-remote-manifest.json> \
  --output .wrangler/d1-staging-evidence/verification.json
```

The evidence verifier rejects missing manifests, dry-run manifests, failed
commands, reconciliation mismatch rows, missing signer custody export-share
evidence, wrong custody endpoint paths/statuses, mixed staging environments, and
incomplete restore artifacts.

## R155B shared Email OTP counters

Regional Gateways require `EMAIL_OTP_RATE_LIMIT_DB`. All regions in one environment
must bind the same dedicated D1 database. Apply `migrations/d1-email-otp-rate-limit`
to that database. Keep Console and signer records in their existing databases.
The staging example and readiness check include the required binding.
The canonical deployment target stores this allocation in
`gatewayDeploymentConfig.resources.emailOtpRateLimitD1`. Its `kind` is `pending`
until provisioning supplies an `allocated` database ID. Gateway manifest rendering
rejects pending allocations. The renderer gives all regional Gateways the same
counter binding and keeps it out of Console and Wallet Runtime manifests.
The existing wallet-system migration command applies the counter schema once,
using the ingress Gateway manifest. It then remains the shared counter authority
for every regional Gateway.

The staging inventory command records remote metadata for the counter database.
The staging migration command lists, applies, and rechecks its schema alongside
Console and signer schemas. Evidence verification requires those counter checks,
rejects a `CONSOLE_DB` binding on the Gateway, and rejects counter database IDs
that match either the Console or signer database.

The Gateway scopes counter keys with its admitted deployment tenant. The existing
atomic D1 counter enforces the global limits. Counter storage failures reject the
OTP action. There is no fallback to a regional counter or to Console.
The Console `/internal/wallet-placement/v1/rate-limit` endpoint is removed.

This change is prepared locally. No shared counter database has been provisioned.
Before deployment, approve the dedicated database within the $25 Cloudflare budget.
Bind every regional Gateway before accepting OTP traffic on this candidate.
For a live cutover, preserve unexpired counters or pause OTP traffic until the
maximum configured rate-limit window expires. Do not split traffic between old
and new counter stores. Remove the obsolete Console counter table after all old
Gateway versions stop serving traffic. Historical Console migrations remain
unchanged until that deployment cutover is complete.

Local verification uses `tests/e2e/regional-session-routing.e2e.mjs` and the
Email OTP budget/step-up scenario in
`tests/e2e/regional-real/google-email-otp.recovery.contract.test.ts`.

On 2026-10-07, regional acceptance passed with 32 concurrent counter requests:
12 accepted and 20 limited. Console outage, independent project scopes, and real
counter-storage failure checks passed. Package type-check also passed.
The browser step-up scenario also passed after replacing its Console-dependent
development outbox reader with a local email-provider mailbox. During the outage,
it completed two NEAR signatures, three ECDSA signatures, and two OTP step-ups.
Console requests stayed at zero. All authorization records remained in the US home.
External email delivery is simulated; regional OTP verification and MPC signing
execute production code. This is local acceptance, with no hosted latency claim.
See [sanitized evidence](docs/evidence/r155b-direct-otp-counters-20261007.json).

The 2026-10-07 candidate now freezes the rebuilt wallet server, migrations, SDK,
and custody artifacts. Gateway, Runtime, and Console passed Wrangler dry-run
builds against that frozen server. Bundle input records contain no published
wallet-server imports. The inventory contains 5,821 hashed files.
See [candidate identity and limitations](docs/evidence/r155b-verified-candidate-20261007.json).
Database allocation, coordinated staging deployment, and hosted comparison remain
open. These build results do not establish a latency gain.

#### Staging OTP counter cutover and rollback

Use a coordinated maintenance interval for the counter cutover. Stop OTP traffic
through every regional Gateway before changing the counter authority. A quiet
request log alone does not prove that traffic is blocked. If a verified traffic
block is unavailable, do not switch stores.

1. Record all current Worker versions, bindings, routes, and non-versioned settings.
2. After database approval, allocate the dedicated database and apply its migration.
3. Block OTP traffic on every ingress and drain in-flight OTP requests.
4. Read the latest `reset_at_ms` from the old counter table after draining. Keep
   traffic blocked until that time passes. Repeat the read to confirm that no
   unexpired rows remain. Do not substitute a default policy window: deployments
   can configure longer windows.
5. Bind all four candidate Gateways to the same dedicated counter database.
   Keep the old Console endpoint available until all old Gateways stop serving.
6. Deploy the candidate Console after the Gateway switch. Verify the bindings
   and versions, then reopen OTP traffic and run the cross-region limiter check.

For rollback, first block OTP traffic and drain requests again. Wait until all
unexpired counters in **both** databases expire. Restore Console before restoring
the old Gateways, because those Gateways require its counter endpoint. Restore
recorded bindings and non-versioned settings as well as Worker versions. Reopen
traffic only after every Gateway uses the original shared counter store.

The old and dedicated counter schemas are identical as of 2026-10-07. This runbook
uses expiry under blocked traffic, so it needs no counter-copy compatibility path.
Retain the old Console table during the bounded comparison and rollback interval.
Remove it only after the accepted cutover, when old Gateway traffic and rollback
are no longer required. This procedure has been reviewed against the migration
and deployment scripts. It has not been executed on staging.
