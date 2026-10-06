import { isPlainObject, queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletPlacementError, type WalletOwnershipKey } from './home';
import { WalletD1RelocationCommand } from './relocationCommands';
import { relocationDigest, relocationTimestamp } from './relocation';
import type { WalletRelocationAttempt } from './relocationExecution';
import { authorizeWalletRuntimeSourceCommand } from './runtimeRelocationCommand';

type Cursor = { readonly kind: 'start'; readonly presign_session_id?: never }
  | { readonly kind: 'after'; readonly presign_session_id: string };
type Session = { readonly presignSessionId: string; readonly serverPresignatureId: string };
type SessionCommand = {
  readonly wallet_scope: { readonly org_id: string; readonly project_id: string; readonly project_environment_id: string; readonly wallet_id: string };
  readonly request: { readonly move_id: string; readonly source_generation: number; readonly invalidated_at_ms: number };
  readonly presign_session_id: string;
  readonly server_presignature_id: string;
};

export type PresignTransferRequest =
  | { readonly operation: 'export'; readonly session: Session; readonly segmentIndex: number }
  | { readonly operation: 'import' | 'verify' | 'status'; readonly session: Session; readonly segmentIndex?: never };

export function parsePresignTransferRequest(raw: unknown): PresignTransferRequest {
  if (!isPlainObject(raw)) throw invalid('Presign transfer request is invalid');
  const session = parseSession(raw.session);
  if (raw.operation === 'export' && Object.keys(raw).length === 3 &&
      typeof raw.segmentIndex === 'number' && Number.isInteger(raw.segmentIndex) && raw.segmentIndex >= 0 && raw.segmentIndex <= 4294967295)
    return { operation: 'export', session, segmentIndex: raw.segmentIndex };
  if ((raw.operation === 'import' || raw.operation === 'verify' || raw.operation === 'status') && Object.keys(raw).length === 2)
    return { operation: raw.operation, session };
  throw invalid('Presign transfer operation fields are invalid');
}

function parseSession(raw: unknown): Session {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 2) throw invalid('Presign session fields are invalid');
  return { presignSessionId: identity(raw.presignSessionId), serverPresignatureId: identity(raw.serverPresignatureId) };
}

export type PresignSourceRequest =
  | { readonly operation: 'inventory'; readonly cursor: Cursor; readonly limit: number; readonly session?: never }
  | { readonly operation: 'fence' | 'freeze'; readonly session: Session; readonly cursor?: never; readonly limit?: never };

export function parsePresignSourceRequest(raw: unknown): PresignSourceRequest {
  if (!isPlainObject(raw)) throw invalid('Presign source request is invalid');
  if (raw.operation === 'inventory' && Object.keys(raw).length === 3 &&
      typeof raw.limit === 'number' && Number.isInteger(raw.limit) && raw.limit >= 1 && raw.limit <= 128 && isPlainObject(raw.cursor)) {
    if (raw.cursor.kind === 'start' && Object.keys(raw.cursor).length === 1)
      return { operation: 'inventory', cursor: { kind: 'start' }, limit: raw.limit };
    if (raw.cursor.kind === 'after' && Object.keys(raw.cursor).length === 2)
      return { operation: 'inventory', cursor: { kind: 'after', presign_session_id: identity(raw.cursor.presign_session_id) }, limit: raw.limit };
  }
  if ((raw.operation === 'fence' || raw.operation === 'freeze') && Object.keys(raw).length === 2 &&
      isPlainObject(raw.session) && Object.keys(raw.session).length === 2) {
    return { operation: raw.operation, session: parseSession(raw.session) };
  }
  throw invalid('Presign source operation fields are invalid');
}

export async function authorizePresignSource(
  database: D1DatabaseLike, wallet: WalletOwnershipKey, writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt, request: PresignSourceRequest,
) {
  const authorized = await authorizeWalletRuntimeSourceCommand(database, wallet, writer, attempt, 'ecdsa-freeze');
  if (!authorized.ok) return authorized;
  if (authorized.command.operation !== 'ecdsa-freeze') throw new Error('Wallet freeze authority required');
  const source = authorized.command.payload;
  switch (request.operation) {
    case 'inventory':
      return { ok: true, command: { operation: 'inventory', payload: {
        scope: source.scope, request: source.request, cursor: request.cursor, limit: request.limit,
      } } } as const;
    case 'fence':
    case 'freeze':
      // The source participant checks both identities against its registered wallet
      // inventory before touching the session object.
      return { ok: true, command: { operation: request.operation, payload: {
        wallet_scope: source.scope, request: source.request,
        presign_session_id: request.session.presignSessionId, server_presignature_id: request.session.serverPresignatureId,
      } } } as const;
    default: {
      const unexpected: never = request;
      throw new Error(`Unknown presign source request: ${String(unexpected)}`);
    }
  }
}

