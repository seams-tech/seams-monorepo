import { parseCustodyTargetPair, type CustodyTargetPair } from './custodyTargets';
import { WalletPlacementError } from './home';
import { WalletRelocationRequest, relocationTimestamp } from './relocation';

const PARTICIPANTS = [
  'gateway',
  'walletRuntime',
  'router',
  'deriverA',
  'deriverB',
  'signingWorker',
  'presignSessions',
] as const;

type Participant = (typeof PARTICIPANTS)[number];
type PreparationCommand = {
  readonly kind: 'prepare';
  readonly participant: Participant;
  readonly request: WalletRelocationRequest;
  readonly requestDigest: string;
  readonly destinationGeneration: number;
};
type PreparationTransport = {
  // Implementations use authenticated, role-local transport and verify schema,
  // key continuity, and inactive physical resources before returning a receipt.
  prepare(command: PreparationCommand): Promise<unknown>;
};
export type WalletRelocationParticipants = Readonly<Record<Participant, PreparationTransport>>;

type PreparationReceipt = {
  readonly physicalResource: string;
  readonly evidenceDigest: string;
  readonly preparedAtMs: number;
  readonly expiresAtMs: number;
} & (
  | { readonly participant: 'deriverA' | 'deriverB'; readonly physicalObjects: { readonly source: string; readonly destination: string } }
  | { readonly participant: Exclude<Participant, 'deriverA' | 'deriverB'>; readonly physicalObjects?: never }
) & (
  | { readonly participant: 'router' | 'deriverA' | 'deriverB' | 'signingWorker'; readonly custodyTargets: CustodyTargetPair; readonly custodyEvidenceDigest: string }
  | { readonly participant: 'presignSessions'; readonly custodyTargets: readonly CustodyTargetPair[]; readonly custodyEvidenceDigest: string }
  | { readonly participant: 'gateway' | 'walletRuntime'; readonly custodyTargets?: never; readonly custodyEvidenceDigest?: never }
);

function invalid(): never {
  throw new WalletPlacementError(
    'invalid_record',
    'Destination preparation is incomplete or conflicts',
  );
}

function readReceipt(raw: unknown, command: PreparationCommand, nowMs: number): PreparationReceipt {
  const deriver = command.participant === 'deriverA' || command.participant === 'deriverB';
  const custody = deriver || command.participant === 'router' || command.participant === 'signingWorker' || command.participant === 'presignSessions';
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== (deriver ? 12 : custody ? 11 : 9) ||
    !('kind' in raw) ||
    raw.kind !== 'prepared' ||
    !('admission' in raw) ||
    raw.admission !== 'closed' ||
    !('participant' in raw) ||
    raw.participant !== command.participant ||
    !('requestDigest' in raw) ||
    raw.requestDigest !== command.requestDigest ||
    !('destinationGeneration' in raw) ||
    raw.destinationGeneration !== command.destinationGeneration ||
    !('physicalResource' in raw) ||
    typeof raw.physicalResource !== 'string' ||
    raw.physicalResource.length === 0 ||
    raw.physicalResource.length > 512 ||
    raw.physicalResource.trim() !== raw.physicalResource ||
    !('evidenceDigest' in raw) ||
    typeof raw.evidenceDigest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(raw.evidenceDigest) ||
    !('preparedAtMs' in raw) ||
    !('expiresAtMs' in raw)
  )
    invalid();
  const preparedAtMs = relocationTimestamp(raw.preparedAtMs);
  const expiresAtMs = relocationTimestamp(raw.expiresAtMs);
  if (
    preparedAtMs > nowMs ||
    expiresAtMs <= nowMs ||
    expiresAtMs <= preparedAtMs ||
    expiresAtMs - preparedAtMs > 300_000
  )
    invalid();
  if (command.participant === 'deriverA' || command.participant === 'deriverB' ||
      command.participant === 'router' || command.participant === 'signingWorker') {
    if (!('custodyTargets' in raw) || !('custodyEvidenceDigest' in raw) ||
        typeof raw.custodyEvidenceDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.custodyEvidenceDigest)) invalid();
    const custodyTargets = parseCustodyTargetPair(raw.custodyTargets, command.request.expectedGeneration);
    const common = {
      physicalResource: raw.physicalResource, evidenceDigest: raw.evidenceDigest,
      preparedAtMs, expiresAtMs, custodyTargets, custodyEvidenceDigest: raw.custodyEvidenceDigest,
    };
    if (command.participant === 'router' || command.participant === 'signingWorker') {
      return Object.freeze({ ...common, participant: command.participant });
    }
    if (!('physicalObjects' in raw)) invalid();
    const physicalObjects = parseDeriverPhysicalObjects(raw.physicalObjects);
    return Object.freeze({
      participant: command.participant,
      ...common,
      physicalObjects,
    });
  }
  if (command.participant === 'presignSessions') {
    if (!('custodyTargets' in raw) || !Array.isArray(raw.custodyTargets) ||
        !('custodyEvidenceDigest' in raw) || typeof raw.custodyEvidenceDigest !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(raw.custodyEvidenceDigest)) invalid();
    const custodyTargets: CustodyTargetPair[] = [];
    for (const target of raw.custodyTargets) {
      custodyTargets.push(parseCustodyTargetPair(target, command.request.expectedGeneration));
    }
    return Object.freeze({
      participant: 'presignSessions', physicalResource: raw.physicalResource,
      evidenceDigest: raw.evidenceDigest, preparedAtMs, expiresAtMs,
      custodyTargets, custodyEvidenceDigest: raw.custodyEvidenceDigest,
    });
  }
  return Object.freeze({
    participant: command.participant,
    physicalResource: raw.physicalResource,
    evidenceDigest: raw.evidenceDigest,
    preparedAtMs,
    expiresAtMs,
  });
}

