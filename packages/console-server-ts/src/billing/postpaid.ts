import {
  integer,
  textValue,
  object,
  exactKeys,
} from '@seams-internal/console-shared/accountPlatform/boundary';
import { queryD1One, queryD1All, d1ChangedRows, type D1DatabaseLike } from '../boundary/d1';
import { ConsoleBillingError } from './errors';
import type { ConsoleBillingD1Runtime } from './d1';

export type BillingPaymentPolicy =
  | {
      readonly kind: 'prepaid';
      readonly creditLimitMinor?: never;
      readonly approvedBy?: never;
      readonly approvedAtMs?: never;
    }
  | {
      readonly kind: 'postpaid';
      readonly creditLimitMinor: number;
      readonly approvedBy: string;
      readonly approvedAtMs: number;
    };

export class CreditLimitApproval {
  private constructor(
    readonly orgId: string,
    readonly creditLimitMinor: number,
    readonly reason: string,
    readonly operationId: string,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): CreditLimitApproval {
    try {
      const row = object(input, 'credit limit approval');
      exactKeys(row, ['orgId', 'creditLimitMinor', 'reason', 'operationId']);
      return new CreditLimitApproval(
        textValue(row.orgId, 'orgId'),
        integer(row.creditLimitMinor, 'creditLimitMinor', 0),
        textValue(row.reason, 'reason'),
        textValue(row.operationId, 'operationId'),
      );
    } catch (error: unknown) {
      throw new ConsoleBillingError(
        'invalid_credit_approval',
        400,
        error instanceof Error ? error.message : 'Credit approval is invalid',
      );
    }
  }
}

export async function readBillingPaymentPolicy(
  database: D1DatabaseLike,
  namespace: string,
  orgId: string,
): Promise<BillingPaymentPolicy> {
  const row = await queryD1One(
    database,
    'SELECT * FROM billing_payment_policies WHERE namespace=? AND org_id=?',
    [namespace, orgId],
  );
  if (!row)
    throw new ConsoleBillingError(
      'billing_account_missing',
      409,
      'The organization has no billing account',
    );
  switch (row.payment_model) {
    case 'prepaid':
      return { kind: 'prepaid' };
    case 'postpaid':
      return {
        kind: 'postpaid',
        creditLimitMinor: integer(row.credit_limit_minor, 'credit limit', 0),
        approvedBy: textValue(row.approved_by, 'approved by'),
        approvedAtMs: integer(row.approved_at_ms, 'approval time', 1),
      };
    default:
      throw new Error('Invalid stored payment model');
  }
}

export async function approveCreditLimit(
  runtime: ConsoleBillingD1Runtime,
  actor: { readonly userId: string; readonly platformSupport: true },
  approval: CreditLimitApproval,
): Promise<BillingPaymentPolicy> {
  const current = await readBillingPaymentPolicy(
    runtime.database,
    runtime.namespace,
    approval.orgId,
  );
  if (current.kind === 'prepaid') {
    const plan = await queryD1One(
      runtime.database,
      'SELECT plan FROM billing_account_plans WHERE namespace=? AND org_id=?',
      [runtime.namespace, approval.orgId],
    );
    if (plan?.plan === 'enterprise')
      throw new ConsoleBillingError(
        'postpaid_contract_required',
        409,
        'Enterprise postpaid billing requires configured contract pricing',
      );
  }
  const nowMs = runtime.now().getTime();
  try {
    await runtime.database.batch([
      runtime.database
        .prepare(
          `INSERT INTO billing_credit_limit_changes(namespace,org_id,operation_id,credit_limit_minor,actor_user_id,reason,created_at_ms)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(namespace,operation_id) DO NOTHING`,
        )
        .bind(
          runtime.namespace,
          approval.orgId,
          approval.operationId,
          approval.creditLimitMinor,
          actor.userId,
          approval.reason,
          nowMs,
        ),
      runtime.database
        .prepare(
          `UPDATE billing_payment_policies SET payment_model='postpaid', credit_limit_minor=?, approved_by=?, approved_at_ms=?
        WHERE namespace=? AND org_id=? AND changes()=1`,
        )
        .bind(approval.creditLimitMinor, actor.userId, nowMs, runtime.namespace, approval.orgId),
    ]);
  } catch (error) {
    if (String(error).includes('postpaid_conversion_ineligible'))
      throw new ConsoleBillingError(
        'postpaid_conversion_ineligible',
        409,
        'Postpaid needs a usable card, positive credit, zero prepaid balance, and no unsettled obligations',
      );
    throw error;
  }
  const change = await queryD1One(
    runtime.database,
    'SELECT * FROM billing_credit_limit_changes WHERE namespace=? AND operation_id=?',
    [runtime.namespace, approval.operationId],
  );
  if (
    !change ||
    change.org_id !== approval.orgId ||
    change.credit_limit_minor !== approval.creditLimitMinor ||
    change.actor_user_id !== actor.userId ||
    change.reason !== approval.reason
  ) {
    throw new ConsoleBillingError(
      'credit_approval_conflict',
      409,
      'The approval operation already has different values',
    );
  }
  return readBillingPaymentPolicy(runtime.database, runtime.namespace, approval.orgId);
}

