import { isPlainObject, queryD1One, type D1DatabaseLike, type WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletPlacementError } from './home';
import { WalletRelocationRequest, relocationTimestamp } from './relocation';
import { preparationEvidenceDigest, type WalletRelocationParticipants } from './relocationPreparation';

type Command = Parameters<WalletRelocationParticipants['walletRuntime']['prepare']>[0];
const URL = 'https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/prepare';

// Gateway reserves the shared database first. Runtime independently reads that reservation.
export async function handleRuntimeRelocationPreparation(
  request: Request,
  database: D1DatabaseLike,
  namespace: string,
  writer: TenantRuntimeWriterV1,
): Promise<Response | null> {
  if (request.url !== URL) return null;
  if (request.method !== 'POST') return Response.json({ kind: 'rejected' }, { status: 405 });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 8192) return Response.json({ kind: 'rejected' }, { status: 413 });
  let move: WalletRelocationRequest;
  try {
    move = WalletRelocationRequest.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return Response.json({ kind: 'rejected' }, { status: 400 });
  }
  if (writer.role !== 'walletRuntime' || move.wallet.namespace !== namespace ||
      move.destination.accountId !== writer.resource.accountId ||
      move.destination.databaseId !== writer.resource.databaseId) {
    return Response.json({ kind: 'rejected' }, { status: 409 });
  }
  const requestDigest = await move.digest();
  const row = await queryD1One(database, `SELECT state FROM wallet_relocation_authorization_imports
    WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
      AND wallet_id = ?5 AND move_id = ?6 AND request_digest_hex = ?7 AND source_generation = ?8`, [
    move.wallet.namespace, move.wallet.organizationId, move.wallet.projectId, move.wallet.environmentId,
    move.wallet.walletId, move.moveId, requestDigest, move.expectedGeneration,
  ]);
  if (!row || row.state !== 'importing') return Response.json({ kind: 'rejected' }, { status: 409 });
  return Response.json({ kind: 'runtime_prepared', requestDigest, writer });
}

export class RuntimeRelocationPreparation {
  constructor(
    private readonly writer: TenantRuntimeWriterV1,
    private readonly runtime: WalletRuntimeServiceBinding,
    private readonly clock: () => number,
  ) {}

  async prepare(command: Command): Promise<unknown> {
    if (command.participant !== 'walletRuntime' || this.writer.role !== 'walletRuntime' ||
        command.request.destination.accountId !== this.writer.resource.accountId ||
        command.request.destination.databaseId !== this.writer.resource.databaseId) {
      throw new WalletPlacementError('invalid_input', 'Runtime preparation destination conflicts');
    }
    const preparedAtMs = relocationTimestamp(this.clock());
    const response = await this.runtime.fetch(new Request(URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command.request),
    }));
    if (response.status !== 200) return { kind: 'unavailable' };
    const raw: unknown = await response.json();
    if (!isPlainObject(raw) || Object.keys(raw).length !== 3 || raw.kind !== 'runtime_prepared' ||
        raw.requestDigest !== command.requestDigest || !isPlainObject(raw.writer) ||
        Object.keys(raw.writer).length !== 3 || raw.writer.role !== 'walletRuntime' ||
        raw.writer.versionId !== this.writer.versionId || !isPlainObject(raw.writer.resource) ||
        Object.keys(raw.writer.resource).length !== 2 ||
        raw.writer.resource.accountId !== this.writer.resource.accountId ||
        raw.writer.resource.databaseId !== this.writer.resource.databaseId) return { kind: 'unavailable' };
    return {
      kind: 'prepared', admission: 'closed', participant: 'walletRuntime',
      requestDigest: command.requestDigest,
      destinationGeneration: command.destinationGeneration,
      physicalResource: this.writer.resource.databaseId,
      evidenceDigest: await preparationEvidenceDigest(['seams/runtime/preparation/v1', command.requestDigest, this.writer]),
      preparedAtMs, expiresAtMs: preparedAtMs + 300_000,
    };
  }
}
