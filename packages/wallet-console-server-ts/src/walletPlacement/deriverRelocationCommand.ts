import { isPlainObject, queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletPlacementError, type WalletOwnershipKey } from './home';
import type { WalletRelocationAttempt } from './relocationExecution';
import { preparationEvidenceDigest } from './relocationPreparation';
import { deriverWalletObject } from './deriverPreparation';
import { authorizeWalletRuntimeSourceCommand, type RouterFreezeRequest } from './runtimeRelocationCommand';

export type DeriverRelocationRole = 'deriverA' | 'deriverB';
export type DeriverSourceRequest = RouterFreezeRequest & { readonly cipher_context_digest_hex: string };

export function parseDeriverRelocationRole(raw: unknown): DeriverRelocationRole {
  if (raw === 'deriverA' || raw === 'deriverB') return raw;
  throw new WalletPlacementError('invalid_input', 'Deriver relocation role is invalid');
}

// Reconstruct the exact destination preparation evidence before authorizing its source fence.
export async function authorizeDeriverSourceFence(
  database: D1DatabaseLike,
  wallet: WalletOwnershipKey,
  writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt,
  role: DeriverRelocationRole,
  cipherContextDigest: string,
) {
  const authorized = await authorizeWalletRuntimeSourceCommand(database, wallet, writer, attempt, 'router-freeze');
  if (!authorized.ok) return authorized;
  if (authorized.command.operation !== 'router-freeze') return { ok: false, code: 'participant_conflict' } as const;
  const source = authorized.command.payload;
  const command = {
    owner: source.owner,
    move_id: source.move_id,
    request_digest_hex: source.request_digest_hex,
    cipher_context_digest_hex: cipherContextDigest,
    source_generation: source.source_generation,
    destination_generation: source.destination_generation,
  };
  if (!await matchesDeriverPreparation(database, wallet, role, command)) {
    return { ok: false, code: 'participant_conflict' } as const;
  }
  return { ok: true, command } as const;
}

export async function matchesDeriverPreparation(
  database: D1DatabaseLike,
  wallet: WalletOwnershipKey,
  role: DeriverRelocationRole,
  command: DeriverSourceRequest,
): Promise<boolean> {
  const destinationObject = await deriverWalletObject(role, command.owner);
  const evidenceDigest = await preparationEvidenceDigest([
    'seams/deriver/preparation/v1', role, command, destinationObject,
  ]);
  const row = await queryD1One(database, `SELECT preparation_json FROM wallet_relocations
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6`, [
    wallet.namespace, wallet.organizationId, wallet.projectId, wallet.environmentId, wallet.walletId, command.move_id,
  ]);
  if (!row || typeof row.preparation_json !== 'string') return false;
  const prepared: unknown = JSON.parse(row.preparation_json);
  if (!isPlainObject(prepared) || prepared.requestDigest !== command.request_digest_hex ||
      prepared.destinationGeneration !== command.destination_generation || !Array.isArray(prepared.receipts)) {
    return false;
  }
  let matches = 0;
  for (const receipt of prepared.receipts) {
    if (!isPlainObject(receipt) || receipt.participant !== role) continue;
    if (receipt.physicalResource !== destinationObject || receipt.evidenceDigest !== evidenceDigest) {
      return false;
    }
    matches += 1;
  }
  if (matches !== 1) return false;
  return true;
}
