import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_splitSqlQuery } from 'wrangler';
import { SqliteCliD1Database } from '../../helpers/sqliteD1';
import {
  ServiceProvisionCommandV1,
  ServiceTenantBindingV1,
  parseServiceProvisionReceiptV1,
  type PlatformResult,
  type WalletTenantScopeV1,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import {
  object,
  textValue,
} from '../../../packages/console-shared-ts/src/accountPlatform/boundary';
import { createD1AccountPlatformService } from '../../../packages/console-server-ts/src/accountPlatform/d1';
import { createD1ConsoleOrganizationAccessService } from '../../../packages/console-server-ts/src/teamRbac/d1';
import { createD1ConsoleOrgProjectService } from '../../../packages/console-server-ts/src/orgProjectEnv/d1';
import { walletProjectAttachmentEvidence } from '../../../packages/wallet-console-server-ts/src/accountPlatform/provisioning';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = path.join(repository, '.artifacts/shared-account-platform/restore');
const walletMigrations = path.join(
  repository,
  'packages/wallet-console-server-ts/migrations/d1-console',
);

function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function encodeValue(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return { integer: value.toString() };
  if (value instanceof Uint8Array) return { bytes: Buffer.from(value).toString('base64') };
  return value;
}

function tableHash(
  database: DatabaseSync,
  table: string,
  columns: readonly string[],
): { count: number; sha256: string } {
  const statement = database.prepare(`SELECT ${columns.join(',')} FROM "${table}"`);
  statement.setReadBigInts(true);
  const encoded: string[] = [];
  for (const row of statement.all()) encoded.push(JSON.stringify(row, encodeValue));
  encoded.sort();
  return { count: encoded.length, sha256: hash(JSON.stringify(encoded)) };
}

function columnsFor(database: DatabaseSync, table: string): string[] {
  const columns: string[] = [];
  for (const row of database.prepare(`PRAGMA table_info("${table}")`).all()) {
    const name = textValue(row.name, 'column');
    if (table === 'organizations' && (name === 'authorization_version' || name === 'updated_at_ms'))
      continue;
    columns.push(`"${name.replaceAll('"', '""')}"`);
  }
  return columns;
}

function sourceSnapshot(file: string) {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const tables: Record<string, { columns: readonly string[]; count: number; sha256: string }> =
      {};
    for (const name of [
      'organizations',
      'projects',
      'environments',
      'organization_memberships',
      'billing_ledger_entries',
      'billing_ledger_postings',
      'billing_purchases',
      'billing_refunds',
      'billing_disputes',
      'billing_invoices',
      'billing_invoice_line_items',
    ]) {
      if (
        !database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)
      )
        continue;
      const columns = columnsFor(database, name);
      const digest = tableHash(database, name, columns);
      tables[name] = { columns, count: digest.count, sha256: digest.sha256 };
    }
    return tables;
  } finally {
    database.close();
  }
}

function assertSnapshot(file: string, before: ReturnType<typeof sourceSnapshot>): void {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    for (const [table, previous] of Object.entries(before)) {
      expect(
        tableHash(database, table, previous.columns),
        `${table} preserves source values`,
      ).toEqual({ count: previous.count, sha256: previous.sha256 });
    }
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    database.close();
  }
}

async function applyMigrations(
  database: SqliteCliD1Database,
  start: string,
  end: string,
): Promise<string[]> {
  const applied: string[] = [];
  for (const name of (await readdir(walletMigrations)).sort()) {
    if (!name.endsWith('.sql') || name < start || name >= end) continue;
    const previous = await database
      .prepare('SELECT name FROM d1_migrations WHERE name=?')
      .bind(name)
      .first();
    if (previous) continue;
    await database.exec(await readFile(path.join(walletMigrations, name), 'utf8'));
    await database.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name).run();
    applied.push(name);
  }
  return applied;
}

