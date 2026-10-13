import {
  PlatformScopeV1,
  type BillingChargeAttributionV1,
  type PlatformMeterIdV1,
} from '@seams-internal/console-shared/accountPlatform';
import { integer, textValue } from '@seams-internal/console-shared/accountPlatform/boundary';
import { queryD1All, type D1DatabaseLike, type D1Row } from '../boundary/d1';

interface BillingUsageChargeBaseV1 {
  readonly ledgerEntryId: string;
  readonly amountMinor: number;
  readonly occurredAt: string;
}

export type BillingUsageChargeV1 = BillingUsageChargeBaseV1 &
  (
    | {
        readonly kind: 'instance';
        readonly attribution: Extract<BillingChargeAttributionV1, { readonly kind: 'instance' }>;
        readonly meterId: PlatformMeterIdV1;
        readonly priceVersion: string;
        readonly quantity: number;
        readonly unit: 'resource_month' | 'execution' | 'turn';
      }
    | {
        readonly kind: 'historical_organization';
        readonly attribution: Extract<
          BillingChargeAttributionV1,
          { readonly kind: 'historical_organization' }
        >;
        readonly meterId?: never;
        readonly priceVersion?: never;
        readonly quantity?: never;
        readonly unit?: never;
      }
  );

function meterId(input: unknown): PlatformMeterIdV1 {
  switch (input) {
    case 'wallet.monthly_active_resource':
    case 'wallet.execution':
    case 'satyr.completed_turn.test':
      return input;
    default:
      throw new Error('Invalid persisted billing meter');
  }
}

function serviceId(input: unknown): 'wallet' | 'satyr' {
  switch (input) {
    case 'wallet':
    case 'satyr':
      return input;
    default:
      throw new Error('Invalid persisted billing service');
  }
}

function unit(input: unknown): 'resource_month' | 'execution' | 'turn' {
  switch (input) {
    case 'resource_month':
    case 'execution':
    case 'turn':
      return input;
    default:
      throw new Error('Invalid persisted billing unit');
  }
}

function parseCharge(row: D1Row): BillingUsageChargeV1 {
  const ledgerEntryId = textValue(row.ledger_entry_id, 'ledger_entry_id');
  const amountMinor = integer(row.amount_minor, 'amount_minor', 1);
  const occurredAt = new Date(integer(row.occurred_at_ms, 'occurred_at_ms', 0)).toISOString();
  const namespace = textValue(row.namespace, 'namespace');
  const organizationId = textValue(row.org_id, 'org_id');
  const billingAccountId = textValue(row.billing_account_id, 'billing_account_id');
  if (row.instance_id === null) {
    return {
      kind: 'historical_organization',
      ledgerEntryId,
      amountMinor,
      occurredAt,
      attribution: { kind: 'historical_organization', namespace, organizationId, billingAccountId },
    };
  }
  const scope = PlatformScopeV1.parse({
    namespace,
    organizationId,
    projectId: row.project_id,
    billingAccountId,
  });
  if (scope.kind === 'rejected') throw new Error('Invalid persisted charge scope');
  return {
    kind: 'instance',
    ledgerEntryId,
    amountMinor,
    occurredAt,
    attribution: {
      kind: 'instance',
      scope: scope.value,
      serviceId: serviceId(row.service_id),
      instanceId: textValue(row.instance_id, 'instance_id'),
    },
    meterId: meterId(row.meter_id),
    priceVersion: textValue(row.price_version, 'price_version'),
    quantity: integer(row.quantity, 'quantity', 1),
    unit: unit(row.unit),
  };
}

export async function listD1BillingUsageCharges(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly organizationId: string;
  readonly periodMonthUtc: string;
}): Promise<readonly BillingUsageChargeV1[]> {
  const rows = await queryD1All(
    input.database,
    `SELECT l.namespace, l.id AS ledger_entry_id, l.org_id,
    -l.amount_minor AS amount_minor, l.created_at_ms AS occurred_at_ms, p.id AS billing_account_id,
    a.project_id, a.instance_id, a.service_id, a.meter_id, a.price_version, a.quantity, a.unit
    FROM billing_ledger_entries l
    JOIN organization_billing_accounts p ON p.namespace = l.namespace AND p.org_id = l.org_id
    LEFT JOIN billing_charge_attributions a ON a.namespace = l.namespace AND a.ledger_entry_id = l.id
    WHERE l.namespace = ? AND l.org_id = ? AND l.month_utc = ? AND l.amount_minor < 0
      AND l.entry_type IN ('USAGE_DEBIT', 'PRODUCT_EXECUTION_DEBIT')
    ORDER BY l.created_at_ms, l.id`,
    [input.namespace, input.organizationId, input.periodMonthUtc],
  );
  return rows.map(parseCharge);
}
