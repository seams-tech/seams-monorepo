import {
  contractResult,
  exactKeys,
  exactObject,
  utcTimestamp,
  integer,
  invalidContract,
  object,
  textValue,
  versionOne,
  type PlatformContractError,
  type PlatformResult,
} from './boundary';
import { readDurableSourceEvidenceV1, type DurableSourceEvidenceV1 } from './instances';
import { readPlatformScopeV1 } from './scope';
import type { FundsReservationV1 } from './protocol';

/** Authenticated service evidence authorizes terminal money changes. */
export class SettleFundsRequestV1 {
  readonly version = 1;

  private constructor(
    readonly operationId: string,
    readonly reservationId: string,
    readonly executionId: string,
    readonly settledMinor: number,
    readonly priceVersion: string,
    readonly evidence: DurableSourceEvidenceV1,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): PlatformResult<SettleFundsRequestV1, PlatformContractError> {
    return contractResult(SettleFundsRequestV1.read, input);
  }

  private static read(input: unknown): SettleFundsRequestV1 {
    const record = object(input, 'settlement');
    exactKeys(record, [
      'version',
      'operationId',
      'reservationId',
      'executionId',
      'settledMinor',
      'priceVersion',
      'evidence',
    ]);
    versionOne(record.version);
    return new SettleFundsRequestV1(
      textValue(record.operationId, 'operationId'),
      textValue(record.reservationId, 'reservationId'),
      textValue(record.executionId, 'executionId'),
      integer(record.settledMinor, 'settledMinor', 0),
      textValue(record.priceVersion, 'priceVersion'),
      readDurableSourceEvidenceV1(record.evidence, 'evidence'),
    );
  }
}

export class ReleaseFundsRequestV1 {
  readonly version = 1;

  private constructor(
    readonly operationId: string,
    readonly reservationId: string,
    readonly executionId: string,
    readonly noChargeEvidence: DurableSourceEvidenceV1,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): PlatformResult<ReleaseFundsRequestV1, PlatformContractError> {
    return contractResult(ReleaseFundsRequestV1.read, input);
  }

  private static read(input: unknown): ReleaseFundsRequestV1 {
    const record = object(input, 'release');
    exactKeys(record, [
      'version',
      'operationId',
      'reservationId',
      'executionId',
      'noChargeEvidence',
    ]);
    versionOne(record.version);
    return new ReleaseFundsRequestV1(
      textValue(record.operationId, 'operationId'),
      textValue(record.reservationId, 'reservationId'),
      textValue(record.executionId, 'executionId'),
      readDurableSourceEvidenceV1(record.noChargeEvidence, 'noChargeEvidence'),
    );
  }
}

/** An uncertain execution retains its hold until the service proves its outcome. */
export class MarkFundsIndeterminateRequestV1 {
  readonly version = 1;

  private constructor(
    readonly operationId: string,
    readonly reservationId: string,
    readonly executionId: string,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(
    input: unknown,
  ): PlatformResult<MarkFundsIndeterminateRequestV1, PlatformContractError> {
    return contractResult(MarkFundsIndeterminateRequestV1.read, input);
  }

  private static read(input: unknown): MarkFundsIndeterminateRequestV1 {
    const record = object(input, 'indeterminate');
    exactKeys(record, ['version', 'operationId', 'reservationId', 'executionId']);
    versionOne(record.version);
    return new MarkFundsIndeterminateRequestV1(
      textValue(record.operationId, 'operationId'),
      textValue(record.reservationId, 'reservationId'),
      textValue(record.executionId, 'executionId'),
    );
  }
}

export type FundsReconciliationOutcomeV1 =
  | {
      readonly kind: 'charged';
      readonly settledMinor: number;
      readonly priceVersion: string;
      readonly evidence: DurableSourceEvidenceV1;
      readonly noChargeEvidence?: never;
    }
  | {
      readonly kind: 'no_charge';
      readonly noChargeEvidence: DurableSourceEvidenceV1;
      readonly settledMinor?: never;
      readonly priceVersion?: never;
      readonly evidence?: never;
    };

export class ReconcileFundsRequestV1 {
  readonly version = 1;

  private constructor(
    readonly operationId: string,
    readonly reservationId: string,
    readonly executionId: string,
    readonly outcome: FundsReconciliationOutcomeV1,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): PlatformResult<ReconcileFundsRequestV1, PlatformContractError> {
    return contractResult(ReconcileFundsRequestV1.read, input);
  }

  private static read(input: unknown): ReconcileFundsRequestV1 {
    const record = object(input, 'reconciliation');
    exactKeys(record, ['version', 'operationId', 'reservationId', 'executionId', 'outcome']);
    versionOne(record.version);
    return new ReconcileFundsRequestV1(
      textValue(record.operationId, 'operationId'),
      textValue(record.reservationId, 'reservationId'),
      textValue(record.executionId, 'executionId'),
      readReconciliationOutcome(record.outcome),
    );
  }
}

function readReconciliationOutcome(input: unknown): FundsReconciliationOutcomeV1 {
  const record = object(input, 'outcome');
  switch (record.kind) {
    case 'charged':
      exactKeys(record, ['kind', 'settledMinor', 'priceVersion', 'evidence']);
      return Object.freeze({
        kind: record.kind,
        settledMinor: integer(record.settledMinor, 'settledMinor', 0),
        priceVersion: textValue(record.priceVersion, 'priceVersion'),
        evidence: readDurableSourceEvidenceV1(record.evidence, 'evidence'),
      });
    case 'no_charge':
      exactKeys(record, ['kind', 'noChargeEvidence']);
      return Object.freeze({
        kind: record.kind,
        noChargeEvidence: readDurableSourceEvidenceV1(record.noChargeEvidence, 'noChargeEvidence'),
      });
    default:
      return invalidContract('outcome.kind');
  }
}

export function readFundsReservationV1(input: unknown): FundsReservationV1 {
  const record = object(input, 'reservation');
  const keys = [
    'reservationId',
    'scope',
    'instanceId',
    'executionId',
    'requestedMinor',
    'priceVersion',
    'createdAt',
    'kind',
  ];
  const common = {
    reservationId: textValue(record.reservationId),
    scope: readPlatformScopeV1(record.scope),
    instanceId: textValue(record.instanceId),
    executionId: textValue(record.executionId),
    requestedMinor: integer(record.requestedMinor, 'requestedMinor', 0),
    priceVersion: textValue(record.priceVersion),
    createdAt: utcTimestamp(record.createdAt),
  };
  switch (record.kind) {
    case 'reserved':
      exactObject(record, keys);
      return { ...common, kind: record.kind };
    case 'indeterminate':
      exactObject(record, [...keys, 'reconciliation']);
      if (exactObject(record.reconciliation, ['kind']).kind !== 'pending')
        throw new Error('Invalid reconciliation');
      return {
        ...common,
        kind: record.kind,
        reconciliation: { kind: 'pending' },
      };
    case 'settled':
      exactObject(record, [...keys, 'chargeId', 'settledMinor']);
      return {
        ...common,
        kind: record.kind,
        chargeId: textValue(record.chargeId),
        settledMinor: integer(record.settledMinor, 'integer', 0),
      };
    case 'released':
      exactObject(record, [...keys, 'noChargeEvidence']);
      return {
        ...common,
        kind: record.kind,
        noChargeEvidence: readDurableSourceEvidenceV1(record.noChargeEvidence),
      };
    default:
      throw new Error('Unknown reservation state');
  }
}
