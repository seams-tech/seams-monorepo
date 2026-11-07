import type {
  PlatformPriceV1,
  PlatformScopeV1,
} from '@seams-internal/console-shared/accountPlatform';
import { queryD1One, type D1DatabaseLike, type D1PreparedStatementLike } from '../boundary/d1';
import {
  contractResult,
  digestValue,
  exactKeys,
  integer,
  object,
  textValue,
  utcTimestamp,
  versionOne,
  invalidContract,
  type PlatformContractError,
  type PlatformResult,
} from '@seams-internal/console-shared/accountPlatform/boundary';

export const WALLET_MONTHLY_ACTIVE_RESOURCE_PRICE_V1 = Object.freeze({
  kind: 'fixed_measured',
  meterId: 'wallet.monthly_active_resource',
  version: 'wallet-monthly-active-resource-v1',
  currency: 'USD',
  unitMinor: 300,
  timeRule: 'occurred_at_utc_month',
  availability: 'customer_accounts',
} as const satisfies PlatformPriceV1);

export const SATYR_COMPLETED_TURN_TEST_PRICE_V1 = Object.freeze({
  kind: 'fixed_measured',
  meterId: 'satyr.completed_turn.test',
  version: 'satyr-completed-turn-test-v1',
  currency: 'USD',
  unitMinor: 1,
  timeRule: 'terminal_accepted_at',
  availability: 'isolated_test_accounts',
} as const satisfies PlatformPriceV1);

/** Plan 88 D9: two times the TypeSafe cost, after $1.00 of TypeSafe cost each UTC month. */
export const SATYR_JEV_INPUT_TOKENS_PRICE_V1 = Object.freeze({
  kind: 'block_measured',
  meterId: 'satyr.jev_input_tokens',
  version: 'satyr-jev-input-tokens-v1',
  currency: 'USD',
  blockMinor: 84,
  blockUnits: 10_000_000,
  includedUnits: 23_809_523,
  timeRule: 'hour_start_utc_month',
  availability: 'isolated_test_accounts',
} as const satisfies PlatformPriceV1);

/** The month's charge comes from the month's total, rounded up to whole cents once. */
export function blockMeasuredMonthChargeMinor(
  price: Pick<
    typeof SATYR_JEV_INPUT_TOKENS_PRICE_V1,
    'blockMinor' | 'blockUnits' | 'includedUnits'
  >,
  monthUnits: number,
): number {
  const billable = BigInt(Math.max(0, monthUnits - price.includedUnits));
  const blockUnits = BigInt(price.blockUnits);
  const charge = (billable * BigInt(price.blockMinor) + blockUnits - 1n) / blockUnits;
  if (charge > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Month charge is out of range');
  return Number(charge);
}

/**
 * SQL for the same rounding, with p bound to the price row. D1 binds numbers as REAL,
 * so the units are cast to keep the division an integer division.
 */
export function blockMeasuredChargeSql(units: string): string {
  return `((MAX(0, CAST(${units} AS INTEGER) - p.included_units) * p.unit_minor + p.block_units - 1) / p.block_units)`;
}

/** Wallet supplies an accepted execution quote after its existing integer-cent rounding. */
export class TrustedWalletExecutionQuoteV1 {
  readonly version = 1;
  readonly currency = 'USD';

  private constructor(
    readonly instanceId: string,
    readonly executionId: string,
    readonly quoteVersion: string,
    readonly quotedAt: string,
    readonly amountMinor: number,
    readonly sourceRecordId: string,
    readonly sourceDigest: string,
    readonly ledgerSourceEventId: string,
    readonly resourceId: string,
    readonly txOrExecutionRef: string | null,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(
    input: unknown,
  ): PlatformResult<TrustedWalletExecutionQuoteV1, PlatformContractError> {
    return contractResult(TrustedWalletExecutionQuoteV1.read, input);
  }

  private static read(input: unknown): TrustedWalletExecutionQuoteV1 {
    const record = object(input, 'quote');
    exactKeys(record, [
      'version',
      'currency',
      'instanceId',
      'executionId',
      'quoteVersion',
      'quotedAt',
      'amountMinor',
      'sourceRecordId',
      'sourceDigest',
      'ledgerSourceEventId',
      'resourceId',
      'txOrExecutionRef',
    ]);
    versionOne(record.version);
    if (record.currency !== 'USD') return invalidContract('currency');
    return new TrustedWalletExecutionQuoteV1(
      textValue(record.instanceId, 'instanceId'),
      textValue(record.executionId, 'executionId'),
      textValue(record.quoteVersion, 'quoteVersion'),
      utcTimestamp(record.quotedAt, 'quotedAt'),
      integer(record.amountMinor, 'amountMinor', 0),
      textValue(record.sourceRecordId, 'sourceRecordId'),
      digestValue(record.sourceDigest, 'sourceDigest'),
      textValue(record.ledgerSourceEventId, 'ledgerSourceEventId'),
      textValue(record.resourceId, 'resourceId'),
      record.txOrExecutionRef === null
        ? null
        : textValue(record.txOrExecutionRef, 'txOrExecutionRef'),
    );
  }

  toJSON(): Record<string, unknown> {
    return {
      version: this.version,
      currency: this.currency,
      instanceId: this.instanceId,
      executionId: this.executionId,
      quoteVersion: this.quoteVersion,
      quotedAt: this.quotedAt,
      amountMinor: this.amountMinor,
      sourceRecordId: this.sourceRecordId,
      sourceDigest: this.sourceDigest,
      ledgerSourceEventId: this.ledgerSourceEventId,
      resourceId: this.resourceId,
      txOrExecutionRef: this.txOrExecutionRef,
    };
  }
}

function canonicalJson(input: unknown): string {
  if (input === null || typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(canonicalJson).join(',')}]`;
  const fields: string[] = [];
  for (const key of Object.keys(input).sort()) {
    const value = Reflect.get(input, key);
    fields.push(`${JSON.stringify(key)}:${canonicalJson(value)}`);
  }
  return `{${fields.join(',')}}`;
}

function hexadecimalByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}

export async function billingCanonicalDigest(input: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(input)),
  );
  return Array.from(new Uint8Array(digest)).map(hexadecimalByte).join('');
}

/** Only the authenticated Wallet producer registers versions from its accepted pricing rules. */
export async function registerWalletExecutionPriceVersion(
  database: D1DatabaseLike,
  priceVersion: string,
): Promise<void> {
  await createWalletExecutionPriceVersionInsert(database, priceVersion).run();
}

export function createWalletExecutionPriceVersionInsert(
  database: D1DatabaseLike,
  priceVersion: string,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO billing_price_definitions
    (meter_id, version, kind, currency, unit_minor, time_rule, availability)
    VALUES ('wallet.execution', ?, 'quoted_execution', 'USD', NULL, 'accepted_quote_at', 'customer_accounts')
    ON CONFLICT(meter_id, version) DO NOTHING`,
    )
    .bind(priceVersion);
}

