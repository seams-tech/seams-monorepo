import { isPlainObject, queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletPlacementError, type WalletOwnershipKey } from './home';
import { relocationDigest } from './relocation';
import { WalletD1RelocationCommand } from './relocationCommands';
import type { WalletRelocationAttempt } from './relocationExecution';
import { deriverWalletObject } from './deriverPreparation';
import { authorizeDeriverSourceFence, matchesDeriverPreparation,
  type DeriverRelocationRole, type DeriverSourceRequest } from './deriverRelocationCommand';

export type DeriverTransferRequest =
  | { readonly operation: 'export'; readonly segmentIndex: number }
  | { readonly operation: 'import' | 'status' | 'verify' | 'activate' | 'cleanup'; readonly segmentIndex?: never };

export function parseDeriverTransferRequest(raw: unknown): DeriverTransferRequest {
  if (!isPlainObject(raw)) throw invalid('Deriver transfer request is invalid');
  if (raw.operation === 'export' && Object.keys(raw).length === 2 &&
      typeof raw.segmentIndex === 'number' && Number.isInteger(raw.segmentIndex) &&
      raw.segmentIndex >= 0 && raw.segmentIndex <= 4294967295) {
    return { operation: 'export', segmentIndex: raw.segmentIndex };
  }
  if (Object.keys(raw).length === 1 &&
      (raw.operation === 'import' || raw.operation === 'status' || raw.operation === 'verify' || raw.operation === 'activate' || raw.operation === 'cleanup')) {
    return { operation: raw.operation };
  }
  throw invalid('Deriver transfer operation or cursor is invalid');
}

export async function recordDeriverSnapshot(
  database: D1DatabaseLike, wallet: WalletOwnershipKey, writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt, role: DeriverRelocationRole, raw: unknown,
) {
  if (!isPlainObject(raw) || !isPlainObject(raw.source)) throw invalid('Deriver snapshot receipt is invalid');
  const authorized = await authorizeDeriverSourceFence(database, wallet, writer, attempt, role,
    relocationDigest(raw.source.cipher_context_digest_hex));
  if (!authorized.ok) return authorized;
  const receipt = await parseReceipt(raw, role, authorized.command);
  const encoded = JSON.stringify(receipt);
  const identity = scope(wallet, attempt.moveId, role);
  await database.prepare(`INSERT INTO wallet_deriver_snapshots
    (namespace, organization_id, project_id, environment_id, wallet_id, move_id, role, receipt_json)
    SELECT namespace, organization_id, project_id, environment_id, wallet_id, move_id, ?7, ?8
    FROM wallet_relocations WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
      AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6
      AND state = 'freezing' AND execution_state = 'running'
      AND execution_revision = ?9 AND execution_attempt_id = ?10
    ON CONFLICT DO NOTHING`).bind(...identity, encoded, attempt.revision, attempt.id).run();
  const row = await queryD1One(database, `SELECT receipt_json FROM wallet_deriver_snapshots
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6 AND role = ?7`, identity);
  if (row?.receipt_json !== encoded) return { ok: false, code: 'receipt_conflict' } as const;
  return { ok: true, receipt } as const;
}

export async function authorizeDeriverTransfer(
  database: D1DatabaseLike, wallet: WalletOwnershipKey, writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt, role: DeriverRelocationRole, request: DeriverTransferRequest,
) {
  if (writer.role !== 'walletRuntime') return { ok: false, code: 'participant_conflict' } as const;
  let kind: 'export' | 'verify' | 'activate' | 'cleanup' = 'verify';
  if (request.operation === 'export') kind = 'export';
  else if (request.operation === 'activate') kind = 'activate';
  else if (request.operation === 'cleanup') kind = 'cleanup';
  const authorized = await WalletD1RelocationCommand.authorize(database, wallet, writer, attempt, kind);
  if (!authorized.ok) return authorized;
  const command = authorized.command;
  const row = await queryD1One(database, `SELECT receipt_json FROM wallet_deriver_snapshots
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6 AND role = ?7`, scope(wallet, command.moveId, role));
  if (typeof row?.receipt_json !== 'string') return { ok: false, code: 'source_manifest_unavailable' } as const;
  const raw: unknown = JSON.parse(row.receipt_json);
  if (!isPlainObject(raw) || !isPlainObject(raw.source)) throw invalid('Stored Deriver snapshot is invalid');
  const fromSource = request.operation === 'export' || request.operation === 'cleanup';
  const sourceGeneration = fromSource ? command.generation : command.generation - 1;
  const source: DeriverSourceRequest = {
    owner: { org_id: wallet.organizationId, project_id: wallet.projectId, env_id: wallet.environmentId, wallet_id: wallet.walletId },
    move_id: command.moveId, request_digest_hex: command.requestDigest,
    cipher_context_digest_hex: relocationDigest(raw.source.cipher_context_digest_hex),
    source_generation: sourceGeneration, destination_generation: sourceGeneration + 1,
  };
  const receipt = await parseReceipt(raw, role, source);
  if (!await matchesDeriverPreparation(database, wallet, role, source)) {
    return { ok: false, code: 'participant_conflict' } as const;
  }
  switch (request.operation) {
    case 'export':
      if (request.segmentIndex >= receipt.segment_count) return { ok: false, code: 'invalid_cursor' } as const;
      return { ok: true, command: { operation: 'export', source, segment_index: request.segmentIndex } } as const;
    case 'activate': return { ok: true, command: { operation: 'activate', receipt } } as const;
    case 'cleanup': {
      const row = await queryD1One(database, `SELECT receipt_json FROM wallet_deriver_activations
        WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
          AND wallet_id = ?5 AND move_id = ?6 AND role = ?7`, scope(wallet, command.moveId, role));
      if (typeof row?.receipt_json !== 'string') return { ok: false, code: 'activation_receipt_unavailable' } as const;
      const activation = await parseActivation(JSON.parse(row.receipt_json), role, receipt);
      return { ok: true, command: { operation: 'cleanup', activation } } as const;
    }
    case 'import': return { ok: true, command: { operation: 'import', receipt } } as const;
    case 'status': return { ok: true, command: { operation: 'status', receipt } } as const;
    case 'verify': return { ok: true, command: { operation: 'verify', receipt } } as const;
    default: {
      const unexpected: never = request;
      throw new Error(`Unknown Deriver transfer request: ${String(unexpected)}`);
    }
  }
}

