# Wallet PostgreSQL preparation

The Wallet role store now exposes explicit transaction requirements through its existing SQL session interface.
[Wallet storage portability](../../seams-wallet/docs/storage-portability.md)
describes the public implementation and its remaining SQL work.
PostgreSQL support remains unimplemented and untested.

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

The public preparation keeps D1's precommit rollback guards inside its D1 driver.
Its transaction contract requires coherent reads, ordered writes, atomic rollback, and durable completion.
The public migration note explains the PostgreSQL isolation and retry requirements.
Keep Deriver A and B credentials, role stores, and secret access separate throughout that work.

No private runtime behavior or dependency version changes in this preparation.
No AWS resources or production data change.
The Wallet repository stores verification evidence beside the migration note.
