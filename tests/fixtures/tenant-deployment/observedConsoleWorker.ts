export { SatyrAccountPlatform } from '../../../packages/wallet-console-server-ts/src/router/cloudflare/satyrAccountPlatform';
import consoleWorker from '../../../packages/wallet-console-server-ts/src/router/cloudflare/d1ConsoleStagingWorker';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from '@seams/wallet-server/cloud-host';

class ObservedDatabase implements D1DatabaseLike {
  calls = 0;
  statements = 0;

  constructor(
    private readonly database: D1DatabaseLike,
    private readonly failBatch: boolean,
  ) {}

  prepare(sql: string): D1PreparedStatementLike {
    return new ObservedStatement(this, this.database.prepare(sql));
  }

  record(statements: number): void {
    this.calls += 1;
    this.statements += statements;
  }

  async batch<T>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    const originals = [];
    for (const statement of statements) {
      if (!(statement instanceof ObservedStatement) || statement.owner !== this) {
        throw new Error('Console test batch contains a foreign statement');
      }
      originals.push(statement.original);
    }
    this.record(statements.length);
    if (this.failBatch) throw new Error('Injected Console D1 batch failure');
    return this.database.batch<T>(originals);
  }

  async exec(sql: string): Promise<unknown> {
    this.record(1);
    return this.database.exec(sql);
  }
}

class ObservedStatement implements D1PreparedStatementLike {
  constructor(
    readonly owner: ObservedDatabase,
    readonly original: D1PreparedStatementLike,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new ObservedStatement(this.owner, this.original.bind(...values));
  }

  first<T>(columnName?: string): Promise<T | null> {
    this.owner.record(1);
    return this.original.first<T>(columnName);
  }

  all<T>(): Promise<D1ResultLike<T>> {
    this.owner.record(1);
    return this.original.all<T>();
  }

  run<T>(): Promise<D1ResultLike<T>> {
    this.owner.record(1);
    return this.original.run<T>();
  }
}

function walletRequestEnvironment(
  request: Request,
  env: Parameters<typeof consoleWorker.fetch>[1],
): Parameters<typeof consoleWorker.fetch>[1] {
  if (request.headers.has('x-test-console-composition-unavailable')) {
    return { ...env, SEAMS_WALLET_HOME_CATALOG_JSON: 'Console composition is unavailable' };
  }
  if (!request.headers.has('x-test-account-keys-unavailable')) return env;
  return {
    ...env,
    SATYR_SERVICE_ORIGIN: 'https://satyr.invalid',
    SATYR_ACCOUNT_USER_ASSERTION_PUBLIC_JWK_JSON: 'Unavailable on Wallet routes',
    ACCOUNT_PROVISION_ASSERTION_PRIVATE_JWK_JSON: 'Unavailable on Wallet routes',
  };
}

async function fetch(
  request: Parameters<typeof consoleWorker.fetch>[0],
  env: Parameters<typeof consoleWorker.fetch>[1],
  ctx: Parameters<typeof consoleWorker.fetch>[2],
): Promise<Response> {
  const browserOrigin = request.headers.get('x-test-browser-origin');
  if (browserOrigin) {
    const headers = new Headers(request.headers);
    headers.set('Origin', browserOrigin);
    headers.delete('x-test-browser-origin');
    request = new Request(request, { headers });
  }
  const database = new ObservedDatabase(
    env.CONSOLE_DB,
    request.headers.has('x-test-fail-d1-batch'),
  );
  const response = await consoleWorker.fetch(
    request,
    { ...walletRequestEnvironment(request, env), CONSOLE_DB: database },
    ctx,
  );
  const result = new Response(response.body, response);
  result.headers.set('x-test-d1-calls', String(database.calls));
  result.headers.set('x-test-d1-statements', String(database.statements));
  return result;
}

export default { fetch };
