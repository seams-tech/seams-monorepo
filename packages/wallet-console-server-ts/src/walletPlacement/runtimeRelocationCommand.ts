import { queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  storedRuntimeVersionMatches,
  type TenantRuntimeWriterV1,
} from '../tenantDeployment/resourceVerification';
import { WalletOwnershipKey, WalletPlacementError } from './home';
import type { WalletRelocationAttempt } from './relocationExecution';
import { readWalletPlacementStatus } from './relocationStatus';

export type WalletRuntimeSourceOperation = 'ed25519-settle' | 'ed25519-capture' | 'ecdsa-freeze';

type Source = {
  readonly scope: {
    readonly org_id: string;
    readonly project_id: string;
    readonly project_environment_id: string;
    readonly wallet_id: string;
  };
  readonly request: {
    readonly move_id: string;
    readonly source_generation: number;
    readonly invalidated_at_ms: number;
  };
};

type SourceCommand =
  | { readonly operation: 'ed25519-settle' | 'ecdsa-freeze'; readonly payload: Source }
  | {
      readonly operation: 'ed25519-capture';
      readonly payload: { readonly command: 'capture'; readonly source: Source };
    };

type Authorization =
  | { readonly ok: true; readonly command: SourceCommand; readonly code?: never }
  | {
      readonly ok: false;
      readonly code: 'attempt_conflict' | 'phase_conflict' | 'participant_conflict';
      readonly command?: never;
    };

export function parseWalletRuntimeSourceOperation(raw: unknown): WalletRuntimeSourceOperation {
  switch (raw) {
    case 'ed25519-settle':
    case 'ed25519-capture':
    case 'ecdsa-freeze':
      return raw;
    default:
      throw new WalletPlacementError('invalid_input', 'Runtime source operation is invalid');
  }
}

// The journal supplies every identity and timestamp. Retry attempts never change
// the participant command, and the caller cannot substitute another wallet.
export async function authorizeWalletRuntimeSourceCommand(
  database: D1DatabaseLike,
  wallet: WalletOwnershipKey,
  writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt,
  operation: WalletRuntimeSourceOperation,
): Promise<Authorization> {
  if (!attempt.wallet.matches(wallet)) return { ok: false, code: 'attempt_conflict' };
  const status = await readWalletPlacementStatus(database, wallet);
  if (status.state !== 'moving' || status.move.progress.state !== 'freezing')
    return { ok: false, code: 'phase_conflict' };
  const move = status.move;
  const execution = status.move.progress.execution;
  if (execution.state !== 'running' || !execution.attempt.matches(attempt))
    return { ok: false, code: 'attempt_conflict' };
  if (
    writer.role !== 'walletRuntime' ||
    writer.resource.accountId !== move.source.accountId ||
    writer.resource.databaseId !== move.source.databaseId
  )
    return { ok: false, code: 'participant_conflict' };
  const row = await queryD1One(
    database,
    `SELECT resource_verifications_json FROM wallet_relocations
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
      AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6`,
    [
      wallet.namespace,
      wallet.organizationId,
      wallet.projectId,
      wallet.environmentId,
      wallet.walletId,
      move.moveId,
    ],
  );
  if (!row || !storedRuntimeVersionMatches(row.resource_verifications_json, writer))
    return { ok: false, code: 'participant_conflict' };
  const source: Source = {
    scope: {
      org_id: wallet.organizationId,
      project_id: wallet.projectId,
      project_environment_id: wallet.environmentId,
      wallet_id: wallet.walletId,
    },
    request: {
      move_id: move.moveId,
      source_generation: move.sourceGeneration,
      invalidated_at_ms: move.admittedAtMs,
    },
  };
  switch (operation) {
    case 'ed25519-settle':
    case 'ecdsa-freeze':
      return { ok: true, command: { operation, payload: source } };
    case 'ed25519-capture':
      return { ok: true, command: { operation, payload: { command: 'capture', source } } };
    default: {
      const unexpected: never = operation;
      throw new Error(`Unexpected Runtime source operation: ${String(unexpected)}`);
    }
  }
}
