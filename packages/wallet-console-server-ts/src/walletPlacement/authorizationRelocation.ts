import { isPlainObject, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletPlacementError, type WalletOwnershipKey } from './home';
import {
  WalletAuthorizationManifest,
  recordWalletAuthorizationManifest,
} from './authorizationManifest';
import { relocationTimestamp } from './relocation';
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

type FreezeResult =
  | {
      readonly state: 'pending';
      readonly manifest?: never;
      readonly retiredAtMs?: never;
      readonly frozenAtMs?: never;
      readonly code?: never;
    }
  | {
      readonly state: 'frozen';
      readonly manifest: WalletAuthorizationManifest;
      readonly retiredAtMs: number;
      readonly frozenAtMs: number;
      readonly code?: never;
    }
  | {
      readonly state: 'failed';
      readonly code: WalletRelocationFailure;
      readonly manifest?: never;
      readonly retiredAtMs?: never;
      readonly frozenAtMs?: never;
    };

type ActivationResult =
  | {
      readonly state: 'activated';
      readonly digestHex: string;
      readonly activatedAtMs: number;
      readonly code?: never;
    }
  | {
      readonly state: 'failed';
      readonly code: WalletRelocationFailure;
      readonly digestHex?: never;
      readonly activatedAtMs?: never;
    };

type CleanupResult =
  | { readonly state: 'pending'; readonly completedAtMs?: never; readonly code?: never }
  | { readonly state: 'cleaned'; readonly completedAtMs: number; readonly code?: never }
  | {
      readonly state: 'failed';
      readonly code: WalletRelocationFailure;
      readonly completedAtMs?: never;
    };

class AuthorizationRelocationFailure extends Error {
  constructor(readonly code: WalletRelocationFailure) {
    super(code);
  }
}

