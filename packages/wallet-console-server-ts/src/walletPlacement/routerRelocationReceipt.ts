import { WalletD1RelocationCommand } from './relocationCommands';
import { isPlainObject, queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletOwnershipKey, WalletPlacementError } from './home';
import type { WalletRelocationAttempt } from './relocationExecution';
import {
  authorizeWalletRuntimeSourceCommand,
  type RouterFreezeRequest,
} from './runtimeRelocationCommand';

// Store only the receipt of the journal-authorized source request. The Router
// remains responsible for constructing and verifying its inventory digest.
export async function recordRouterRelocationReceipt(
  database: D1DatabaseLike,
  wallet: WalletOwnershipKey,
  writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt,
  raw: unknown,
) {
  const authorized = await authorizeWalletRuntimeSourceCommand(
    database,
    wallet,
    writer,
    attempt,
    'router-freeze',
  );
  if (!authorized.ok) return authorized;
  if (authorized.command.operation !== 'router-freeze')
    throw new Error('Router receipt requires a Router command');
  const expected = authorized.command.payload;
  const receipt = parseRouterReceipt(raw, expected);
  const encoded = JSON.stringify(receipt);
  const identity = [
    wallet.namespace,
    wallet.organizationId,
    wallet.projectId,
    wallet.environmentId,
    wallet.walletId,
    expected.move_id,
  ];
  await database
    .prepare(
      `UPDATE wallet_relocations SET router_source_receipt_json = ?7
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
      AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6
      AND state = 'freezing' AND execution_state = 'running'
      AND execution_revision = ?8 AND execution_attempt_id = ?9
      AND (router_source_receipt_json IS NULL OR router_source_receipt_json = ?7)`,
    )
    .bind(...identity, encoded, attempt.revision, attempt.id)
    .run();
  const row = await queryD1One(
    database,
    `SELECT router_source_receipt_json FROM wallet_relocations
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
      AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6`,
    identity,
  );
  if (row?.router_source_receipt_json !== encoded)
    return { ok: false, code: 'receipt_conflict' } as const;
  return { ok: true, receipt } as const;
}

function parseRouterReceipt(raw: unknown, expected: RouterFreezeRequest) {
  if (
    !isPlainObject(raw) ||
    Object.keys(raw).length !== 3 ||
    !isPlainObject(raw.request) ||
    Object.keys(raw.request).length !== 5 ||
    !isPlainObject(raw.request.owner) ||
    Object.keys(raw.request.owner).length !== 4 ||
    raw.request.owner.org_id !== expected.owner.org_id ||
    raw.request.owner.project_id !== expected.owner.project_id ||
    raw.request.owner.env_id !== expected.owner.env_id ||
    raw.request.owner.wallet_id !== expected.owner.wallet_id ||
    raw.request.move_id !== expected.move_id ||
    raw.request.request_digest_hex !== expected.request_digest_hex ||
    raw.request.source_generation !== expected.source_generation ||
    raw.request.destination_generation !== expected.destination_generation ||
    typeof raw.records_digest_hex !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(raw.records_digest_hex) ||
    typeof raw.record_count !== 'number' ||
    !Number.isSafeInteger(raw.record_count) ||
    raw.record_count < 0
  )
    throw new WalletPlacementError('invalid_input', 'Router source receipt is invalid');
  return {
    request: expected,
    records_digest_hex: raw.records_digest_hex,
    record_count: raw.record_count,
  };
}

export async function authorizeRouterExport(
  database: D1DatabaseLike,
  wallet: WalletOwnershipKey,
  writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt,
  recordIndex: unknown,
  segmentIndex: unknown,
) {
  if (
    typeof recordIndex !== 'number' ||
    !Number.isSafeInteger(recordIndex) ||
    recordIndex < 0 ||
    typeof segmentIndex !== 'number' ||
    !Number.isSafeInteger(segmentIndex) ||
    segmentIndex < 0 ||
    segmentIndex > 4294967295
  )
    throw new WalletPlacementError('invalid_input', 'Router export cursor is invalid');
  if (writer.role !== 'walletRuntime') return { ok: false, code: 'participant_conflict' } as const;
  const authorized = await WalletD1RelocationCommand.authorize(
    database,
    wallet,
    writer,
    attempt,
    'export',
  );
  if (!authorized.ok) return authorized;
  const command = authorized.command;
  const row = await queryD1One(
    database,
    `SELECT router_source_receipt_json FROM wallet_relocations
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
      AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6`,
    [
      wallet.namespace,
      wallet.organizationId,
      wallet.projectId,
      wallet.environmentId,
      wallet.walletId,
      command.moveId,
    ],
  );
  if (typeof row?.router_source_receipt_json !== 'string')
    return { ok: false, code: 'source_manifest_unavailable' } as const;
  const receipt = parseRouterReceipt(JSON.parse(row.router_source_receipt_json), {
    owner: {
      org_id: wallet.organizationId,
      project_id: wallet.projectId,
      env_id: wallet.environmentId,
      wallet_id: wallet.walletId,
    },
    move_id: command.moveId,
    request_digest_hex: command.requestDigest,
    source_generation: command.generation,
    destination_generation: command.generation + 1,
  });
  if (recordIndex >= receipt.record_count) return { ok: false, code: 'invalid_cursor' } as const;
  return {
    ok: true,
    command: {
      kind: 'export',
      receipt,
      record_index: recordIndex,
      segment_index: segmentIndex,
      chunk_bytes: 4096,
    },
  } as const;
}
