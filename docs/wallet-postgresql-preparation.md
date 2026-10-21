# Wallet PostgreSQL preparation

The Wallet role store now has a native PostgreSQL backend with E2E evidence from a real local database.
[Wallet storage portability](../../seams-wallet/docs/storage-portability.md)
describes the public implementation and the remaining storage work.
This verifies the Rust role-store backend. The private Console and Gateway stores still require separate PostgreSQL implementations.
The target is one PostgreSQL implementation that can use RDS or another PostgreSQL provider.
Provider credentials, TLS, connection setup, and pooling belong at the host boundary.

This change covers the Rust tenant-root role store in `seams-wallet`.
The private Console and Gateway composition still use D1.
They need a separate port with their own transaction evidence.

| Private surface | Required migration work |
| --- | --- |
| `packages/console-server-ts` and `migrations/d1-console-core` | Port account, organization, session, and funds persistence with its constraints. |
| `packages/wallet-console-server-ts` and `migrations/d1-console` | Port wallet placement, tenant deployment, policy, billing, recovery, and relocation persistence. |
| `walletPlacement/d1.ts` | Preserve the atomic registration completion, locator insertion, and wallet index update. Replace the dependency on the previous statement's `changes()`. |
| Relocation migrations `0070`, `0072`, `0075`, and `0076` | Port ownership-switch guards, JSON validation, expiry checks, and resource-binding constraints. |
| `tenantRootSecurity/restoreWorkerRoute.ts` | Replace the `sqlite_master` schema inspection with an explicit PostgreSQL schema check. |
| `router/cloudflare/d1ConsoleServices.ts` and worker composition | Replace D1 bindings at concrete storage boundaries. Keep exact public Wallet package versions when the implementation ships. |

The schemas also use `PRAGMA`, SQLite trigger syntax, `INSERT OR IGNORE`, and SQLite JSON functions.
PostgreSQL replacements must preserve null handling, numeric ranges, unique keys, and row-count requirements.
Review each transaction with its schema and the operation it protects.
Changing only a database connection cannot preserve these rules.

Wallet home records and resource proofs contain Cloudflare account, database, Worker, and Durable Object identifiers.
A future RDS implementation needs precise provider state at those request and persistence boundaries.
Keep that work separate from the role-store execution interface.

The public implementation keeps D1's precommit rollback guards inside its D1 driver.
Its PostgreSQL driver checks affected-row requirements inside Serializable transactions before commit.
Its transaction contract requires coherent reads, ordered writes, atomic rollback, and durable completion.
The public migration note explains the PostgreSQL isolation and retry requirements.
Keep Deriver A and B credentials, role stores, and secret access separate throughout that work.

No private runtime behavior or dependency version changes in this preparation.
No production data change.
On 2026-10-21 the unchanged role-store E2E also passed against a private Amazon RDS for PostgreSQL 18.6 instance.
Its results equal the local run. The task-owned RDS instance and runner were deleted afterwards.
See [the RDS evidence](../../seams-wallet/docs/evidence/postgres-role-store-rds-20261021.json).
The Console and Gateway ports above remain the blockers for a move off D1.
The Wallet repository stores verification evidence beside the migration note.

## Keeping Workers on Cloudflare with Hyperdrive

The private Workers can stay on Cloudflare and use PostgreSQL through Hyperdrive.
The [public portability note](../../seams-wallet/docs/storage-portability.md) describes the role-store path and its open items.
For the TypeScript Console stores, Hyperdrive documents `node-postgres` and `postgres.js` with the `nodejs_compat` flag.
Each ported store needs a Hyperdrive configuration created with `--caching-disabled`.
Hyperdrive caches read queries by default and does not invalidate them after writes. A cached read would break these transaction rules.
Hyperdrive pools in transaction mode. Session-level `SET`, SQL-level `PREPARE`, advisory locks, and `LISTEN` are not available.
Run each store's transaction evidence through the Hyperdrive connection, not only against a direct database.