export function parseDeriverPhysicalObjects(raw: unknown): { readonly source: string; readonly destination: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 2 ||
      !('source' in raw) || typeof raw.source !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.source) ||
      !('destination' in raw) || typeof raw.destination !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.destination) ||
      raw.source === raw.destination) invalid();
  return Object.freeze({ source: raw.source, destination: raw.destination });
}

// Construction requires every role's authenticated preparation call to succeed.
// This capability authorizes admission only; it never authorizes destination writes.
export class WalletRelocationPreparation {
  readonly #validated = true;

  private constructor(
    readonly requestDigest: string,
    readonly destinationGeneration: number,
    readonly receipts: readonly PreparationReceipt[],
  ) {
    Object.freeze(receipts);
    Object.freeze(this);
  }

  static async prepare(
    request: WalletRelocationRequest,
    participants: WalletRelocationParticipants,
    clock: () => number,
  ): Promise<WalletRelocationPreparation> {
    const destinationGeneration = request.expectedGeneration + 1;
    if (!Number.isSafeInteger(destinationGeneration)) invalid();
    const requestDigest = await request.digest();
    const receipts: PreparationReceipt[] = [];
    for (const participant of PARTICIPANTS) {
      const command: PreparationCommand = {
        kind: 'prepare',
        participant,
        request,
        requestDigest,
        destinationGeneration,
      };
      const raw = await participants[participant].prepare(Object.freeze(command));
      const receipt = readReceipt(raw, command, relocationTimestamp(clock()));
      if (receipt.custodyTargets && receipt.custodyEvidenceDigest !==
          await preparationEvidenceDigest([requestDigest, participant, receipt.custodyTargets])) invalid();
      receipts.push(receipt);
    }
    const preparation = new WalletRelocationPreparation(
      requestDigest,
      destinationGeneration,
      receipts,
    );
    preparation.assertFor(requestDigest, destinationGeneration, relocationTimestamp(clock()));
    return preparation;
  }

  assertFor(requestDigest: string, destinationGeneration: number, nowMs: number): void {
    if (
      !this.#validated ||
      this.requestDigest !== requestDigest ||
      this.destinationGeneration !== destinationGeneration ||
      this.receipts.length !== PARTICIPANTS.length
    )
      invalid();
    for (const receipt of this.receipts) {
      if (receipt.preparedAtMs > nowMs || receipt.expiresAtMs <= nowMs) invalid();
    }
  }
}

export async function preparationEvidenceDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, hexByte).join('');
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}
