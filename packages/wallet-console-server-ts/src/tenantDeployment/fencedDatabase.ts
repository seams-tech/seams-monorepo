import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from '@seams/wallet-server/cloud-host';
import type { TenantDeploymentBindingV1 } from './types';
import type { TenantRuntimeWriterV1 } from './resourceVerification';

// Bind once at request admission. Deferred work retains this exact writer and binding.
export class DeploymentFencedDatabase implements D1DatabaseLike {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly binding: TenantDeploymentBindingV1,
    private readonly writer: TenantRuntimeWriterV1,
  ) {}

  async exec(): Promise<never> {
    throw new Error('Runtime deployment access requires prepared statements');
  }

  prepare(sql: string): D1PreparedStatementLike {
    return new DeploymentFencedStatement(this, this.database.prepare(sql));
  }

  async batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    const raw = [];
    for (const statement of statements) {
      if (!(statement instanceof DeploymentFencedStatement) || statement.owner !== this) {
        throw new Error('Deployment batch contains a statement from another admission');
      }
      raw.push(statement.statement);
    }
    return this.execute<T>(raw);
  }

  async execute<T>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    const guard = this.database
      .prepare(
        `INSERT INTO regional_deployment_write_checks
       (deployment_lane, namespace, account_id, database_id, binding_revision, writer_role, writer_version)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        this.binding.deploymentLane,
        this.binding.tenant.namespace,
        this.writer.resource.accountId,
        this.writer.resource.databaseId,
        this.binding.revision,
        this.writer.role,
        this.writer.versionId,
      );
    const results = await this.database.batch<T>([guard, ...statements]);
    return results.slice(1);
  }
}

class DeploymentFencedStatement implements D1PreparedStatementLike {
  constructor(
    readonly owner: DeploymentFencedDatabase,
    readonly statement: D1PreparedStatementLike,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    return new DeploymentFencedStatement(this.owner, this.statement.bind(...values));
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    if (columnName !== undefined) {
      const result = await this.all<Readonly<Record<string, T>>>();
      return result.results?.[0]?.[columnName] ?? null;
    }
    const result = await this.all<T>();
    return result.results?.[0] ?? null;
  }

  async all<T = unknown>(): Promise<D1ResultLike<T>> {
    const results = await this.owner.execute<D1ResultLike<T>>([this.statement]);
    const result = results[0];
    if (!result) throw new Error('Deployment batch omitted its statement result');
    return result;
  }

  async run<T = unknown>(): Promise<D1ResultLike<T>> {
    return this.all<T>();
  }
}
