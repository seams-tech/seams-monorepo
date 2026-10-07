import type { RouterFreezeRequest } from './runtimeRelocationCommand';
import {
  isPlainObject,
  sha256Bytes,
  type WalletRuntimeServiceBinding,
} from '@seams/wallet-server/cloud-host';
import { WalletPlacementError, type WalletHome } from './home';
import { relocationTimestamp } from './relocation';
import { preparationEvidenceDigest, type WalletRelocationParticipants } from './relocationPreparation';

type Role = 'deriverA' | 'deriverB';
type Command = Parameters<WalletRelocationParticipants[Role]['prepare']>[0];
const ROLE_PATHS = { deriverA: 'deriver-a', deriverB: 'deriver-b' } as const;
const BASE = 'https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation';

// Both bindings must come from the verified source and destination resource catalog.
export class DeriverRelocationPreparation {
  constructor(
    private readonly role: Role,
    private readonly destination: WalletHome,
    private readonly sourceRuntime: WalletRuntimeServiceBinding,
    private readonly destinationRuntime: WalletRuntimeServiceBinding,
    private readonly clock: () => number,
  ) {}

  async prepare(command: Command): Promise<unknown> {
    if (command.participant !== this.role || !command.request.destination.matches(this.destination)) {
      throw new WalletPlacementError('invalid_input', 'Deriver preparation destination conflicts');
    }
    const preparedAtMs = relocationTimestamp(this.clock());
    const rolePath = ROLE_PATHS[this.role];
    const contextResponse = await this.sourceRuntime.fetch(new Request(`${BASE}/${rolePath}-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }));
    if (contextResponse.status !== 200) return { kind: 'unavailable' };
    const context: unknown = await contextResponse.json();
    if (
      !isPlainObject(context) || Object.keys(context).length !== 2 ||
      context.kind !== 'deriver_cipher_context' || typeof context.digest_hex !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(context.digest_hex)
    ) return { kind: 'unavailable' };
    const owner = {
      org_id: command.request.wallet.organizationId,
      project_id: command.request.wallet.projectId,
      env_id: command.request.wallet.environmentId,
      wallet_id: command.request.wallet.walletId,
    };
    const request = {
      owner,
      move_id: command.request.moveId,
      request_digest_hex: command.requestDigest,
      cipher_context_digest_hex: context.digest_hex,
      source_generation: command.request.expectedGeneration,
      destination_generation: command.destinationGeneration,
    };
    const response = await this.destinationRuntime.fetch(new Request(`${BASE}/${rolePath}-prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }));
    if (response.status !== 200) return { kind: 'unavailable' };
    const raw: unknown = await response.json();
    const destinationObject = await deriverWalletObject(this.role, owner);
    if (
      !isPlainObject(raw) || Object.keys(raw).length !== 3 || raw.kind !== 'prepared' ||
      raw.destination_object !== destinationObject ||
      !isPlainObject(raw.request) || Object.keys(raw.request).length !== 6 ||
      raw.request.move_id !== request.move_id ||
      raw.request.request_digest_hex !== request.request_digest_hex ||
      raw.request.cipher_context_digest_hex !== request.cipher_context_digest_hex ||
      raw.request.source_generation !== request.source_generation ||
      raw.request.destination_generation !== request.destination_generation ||
      !isPlainObject(raw.request.owner) || Object.keys(raw.request.owner).length !== 4 ||
      raw.request.owner.org_id !== owner.org_id || raw.request.owner.project_id !== owner.project_id ||
      raw.request.owner.env_id !== owner.env_id || raw.request.owner.wallet_id !== owner.wallet_id
    ) return { kind: 'unavailable' };
    return {
      kind: 'prepared',
      admission: 'closed',
      participant: this.role,
      requestDigest: command.requestDigest,
      destinationGeneration: command.destinationGeneration,
      physicalResource: destinationObject,
      evidenceDigest: await preparationEvidenceDigest([
        'seams/deriver/preparation/v1', this.role, request, destinationObject,
      ]),
      preparedAtMs,
      expiresAtMs: preparedAtMs + 300_000,
    };
  }
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}

export async function deriverWalletObject(role: Role, owner: RouterFreezeRequest['owner']): Promise<string> {
  const rolePath = ROLE_PATHS[role];
  const bytes = new TextEncoder().encode(`seams/${rolePath}/wallet-do/v1${JSON.stringify(owner)}`);
  const digest = Array.from(await sha256Bytes(bytes), hexByte).join('');
  return `${rolePath}-wallet-${digest}`;
}
