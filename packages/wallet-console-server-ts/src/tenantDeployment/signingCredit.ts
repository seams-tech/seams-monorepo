import { queryD1One, type D1DatabaseLike } from '@seams-internal/console-server/boundary/d1';
import type { SigningCreditPolicy } from '@seams-internal/console-server/billing/signingCredit';

export function parseSigningCredit(raw: unknown): SigningCreditPolicy {
  // Older request envelopes carry included usage. They cannot clear an installed credit policy.
  if (raw === undefined) return { kind: 'included' };
  if (!raw || typeof raw !== 'object' || !('kind' in raw))
    throw new Error('Missing signing credit policy');
  if (raw.kind === 'included' || raw.kind === 'blocked') return { kind: raw.kind };
  if (raw.kind !== 'credit' || !('grant' in raw) || !raw.grant || typeof raw.grant !== 'object')
    throw new Error('Invalid signing credit policy');
  const grant = raw.grant;
  if (
    !('id' in grant) ||
    typeof grant.id !== 'string' ||
    !grant.id ||
    !('capacity' in grant) ||
    typeof grant.capacity !== 'number' ||
    !Number.isSafeInteger(grant.capacity) ||
    grant.capacity <= 0 ||
    !('expiresAtMs' in grant) ||
    typeof grant.expiresAtMs !== 'number' ||
    !Number.isSafeInteger(grant.expiresAtMs) ||
    grant.expiresAtMs <= 0
  )
    throw new Error('Invalid signing credit grant');
  return {
    kind: 'credit',
    grant: { id: grant.id, capacity: grant.capacity, expiresAtMs: grant.expiresAtMs },
  };
}
export async function installSigningCredit(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly credit: SigningCreditPolicy;
  readonly retire: readonly string[];
}): Promise<readonly { readonly id: string; readonly admittedCount: number }[]> {
  if (input.credit.kind === 'included') {
    const schema = await queryD1One(
      input.database,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='wallet_signing_credit_policies'",
      [],
    );
    if (!schema) return [];
  }
  const statements = [];
  if (input.credit.kind === 'credit') {
    const grant = input.credit.grant;
    statements.push(
      input.database
        .prepare(
          `INSERT INTO wallet_signing_credit_grants(namespace,tenant_id,grant_id,project_id,env_id,capacity,expires_at_ms)
      VALUES(?,?,?,?,'prod',?,?) ON CONFLICT DO NOTHING`,
        )
        .bind(
          input.namespace,
          input.orgId,
          grant.id,
          input.projectId,
          grant.capacity,
          grant.expiresAtMs,
        ),
    );
  }
  for (const id of input.retire)
    statements.push(
      input.database
        .prepare(
          `UPDATE wallet_signing_credit_grants SET sealed=1 WHERE namespace=? AND tenant_id=? AND grant_id=?
    AND NOT EXISTS(SELECT 1 FROM wallet_signing_credit_policies WHERE namespace=? AND tenant_id=? AND project_id=? AND env_id='prod' AND revision>?)`,
        )
        .bind(
          input.namespace,
          input.orgId,
          id,
          input.namespace,
          input.orgId,
          input.projectId,
          input.revision,
        ),
    );
  statements.push(
    input.database
      .prepare(
        `INSERT INTO wallet_signing_credit_policies(namespace,tenant_id,project_id,env_id,mode,grant_id,revision)
    VALUES(?,?,?,'prod',?,?,?) ON CONFLICT(namespace,tenant_id,project_id,env_id) DO UPDATE SET mode=excluded.mode,grant_id=excluded.grant_id,revision=excluded.revision
    WHERE excluded.revision>=wallet_signing_credit_policies.revision`,
      )
      .bind(
        input.namespace,
        input.orgId,
        input.projectId,
        input.credit.kind,
        input.credit.kind === 'credit' ? input.credit.grant.id : null,
        input.revision,
      ),
  );
  await input.database.batch(statements);
  const retired = [];
  for (const id of input.retire) {
    const row = await queryD1One(
      input.database,
      'SELECT admitted_count,sealed FROM wallet_signing_credit_grants WHERE namespace=? AND tenant_id=? AND grant_id=?',
      [input.namespace, input.orgId, id],
    );
    if (row?.sealed === 1 && typeof row.admitted_count === 'number')
      retired.push({ id, admittedCount: row.admitted_count });
  }
  return retired;
}
