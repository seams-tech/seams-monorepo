import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
} from '../../packages/console-server-ts/src/boundary/d1';

/** Counts transport calls and can interrupt the next transaction at its boundary. */
export class AccountDatabaseProbe implements D1DatabaseLike {
  calls = 0;
  statements = 0;
  beforeBatch: (() => Promise<void>) | null = null;
  constructor(readonly database: D1DatabaseLike) {}
  reset(): void {
    this.calls = 0;
    this.statements = 0;
  }
  prepare(sql: string): D1PreparedStatementLike {
    return new ProbedStatement(this, this.database.prepare(sql));
  }
  async batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    const hook = this.beforeBatch;
    this.beforeBatch = null;
    if (hook) await hook();
    this.calls += 1;
    this.statements += statements.length;
    return this.database.batch<T>(statements.map(unwrapStatement));
  }
  exec(sql: string): Promise<unknown> {
    this.calls += 1;
    return this.database.exec(sql);
  }
}
function unwrapStatement(statement: D1PreparedStatementLike): D1PreparedStatementLike {
  return statement instanceof ProbedStatement ? statement.statement : statement;
}
class ProbedStatement implements D1PreparedStatementLike {
  constructor(
    private readonly probe: AccountDatabaseProbe,
    readonly statement: D1PreparedStatementLike,
  ) {}
  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new ProbedStatement(this.probe, this.statement.bind(...values));
  }
  first<T = unknown>(columnName?: string): Promise<T | null> {
    this.count();
    return this.statement.first<T>(columnName);
  }
  all<T = unknown>() {
    this.count();
    return this.statement.all<T>();
  }
  run<T = unknown>() {
    this.count();
    return this.statement.run<T>();
  }
  private count(): void {
    this.probe.calls += 1;
    this.probe.statements += 1;
  }
}