async function bindExistingWalletProjects(
  database: SqliteCliD1Database,
  namespace: string,
  deploymentId: string,
): Promise<number> {
  const access = await createD1ConsoleOrganizationAccessService({ database, namespace });
  const projects = await createD1ConsoleOrgProjectService({ database, namespace });
  const platform = createD1AccountPlatformService({
    database,
    namespace,
    organizationAccess: access,
  });
  const owners = await database
    .prepare(
      "SELECT org_id,user_id FROM organization_memberships WHERE namespace=? AND kind='ACTIVE' AND role='OWNER' ORDER BY org_id,user_id",
    )
    .bind(namespace)
    .all();
  let count = 0;
  const seen = new Set<string>();
  for (const raw of owners.results ?? []) {
    const owner = object(raw, 'owner');
    const orgId = textValue(owner.org_id, 'org_id');
    if (seen.has(orgId)) continue;
    seen.add(orgId);
    const context = { orgId, actorUserId: textValue(owner.user_id, 'user_id') };
    for (const project of await projects.listProjects(context)) {
      const native: WalletTenantScopeV1 = {
        serviceId: 'wallet',
        deploymentId,
        namespace,
        nativeOrganizationId: orgId,
        nativeProjectId: project.id,
      };
      const scope = accepted(await platform.bindProjectBilling(context, project.id));
      const instanceId = `instance_wallet_${project.id}`;
      const command = accepted(
        ServiceProvisionCommandV1.parse({
          version: 1,
          operationId: `migration:${namespace}:${project.id}`,
          instanceId,
          desiredRevision: 1,
          command: 'enable',
          binding: {
            kind: 'attach_existing_scope',
            nativeScope: native,
            authorityEvidence: await walletProjectAttachmentEvidence(native, project),
          },
        }),
      );
      accepted(await platform.requestProvision(context, { scope, command }));
      const binding = accepted(
        ServiceTenantBindingV1.parse({ instanceId, scope, nativeScope: native }),
      );
      const receipt = accepted(
        parseServiceProvisionReceiptV1({
          version: 1,
          operationId: command.operationId,
          instanceId,
          desiredRevision: 1,
          result: 'active',
          binding,
        }),
      );
      accepted(await platform.acknowledgeProvision({ serviceId: 'wallet', deploymentId }, receipt));
      // A verified attachment records the existing native state. It does not create environments or rotate credentials.
      count += 1;
    }
  }
  const total = await database
    .prepare("SELECT count(*) AS count FROM projects WHERE namespace=? AND status='ACTIVE'")
    .bind(namespace)
    .first<number>('count');
  expect(count).toBe(total);
  return count;
}

async function walletRehearsal(
  snapshotDirectory: string,
  source: string,
  namespace: string,
  deploymentId: string,
) {
  const original = path.join(snapshotDirectory, `${source}.sqlite`);
  const target = path.join(snapshotDirectory, `${source}-migrated.sqlite`);
  await copyFile(original, target);
  const before = sourceSnapshot(target);
  let database = new SqliteCliD1Database(target);
  const baselineMigrations = await applyMigrations(database, '0000', '0093');
  assertSnapshot(target, before);
  const featureMigrations = await applyMigrations(database, '0093', '0094');
  const instances = await bindExistingWalletProjects(database, namespace, deploymentId);
  featureMigrations.push(...(await applyMigrations(database, '0094', '9999')));
  assertSnapshot(target, before);
  // Reconstruct the adapter from the migrated file, then replay the same attachment operations.
  database = new SqliteCliD1Database(target);
  expect(await bindExistingWalletProjects(database, namespace, deploymentId)).toBe(instances);
  assertSnapshot(target, before);
  const restored = path.join(snapshotDirectory, `${source}-restored.sqlite`);
  await copyFile(original, restored);
  assertSnapshot(restored, before);
  const restoredDatabase = new SqliteCliD1Database(restored);
  await applyMigrations(restoredDatabase, '0000', '0093');
  await applyMigrations(restoredDatabase, '0093', '0094');
  expect(await bindExistingWalletProjects(restoredDatabase, namespace, deploymentId)).toBe(
    instances,
  );
  await applyMigrations(restoredDatabase, '0094', '9999');
  assertSnapshot(restored, before);
  return {
    source,
    baselineMigrations,
    featureMigrations,
    instances,
    preserved: before,
    restarted: true,
    restoredBeforeNewWrites: true,
  };
}

