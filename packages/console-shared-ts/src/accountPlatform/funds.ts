import {
  contractResult,
  digestValue,
  exactKeys,
  integer,
  invalidContract,
  object,
  textValue,
  versionOne,
  type PlatformContractError,
  type PlatformResult,
} from './boundary';
import type { DurableSourceEvidenceV1 } from './instances';

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
      readFundsEvidence(record.evidence, 'evidence'),
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
      readFundsEvidence(record.noChargeEvidence, 'noChargeEvidence'),
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
        evidence: readFundsEvidence(record.evidence, 'evidence'),
      });
    case 'no_charge':
      exactKeys(record, ['kind', 'noChargeEvidence']);
      return Object.freeze({
        kind: record.kind,
        noChargeEvidence: readFundsEvidence(record.noChargeEvidence, 'noChargeEvidence'),
      });
    default:
      return invalidContract('outcome.kind');
  }
}

function readFundsEvidence(input: unknown, field: string): DurableSourceEvidenceV1 {
  const record = object(input, field);
  exactKeys(record, ['sourceRecordId', 'sourceDigest']);
  return Object.freeze({
    sourceRecordId: textValue(record.sourceRecordId, `${field}.sourceRecordId`),
    sourceDigest: digestValue(record.sourceDigest, `${field}.sourceDigest`),
  });
}
