import {
  WalletHome,
  WalletOwnershipKey,
  WalletPlacementError,
  parseWalletOwnershipGeneration,
} from './home';

export const WALLET_RELOCATION_COOLDOWN_MS = 5 * 60_000;

function relocationRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WalletPlacementError('invalid_input', 'Wallet relocation record is invalid');
  }
  return raw as Record<string, unknown>;
}

function relocationId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^wmove_[A-Za-z0-9_-]{43}$/u.test(raw)) {
    throw new WalletPlacementError('invalid_input', 'Wallet relocation identity is invalid');
  }
  return raw;
}

function relocationDigest(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/u.test(raw)) {
    throw new WalletPlacementError('invalid_record', 'Wallet relocation digest is invalid');
  }
  return raw;
}

export function relocationTimestamp(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    throw new WalletPlacementError('invalid_record', 'Wallet relocation timestamp is invalid');
  }
  return raw;
}

type RelocationParticipants = {
  readonly gateway: string;
  readonly walletRuntime: string;
  readonly router: string;
  readonly deriverA: string;
  readonly deriverB: string;
  readonly signingWorker: string;
  readonly presignSessions: string;
};

function participantDigests(raw: unknown): RelocationParticipants {
  const value = relocationRecord(raw);
  if (Object.keys(value).length !== 7) {
    throw new WalletPlacementError(
      'invalid_record',
      'Wallet relocation participant set is invalid',
    );
  }
  return Object.freeze({
    gateway: relocationDigest(value.gateway),
    walletRuntime: relocationDigest(value.walletRuntime),
    router: relocationDigest(value.router),
    deriverA: relocationDigest(value.deriverA),
    deriverB: relocationDigest(value.deriverB),
    signingWorker: relocationDigest(value.signingWorker),
    presignSessions: relocationDigest(value.presignSessions),
  });
}

export class WalletRelocationRequest {
  readonly #validated = true;

  private constructor(
    readonly wallet: WalletOwnershipKey,
    readonly moveId: string,
    readonly destination: WalletHome,
    readonly expectedGeneration: number,
    readonly authorityId: string,
  ) {
    Object.freeze(this);
  }

  static parse(raw: unknown): WalletRelocationRequest {
    const value = relocationRecord(raw);
    if (
      Object.keys(value).length !== 5 ||
      typeof value.authorityId !== 'string' ||
      !/^wallet-authority:[A-Za-z0-9_-]+$/u.test(value.authorityId)
    ) {
      throw new WalletPlacementError('invalid_input', 'Wallet relocation request is invalid');
    }
    return new WalletRelocationRequest(
      WalletOwnershipKey.parse(value.wallet),
      relocationId(value.moveId),
      WalletHome.parse(value.destination),
      parseWalletOwnershipGeneration(value.expectedGeneration),
      value.authorityId,
    );
  }

  matches(move: WalletRelocation): boolean {
    return (
      this.#validated &&
      this.wallet.matches(move.wallet) &&
      this.moveId === move.moveId &&
      this.destination.matches(move.destination) &&
      this.expectedGeneration === move.sourceGeneration &&
      this.authorityId === move.authorityId
    );
  }

  async digest(): Promise<string> {
    const bytes = new TextEncoder().encode(
      JSON.stringify([
        'seams/wallet-relocation/v1',
        this.wallet,
        this.moveId,
        this.destination,
        this.expectedGeneration,
        this.authorityId,
      ]),
    );
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest, byteHex).join('');
  }
}

function byteHex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

type ReceiptKind = 'source_fence' | 'destination_verification';

export class WalletRelocationReceipt<Kind extends ReceiptKind = ReceiptKind> {
  readonly #validated = true;

  private constructor(
    readonly kind: Kind,
    readonly wallet: WalletOwnershipKey,
    readonly moveId: string,
    readonly home: WalletHome,
    readonly generation: number,
    readonly recordedAtMs: number,
    readonly participants: RelocationParticipants,
  ) {
    Object.freeze(this);
  }

