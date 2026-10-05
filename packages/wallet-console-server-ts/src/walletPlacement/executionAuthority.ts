import { isPlainObject, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import {
  WalletHome,
  WalletOwnershipKey,
  WalletPlacementError,
  parseWalletOwnershipGeneration,
} from './home';
import { readWalletPlacementStatus } from './relocationStatus';

type ExecutionAdmission =
  | { readonly ok: true; readonly authority: WalletExecutionAuthority; readonly code?: never }
  | {
      readonly ok: false;
      readonly code: 'wallet_unavailable' | 'wallet_paused' | 'writer_home_mismatch';
      readonly authority?: never;
    };

// The authenticated Console boundary supplies the verified runtime writer.
// This observation pins dispatch identity. Local fences still serialize effects
// with relocation; a previously issued authority cannot reopen a frozen source.
export class WalletExecutionAuthority {
  readonly #validated = true;

  private constructor(
    readonly wallet: WalletOwnershipKey,
    readonly home: WalletHome,
    readonly generation: number,
    readonly participant: TenantRuntimeWriterV1['role'],
    readonly versionId: string,
  ) {
    Object.freeze(this);
  }

  static async admit(
    database: D1DatabaseLike,
    wallet: WalletOwnershipKey,
    writer: TenantRuntimeWriterV1,
  ): Promise<ExecutionAdmission> {
    const status = await readWalletPlacementStatus(database, wallet);
    let home: WalletHome;
    let generation: number;
    switch (status.state) {
      case 'unavailable':
        return { ok: false, code: 'wallet_unavailable' };
      case 'settled':
        home = status.home;
        generation = status.generation;
        break;
      case 'moving': {
        const progress = status.move.progress;
        if (progress.state !== 'cutover' || progress.activation.state !== 'activated')
          return { ok: false, code: 'wallet_paused' };
        home = status.move.destination;
        generation = status.move.destinationGeneration;
        break;
      }
      default: {
        const unexpected: never = status;
        throw new Error(`Unexpected wallet placement: ${String(unexpected)}`);
      }
    }
    if (
      home.accountId !== writer.resource.accountId ||
      home.databaseId !== writer.resource.databaseId
    )
      return { ok: false, code: 'writer_home_mismatch' };
    return {
      ok: true,
      authority: new WalletExecutionAuthority(
        wallet,
        home,
        generation,
        writer.role,
        writer.versionId,
      ),
    };
  }

  static fromResponse(
    raw: unknown,
    wallet: WalletOwnershipKey,
    writer: TenantRuntimeWriterV1,
  ): ExecutionAdmission {
    if (!isPlainObject(raw) || Object.keys(raw).length !== 2)
      throw new WalletPlacementError('invalid_record', 'Execution admission response is invalid');
    if (raw.ok === false) {
      switch (raw.code) {
        case 'wallet_unavailable':
        case 'wallet_paused':
        case 'writer_home_mismatch':
          return { ok: false, code: raw.code };
        default:
          throw new WalletPlacementError(
            'invalid_record',
            'Execution admission failure is invalid',
          );
      }
    }
    if (raw.ok !== true || !isPlainObject(raw.authority) || Object.keys(raw.authority).length !== 5)
      throw new WalletPlacementError('invalid_record', 'Execution authority response is invalid');
    const value = raw.authority;
    const returnedWallet = WalletOwnershipKey.parse(value.wallet);
    const home = WalletHome.parse(value.home);
    const generation = parseWalletOwnershipGeneration(value.generation);
    if (
      !returnedWallet.matches(wallet) ||
      value.participant !== writer.role ||
      value.versionId !== writer.versionId ||
      home.accountId !== writer.resource.accountId ||
      home.databaseId !== writer.resource.databaseId
    )
      throw new WalletPlacementError('invalid_record', 'Execution authority identity conflicts');
    return {
      ok: true,
      authority: new WalletExecutionAuthority(
        returnedWallet,
        home,
        generation,
        writer.role,
        writer.versionId,
      ),
    };
  }

  matches(wallet: WalletOwnershipKey, generation: number): boolean {
    return this.#validated && this.wallet.matches(wallet) && this.generation === generation;
  }
}
