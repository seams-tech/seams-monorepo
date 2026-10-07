import { isPlainObject, sha256Bytes, type WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import { WalletPlacementError, type WalletHome } from './home';
import { relocationTimestamp } from './relocation';
import { preparationEvidenceDigest, type WalletRelocationParticipants } from './relocationPreparation';

type Command = Parameters<WalletRelocationParticipants['router']['prepare']>[0];

// The caller selects this binding from the verified destination resource catalog.
export class RouterRelocationPreparation {
  constructor(
    private readonly destination: WalletHome,
    private readonly runtime: WalletRuntimeServiceBinding,
    private readonly clock: () => number,
  ) {}

  async prepare(command: Command): Promise<unknown> {
    if (command.participant !== 'router' || !command.request.destination.matches(this.destination)) {
      throw new WalletPlacementError('invalid_input', 'Router preparation destination conflicts');
    }
    const request = {
      owner: {
        org_id: command.request.wallet.organizationId,
        project_id: command.request.wallet.projectId,
        env_id: command.request.wallet.environmentId,
        wallet_id: command.request.wallet.walletId,
      },
      move_id: command.request.moveId,
      request_digest_hex: command.requestDigest,
      source_generation: command.request.expectedGeneration,
      destination_generation: command.destinationGeneration,
    };
    const preparedAtMs = relocationTimestamp(this.clock());
    const response = await this.runtime.fetch(new Request(
      'https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/router-transfer',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'prepare', request, chunk_bytes: 4096 }),
      },
    ));
    if (response.status !== 200) return { kind: 'unavailable' };
    const raw: unknown = await response.json();
    const objectInput = new TextEncoder().encode(
      `seams/router/wallet-do/v2${JSON.stringify([request.owner, command.destinationGeneration])}`,
    );
    const objectDigest = Array.from(await sha256Bytes(objectInput), hexByte).join('');
    const destinationObject = `router-wallet-${objectDigest}`;
    if (
      !isPlainObject(raw) ||
      Object.keys(raw).length !== 4 ||
      raw.kind !== 'prepared' ||
      raw.chunk_bytes !== 4096 ||
      raw.destination_object !== destinationObject ||
      !isPlainObject(raw.request) ||
      Object.keys(raw.request).length !== 5 ||
      raw.request.move_id !== request.move_id ||
      raw.request.request_digest_hex !== request.request_digest_hex ||
      raw.request.source_generation !== request.source_generation ||
      raw.request.destination_generation !== request.destination_generation ||
      !isPlainObject(raw.request.owner) ||
      Object.keys(raw.request.owner).length !== 4 ||
      raw.request.owner.org_id !== request.owner.org_id ||
      raw.request.owner.project_id !== request.owner.project_id ||
      raw.request.owner.env_id !== request.owner.env_id ||
      raw.request.owner.wallet_id !== request.owner.wallet_id
    ) return { kind: 'unavailable' };
    return {
      kind: 'prepared',
      admission: 'closed',
      participant: 'router',
      requestDigest: command.requestDigest,
      destinationGeneration: command.destinationGeneration,
      physicalResource: raw.destination_object,
      evidenceDigest: await preparationEvidenceDigest([
        'seams/router/preparation/v1', request, raw.destination_object, raw.chunk_bytes,
      ]),
      preparedAtMs,
      expiresAtMs: preparedAtMs + 300_000,
    };
  }
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}
