import { d1ChangedRows, queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { TenantDeploymentStoreError } from './service';

// A home names a provider resource. Region and deployment lane are not authority identities.
export class NamespaceD1HomeV1 {
  readonly #validated = true;

  private constructor(
    readonly namespace: string,
    readonly accountId: string,
    readonly databaseId: string,
  ) {}

  static parse(raw: unknown): NamespaceD1HomeV1 {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('namespace' in raw) ||
      !('accountId' in raw) ||
      !('databaseId' in raw) ||
      Object.keys(raw).length !== 3
    ) {
      throw new TenantDeploymentStoreError('invalid_input', 'namespace D1 home is invalid');
    }
    const namespace = parseNamespace(raw.namespace);
    if (typeof raw.accountId !== 'string' || !/^[a-f0-9]{32}$/u.test(raw.accountId)) {
      throw new TenantDeploymentStoreError('invalid_input', 'D1 account ID is invalid');
    }
    if (
      typeof raw.databaseId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(raw.databaseId)
    ) {
      throw new TenantDeploymentStoreError('invalid_input', 'D1 database ID is invalid');
    }
    const home = new NamespaceD1HomeV1(namespace, raw.accountId, raw.databaseId);
    Object.freeze(home);
    return home;
  }

  matches(other: NamespaceD1HomeV1): boolean {
    return (
      this.#validated &&
      other.#validated &&
      this.namespace === other.namespace &&
      this.accountId === other.accountId &&
      this.databaseId === other.databaseId
    );
  }
}

export type NamespaceD1HomeAssignmentV1 = {
  readonly home: NamespaceD1HomeV1;
  readonly assignedAtMs: number;
};

export type ReserveNamespaceD1HomeResultV1 =
  | {
      readonly ok: true;
      readonly disposition: 'reserved' | 'reused';
      readonly assignment: NamespaceD1HomeAssignmentV1;
      readonly code?: never;
    }
  | {
      readonly ok: false;
      readonly code: 'namespace_home_conflict';
      readonly assignment: NamespaceD1HomeAssignmentV1;
      readonly disposition?: never;
    };

export interface NamespaceD1HomeStoreV1 {
  reserveNamespaceHome(home: NamespaceD1HomeV1): Promise<ReserveNamespaceD1HomeResultV1>;
  findNamespaceHome(namespace: string): Promise<NamespaceD1HomeAssignmentV1 | null>;
}

function parseNamespace(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.trim() !== raw) {
    throw new TenantDeploymentStoreError('invalid_input', 'namespace is invalid');
  }
  return raw;
}

export async function readNamespaceD1Home(
  database: D1DatabaseLike,
  rawNamespace: string,
): Promise<NamespaceD1HomeAssignmentV1 | null> {
  const namespace = parseNamespace(rawNamespace);
  const row = await queryD1One(
    database,
    `SELECT namespace, account_id, database_id, assigned_at_ms
     FROM namespace_d1_homes WHERE namespace = ?1`,
    [namespace],
  );
  if (!row) return null;
  try {
    const home = NamespaceD1HomeV1.parse({
      namespace: row.namespace,
      accountId: row.account_id,
      databaseId: row.database_id,
    });
    const assignedAtMs = row.assigned_at_ms;
    if (
      typeof assignedAtMs !== 'number' ||
      !Number.isSafeInteger(assignedAtMs) ||
      assignedAtMs <= 0
    ) {
      throw new Error('assignment timestamp is invalid');
    }
    return Object.freeze({ home, assignedAtMs });
  } catch {
    throw new TenantDeploymentStoreError('invalid_record', 'stored namespace D1 home is invalid');
  }
}

export async function reserveNamespaceD1Home(
  database: D1DatabaseLike,
  home: NamespaceD1HomeV1,
  now: Date,
): Promise<ReserveNamespaceD1HomeResultV1> {
  const assignedAtMs = now.getTime();
  if (!Number.isSafeInteger(assignedAtMs) || assignedAtMs <= 0) {
    throw new TenantDeploymentStoreError('invalid_input', 'assignment timestamp is invalid');
  }
  // The insert and absence check are one D1 statement, shared by every provisioning lane.
  const result = await database
    .prepare(
      `INSERT INTO namespace_d1_homes (namespace, account_id, database_id, assigned_at_ms)
       SELECT ?1, ?2, ?3, ?4
       WHERE NOT EXISTS (SELECT 1 FROM namespace_d1_homes WHERE namespace = ?1)`,
    )
    .bind(home.namespace, home.accountId, home.databaseId, assignedAtMs)
    .run();
  const assignment = await readNamespaceD1Home(database, home.namespace);
  if (!assignment) {
    throw new TenantDeploymentStoreError('invalid_record', 'namespace D1 home was not persisted');
  }
  if (!assignment.home.matches(home)) {
    return { ok: false, code: 'namespace_home_conflict', assignment };
  }
  return {
    ok: true,
    disposition: d1ChangedRows(result) === 1 ? 'reserved' : 'reused',
    assignment,
  };
}