async function satyrRehearsal(snapshotDirectory: string, source: string, patch: string) {
  const original = path.join(snapshotDirectory, `${source}.sqlite`);
  const target = path.join(snapshotDirectory, `${source}-migrated.sqlite`);
  await copyFile(original, target);
  const preserved = nativeSnapshot(original);
  const sourceDatabase = new DatabaseSync(original, { readOnly: true });
  const roleBefore =
    source === 'satyr-apac'
      ? tableHash(
          sourceDatabase,
          'organisation_membership',
          columnsFor(sourceDatabase, 'organisation_membership'),
        )
      : null;
  const placementBefore = tableHash(
    sourceDatabase,
    'organisation_placement',
    columnsFor(sourceDatabase, 'organisation_placement'),
  );
  sourceDatabase.close();
  const patchSql = await readFile(
    path.join('/Users/pta/Dev/lowerarchy/satyr/services/platform/scripts', patch),
    'utf8',
  );
  let database = new SqliteCliD1Database(target);
  await applyRecordedPatch(database, patch, patchSql);
  assertNativeSnapshot(target, preserved);
  // Deployment patches must be safe to replay after an uncertain acknowledgement.
  await applyRecordedPatch(database, patch, patchSql);
  assertNativeSnapshot(target, preserved);
  const migrated = new DatabaseSync(target, { readOnly: true });
  const placementAfter = tableHash(
    migrated,
    'organisation_placement',
    columnsFor(migrated, 'organisation_placement'),
  );
  expect(placementAfter).toEqual(placementBefore);
  if (roleBefore) {
    const oldColumns = new DatabaseSync(original, { readOnly: true });
    const columns = columnsFor(oldColumns, 'organisation_membership');
    oldColumns.close();
    expect(tableHash(migrated, 'service_role_grant', columns)).toEqual(roleBefore);
    expect(
      migrated.prepare("SELECT name FROM sqlite_master WHERE name='organisation_membership'").get(),
    ).toBeUndefined();
  }
  expect(migrated.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  migrated.close();
  const restored = path.join(snapshotDirectory, `${source}-restored.sqlite`);
  await copyFile(original, restored);
  database = new SqliteCliD1Database(restored);
  await applyRecordedPatch(database, patch, patchSql);
  assertNativeSnapshot(restored, preserved);
  const restoredDatabase = new DatabaseSync(restored, { readOnly: true });
  expect(
    tableHash(
      restoredDatabase,
      'organisation_placement',
      columnsFor(restoredDatabase, 'organisation_placement'),
    ),
  ).toEqual(placementBefore);
  expect(restoredDatabase.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  restoredDatabase.close();
  return {
    source,
    patch,
    rolePreserved: roleBefore,
    placementPreserved: placementBefore,
    replayed: true,
    restoredBeforeNewWrites: true,
    preserved,
  };
}

function nativeSnapshot(file: string) {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const result: Record<string, { columns: readonly string[]; count: number; sha256: string }> =
      {};
    for (const row of database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' AND name NOT LIKE 'context_projection_fts_%'",
      )
      .all()) {
      const table = textValue(row.name, 'native table');
      const columns = columnsFor(database, table);
      if (table === 'context_projection' || table === 'context_projection_fts')
        columns.push('rowid');
      const digest = tableHash(database, table, columns);
      result[table] = { columns, count: digest.count, sha256: digest.sha256 };
    }
    return result;
  } finally {
    database.close();
  }
}

function assertNativeSnapshot(file: string, before: ReturnType<typeof nativeSnapshot>): void {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    for (const [source, previous] of Object.entries(before)) {
      let target = source;
      if (source === 'organisation_membership') target = 'service_role_grant';
      if (source === 'organisation_invitation') target = 'retired_organisation_invitation';
      expect(
        tableHash(database, target, previous.columns),
        `${source} retains native records`,
      ).toEqual({ count: previous.count, sha256: previous.sha256 });
    }
  } finally {
    database.close();
  }
}

async function applyRecordedPatch(
  database: SqliteCliD1Database,
  name: string,
  sql: string,
): Promise<void> {
  // Use Wrangler's existing migration receipt model. The receipt and DDL share one transaction.
  await database.exec(
    'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
  );
  const applied = await database
    .prepare('SELECT name FROM d1_migrations WHERE name=?')
    .bind(name)
    .first();
  if (applied) return;
  const statements = [];
  for (const statement of unstable_splitSqlQuery(sql)) {
    if (statement.trim().toUpperCase().startsWith('PRAGMA FOREIGN_KEYS')) continue;
    statements.push(database.prepare(statement));
  }
  statements.push(database.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name));
  await database.batch(statements);
}

test('live snapshot clones preserve Wallet money and Satyr placement through migration, restart, and restore', async () => {
  test.setTimeout(180_000);
  const snapshots = textValue(
    process.env.SHARED_ACCOUNT_MIGRATION_SNAPSHOTS,
    'SHARED_ACCOUNT_MIGRATION_SNAPSHOTS',
  );
  await mkdir(evidence, { recursive: true });
  const wallets = [];
  wallets.push(
    await walletRehearsal(snapshots, 'seams-staging', 'seams-staging', 'staging-testnet'),
  );
  wallets.push(
    await walletRehearsal(snapshots, 'seams-production', 'seams-production', 'production-mainnet'),
  );
  wallets.push(
    await walletRehearsal(
      snapshots,
      'seams-testnet',
      'seams-production-testnet',
      'production-testnet',
    ),
  );
  const satyr = [];
  satyr.push(
    await satyrRehearsal(snapshots, 'satyr-control', 'shared-account-platform-global-patch.sql'),
  );
  satyr.push(
    await satyrRehearsal(snapshots, 'satyr-apac', 'shared-account-platform-regional-patch.sql'),
  );
  await writeFile(
    path.join(evidence, 'report.json'),
    JSON.stringify(
      { version: 1, passed: true, productionMutated: false, wallets, satyr },
      null,
      2,
    ) + '\n',
  );
});
