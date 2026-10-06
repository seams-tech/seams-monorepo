import { isPlainObject, queryD1One, sha256Bytes, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletPlacementError, type WalletOwnershipKey } from './home';
import type { WalletRelocationAttempt } from './relocationExecution';
import { preparationEvidenceDigest } from './relocationPreparation';
import { authorizeWalletRuntimeSourceCommand } from './runtimeRelocationCommand';

type Role = 'deriverA' | 'deriverB';

export function parseDeriverRelocationRole(raw: unknown): Role {
  if (raw === 'deriverA' || raw === 'deriverB') return raw;
  throw new WalletPlacementError('invalid_input', 'Deriver relocation role is invalid');
}

// Reconstruct the exact destination preparation evidence before authorizing its source fence.
export async function authorizeDeriverSourceFence(
  database: D1DatabaseLike,
  wallet: WalletOwnershipKey,
  writer: TenantRuntimeWriterV1,
  attempt: WalletRelocationAttempt,
  role: Role,
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
  const rolePath = role === 'deriverA' ? 'deriver-a' : 'deriver-b';
  const encoded = new TextEncoder().encode(`seams/${rolePath}/wallet-do/v1${JSON.stringify(source.owner)}`);
  const objectDigest = Array.from(await sha256Bytes(encoded), hexByte).join('');
  const destinationObject = `${rolePath}-wallet-${objectDigest}`;
  const evidenceDigest = await preparationEvidenceDigest([
    'seams/deriver/preparation/v1', role, command, destinationObject,
  ]);
  const row = await queryD1One(database, `SELECT preparation_json FROM wallet_relocations
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6`, [
    wallet.namespace, wallet.organizationId, wallet.projectId, wallet.environmentId, wallet.walletId, attempt.moveId,
  ]);
  if (!row || typeof row.preparation_json !== 'string') return { ok: false, code: 'participant_conflict' } as const;
  const prepared: unknown = JSON.parse(row.preparation_json);
  if (!isPlainObject(prepared) || prepared.requestDigest !== source.request_digest_hex ||
      prepared.destinationGeneration !== source.destination_generation || !Array.isArray(prepared.receipts)) {
    return { ok: false, code: 'participant_conflict' } as const;
  }
  let matches = 0;
  for (const receipt of prepared.receipts) {
    if (!isPlainObject(receipt) || receipt.participant !== role) continue;
    if (receipt.physicalResource !== destinationObject || receipt.evidenceDigest !== evidenceDigest) {
      return { ok: false, code: 'participant_conflict' } as const;
    }
    matches += 1;
  }
  if (matches !== 1) return { ok: false, code: 'participant_conflict' } as const;
  return { ok: true, command } as const;
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}
