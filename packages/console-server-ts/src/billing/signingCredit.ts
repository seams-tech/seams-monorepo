import { integer, textValue } from '@seams-internal/console-shared/accountPlatform/boundary';
import { secureRandomBase36 } from '../boundary';
import { queryD1All, queryD1One, type D1DatabaseLike } from '../boundary/d1';
import { readBillingPaymentPolicy } from './postpaid';

export type SigningCreditPolicy =
  | { readonly kind: 'included'; readonly grant?: never }
  | { readonly kind: 'blocked'; readonly grant?: never }
  | {
      readonly kind: 'credit';
      readonly grant: {
        readonly id: string;
        readonly capacity: number;
        readonly expiresAtMs: number;
      };
    };

export interface SigningCreditTarget {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly deploymentLane: string;
  readonly region: string;
  readonly nowMs: number;
}

export async function signingCreditForRegion(
  input: SigningCreditTarget,
): Promise<{ readonly policy: SigningCreditPolicy; readonly retire: readonly string[] }> {
  const policy = await readBillingPaymentPolicy(input.database, input.namespace, input.orgId);
  if (policy.kind === 'prepaid') return { policy: { kind: 'included' }, retire: [] };
  const grants = await queryD1All(
    input.database,
    `SELECT * FROM billing_signing_credit_grants WHERE namespace=? AND org_id=? AND deployment_lane=? AND region=? AND sealed=0 ORDER BY created_at_ms DESC`,
    [input.namespace, input.orgId, input.deploymentLane, input.region],
  );
  const exposure = await queryD1One(
    input.database,
    `SELECT e.*,p.plan,p.price_version,p.downgrade_at_ms,
    EXISTS(SELECT 1 FROM billing_payment_methods m WHERE m.namespace=e.namespace AND m.org_id=e.org_id AND status='usable'
      AND m.exp_year*12+m.exp_month-1>=?) AS card_ready
    FROM billing_postpaid_exposure e JOIN billing_account_plans p USING(namespace,org_id) WHERE e.namespace=? AND e.org_id=?`,
    [
      new Date(input.nowMs).getUTCFullYear() * 12 + new Date(input.nowMs).getUTCMonth(),
      input.namespace,
      input.orgId,
    ],
  );
  if (exposure?.plan === 'free') {
    const retire = grants.map(signingGrantId);
    return { policy: { kind: 'included' }, retire };
  }
  if (!exposure || (exposure.plan !== 'growth' && exposure.plan !== 'pro'))
    return { policy: { kind: 'blocked' }, retire: grants.map(signingGrantId) };
  const plan = exposure.plan;
  const priceVersion = textValue(exposure.price_version, 'plan price version');
  const retire: string[] = [];
  let active: SigningCreditPolicy | null = null;
  const blocked =
    policy.creditLimitMinor <= 0 ||
    exposure.card_ready !== 1 ||
    exposure.collection_blocked === 1 ||
    (exposure.first_failed_at_ms !== null &&
      Number(exposure.first_failed_at_ms) + 604800000 <= input.nowMs) ||
    (exposure.downgrade_at_ms !== null && Number(exposure.downgrade_at_ms) <= input.nowMs);
  for (const grant of grants) {
    const id = textValue(grant.id, 'signing grant');
    if (
      blocked ||
      Number(grant.expires_at_ms) <= input.nowMs ||
      Number(grant.settled_count) >= Number(grant.capacity)
    )
      retire.push(id);
    else if (active === null)
      active = {
        kind: 'credit',
        grant: {
          id,
          capacity: integer(grant.capacity, 'grant capacity', 1),
          expiresAtMs: integer(grant.expires_at_ms, 'grant expiry', 1),
        },
      };
  }
  if (blocked) return { policy: { kind: 'blocked' }, retire };
  if (active) return { policy: active, retire };
  const available =
    Number(exposure.credit_limit_minor) -
    Number(exposure.unpaid_minor) -
    Number(exposure.reserved_minor);
  // One cent bounds the largest marginal self-serve signature charge. The other regions keep a share.
  const capacity = Math.min(1000, Math.floor(available / 4));
  if (capacity < 1) return { policy: { kind: 'blocked' }, retire };
  const date = new Date(input.nowMs);
  const graceEnd =
    exposure.first_failed_at_ms === null
      ? Number.MAX_SAFE_INTEGER
      : Number(exposure.first_failed_at_ms) + 604800000;
  const expiresAtMs = Math.min(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
    input.nowMs + 3600000,
    graceEnd,
  );
  const id = `signing-credit:${secureRandomBase36(24, 'signing credit grant')}`;
  await input.database
    .prepare(
      `INSERT INTO billing_signing_credit_grants(namespace,org_id,id,project_id,environment_id,deployment_lane,region,capacity,expires_at_ms,created_at_ms,plan,price_version)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM billing_postpaid_exposure e WHERE e.namespace=? AND e.org_id=? AND e.credit_limit_minor-e.unpaid_minor-e.reserved_minor>=?)
    AND NOT EXISTS(SELECT 1 FROM billing_signing_credit_grants WHERE namespace=? AND org_id=? AND deployment_lane=? AND region=? AND sealed=0 AND expires_at_ms>? AND settled_count<capacity)`,
    )
    .bind(
      input.namespace,
      input.orgId,
      id,
      input.projectId,
      input.environmentId,
      input.deploymentLane,
      input.region,
      capacity,
      expiresAtMs,
      input.nowMs,
      plan,
      priceVersion,
      input.namespace,
      input.orgId,
      capacity,
      input.namespace,
      input.orgId,
      input.deploymentLane,
      input.region,
      input.nowMs,
    )
    .run();
  const stored = await queryD1One(
    input.database,
    `SELECT * FROM billing_signing_credit_grants WHERE namespace=? AND org_id=? AND deployment_lane=? AND region=? AND sealed=0 AND expires_at_ms>? AND settled_count<capacity ORDER BY created_at_ms DESC LIMIT 1`,
    [input.namespace, input.orgId, input.deploymentLane, input.region, input.nowMs],
  );
  if (!stored) return { policy: { kind: 'blocked' }, retire };
  return {
    policy: {
      kind: 'credit',
      grant: {
        id: textValue(stored.id, 'grant id'),
        capacity: integer(stored.capacity, 'capacity', 1),
        expiresAtMs: integer(stored.expires_at_ms, 'expiry', 1),
      },
    },
    retire,
  };
}

export async function sealSigningCredit(
  input: SigningCreditTarget,
  id: string,
  admittedCount: number,
): Promise<void> {
  const result = await input.database
    .prepare(
      `UPDATE billing_signing_credit_grants SET sealed=1,admitted_count=?
    WHERE namespace=? AND org_id=? AND deployment_lane=? AND region=? AND id=? AND capacity>=? AND settled_count<=?
      AND (sealed=0 OR admitted_count=?) RETURNING id`,
    )
    .bind(
      admittedCount,
      input.namespace,
      input.orgId,
      input.deploymentLane,
      input.region,
      id,
      admittedCount,
      admittedCount,
      admittedCount,
    )
    .first<{ id: unknown }>();
  if (result?.id !== id)
    throw new Error('Signing credit retirement does not match the recorded grant');
}

function signingGrantId(row: import('../boundary/d1').D1Row): string {
  return textValue(row.id, 'signing grant id');
}