  static parse<Kind extends ReceiptKind>(raw: unknown, kind: Kind): WalletRelocationReceipt<Kind> {
    const value = relocationRecord(raw);
    if (Object.keys(value).length !== 7 || value.kind !== kind) {
      throw new WalletPlacementError('invalid_record', 'Wallet relocation receipt is invalid');
    }
    return new WalletRelocationReceipt(
      kind,
      WalletOwnershipKey.parse(value.wallet),
      relocationId(value.moveId),
      WalletHome.parse(value.home),
      parseWalletOwnershipGeneration(value.generation),
      relocationTimestamp(value.recordedAtMs),
      participantDigests(value.participants),
    );
  }

  matches(move: WalletRelocation): boolean {
    const home = this.kind === 'source_fence' ? move.source : move.destination;
    const generation =
      this.kind === 'source_fence' ? move.sourceGeneration : move.destinationGeneration;
    return (
      this.#validated &&
      this.wallet.matches(move.wallet) &&
      this.moveId === move.moveId &&
      this.home.matches(home) &&
      this.generation === generation &&
      this.recordedAtMs >= move.admittedAtMs
    );
  }
}

export type WalletRelocationProgress =
  | {
      readonly state: 'freezing';
      readonly sourceFence?: never;
      readonly destinationVerification?: never;
      readonly cutoverAtMs?: never;
      readonly completedAtMs?: never;
    }
  | {
      readonly state: 'copying';
      readonly sourceFence: WalletRelocationReceipt<'source_fence'>;
      readonly destinationVerification?: never;
      readonly cutoverAtMs?: never;
      readonly completedAtMs?: never;
    }
  | {
      readonly state: 'verified';
      readonly sourceFence: WalletRelocationReceipt<'source_fence'>;
      readonly destinationVerification: WalletRelocationReceipt<'destination_verification'>;
      readonly cutoverAtMs?: never;
      readonly completedAtMs?: never;
    }
  | {
      readonly state: 'cutover';
      readonly sourceFence: WalletRelocationReceipt<'source_fence'>;
      readonly destinationVerification: WalletRelocationReceipt<'destination_verification'>;
      readonly cutoverAtMs: number;
      readonly completedAtMs?: never;
    }
  | {
      readonly state: 'completed';
      readonly sourceFence: WalletRelocationReceipt<'source_fence'>;
      readonly destinationVerification: WalletRelocationReceipt<'destination_verification'>;
      readonly cutoverAtMs: number;
      readonly completedAtMs: number;
    };

export class WalletRelocation {
  readonly #validated = true;

  private constructor(
    readonly wallet: WalletOwnershipKey,
    readonly moveId: string,
    readonly requestDigest: string,
    readonly authorityId: string,
    readonly source: WalletHome,
    readonly destination: WalletHome,
    readonly sourceGeneration: number,
    readonly destinationGeneration: number,
    readonly admittedAtMs: number,
    readonly progress: WalletRelocationProgress,
  ) {
    Object.freeze(progress);
    Object.freeze(this);
  }

