import { isPlainObject, queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletPlacementError, type WalletOwnershipKey } from './home';
import { relocationDigest } from './relocation';
import type { WalletRelocationAttempt } from './relocationExecution';
import { authorizeWalletRuntimeSourceCommand } from './runtimeRelocationCommand';

type Cursor = { readonly kind: 'start'; readonly presign_session_id?: never }
  | { readonly kind: 'after'; readonly presign_session_id: string };
type Session = { readonly presignSessionId: string; readonly serverPresignatureId: string };

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
    return { operation: raw.operation, session: {
      presignSessionId: identity(raw.session.presignSessionId), serverPresignatureId: identity(raw.session.serverPresignatureId),
    } };
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
  const value = raw.command;
  if (Object.keys(value).length !== 4 || !isPlainObject(value.wallet_scope) || Object.keys(value.wallet_scope).length !== 4 ||
      !isPlainObject(value.request) || Object.keys(value.request).length !== 3 ||
      value.wallet_scope.org_id !== command.wallet_scope.org_id || value.wallet_scope.project_id !== command.wallet_scope.project_id ||
      value.wallet_scope.project_environment_id !== command.wallet_scope.project_environment_id || value.wallet_scope.wallet_id !== command.wallet_scope.wallet_id ||
      value.request.move_id !== command.request.move_id || value.request.source_generation !== command.request.source_generation ||
      value.request.invalidated_at_ms !== command.request.invalidated_at_ms ||
      typeof raw.record_count !== 'number' || !Number.isSafeInteger(raw.record_count) || raw.record_count < 1)
    throw invalid('Presign snapshot differs from its admitted move');
  const receipt = { command, record_count: raw.record_count, records_digest_hex: relocationDigest(raw.records_digest_hex) };
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
