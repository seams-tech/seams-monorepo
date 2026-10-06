import { isPlainObject } from '@seams/wallet-server/cloud-host';
import { WalletPlacementError, type WalletHome } from './home';
import { relocationTimestamp } from './relocation';
import { WalletRegionalDispatch } from './regionalDispatch';
import { preparationEvidenceDigest, type WalletRelocationParticipants } from './relocationPreparation';

type Command = Parameters<WalletRelocationParticipants['gateway']['prepare']>[0];
const BASE = 'https://wallet-relocation.internal/internal/wallet-relocation/v1/authorization';

export class GatewayRelocationPreparation {
  constructor(
    private readonly source: WalletHome,
    private readonly destination: WalletHome,
    private readonly transport: WalletRegionalDispatch,
    private readonly clock: () => number,
  ) {}

  async prepare(command: Command): Promise<unknown> {
    if (command.participant !== 'gateway' || !command.request.destination.matches(this.destination)) {
      throw new WalletPlacementError('invalid_input', 'Gateway preparation destination conflicts');
    }
    const preparedAtMs = relocationTimestamp(this.clock());
    const schemaResponse = await this.transport.forward(this.source, new Request(`${BASE}/schema`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }));
    if (schemaResponse.status !== 200) return { kind: 'unavailable' };
    const schema: unknown = await schemaResponse.json();
    if (
      !isPlainObject(schema) || Object.keys(schema).length !== 2 ||
      schema.kind !== 'authorization_schema' || typeof schema.schemaDigestHex !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(schema.schemaDigestHex)
    ) return { kind: 'unavailable' };
    const source = {
      walletId: command.request.wallet.walletId,
      moveId: command.request.moveId,
      requestDigestHex: command.requestDigest,
      sourceGeneration: command.request.expectedGeneration,
    };
    const response = await this.transport.forward(this.destination, new Request(`${BASE}/reserve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, schemaDigestHex: schema.schemaDigestHex }),
    }));
    if (response.status !== 200) return { kind: 'unavailable' };
    const raw: unknown = await response.json();
    if (
      !isPlainObject(raw) || Object.keys(raw).length !== 3 ||
      raw.kind !== 'authorization_reserved' || raw.schemaDigestHex !== schema.schemaDigestHex ||
      !isPlainObject(raw.source) || Object.keys(raw.source).length !== 4 ||
      raw.source.walletId !== source.walletId || raw.source.moveId !== source.moveId ||
      raw.source.requestDigestHex !== source.requestDigestHex ||
      raw.source.sourceGeneration !== source.sourceGeneration
    ) return { kind: 'unavailable' };
    return {
      kind: 'prepared', admission: 'closed', participant: 'gateway',
      requestDigest: command.requestDigest,
      destinationGeneration: command.destinationGeneration,
      physicalResource: this.destination.databaseId,
      evidenceDigest: await preparationEvidenceDigest([
        'seams/gateway/preparation/v1', source, schema.schemaDigestHex, this.destination,
      ]),
      preparedAtMs,
      expiresAtMs: preparedAtMs + 300_000,
    };
  }
}
