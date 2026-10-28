import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const output = path.join(repository, 'output/playwright/remote-d1-migrations');
const runner = path.join(
  repository,
  'packages/wallet-console-server-ts/scripts/apply-remote-d1-migrations.mjs',
);
const databaseName = `seams-migration-e2e-${randomUUID().slice(0, 8)}`;

const initialSchema = `
CREATE TABLE parents (id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('first', 'second')));
CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parents(id));
CREATE TABLE audit (child_id INTEGER PRIMARY KEY);
CREATE TRIGGER child_audit AFTER INSERT ON children
BEGIN INSERT INTO audit (child_id) VALUES (NEW.id); END;
INSERT INTO parents VALUES (1, 'first'), (2, 'second');
WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 100)
INSERT INTO children SELECT n, 1 + n % 2 FROM numbers;
`;

const rebuildSchema = `
PRAGMA defer_foreign_keys = ON;
CREATE TABLE parents_next (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('first', 'second', 'third'))
);
INSERT INTO parents_next SELECT * FROM parents;
DROP TABLE parents;
ALTER TABLE parents_next RENAME TO parents;
CREATE TABLE migration_fk_guard (id INTEGER PRIMARY KEY CHECK (id = 1));
INSERT INTO migration_fk_guard SELECT 0 FROM pragma_foreign_key_check LIMIT 1;
DROP TABLE migration_fk_guard;
PRAGMA defer_foreign_keys = OFF;
`;

await main();

async function main() {
  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(path.join(tmpdir(), 'seams-remote-migration-'));
  let created = false;
  try {
    const creation = run('pnpm', ['exec', 'wrangler', 'd1', 'create', databaseName]);
    assert.equal(creation.status, 0, creation.stderr);
    created = true;
    const match = creation.stdout.match(/"database_id":\s*"([a-f0-9-]+)"/u);
    assert.ok(match, 'D1 creation must return its database ID');
    const config = path.join(temporary, 'wrangler.json');
    await writeFile(
      config,
      JSON.stringify({
        name: databaseName,
        compatibility_date: '2026-04-17',
        d1_databases: [{ binding: 'DB', database_name: databaseName, database_id: match[1] }],
      }),
    );
    const migrations = path.join(temporary, 'migrations');
    await mkdir(migrations);
    await writeFile(path.join(migrations, '0001_initial.sql'), initialSchema);
    await writeFile(path.join(migrations, '0002_rebuild.sql'), rebuildSchema);
    await applyMigrations(config, migrations, 'initial-and-rebuild', 0);
    assert.equal(query(config, 'SELECT COUNT(*) AS count FROM children')[0].count, 100);
    assert.equal(query(config, 'SELECT COUNT(*) AS count FROM audit')[0].count, 100);
    assert.deepEqual(query(config, 'PRAGMA foreign_key_check'), []);
    query(config, "INSERT INTO parents VALUES (3, 'third')");
    query(config, 'INSERT INTO children VALUES (101, 3)');
    assert.equal(query(config, 'SELECT COUNT(*) AS count FROM audit')[0].count, 101);

    const failurePath = path.join(migrations, '0003_resume.sql');
    await writeFile(
      failurePath,
      `
CREATE TABLE resume_marker (id INTEGER PRIMARY KEY);
INSERT INTO audit VALUES (999);
SELECT * FROM deliberately_missing_table;
`,
    );
    await applyMigrations(config, migrations, 'deliberate-failure', 1);
    assert.match(
      await readFile(path.join(output, 'deliberate-failure.log'), 'utf8'),
      /no such table: deliberately_missing_table/u,
    );
    assert.deepEqual(
      query(config, "SELECT name FROM sqlite_master WHERE name = 'resume_marker'"),
      [],
    );
    assert.equal(query(config, 'SELECT COUNT(*) AS count FROM audit')[0].count, 101);
    assert.equal(query(config, 'SELECT COUNT(*) AS count FROM d1_migrations')[0].count, 2);

    await writeFile(failurePath, 'CREATE TABLE resume_marker (id INTEGER PRIMARY KEY);\n');
    await applyMigrations(config, migrations, 'resume-after-rollback', 0);
    assert.equal(query(config, 'SELECT COUNT(*) AS count FROM d1_migrations')[0].count, 3);
    await applyMigrations(config, migrations, 'repeat-unchanged', 0);
    await writeFile(
      path.join(migrations, '0001_initial.sql'),
      `${initialSchema}\n-- changed source\n`,
    );
    await applyMigrations(config, migrations, 'reject-applied-source-change', 1);
    assert.match(
      await readFile(path.join(output, 'reject-applied-source-change.log'), 'utf8'),
      /Applied D1 migration sources changed/u,
    );
    assert.equal(query(config, 'SELECT COUNT(*) AS count FROM d1_migrations')[0].count, 3);
    assert.deepEqual(query(config, 'PRAGMA foreign_key_check'), []);
    await writeFile(
      path.join(output, 'result.json'),
      `${JSON.stringify(
        {
          status: 'passed',
          databaseName,
          transport: 'remote D1 query API through the production migration runner',
          retainedChildren: 101,
          retainedAuditRows: 101,
          foreignKeyViolations: 0,
          failedMigrationRolledBack: true,
          failedMigrationHistoryAbsent: true,
          resumePassed: true,
          unchangedRepeatPassed: true,
          appliedSourceChangeRejected: true,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (created) {
      const deletion = run('pnpm', [
        'exec',
        'wrangler',
        'd1',
        'delete',
        databaseName,
        '--skip-confirmation',
      ]);
      assert.equal(deletion.status, 0, deletion.stderr);
    }
    await rm(temporary, { recursive: true, force: true });
  }
  const resultPath = path.join(output, 'result.json');
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  result.temporaryDatabaseDeleted = true;
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Remote migration E2E passed: ${resultPath}\n`);
}

async function applyMigrations(config, migrations, label, expectedStatus) {
  const result = run('node', [
    runner,
    '--database',
    'DB',
    '--config',
    config,
    '--migrations-dir',
    migrations,
  ]);
  await writeFile(path.join(output, `${label}.log`), result.stdout + result.stderr);
  if (expectedStatus === 0) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0, 'The deliberate failure must be rejected');
}

function query(config, sql) {
  const result = run('pnpm', [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'DB',
    '--remote',
    '--config',
    config,
    `--command=${sql}`,
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const batches = JSON.parse(result.stdout);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].success, true);
  return batches[0].results;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repository,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}
