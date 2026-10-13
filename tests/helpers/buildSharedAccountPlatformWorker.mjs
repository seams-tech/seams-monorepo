import { build } from 'esbuild';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_splitSqlQuery } from 'wrangler';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(repository, 'packages/console-server-ts/migrations/d1-console-core');
const output = path.join(repository, '.artifacts/shared-account-platform/account-worker/index.mjs');
const migrations = [];
for (const name of (await readdir(directory)).sort()) {
  if (!name.endsWith('.sql')) continue;
  const sql = await readFile(path.join(directory, name), 'utf8');
  migrations.push({ name, statements: unstable_splitSqlQuery(sql) });
}
await mkdir(path.dirname(output), { recursive: true });
await build({
  entryPoints: [path.join(repository, 'tests/helpers/sharedAccountPlatformWorker.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: output,
  define: { ACCOUNT_CORE_MIGRATIONS: JSON.stringify(migrations) },
  logLevel: 'info',
});