export async function getPostpaidAccount(runtime: ConsoleBillingD1Runtime, orgId: string) {
  const policy = await readBillingPaymentPolicy(runtime.database, runtime.namespace, orgId);
  if (policy.kind === 'prepaid') return { policy, exposure: null, invoices: [] };
  const exposure = await queryD1One(
    runtime.database,
    'SELECT * FROM billing_postpaid_exposure WHERE namespace=? AND org_id=?',
    [runtime.namespace, orgId],
  );
  if (!exposure) throw new Error('Postpaid exposure is missing');
  const unpaidMinor = integer(exposure.unpaid_minor, 'unpaid amount', Number.MIN_SAFE_INTEGER);
  const reservedMinor = integer(exposure.reserved_minor, 'reserved amount', 0);
  const invoices = await queryD1All(
    runtime.database,
    `SELECT c.month_utc, c.amount_minor, c.status AS close_status, p.status, p.provider_invoice_ref, p.hosted_invoice_url, p.first_failed_at_ms
    FROM billing_monthly_closes c LEFT JOIN billing_monthly_collections p USING(namespace,org_id,month_utc)
    WHERE c.namespace=? AND c.org_id=? ORDER BY c.month_utc DESC`,
    [runtime.namespace, orgId],
  );
  return {
    policy,
    exposure: {
      unpaidMinor,
      reservedMinor,
      availableCreditMinor: policy.creditLimitMinor - unpaidMinor - reservedMinor,
      graceDeadlineAt:
        exposure.first_failed_at_ms === null
          ? null
          : new Date(Number(exposure.first_failed_at_ms) + 604800000).toISOString(),
      collectionBlocked: exposure.collection_blocked === 1,
    },
    invoices: invoices.map(parseMonthlyInvoiceView),
  };
}

/** A downgrade preserves the card clock, charges, and payment model. It starts next UTC month. */
export async function requestFreeDowngrade(
  runtime: ConsoleBillingD1Runtime,
  orgId: string,
): Promise<void> {
  const nowMs = runtime.now().getTime();
  const month = runtime.now().toISOString().slice(0, 7);
  const result = await runtime.database
    .prepare(
      `UPDATE billing_account_plans SET downgrade_at_ms=COALESCE(downgrade_at_ms,?), evaluation_due_at_ms=0
    WHERE namespace=? AND org_id=? AND plan IN ('growth','pro')
      AND COALESCE((SELECT production_active_users FROM billing_plan_usage_months u WHERE u.namespace=billing_account_plans.namespace AND u.org_id=billing_account_plans.org_id AND month_utc=?),0) < 300
      AND COALESCE((SELECT production_signatures FROM billing_plan_usage_months u WHERE u.namespace=billing_account_plans.namespace AND u.org_id=billing_account_plans.org_id AND month_utc=?),0) < 30000
      AND NOT EXISTS(SELECT 1 FROM billing_funds_reservations r WHERE r.namespace=billing_account_plans.namespace AND r.org_id=billing_account_plans.org_id AND status IN ('reserved','indeterminate'))
      AND NOT EXISTS(SELECT 1 FROM billing_monthly_collections c WHERE c.namespace=billing_account_plans.namespace AND c.org_id=billing_account_plans.org_id AND status<>'paid')`,
    )
    .bind(
      Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth() + 1, 1),
      runtime.namespace,
      orgId,
      month,
      month,
    )
    .run();
  if (d1ChangedRows(result) !== 1)
    throw new ConsoleBillingError(
      'free_downgrade_ineligible',
      409,
      'Free requires usage below both Free limits, no execution commitments, and no unpaid invoices',
    );
}

