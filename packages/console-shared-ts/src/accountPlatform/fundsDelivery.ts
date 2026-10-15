import {
  contractResult,
  exactKeys,
  invalidContract,
  object,
  utcTimestamp,
  versionOne,
  type PlatformContractError,
  type PlatformResult,
} from './boundary';
import { ReconcileFundsRequestV1, ReleaseFundsRequestV1, SettleFundsRequestV1 } from './funds';

export type FundsTerminalRequestV1 =
  | { readonly kind: 'settle'; readonly request: SettleFundsRequestV1 }
  | { readonly kind: 'release'; readonly request: ReleaseFundsRequestV1 }
  | { readonly kind: 'reconcile'; readonly request: ReconcileFundsRequestV1 };

/** The account service derives financial identifiers from the accepted reservation. */
export class FundsTerminalDeliveryV1 {
  readonly version = 1;

  private constructor(
    readonly terminal: FundsTerminalRequestV1,
    readonly occurredAt: string,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): PlatformResult<FundsTerminalDeliveryV1, PlatformContractError> {
    return contractResult(FundsTerminalDeliveryV1.read, input);
  }

  private static read(input: unknown): FundsTerminalDeliveryV1 {
    const record = object(input, 'terminalDelivery');
    exactKeys(record, ['version', 'kind', 'request', 'occurredAt']);
    versionOne(record.version);
    return new FundsTerminalDeliveryV1(
      readTerminalRequest(record),
      utcTimestamp(record.occurredAt, 'occurredAt'),
    );
  }

  toJSON(): Record<string, unknown> {
    return {
      version: this.version,
      kind: this.terminal.kind,
      request: this.terminal.request,
      occurredAt: this.occurredAt,
    };
  }
}

function readTerminalRequest(record: Record<string, unknown>): FundsTerminalRequestV1 {
  switch (record.kind) {
    case 'settle': {
      const request = SettleFundsRequestV1.parse(record.request);
      if (request.kind === 'rejected') return invalidContract(`request.${request.error.field}`);
      return Object.freeze({ kind: record.kind, request: request.value });
    }
    case 'release': {
      const request = ReleaseFundsRequestV1.parse(record.request);
      if (request.kind === 'rejected') return invalidContract(`request.${request.error.field}`);
      return Object.freeze({ kind: record.kind, request: request.value });
    }
    case 'reconcile': {
      const request = ReconcileFundsRequestV1.parse(record.request);
      if (request.kind === 'rejected') return invalidContract(`request.${request.error.field}`);
      return Object.freeze({ kind: record.kind, request: request.value });
    }
    default:
      return invalidContract('kind');
  }
}

export type FundsTerminalDeliveryDataV1 = Readonly<{ version: 1; occurredAt: string }> &
  (
    | {
        readonly kind: 'settle';
        readonly request: Pick<SettleFundsRequestV1, keyof SettleFundsRequestV1>;
      }
    | {
        readonly kind: 'release';
        readonly request: Pick<ReleaseFundsRequestV1, keyof ReleaseFundsRequestV1>;
      }
    | {
        readonly kind: 'reconcile';
        readonly request: Pick<ReconcileFundsRequestV1, keyof ReconcileFundsRequestV1>;
      }
  );