  static fromRow(row: Record<string, unknown>): WalletRelocation {
    const wallet = WalletOwnershipKey.parse({
      namespace: row.namespace,
      organizationId: row.organization_id,
      projectId: row.project_id,
      environmentId: row.environment_id,
      walletId: row.wallet_id,
    });
    const moveId = relocationId(row.move_id);
    const source = WalletHome.parse({
      region: row.source_region,
      accountId: row.source_account_id,
      databaseId: row.source_database_id,
    });
    const destination = WalletHome.parse({
      region: row.destination_region,
      accountId: row.destination_account_id,
      databaseId: row.destination_database_id,
    });
    const sourceGeneration = parseWalletOwnershipGeneration(row.source_generation);
    const destinationGeneration = parseWalletOwnershipGeneration(row.destination_generation);
    const admittedAtMs = relocationTimestamp(row.admitted_at_ms);
    if (
      source.region === destination.region ||
      source.databaseId === destination.databaseId ||
      destinationGeneration !== sourceGeneration + 1 ||
      typeof row.authority_id !== 'string' ||
      !/^wallet-authority:[A-Za-z0-9_-]+$/u.test(row.authority_id)
    ) {
      throw new WalletPlacementError(
        'invalid_record',
        'Stored wallet relocation identity is invalid',
      );
    }
    const progress = progressFromRow(row);
    const move = new WalletRelocation(
      wallet,
      moveId,
      relocationDigest(row.request_digest),
      row.authority_id,
      source,
      destination,
      sourceGeneration,
      destinationGeneration,
      admittedAtMs,
      progress,
    );
    if (
      (progress.state !== 'freezing' && !progress.sourceFence.matches(move)) ||
      ((progress.state === 'verified' ||
        progress.state === 'cutover' ||
        progress.state === 'completed') &&
        (!progress.destinationVerification.matches(move) ||
          progress.destinationVerification.recordedAtMs < progress.sourceFence.recordedAtMs))
    ) {
      throw new WalletPlacementError(
        'invalid_record',
        'Stored wallet relocation receipt is inconsistent',
      );
    }
    if (
      (progress.state === 'cutover' || progress.state === 'completed') &&
      progress.cutoverAtMs < progress.destinationVerification.recordedAtMs
    ) {
      throw new WalletPlacementError('invalid_record', 'Wallet relocation cutover time is invalid');
    }
    return move;
  }

  matchesRequest(request: WalletRelocationRequest, digest: string): boolean {
    return this.#validated && request.matches(this) && this.requestDigest === digest;
  }
}

function receiptFromJson<Kind extends ReceiptKind>(
  raw: unknown,
  kind: Kind,
): WalletRelocationReceipt<Kind> {
  if (typeof raw !== 'string') {
    throw new WalletPlacementError('invalid_record', 'Stored wallet relocation receipt is missing');
  }
  return WalletRelocationReceipt.parse(JSON.parse(raw), kind);
}

function progressFromRow(row: Record<string, unknown>): WalletRelocationProgress {
  switch (row.state) {
    case 'freezing':
      if (
        row.source_fence_json !== null ||
        row.destination_verification_json !== null ||
        row.cutover_at_ms !== null ||
        row.completed_at_ms !== null
      )
        break;
      return { state: 'freezing' };
    case 'copying':
      if (
        row.destination_verification_json !== null ||
        row.cutover_at_ms !== null ||
        row.completed_at_ms !== null
      )
        break;
      return {
        state: 'copying',
        sourceFence: receiptFromJson(row.source_fence_json, 'source_fence'),
      };
    case 'verified':
      if (row.cutover_at_ms !== null || row.completed_at_ms !== null) break;
      return {
        state: 'verified',
        sourceFence: receiptFromJson(row.source_fence_json, 'source_fence'),
        destinationVerification: receiptFromJson(
          row.destination_verification_json,
          'destination_verification',
        ),
      };
    case 'cutover':
      if (row.completed_at_ms !== null) break;
      return {
        state: 'cutover',
        sourceFence: receiptFromJson(row.source_fence_json, 'source_fence'),
        destinationVerification: receiptFromJson(
          row.destination_verification_json,
          'destination_verification',
        ),
        cutoverAtMs: relocationTimestamp(row.cutover_at_ms),
      };
    case 'completed': {
      const cutoverAtMs = relocationTimestamp(row.cutover_at_ms);
      const completedAtMs = relocationTimestamp(row.completed_at_ms);
      if (completedAtMs < cutoverAtMs) break;
      return {
        state: 'completed',
        sourceFence: receiptFromJson(row.source_fence_json, 'source_fence'),
        destinationVerification: receiptFromJson(
          row.destination_verification_json,
          'destination_verification',
        ),
        cutoverAtMs,
        completedAtMs,
      };
    }
  }
  throw new WalletPlacementError('invalid_record', 'Stored wallet relocation progress is invalid');
}