export async function applyFreeDowngrade(
  database: D1DatabaseLike,
  namespace: string,
  orgId: string,
  nowMs: number,
): Promise<void> {
  await database
    .prepare(
      `UPDATE billing_account_plans SET plan='free',plan_started_at_ms=NULL,price_version=NULL,downgrade_at_ms=NULL,evaluation_due_at_ms=0,updated_at_ms=?
    WHERE namespace=? AND org_id=? AND downgrade_at_ms<=?
    AND NOT EXISTS(SELECT 1 FROM billing_plan_usage_months u WHERE u.namespace=billing_account_plans.namespace AND u.org_id=billing_account_plans.org_id
      AND u.month_utc>=strftime('%Y-%m',?/1000,'unixepoch','start of month','-1 month') AND (u.production_active_users>=300 OR u.production_signatures>=30000))
    AND NOT EXISTS(SELECT 1 FROM billing_funds_reservations r WHERE r.namespace=billing_account_plans.namespace AND r.org_id=billing_account_plans.org_id AND status IN ('reserved','indeterminate'))
    AND NOT EXISTS(SELECT 1 FROM billing_signing_credit_grants g WHERE g.namespace=billing_account_plans.namespace AND g.org_id=billing_account_plans.org_id AND CASE g.sealed WHEN 1 THEN g.admitted_count ELSE g.capacity END>g.settled_count)
    AND NOT EXISTS(SELECT 1 FROM billing_monthly_collections c WHERE c.namespace=billing_account_plans.namespace AND c.org_id=billing_account_plans.org_id AND status<>'paid')`,
    )
    .bind(nowMs, namespace, orgId, nowMs, nowMs)
    .run();
}

function parseMonthlyInvoiceView(row: import('../boundary/d1').D1Row) {
  const monthUtc = textValue(row.month_utc, 'invoice month');
  const amountMinor = integer(row.amount_minor, 'invoice amount', Number.MIN_SAFE_INTEGER);
  const closeStatus = row.close_status;
  if (closeStatus === 'zero' || closeStatus === 'carried')
    return { kind: closeStatus, monthUtc, amountMinor, invoiceId: null, hostedInvoiceUrl: null };
  if (closeStatus !== 'collectible') throw new Error('Invalid monthly close state');
  const status = row.status;
  if (status === null || status === 'creating')
    return {
      kind: 'pending' as const,
      monthUtc,
      amountMinor,
      invoiceId: null,
      hostedInvoiceUrl: null,
    };
  if (
    status !== 'draft' &&
    status !== 'open' &&
    status !== 'paid' &&
    status !== 'void' &&
    status !== 'uncollectible'
  )
    throw new Error('Invalid invoice collection state');
  const invoiceId = textValue(row.provider_invoice_ref, 'Stripe invoice');
  const hostedInvoiceUrl =
    row.hosted_invoice_url === null
      ? null
      : textValue(row.hosted_invoice_url, 'Stripe invoice URL');
  return { kind: status, monthUtc, amountMinor, invoiceId, hostedInvoiceUrl };
}