export async function recordPresignSnapshot(
  database: D1DatabaseLike, wallet: WalletOwnershipKey, writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt, raw: unknown,
) {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 3 || !isPlainObject(raw.command))
    throw invalid('Presign snapshot receipt is invalid');
  const session: Session = {
    presignSessionId: identity(raw.command.presign_session_id), serverPresignatureId: identity(raw.command.server_presignature_id),
  };
  const authorized = await authorizePresignSource(database, wallet, writer, attempt, { operation: 'freeze', session });
  if (!authorized.ok) return authorized;
  if (authorized.command.operation !== 'freeze') throw new Error('Presign freeze authority required');
  const command = authorized.command.payload;
  const receipt = parseReceipt(raw, command);
  const encoded = JSON.stringify(receipt);
  const key = [wallet.namespace, wallet.organizationId, wallet.projectId, wallet.environmentId,
    wallet.walletId, attempt.moveId, session.presignSessionId];
  await database.prepare(`INSERT INTO wallet_presign_snapshots
    (namespace, organization_id, project_id, environment_id, wallet_id, move_id, presign_session_id, receipt_json)
    SELECT namespace, organization_id, project_id, environment_id, wallet_id, move_id, ?7, ?8
    FROM wallet_relocations WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
      AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6
      AND state = 'freezing' AND execution_state = 'running'
      AND execution_revision = ?9 AND execution_attempt_id = ?10
    ON CONFLICT DO NOTHING`).bind(...key, encoded, attempt.revision, attempt.id).run();
  const row = await queryD1One(database, `SELECT receipt_json FROM wallet_presign_snapshots
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6 AND presign_session_id = ?7`, key);
  if (row?.receipt_json !== encoded) return { ok: false, code: 'receipt_conflict' } as const;
  return { ok: true, receipt } as const;
}

function identity(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) throw invalid('Presign session identity is invalid');
  return raw;
}

function invalid(message: string): WalletPlacementError {
  return new WalletPlacementError('invalid_input', message);
}

function parseReceipt(raw: unknown, command: SessionCommand) {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 3 || !isPlainObject(raw.command))
    throw invalid('Presign snapshot receipt is invalid');
  const value = raw.command;
  if (value.presign_session_id !== command.presign_session_id || value.server_presignature_id !== command.server_presignature_id ||
      Object.keys(value).length !== 4 || !isPlainObject(value.wallet_scope) || Object.keys(value.wallet_scope).length !== 4 ||
      !isPlainObject(value.request) || Object.keys(value.request).length !== 3 ||
      value.wallet_scope.org_id !== command.wallet_scope.org_id || value.wallet_scope.project_id !== command.wallet_scope.project_id ||
      value.wallet_scope.project_environment_id !== command.wallet_scope.project_environment_id || value.wallet_scope.wallet_id !== command.wallet_scope.wallet_id ||
      value.request.move_id !== command.request.move_id || value.request.source_generation !== command.request.source_generation ||
      value.request.invalidated_at_ms !== command.request.invalidated_at_ms ||
      typeof raw.record_count !== 'number' || !Number.isSafeInteger(raw.record_count) || raw.record_count < 1)
    throw invalid('Presign snapshot differs from its admitted move');
  return { command, record_count: raw.record_count, records_digest_hex: relocationDigest(raw.records_digest_hex) };
}

export async function authorizePresignTransfer(
  database: D1DatabaseLike, wallet: WalletOwnershipKey, writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt, request: PresignTransferRequest,
) {
  if (writer.role !== 'walletRuntime') return { ok: false, code: 'participant_conflict' } as const;
  const kind = request.operation === 'export' ? 'export' : 'verify';
  const authorized = await WalletD1RelocationCommand.authorize(database, wallet, writer, attempt, kind);
  if (!authorized.ok) return authorized;
  const command = authorized.command;
  const row = await queryD1One(database, `SELECT snapshot.receipt_json, move.admitted_at_ms
    FROM wallet_presign_snapshots snapshot JOIN wallet_relocations move
      USING (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6 AND presign_session_id = ?7`,
    [wallet.namespace, wallet.organizationId, wallet.projectId, wallet.environmentId, wallet.walletId,
      command.moveId, request.session.presignSessionId]);
  if (typeof row?.receipt_json !== 'string') return { ok: false, code: 'source_manifest_unavailable' } as const;
  const receipt = parseReceipt(JSON.parse(row.receipt_json), {
    wallet_scope: { org_id: wallet.organizationId, project_id: wallet.projectId, project_environment_id: wallet.environmentId, wallet_id: wallet.walletId },
    request: { move_id: command.moveId, source_generation: kind === 'export' ? command.generation : command.generation - 1,
      invalidated_at_ms: relocationTimestamp(row.admitted_at_ms) },
    presign_session_id: request.session.presignSessionId, server_presignature_id: request.session.serverPresignatureId,
  });
  switch (request.operation) {
    case 'export': return { ok: true, command: { kind: 'export', receipt, segment_index: request.segmentIndex, chunk_bytes: 4096 } } as const;
    case 'import': return { ok: true, command: { kind: 'import', receipt, chunk_bytes: 4096 } } as const;
    case 'status': return { ok: true, command: { kind: 'status', receipt, chunk_bytes: 4096 } } as const;
    case 'verify': return { ok: true, command: { kind: 'verify', receipt } } as const;
    default: {
      const unexpected: never = request;
      throw new Error(`Unknown presign transfer request: ${String(unexpected)}`);
    }
  }
}