async function parseReceipt(raw: unknown, role: DeriverRelocationRole, expected: DeriverSourceRequest) {
  const object = await deriverWalletObject(role, expected.owner);
  if (!isPlainObject(raw) || Object.keys(raw).length !== 5 ||
      !isPlainObject(raw.source) || Object.keys(raw.source).length !== 6 ||
      !isPlainObject(raw.source.owner) || Object.keys(raw.source.owner).length !== 4 ||
      raw.source.owner.org_id !== expected.owner.org_id || raw.source.owner.project_id !== expected.owner.project_id ||
      raw.source.owner.env_id !== expected.owner.env_id || raw.source.owner.wallet_id !== expected.owner.wallet_id ||
      raw.source.move_id !== expected.move_id || raw.source.request_digest_hex !== expected.request_digest_hex ||
      raw.source.cipher_context_digest_hex !== expected.cipher_context_digest_hex ||
      raw.source.source_generation !== expected.source_generation || raw.source.destination_generation !== expected.destination_generation ||
      raw.source_object !== object || !count(raw.record_count) || !count(raw.segment_count) ||
      raw.record_count > raw.segment_count || (raw.record_count === 0) !== (raw.segment_count === 0)) {
    throw invalid('Deriver snapshot receipt differs from its prepared move');
  }
  return { source: expected, source_object: object, record_count: raw.record_count,
    segment_count: raw.segment_count, digest_hex: relocationDigest(raw.digest_hex) };
}

function count(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 4294967295;
}

function scope(wallet: WalletOwnershipKey, moveId: string, role: DeriverRelocationRole) {
  return [wallet.namespace, wallet.organizationId, wallet.projectId, wallet.environmentId, wallet.walletId, moveId, role];
}

function invalid(message: string): WalletPlacementError {
  return new WalletPlacementError('invalid_input', message);
}


export async function recordDeriverActivation(
  database: D1DatabaseLike, wallet: WalletOwnershipKey, writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt, role: DeriverRelocationRole, raw: unknown,
) {
  const authorized = await authorizeDeriverTransfer(database, wallet, writer, attempt, role, { operation: 'activate' });
  if (!authorized.ok) return authorized;
  if (authorized.command.operation !== 'activate') throw new Error('Deriver activation requires an activation command');
  const receipt = await parseActivation(raw, role, authorized.command.receipt);
  const identity = scope(wallet, attempt.moveId, role);
  const encoded = JSON.stringify(receipt);
  await database.prepare(`INSERT INTO wallet_deriver_activations
    (namespace, organization_id, project_id, environment_id, wallet_id, move_id, role, receipt_json)
    SELECT namespace, organization_id, project_id, environment_id, wallet_id, move_id, ?7, ?8
    FROM wallet_relocations WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
      AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6
      AND state = 'cutover' AND destination_activation_json IS NULL AND execution_state = 'running'
      AND execution_revision = ?9 AND execution_attempt_id = ?10
      AND (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(json_extract(value, '$.physicalResource')) END
        FROM json_each(wallet_relocations.preparation_json, '$.receipts')
        WHERE json_extract(value, '$.participant') = ?7) = ?11
    ON CONFLICT DO NOTHING`).bind(...identity, encoded, attempt.revision, attempt.id, receipt.destination_object).run();
  const row = await queryD1One(database, `SELECT receipt_json FROM wallet_deriver_activations
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6 AND role = ?7`, identity);
  if (row?.receipt_json !== encoded) return { ok: false, code: 'receipt_conflict' } as const;
  return { ok: true, receipt } as const;
}

async function parseActivation(raw: unknown, role: DeriverRelocationRole, expected: Awaited<ReturnType<typeof parseReceipt>>) {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 2 || raw.destination_object !== expected.source_object) {
    throw invalid('Deriver activation destination differs from preparation');
  }
  const source = await parseReceipt(raw.source, role, expected.source);
  if (JSON.stringify(source) !== JSON.stringify(expected)) throw invalid('Deriver activation snapshot differs');
  return { source, destination_object: expected.source_object };
}
