import { isPlainObject, type WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import { WalletPlacementError, type WalletHome } from './home';
import { relocationTimestamp } from './relocation';
import { preparationEvidenceDigest, type WalletRelocationParticipants } from './relocationPreparation';

type Command = Parameters<WalletRelocationParticipants['signingWorker']['prepare']>[0];
type Scope = {
  readonly org_id: string;
  readonly project_id: string;
  readonly project_environment_id: string;
  readonly wallet_id: string;
};
type Move = { readonly move_id: string; readonly source_generation: number };
type RuntimePreparation =
  | {
      readonly operation: 'ed25519-snapshot';
      readonly body: {
        readonly command: 'prepare';
        readonly source: { readonly scope: Scope; readonly request: Move };
      };
    }
  | {
      readonly operation: 'ecdsa-transfer';
      readonly body: {
        readonly kind: 'prepare';
        readonly scope: Scope;
        readonly request: Move;
        readonly chunk_bytes: 4096;
      };
    };

export class SigningWorkerRelocationPreparation {
  constructor(
    private readonly destination: WalletHome,
    private readonly runtime: WalletRuntimeServiceBinding,
    private readonly clock: () => number,
  ) {}

  async prepare(command: Command): Promise<unknown> {
    if (command.participant !== 'signingWorker' || !command.request.destination.matches(this.destination)) {
      throw new WalletPlacementError('invalid_input', 'SigningWorker preparation destination conflicts');
    }
    const scope: Scope = {
      org_id: command.request.wallet.organizationId,
      project_id: command.request.wallet.projectId,
      project_environment_id: command.request.wallet.environmentId,
      wallet_id: command.request.wallet.walletId,
    };
    const request: Move = {
      move_id: command.request.moveId,
      source_generation: command.request.expectedGeneration,
    };
    const preparedAtMs = relocationTimestamp(this.clock());
    const ed25519 = await prepareRole(this.runtime, {
      operation: 'ed25519-snapshot',
      body: { command: 'prepare', source: { scope, request } },
    });
    if (
      !isPlainObject(ed25519) ||
      Object.keys(ed25519).length !== 3 ||
      ed25519.state !== 'prepared' ||
      !isObjectName(ed25519.destination_object) ||
      !isPlainObject(ed25519.source) ||
      Object.keys(ed25519.source).length !== 2 ||
      !matchesScope(ed25519.source.scope, scope) ||
      !matchesMove(ed25519.source.request, request)
    ) return { kind: 'unavailable' };
    const ecdsa = await prepareRole(this.runtime, {
      operation: 'ecdsa-transfer',
      body: { kind: 'prepare', scope, request, chunk_bytes: 4096 },
    });
    if (
      !isPlainObject(ecdsa) ||
      Object.keys(ecdsa).length !== 5 ||
      ecdsa.kind !== 'prepared' ||
      ecdsa.destination_object !== ed25519.destination_object ||
      ecdsa.chunk_bytes !== 4096 ||
      !matchesScope(ecdsa.scope, scope) ||
      !matchesMove(ecdsa.request, request)
    ) return { kind: 'unavailable' };
    return {
      kind: 'prepared',
      admission: 'closed',
      participant: 'signingWorker',
      requestDigest: command.requestDigest,
      destinationGeneration: command.destinationGeneration,
      physicalResource: ed25519.destination_object,
      evidenceDigest: await preparationEvidenceDigest([
        'seams/signing-worker/preparation/v1', scope, request, ed25519.destination_object, 4096,
      ]),
      preparedAtMs,
      expiresAtMs: preparedAtMs + 300_000,
    };
  }
}

async function prepareRole(runtime: WalletRuntimeServiceBinding, command: RuntimePreparation): Promise<unknown> {
  const response = await runtime.fetch(new Request(
    `https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/${command.operation}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command.body) },
  ));
  if (response.status !== 200) return null;
  return response.json();
}

function isObjectName(value: unknown): value is string {
  return typeof value === 'string' && /^signing-worker-wallet-[a-f0-9]{64}$/u.test(value);
}

function matchesMove(raw: unknown, expected: Move): boolean {
  return isPlainObject(raw) && Object.keys(raw).length === 2 &&
    raw.move_id === expected.move_id && raw.source_generation === expected.source_generation;
}

function matchesScope(raw: unknown, expected: Scope): boolean {
  return isPlainObject(raw) && Object.keys(raw).length === 4 &&
    raw.org_id === expected.org_id && raw.project_id === expected.project_id &&
    raw.project_environment_id === expected.project_environment_id && raw.wallet_id === expected.wallet_id;
}