interface BillingExecutionPriceEligibilityInput {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly scope: PlatformScopeV1;
  readonly meterId: BillingFundsMeterId;
  readonly priceVersion: string;
  readonly amountMinor: number;
}

export type BillingFundsMeterId =
  | 'wallet.execution'
  | 'satyr.completed_turn.test'
  | 'satyr.jev_input_tokens';

/** A reservation names its meter through its service and its price version. */
export function billingFundsMeterId(
  serviceId: 'wallet' | 'satyr',
  priceVersion: string,
): BillingFundsMeterId {
  if (serviceId === 'wallet') return 'wallet.execution';
  return priceVersion === SATYR_JEV_INPUT_TOKENS_PRICE_V1.version
    ? SATYR_JEV_INPUT_TOKENS_PRICE_V1.meterId
    : SATYR_COMPLETED_TURN_TEST_PRICE_V1.meterId;
}

export const BILLING_EXECUTION_PRICE_ELIGIBILITY_SQL = `EXISTS (
  SELECT 1 FROM billing_price_definitions p WHERE p.meter_id = ? AND p.version = ? AND p.currency = 'USD'
    AND ((p.meter_id = 'wallet.execution' AND p.kind = 'quoted_execution' AND p.availability = 'customer_accounts')
      OR (p.availability = 'isolated_test_accounts'
        AND ((p.meter_id = 'satyr.completed_turn.test' AND p.version = 'satyr-completed-turn-test-v1'
            AND p.kind = 'fixed_measured' AND p.unit_minor = 1 AND ? = 1)
          OR (p.meter_id = 'satyr.jev_input_tokens' AND p.version = 'satyr-jev-input-tokens-v1'
            AND p.kind = 'block_measured' AND ? >= 0))
        AND EXISTS (SELECT 1 FROM billing_isolated_test_accounts a WHERE a.namespace = ? AND a.org_id = ?))))`;

export function billingExecutionPriceEligibilityBindings(
  input: BillingExecutionPriceEligibilityInput,
): readonly [string, string, number, number, string, string] {
  return [
    input.meterId,
    input.priceVersion,
    input.amountMinor,
    input.amountMinor,
    input.namespace,
    input.scope.organizationId,
  ];
}

export async function isRegisteredBillingPriceAvailable(
  input: BillingExecutionPriceEligibilityInput,
): Promise<boolean> {
  if (input.namespace !== input.scope.namespace) return false;
  const permission = await queryD1One(
    input.database,
    `SELECT 1 AS permitted WHERE ${BILLING_EXECUTION_PRICE_ELIGIBILITY_SQL}`,
    billingExecutionPriceEligibilityBindings(input),
  );
  return permission !== null;
}