// Each call transfers at most one chunk. The destination owns the durable cursor.
// This component receipt cannot authorize activation of the complete wallet.
export class WalletAuthorizationRelocation {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly transport: WalletRegionalDispatch,
  ) {}

  async freeze(
    wallet: WalletOwnershipKey,
    attempt: WalletRelocationAttempt,
    sourceWriter: TenantRuntimeWriterV1,
  ): Promise<FreezeResult> {
    if (sourceWriter.role !== 'gateway') return { state: 'failed', code: 'identity_conflict' };
    const authorized = await WalletD1RelocationCommand.authorize(
      this.database,
      wallet,
      sourceWriter,
      attempt,
      'freeze',
    );
    if (!authorized.ok) return { state: 'failed', code: 'authority_unavailable' };
    try {
      const response = await this.call(authorized.command, attempt, 'freeze', {
        walletId: wallet.walletId,
        attempt,
      });
      if (
        response.kind === 'authorization_pending' &&
        (response.reason === 'ceremonies_unsettled' ||
          response.reason === 'session_operations_unsettled')
      )
        return { state: 'pending' };
      if (response.kind !== 'authorization_frozen')
        throw new AuthorizationRelocationFailure('receipt_conflict');
      const retiredAtMs = relocationTimestamp(response.retiredAtMs);
      const frozenAtMs = relocationTimestamp(response.frozenAtMs);
      if (retiredAtMs > frozenAtMs) throw new AuthorizationRelocationFailure('receipt_conflict');
      const manifest = WalletAuthorizationManifest.parse(response.manifest);
      await recordWalletAuthorizationManifest(this.database, authorized.command, attempt, manifest);
      return { state: 'frozen', manifest, retiredAtMs, frozenAtMs };
    } catch (error) {
      if (error instanceof AuthorizationRelocationFailure)
        return { state: 'failed', code: error.code };
      if (error instanceof WalletPlacementError)
        return { state: 'failed', code: 'receipt_conflict' };
      throw error;
    }
  }

  async activate(
    wallet: WalletOwnershipKey,
    attempt: WalletRelocationAttempt,
    destinationWriter: TenantRuntimeWriterV1,
  ): Promise<ActivationResult> {
    if (destinationWriter.role !== 'gateway') return { state: 'failed', code: 'identity_conflict' };
    const authorized = await WalletD1RelocationCommand.authorize(
      this.database,
      wallet,
      destinationWriter,
      attempt,
      'activate',
    );
    if (!authorized.ok) return { state: 'failed', code: 'authority_unavailable' };
    const operation = authorized.command.operation;
    if (operation.kind !== 'activate') return { state: 'failed', code: 'identity_conflict' };
    try {
      const response = await this.call(authorized.command, attempt, 'activate', {
        walletId: wallet.walletId,
        attempt,
      });
      if (
        response.kind !== 'authorization_activated' ||
        response.digestHex !== operation.manifest.digestHex
      )
        throw new AuthorizationRelocationFailure('receipt_conflict');
      return {
        state: 'activated',
        digestHex: operation.manifest.digestHex,
        activatedAtMs: relocationTimestamp(response.activatedAtMs),
      };
    } catch (error) {
      if (error instanceof AuthorizationRelocationFailure)
        return { state: 'failed', code: error.code };
      if (error instanceof WalletPlacementError)
        return { state: 'failed', code: 'receipt_conflict' };
      throw error;
    }
  }

  async cleanup(
    wallet: WalletOwnershipKey,
    attempt: WalletRelocationAttempt,
    sourceWriter: TenantRuntimeWriterV1,
  ): Promise<CleanupResult> {
    if (sourceWriter.role !== 'gateway') return { state: 'failed', code: 'identity_conflict' };
    const authorized = await WalletD1RelocationCommand.authorize(
      this.database,
      wallet,
      sourceWriter,
      attempt,
      'cleanup',
    );
    if (!authorized.ok) return { state: 'failed', code: 'authority_unavailable' };
    try {
      const response = await this.call(authorized.command, attempt, 'cleanup', {
        walletId: wallet.walletId,
        attempt,
      });
      const progress = response.progress;
      if (response.kind !== 'authorization_cleanup' || !isPlainObject(progress))
        throw new AuthorizationRelocationFailure('receipt_conflict');
      if (progress.state === 'cleaning' && Object.keys(progress).length === 1)
        return { state: 'pending' };
      if (progress.state !== 'cleaned' || Object.keys(progress).length !== 2)
        throw new AuthorizationRelocationFailure('receipt_conflict');
      return { state: 'cleaned', completedAtMs: relocationTimestamp(progress.completedAtMs) };
    } catch (error) {
      if (error instanceof AuthorizationRelocationFailure)
        return { state: 'failed', code: error.code };
      if (error instanceof WalletPlacementError)
        return { state: 'failed', code: 'receipt_conflict' };
      throw error;
    }
  }

  async transfer(
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
        throw new AuthorizationRelocationFailure('receipt_conflict');
      if (progress.state === 'verified') {
        if (Object.keys(progress).length !== 2 || progress.digestHex !== manifest.digestHex)
          throw new AuthorizationRelocationFailure('receipt_conflict');
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
        throw new AuthorizationRelocationFailure('receipt_conflict');
      const index = progress.nextIndex;
      if (index === manifest.chunkCount) {
        const verified = await this.call(destination.command, attempt, 'verify', {
          walletId: wallet.walletId,
          attempt,
        });
        if (verified.kind !== 'authorization_verified' || verified.digestHex !== manifest.digestHex)
          throw new AuthorizationRelocationFailure('receipt_conflict');
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
        throw new AuthorizationRelocationFailure('content_conflict');
      const accepted = await this.call(destination.command, attempt, 'accept', {
        walletId: wallet.walletId,
        attempt,
        chunk,
      });
      if (
        accepted.kind !== 'authorization_chunk_accepted' ||
        accepted.digestHex !== chunk.digestHex
      )
        throw new AuthorizationRelocationFailure('receipt_conflict');
      return { state: 'advanced', nextIndex: index + 1 };
    } catch (error) {
      if (error instanceof AuthorizationRelocationFailure)
        return { state: 'failed', code: error.code };
      throw error;
    }
  }

  private async call(
    command: WalletD1RelocationCommand,
    attempt: WalletRelocationAttempt,
    operation: 'freeze' | 'prepare' | 'export' | 'accept' | 'verify' | 'activate' | 'cleanup',
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (command.moveId !== attempt.moveId || !command.wallet.matches(attempt.wallet))
      throw new AuthorizationRelocationFailure('identity_conflict');
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
      throw new AuthorizationRelocationFailure(
        response.status >= 500 ? 'transport_unavailable' : 'authority_unavailable',
      );
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new AuthorizationRelocationFailure('receipt_conflict');
    }
    if (!isPlainObject(raw) || raw.commandDigest !== (await command.digest()))
      throw new AuthorizationRelocationFailure('receipt_conflict');
    return raw;
  }
}
