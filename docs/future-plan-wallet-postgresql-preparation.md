# Wallet PostgreSQL preparation

The Wallet role store now has a native PostgreSQL backend with E2E evidence from a real local database.
Its adapter also builds for Workers and passes a local transaction E2E through workerd and Workers sockets.
[Wallet storage portability](../../seams-wallet/docs/storage-portability.md)
describes the public implementation and the remaining storage work.
This verifies the Rust role-store backend. The private Console and Gateway stores still require separate PostgreSQL implementations.
The target is one PostgreSQL implementation that can use RDS or another PostgreSQL provider.
Provider credentials, TLS, connection setup, and pooling belong at the host boundary.

This change covers the Rust tenant-root role store in `seams-wallet`.
The private Console and Gateway composition still use D1.
They need a separate port with their own transaction evidence.

| Private surface                                                 | Required migration work                                                                                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/console-server-ts` and `migrations/d1-console-core`   | Port account, organization, session, and funds persistence with its constraints.                                                                         |
| `packages/wallet-console-server-ts` and `migrations/d1-console` | Port wallet placement, tenant deployment, policy, billing, recovery, and relocation persistence.                                                         |
| `walletPlacement/d1.ts`                                         | Preserve the atomic registration completion, locator insertion, and wallet index update. Replace the dependency on the previous statement's `changes()`. |
| Relocation migrations `0070`, `0072`, `0075`, and `0076`        | Port ownership-switch guards, JSON validation, expiry checks, and resource-binding constraints.                                                          |
| `tenantRootSecurity/restoreWorkerRoute.ts`                      | Replace the `sqlite_master` schema inspection with an explicit PostgreSQL schema check.                                                                  |
| `router/cloudflare/d1ConsoleServices.ts` and worker composition | Replace D1 bindings at concrete storage boundaries. Keep exact public Wallet package versions when the implementation ships.                             |

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

## Potential latency upgrade: PostgreSQL through Hyperdrive

Status, October 24, 2026: the library adapter and local Worker connection pass their checks.
Deployed Derivers still use D1. No hosted latency improvement is established.

The Workers and Durable Objects can stay on Cloudflare while PostgreSQL replaces their D1 stores.
Amazon RDS and Google Cloud SQL are possible PostgreSQL hosts.
Workers would connect through Hyperdrive, with query caching disabled, to a primary near the writing Workers.

### Expected benefit and limits

The [D1 diagnosis](evidence/d1-write-path-diagnosis-20261022.json) isolated selective waits outside reported SQL execution.
The probes recorded an 888 ms B call with 0.289 ms of SQL and a 754 ms A call with 0.454 ms of SQL.
Independent client measurements confirmed real waits while the other database responded and the caller continued sending heartbeats.
The exact internal cause remains unresolved.

PostgreSQL replaces D1's database and binding path, which could reduce these delays.
Hyperdrive reuses connections near the origin database and reduces repeated connection setup.
This expected improvement is an inference that needs a controlled hosted comparison.
See [how Hyperdrive works](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/).

Worker scheduling and local Durable Object storage remain sources of latency.
PostgreSQL introduces network, lock, storage, and commit waits.
Synchronous replication can also increase commit latency.
See [RDS Multi-AZ behavior](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html)
and [Cloud SQL high availability](https://docs.cloud.google.com/sql/docs/postgres/high-availability).

The existing native RDS evidence makes AWS the first candidate for a trial.
That evidence establishes role-store correctness. It establishes no latency advantage over Google Cloud SQL or D1.

### Configuration and implementation requirements

- Place an always-on PostgreSQL primary near the writing Workers, initially in Singapore.
  Keep transactions short and batch dependent statements to limit network round trips.
- Give A and B separate databases, runtime credentials, and Hyperdrive configurations.
  Verify TLS between Hyperdrive and PostgreSQL.
- Create each store's Hyperdrive configuration with `--caching-disabled`.
  Hyperdrive caches eligible reads by default and does not invalidate them after writes.
  Admission, cancellation, session, and authorization reads must observe current state.
  Connection pooling still works with caching disabled.
  See [query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).
- Preserve coherent reads, conditional row-count checks, atomic rollback, and durable completion.
  Preserve serialization retries and reconciliation after a lost commit acknowledgement.
- Use transaction-local settings with Hyperdrive's transaction-mode pooling.
  Avoid persistent session state, SQL-level `PREPARE`, advisory locks, and `LISTEN`.
  See [pooling behavior](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/#pooling-mode).

The [public portability note](../../seams-wallet/docs/storage-portability.md#cloudflare-workers-with-hyperdrive)
records the WASM adapter and connection fixture.
The [October 24 E2E evidence](../../seams-wallet/docs/evidence/postgres-role-worker-20261024.md)
verifies rollback, coherent reads, conditional claims, serialization retries, and role identity through local Workers sockets.
That fixture uses local Hyperdrive bindings against disposable PostgreSQL.
Hosted pooling, origin TLS, and the complete Worker lifecycle remain unverified.
The Deriver runtime still needs PostgreSQL connection setup and store construction.
Gateway, SigningWorker, and Console stores also need PostgreSQL ports.
For TypeScript stores, Hyperdrive documents `node-postgres` and `postgres.js` with the `nodejs_compat` flag.
Data import and production cutover remain separate work.

### Evidence required before migration

1. Compare D1 and PostgreSQL through Hyperdrive with the same writing Worker placement and logical workload.
   Include value-changing writes, concurrent reads, and concurrent admissions.
   Record database locations and match durability settings to the intended production configuration.
2. Run the role-store lifecycle E2E through Hyperdrive.
   Include cancellation during admission, serialization conflicts, and a lost commit reply followed by exact replay.
   Verify rollback, coherent reads, and separate A/B access.
3. Run complete registration and signing through the ported stores.
   Interleave controls and candidates, and include fresh requests, requests after idle periods, and concurrent traffic.
   Retain failures alongside successful requests.
4. Record database-call and complete-flow timings, sample counts, timeouts, and errors.
   Report medians and supported tail percentiles, including p95 and p99 when sample counts permit them.
   Preserve raw timings, source and deployment versions, configuration, correctness proofs, and a repeatable analysis artifact.

Treat this as a latency upgrade only after the hosted comparison shows a repeatable improvement with the required custody and transaction guarantees.
