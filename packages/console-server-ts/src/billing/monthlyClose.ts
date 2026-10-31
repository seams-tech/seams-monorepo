import { integer } from '@seams-internal/console-shared/accountPlatform/boundary';
import { queryD1One, type D1DatabaseLike } from '../boundary/d1';
import { ConsoleBillingError } from './errors';

export interface MonthlyCloseInput {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly orgId: string;
  readonly monthUtc: string;
  readonly nowMs: number;
}

/** Freeze eligible ledger entries once. Late delivery remains unassigned for the next close. */
export async function closePostpaidMonth(input: MonthlyCloseInput): Promise<void> {
  const monthEnd = Date.parse(`${input.monthUtc}-01T00:00:00.000Z`);
  const end = new Date(monthEnd);
  end.setUTCMonth(end.getUTCMonth() + 1);
  if (!Number.isFinite(monthEnd) || input.nowMs < end.getTime() + 3600000) {
    throw new ConsoleBillingError(
      'billing_close_early',
      409,
      'Monthly close starts at 01:00 UTC after the month ends',
    );
  }
  const bindings = [input.namespace, input.orgId, input.monthUtc];
  await input.database.batch([
    input.database
      .prepare(
        `INSERT INTO billing_monthly_closes(namespace,org_id,month_utc,cutoff_ms,status)
      VALUES(?,?,?,?,'building') ON CONFLICT DO NOTHING`,
      )
      .bind(...bindings, input.nowMs),
    input.database
      .prepare(
        `UPDATE billing_monthly_closes SET amount_minor=COALESCE((SELECT SUM(-l.amount_minor)
      FROM billing_ledger_entries l WHERE l.namespace=billing_monthly_closes.namespace AND l.org_id=billing_monthly_closes.org_id
        AND l.payment_model='postpaid' AND l.entry_type IN ('PRODUCT_EXECUTION_DEBIT','PLAN_BASE_CHARGE','PLAN_USAGE_CHARGE','MANUAL_ADJUSTMENT')
        AND l.month_utc<=billing_monthly_closes.month_utc AND l.ingested_at_ms<=billing_monthly_closes.cutoff_ms
        AND NOT EXISTS(SELECT 1 FROM billing_monthly_invoice_items i WHERE i.namespace=l.namespace AND i.org_id=l.org_id AND i.ledger_entry_id=l.id)),0)
      WHERE namespace=? AND org_id=? AND month_utc=? AND status='building'`,
      )
      .bind(...bindings),
    input.database
      .prepare(
        `INSERT INTO billing_monthly_invoice_items(namespace,org_id,month_utc,ledger_entry_id,amount_minor,description,usage_month_utc)
      SELECT l.namespace,l.org_id,c.month_utc,l.id,-l.amount_minor,l.description,l.month_utc
      FROM billing_ledger_entries l JOIN billing_monthly_closes c ON c.namespace=l.namespace AND c.org_id=l.org_id
      WHERE c.namespace=? AND c.org_id=? AND c.month_utc=? AND c.status='building' AND c.amount_minor>=50
        AND l.payment_model='postpaid' AND l.entry_type IN ('PRODUCT_EXECUTION_DEBIT','PLAN_BASE_CHARGE','PLAN_USAGE_CHARGE','MANUAL_ADJUSTMENT')
        AND l.month_utc<=c.month_utc AND l.ingested_at_ms<=c.cutoff_ms
        AND NOT EXISTS(SELECT 1 FROM billing_monthly_invoice_items i WHERE i.namespace=l.namespace AND i.org_id=l.org_id AND i.ledger_entry_id=l.id)`,
      )
      .bind(...bindings),
    input.database
      .prepare(
        `UPDATE billing_ledger_entries SET related_invoice_id='monthly:'||org_id||':'||?
      WHERE namespace=? AND org_id=? AND payment_model='postpaid'
        AND EXISTS(SELECT 1 FROM billing_monthly_invoice_items i JOIN billing_monthly_closes c USING(namespace,org_id,month_utc)
          WHERE i.namespace=billing_ledger_entries.namespace AND i.org_id=billing_ledger_entries.org_id AND i.ledger_entry_id=billing_ledger_entries.id AND c.month_utc=? AND c.status='building')`,
      )
      .bind(input.monthUtc, input.namespace, input.orgId, input.monthUtc),
    input.database
      .prepare(
        `UPDATE billing_monthly_closes SET status=CASE WHEN amount_minor=0 THEN 'zero' WHEN amount_minor<50 THEN 'carried' ELSE 'collectible' END
      WHERE namespace=? AND org_id=? AND month_utc=? AND status='building'`,
      )
      .bind(...bindings),
  ]);
}

export type MonthlyCloseSnapshot =
  | { readonly kind: 'zero'; readonly amountMinor: 0; readonly cutoffMs: number }
  | {
      readonly kind: 'carried' | 'collectible';
      readonly amountMinor: number;
      readonly cutoffMs: number;
    };

export async function loadPostpaidClose(
  input: MonthlyCloseInput,
): Promise<MonthlyCloseSnapshot | null> {
  const row = await queryD1One(
    input.database,
    'SELECT amount_minor,cutoff_ms,status FROM billing_monthly_closes WHERE namespace=? AND org_id=? AND month_utc=?',
    [input.namespace, input.orgId, input.monthUtc],
  );
  if (!row) return null;
  const amountMinor = integer(row.amount_minor, 'monthly close amount', Number.MIN_SAFE_INTEGER);
  const cutoffMs = integer(row.cutoff_ms, 'monthly close cutoff', 1);
  switch (row.status) {
    case 'zero':
      if (amountMinor === 0) return { kind: 'zero', amountMinor: 0, cutoffMs };
      break;
    case 'carried':
      if (amountMinor !== 0 && amountMinor < 50) return { kind: 'carried', amountMinor, cutoffMs };
      break;
    case 'collectible':
      if (amountMinor >= 50) return { kind: 'collectible', amountMinor, cutoffMs };
      break;
  }
  throw new ConsoleBillingError(
    'billing_close_invalid',
    500,
    'Stored monthly close is not a sealed valid snapshot',
  );
}
