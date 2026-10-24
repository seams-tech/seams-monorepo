import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
  WalletConsoleServiceBinding,
} from '@seams/wallet-server/cloud-host';
import { consoleWorkerEnvironment } from '../../helpers/consoleWorkerEnvironment';
import { verifyUnactivatedConsoleOnboarding } from '../../relayer/console-onboarding.scenario';

const [mode, directory, binary, address, repository] = process.argv.slice(2);
if (!directory || !binary || !address || !repository)
  throw new Error('Expected mode, artifact directory, runtime, and address');
const configuration = path.join(directory, 'console.json');
const databaseName = 'console-celld-acceptance';
const databaseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

class ConsoleService implements WalletConsoleServiceBinding {
  readonly requests: { path: string; status: number }[] = [];

  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const original = new Request(input, init);
    const url = new URL(original.url);
    const headers = new Headers(original.headers);
    headers.set('x-forwarded-host', url.host);
    headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
    const response = await fetch(address + url.pathname + url.search, {
      method: original.method,
      headers,
      body: original.body === null ? undefined : await original.arrayBuffer(),
      redirect: 'manual',
    });
    this.requests.push({ path: url.pathname, status: response.status });
    return response;
  }
}

/** Reads proof rows through the runtime's existing authenticated operator CLI. */
class ConsoleReadDatabase implements D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike {
    return new ConsoleReadStatement(sql, []);
  }

  async batch<T>(): Promise<readonly T[]> {
    throw new Error('Console proof reads cannot write a batch');
  }

  async exec(): Promise<unknown> {
    throw new Error('Console proof reads cannot execute writes');
  }
}

class ConsoleReadStatement implements D1PreparedStatementLike {
  constructor(
    private readonly sql: string,
    private readonly values: readonly unknown[],
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new ConsoleReadStatement(this.sql, values);
  }

  async first<T>(columnName?: string): Promise<T | null> {
    if (columnName !== 'count' || !this.sql.startsWith('SELECT COUNT(*) AS count')) {
      throw new Error('The onboarding proof requires a count query');
    }
    const parts = this.sql.split('?');
    if (parts.length !== this.values.length + 1) throw new Error('SQL parameter count differs');
    let sql = parts[0]!;
    for (let index = 0; index < this.values.length; index += 1) {
      sql += sqlLiteral(this.values[index]) + parts[index + 1];
    }
    const output = execFileSync(
      binary,
      [
        'd1',
        'execute',
        databaseName,
        configuration,
        '--bucket',
        'fleet-test',
        '--command',
        sql,
        '--json',
      ],
      { encoding: 'utf8', timeout: 90_000 },
    );
    const row: unknown = JSON.parse(output.trim());
    if (
      typeof row !== 'object' ||
      row === null ||
      !('count' in row) ||
      typeof row.count !== 'number' ||
      !Number.isSafeInteger(row.count) ||
      row.count < 0
    ) {
      throw new Error('Runtime CLI returned an invalid count row');
    }
    return row.count as T;
  }

  async all<T>(): Promise<D1ResultLike<T>> {
    throw new Error('The onboarding proof only reads individual counts');
  }

  async run<T>(): Promise<D1ResultLike<T>> {
    throw new Error('Console proof reads cannot run writes');
  }
}

function sqlLiteral(value: unknown): string {
  if (typeof value === 'string') return "'" + value.replaceAll("'", "''") + "'";
  throw new Error('The onboarding proof only binds string identifiers');
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function prepare(): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await build({
    entryPoints: {
      console: path.join(
        repository,
        'packages/wallet-console-server-ts/src/router/cloudflare/d1ConsoleStagingWorker.ts',
      ),
      consumer: path.join(repository, 'tests/fixtures/tenant-deployment/consoleOpsConsumer.ts'),
    },
    outdir: directory,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*', 'cloudflare:*'],
    loader: { '.wasm': 'file' },
    tsconfig: path.join(repository, 'tests/tsconfig.playwright.json'),
    alias: process.env.SEAMS_WALLET_SERVER_CANDIDATE
      ? {
          '@seams/wallet-server/cloud-host': createRequire(
            path.resolve(process.env.SEAMS_WALLET_SERVER_CANDIDATE, 'package.json'),
          ).resolve('@seams/wallet-server/cloud-host'),
        }
      : {},
  });
  const environment = consoleWorkerEnvironment({
    namespace: 'console-celld-acceptance',
    deploymentLane: 'console-preflight',
    walletServiceDeploymentId: 'console-preflight',
    accountId: '0123456789abcdef0123456789abcdef',
    databaseId,
  });
  const migrationsDirectory = path.join(
    repository,
    'packages/wallet-console-server-ts/migrations/d1-console',
  );
  const migrations = [];
  await mkdir(path.join(directory, 'migrations'));
  for (const name of (await readdir(migrationsDirectory)).sort()) {
    if (name.endsWith('.sql')) {
      await copyFile(
        path.join(migrationsDirectory, name),
        path.join(directory, 'migrations', name),
      );
      migrations.push({
        name,
        sha256: sha256(await readFile(path.join(migrationsDirectory, name))),
      });
    }
  }
  await writeFile(
    configuration,
    JSON.stringify({
      name: 'console',
      main: './console.js',
      no_bundle: true,
      compatibility_date: '2026-04-17',
      compatibility_flags: ['nodejs_compat'],
      vars: environment,
      d1_databases: [
        {
          binding: 'CONSOLE_DB',
          database_name: databaseName,
          database_id: databaseId,
          migrations_dir: './migrations',
        },
      ],
      services: [{ binding: 'WALLET_RUNTIME', service: 'guard' }],
    }),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(directory, 'consumer.json'),
    JSON.stringify({
      name: 'consumer',
      main: './consumer.js',
      no_bundle: true,
      compatibility_date: '2026-04-17',
      services: [{ binding: 'WALLET_CONSOLE', service: 'console' }],
    }),
  );
  await writeFile(
    path.join(directory, 'prepared-proof.json'),
    JSON.stringify(
      {
        scope:
          'production Console Worker through a service binding; onboarding replay and unauthorized activation',
        consoleBundleSha256: sha256(await readFile(path.join(directory, 'console.js'))),
        migrations,
      },
      null,
      2,
    ) + '\n',
  );
}

async function verify(): Promise<void> {
  const config = JSON.parse(await readFile(configuration, 'utf8'));
  const service = new ConsoleService();
  const proof = await verifyUnactivatedConsoleOnboarding({
    service,
    productService: service,
    database: new ConsoleReadDatabase(),
    sessionSecret: config.vars.CONSOLE_SESSION_HMAC_SECRET,
  });
  await writeFile(
    path.join(directory, 'onboarding-proof.json'),
    JSON.stringify(
      {
        status: 'passed',
        proof,
        requests: service.requests,
      },
      null,
      2,
    ) + '\n',
  );
}

async function main(): Promise<void> {
  switch (mode) {
    case 'prepare':
      await prepare();
      break;
    case 'verify':
      await verify();
      break;
    default:
      throw new Error('Expected prepare or verify mode');
  }
}

function failed(error: unknown): void {
  console.error(error);
  process.exitCode = 1;
}

main().catch(failed);
