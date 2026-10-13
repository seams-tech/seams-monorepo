import type {
  PlatformContractError,
  PlatformResult,
} from '@seams-internal/console-shared/accountPlatform';
import {
  contractResult,
  exactKeys,
  invalidContract,
  object,
  textValue,
  versionOne,
} from '@seams-internal/console-shared/accountPlatform/boundary';

export type BillableWalletAction = 'transfer' | 'swap' | 'approve' | 'contract_call';
export type WalletActivityExclusion = 'registration' | 'failed' | 'simulation' | 'internal_retry';

type WalletActivityDecision =
  | { readonly kind: 'billable'; readonly action: BillableWalletAction; readonly reason?: never }
  | {
      readonly kind: 'excluded';
      readonly reason: WalletActivityExclusion;
      readonly action?: never;
    };

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return invalidContract(field);
  return value;
}

function readAction(value: unknown): BillableWalletAction | 'wallet_created' {
  switch (value) {
    case 'transfer':
    case 'swap':
    case 'approve':
    case 'contract_call':
    case 'wallet_created':
      return value;
    default:
      return invalidContract('action');
  }
}

function readDecision(record: Record<string, unknown>): WalletActivityDecision {
  const action = readAction(record.action);
  const succeeded = readBoolean(record.succeeded, 'succeeded');
  const simulation = readBoolean(record.isSimulation, 'isSimulation');
  const internalRetry = readBoolean(record.isInternalRetry, 'isInternalRetry');
  if (action === 'wallet_created') return { kind: 'excluded', reason: 'registration' };
  if (!succeeded) return { kind: 'excluded', reason: 'failed' };
  if (simulation) return { kind: 'excluded', reason: 'simulation' };
  if (internalRetry) return { kind: 'excluded', reason: 'internal_retry' };
  return { kind: 'billable', action };
}

/** A trusted Wallet producer selects an existing execution receipt for monthly usage. */
export class WalletBillingActivityV1 {
  readonly version = 1;

  private constructor(
    readonly nativeOrganizationId: string,
    readonly sourceRecordId: string,
    readonly decision: WalletActivityDecision,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): PlatformResult<WalletBillingActivityV1, PlatformContractError> {
    return contractResult(WalletBillingActivityV1.read, input);
  }

  private static read(input: unknown): WalletBillingActivityV1 {
    const record = object(input, 'walletActivity');
    exactKeys(record, [
      'version',
      'kind',
      'nativeOrganizationId',
      'sourceRecordId',
      'action',
      'succeeded',
      'isSimulation',
      'isInternalRetry',
    ]);
    versionOne(record.version);
    if (record.kind !== 'accepted_evm_wallet_action') return invalidContract('kind');
    return new WalletBillingActivityV1(
      textValue(record.nativeOrganizationId, 'nativeOrganizationId'),
      textValue(record.sourceRecordId, 'sourceRecordId'),
      Object.freeze(readDecision(record)),
    );
  }
}
