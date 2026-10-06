import { isPlainObject, queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletPlacementError, type WalletOwnershipKey } from './home';
import { relocationDigest, relocationTimestamp } from './relocation';
import { WalletD1RelocationCommand } from './relocationCommands';
import type { WalletRelocationAttempt } from './relocationExecution';
import { authorizeWalletRuntimeSourceCommand } from './runtimeRelocationCommand';

type Source = {
  readonly scope: { readonly org_id: string; readonly project_id: string; readonly project_environment_id: string; readonly wallet_id: string };
  readonly request: { readonly move_id: string; readonly source_generation: number; readonly invalidated_at_ms: number };
};

export type Ed25519TransferRequest =
  | { readonly operation: 'export'; readonly segmentIndex: number }
  | { readonly operation: 'import' | 'status' | 'verify'; readonly segmentIndex?: never };

export function parseEd25519TransferRequest(raw: unknown): Ed25519TransferRequest {
  if (!isPlainObject(raw)) throw invalid('Ed25519 transfer request is invalid');
  if (raw.operation === 'export' && Object.keys(raw).length === 2 && count(raw.segmentIndex))
    return { operation: 'export', segmentIndex: raw.segmentIndex };
  if (Object.keys(raw).length === 1 && (raw.operation === 'import' || raw.operation === 'status' || raw.operation === 'verify'))
    return { operation: raw.operation };
  throw invalid('Ed25519 transfer operation or cursor is invalid');
}

export async function recordEd25519Snapshot(
  database: D1DatabaseLike, wallet: WalletOwnershipKey, writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt, raw: unknown,
) {
  const authorized = await authorizeWalletRuntimeSourceCommand(database, wallet, writer, attempt, 'ed25519-capture');
  if (!authorized.ok) return authorized;
  if (authorized.command.operation !== 'ed25519-capture') throw new Error('Ed25519 capture command required');
  const receipt = parseReceipt(raw, authorized.command.payload.source);
  const encoded = JSON.stringify(receipt);
  const identity = scope(wallet, attempt.moveId);
  await database.prepare(`INSERT INTO wallet_ed25519_snapshots
    (namespace, organization_id, project_id, environment_id, wallet_id, move_id, receipt_json)
    SELECT namespace, organization_id, project_id, environment_id, wallet_id, move_id, ?7
    FROM wallet_relocations WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
      AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6
      AND state = 'freezing' AND execution_state = 'running'
      AND execution_revision = ?8 AND execution_attempt_id = ?9
    ON CONFLICT DO NOTHING`).bind(...identity, encoded, attempt.revision, attempt.id).run();
  const row = await queryD1One(database, `SELECT receipt_json FROM wallet_ed25519_snapshots
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6`, identity);
  if (row?.receipt_json !== encoded) return { ok: false, code: 'receipt_conflict' } as const;
  return { ok: true, receipt } as const;
}

export async function authorizeEd25519Transfer(
  database: D1DatabaseLike, wallet: WalletOwnershipKey, writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt, request: Ed25519TransferRequest,
) {
  if (writer.role !== 'walletRuntime') return { ok: false, code: 'participant_conflict' } as const;
  const kind = request.operation === 'export' ? 'export' : 'verify';
  const authorized = await WalletD1RelocationCommand.authorize(database, wallet, writer, attempt, kind);
  if (!authorized.ok) return authorized;
  const command = authorized.command;
  const row = await queryD1One(database, `SELECT snapshot.receipt_json, move.admitted_at_ms
    FROM wallet_ed25519_snapshots snapshot JOIN wallet_relocations move
      USING (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6`, scope(wallet, command.moveId));
  if (typeof row?.receipt_json !== 'string') return { ok: false, code: 'source_manifest_unavailable' } as const;
  const source: Source = {
    scope: { org_id: wallet.organizationId, project_id: wallet.projectId, project_environment_id: wallet.environmentId, wallet_id: wallet.walletId },
    request: { move_id: command.moveId, source_generation: kind === 'export' ? command.generation : command.generation - 1,
      invalidated_at_ms: relocationTimestamp(row.admitted_at_ms) },
  };
  const receipt = parseReceipt(JSON.parse(row.receipt_json), source);
  switch (request.operation) {
    case 'export':
      if (request.segmentIndex >= receipt.segment_count) return { ok: false, code: 'invalid_cursor' } as const;
      return { ok: true, command: { command: 'export', receipt, segment_index: request.segmentIndex } } as const;
    case 'import': return { ok: true, command: { command: 'import', receipt } } as const;
    case 'status': return { ok: true, command: { command: 'status', receipt } } as const;
    case 'verify': return { ok: true, command: { command: 'verify', receipt } } as const;
    default: {
      const unexpected: never = request;
      throw new Error(`Unknown Ed25519 transfer request: ${String(unexpected)}`);
    }
  }
}

function parseReceipt(raw: unknown, source: Source) {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 4 ||
      !isPlainObject(raw.source) || Object.keys(raw.source).length !== 2 ||
      !isPlainObject(raw.source.scope) || Object.keys(raw.source.scope).length !== 4 ||
      !isPlainObject(raw.source.request) || Object.keys(raw.source.request).length !== 3 ||
      raw.source.scope.org_id !== source.scope.org_id || raw.source.scope.project_id !== source.scope.project_id ||
      raw.source.scope.project_environment_id !== source.scope.project_environment_id || raw.source.scope.wallet_id !== source.scope.wallet_id ||
      raw.source.request.move_id !== source.request.move_id || raw.source.request.source_generation !== source.request.source_generation ||
      raw.source.request.invalidated_at_ms !== source.request.invalidated_at_ms ||
      !count(raw.record_count) || !count(raw.segment_count) || raw.record_count > raw.segment_count ||
      (raw.record_count === 0) !== (raw.segment_count === 0)) throw invalid('Ed25519 snapshot differs from its admitted move');
  return { source, record_count: raw.record_count, segment_count: raw.segment_count, digest_hex: relocationDigest(raw.digest_hex) };
}

function scope(wallet: WalletOwnershipKey, moveId: string) {
  return [wallet.namespace, wallet.organizationId, wallet.projectId, wallet.environmentId, wallet.walletId, moveId];
}

function count(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 4294967295;
}

function invalid(message: string): WalletPlacementError {
  return new WalletPlacementError('invalid_input', message);
}
