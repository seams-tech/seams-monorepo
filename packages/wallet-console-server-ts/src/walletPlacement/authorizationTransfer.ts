import { isPlainObject, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import type { WalletOwnershipKey } from './home';
import { WalletRegionalDispatch } from './regionalDispatch';
import { WalletD1RelocationCommand } from './relocationCommands';
import type { WalletRelocationAttempt, WalletRelocationFailure } from './relocationExecution';

type TransferResult =
  | {
      readonly state: 'advanced';
      readonly nextIndex: number;
      readonly digestHex?: never;
      readonly code?: never;
    }
  | {
      readonly state: 'verified';
      readonly digestHex: string;
      readonly nextIndex?: never;
      readonly code?: never;
    }
  | {
      readonly state: 'failed';
      readonly code: WalletRelocationFailure;
      readonly nextIndex?: never;
      readonly digestHex?: never;
    };

class TransferFailure extends Error {
  constructor(readonly code: WalletRelocationFailure) {
    super(code);
  }
}

// Each call transfers at most one chunk. The destination owns the durable cursor.
// This component receipt cannot authorize activation of the complete wallet.
export class WalletAuthorizationTransfer {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly transport: WalletRegionalDispatch,
  ) {}

  async advance(
    wallet: WalletOwnershipKey,
    attempt: WalletRelocationAttempt,
    sourceWriter: TenantRuntimeWriterV1,
    destinationWriter: TenantRuntimeWriterV1,
  ): Promise<TransferResult> {
    if (sourceWriter.role !== 'gateway' || destinationWriter.role !== 'gateway')
      return { state: 'failed', code: 'identity_conflict' };
    const source = await WalletD1RelocationCommand.authorize(
      this.database,
      wallet,
      sourceWriter,
      attempt,
      'export',
    );
    const destination = await WalletD1RelocationCommand.authorize(
      this.database,
      wallet,
      destinationWriter,
      attempt,
      'import_authorization',
    );
    if (!source.ok || !destination.ok) return { state: 'failed', code: 'authority_unavailable' };
    const operation = destination.command.operation;
    if (operation.kind !== 'import_authorization')
      return { state: 'failed', code: 'identity_conflict' };
    const manifest = operation.manifest;
    try {
      const prepared = await this.call(destination.command, attempt, 'prepare', {
        walletId: wallet.walletId,
        attempt,
      });
      const progress = prepared.progress;
      if (prepared.kind !== 'authorization_prepared' || !isPlainObject(progress))
        throw new TransferFailure('receipt_conflict');
      if (progress.state === 'verified') {
        if (Object.keys(progress).length !== 2 || progress.digestHex !== manifest.digestHex)
          throw new TransferFailure('receipt_conflict');
        return { state: 'verified', digestHex: manifest.digestHex };
      }
      if (
        progress.state !== 'receiving' ||
        Object.keys(progress).length !== 3 ||
        typeof progress.nextIndex !== 'number' ||
        !Number.isSafeInteger(progress.nextIndex) ||
        progress.nextIndex < 0 ||
        progress.nextIndex > manifest.chunkCount ||
        progress.chunkCount !== manifest.chunkCount
      )
        throw new TransferFailure('receipt_conflict');
      const index = progress.nextIndex;
      if (index === manifest.chunkCount) {
        const verified = await this.call(destination.command, attempt, 'verify', {
          walletId: wallet.walletId,
          attempt,
        });
        if (verified.kind !== 'authorization_verified' || verified.digestHex !== manifest.digestHex)
          throw new TransferFailure('receipt_conflict');
        return { state: 'verified', digestHex: manifest.digestHex };
      }
      const exported = await this.call(source.command, attempt, 'export', {
        walletId: wallet.walletId,
        attempt,
        index,
      });
      const chunk = exported.chunk;
      if (
        exported.kind !== 'authorization_chunk' ||
        !isPlainObject(chunk) ||
        Object.keys(chunk).length !== 3 ||
        chunk.index !== index ||
        typeof chunk.chunkJson !== 'string' ||
        new TextEncoder().encode(chunk.chunkJson).byteLength > 131072 ||
        typeof chunk.digestHex !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(chunk.digestHex)
      )
        throw new TransferFailure('content_conflict');
      const accepted = await this.call(destination.command, attempt, 'accept', {
        walletId: wallet.walletId,
        attempt,
        chunk,
      });
      if (
        accepted.kind !== 'authorization_chunk_accepted' ||
        accepted.digestHex !== chunk.digestHex
      )
        throw new TransferFailure('receipt_conflict');
      return { state: 'advanced', nextIndex: index + 1 };
    } catch (error) {
      if (error instanceof TransferFailure) return { state: 'failed', code: error.code };
      throw error;
    }
  }

  private async call(
    command: WalletD1RelocationCommand,
    attempt: WalletRelocationAttempt,
    operation: 'prepare' | 'export' | 'accept' | 'verify',
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (command.moveId !== attempt.moveId || !command.wallet.matches(attempt.wallet))
      throw new TransferFailure('identity_conflict');
    const response = await this.transport.forward(
      command.home,
      new Request(
        `https://wallet-relocation.internal/internal/wallet-relocation/v1/authorization/${operation}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      ),
    );
    if (!response.ok)
      throw new TransferFailure(
        response.status >= 500 ? 'transport_unavailable' : 'authority_unavailable',
      );
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new TransferFailure('receipt_conflict');
    }
    if (!isPlainObject(raw) || raw.commandDigest !== (await command.digest()))
      throw new TransferFailure('receipt_conflict');
    return raw;
  }
}
