import { queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  storedRuntimeVersionMatches,
  type TenantRuntimeWriterV1,
} from '../tenantDeployment/resourceVerification';
import { WalletHome, WalletOwnershipKey, WalletPlacementError } from './home';
import type { WalletRelocationReceipt } from './relocation';
import { WalletRelocationAttempt } from './relocationExecution';
import { readWalletPlacementStatus } from './relocationStatus';

type CommandEvidence =
  | { readonly kind: 'freeze'; readonly receipt?: never; readonly physicalResource?: never }
  | {
      readonly kind: 'verify';
      readonly receipt: WalletRelocationReceipt<'source_fence'>;
      readonly physicalResource: string;
    }
  | {
      readonly kind: 'activate';
      readonly receipt: WalletRelocationReceipt<'destination_verification'>;
      readonly physicalResource: string;
    }
  | {
      readonly kind: 'cleanup';
      readonly receipt: WalletRelocationReceipt<'destination_activation'>;
      readonly physicalResource?: never;
    };

// These commands control the participant's move protocol. They never authorize signing.
export class WalletD1RelocationCommand {
  readonly #validated = true;
  readonly id: string;

  private constructor(
    readonly wallet: WalletOwnershipKey,
    readonly moveId: string,
    readonly requestDigest: string,
    readonly participant: TenantRuntimeWriterV1['role'],
    readonly versionId: string,
    readonly home: WalletHome,
    readonly generation: number,
    readonly operation: CommandEvidence,
  ) {
    this.id = `${moveId}/${participant}/${operation.kind}`;
    Object.freeze(operation);
    Object.freeze(this);
  }

  // Retry attempts are deliberately excluded: retries must identify the same local work.
  async digest(): Promise<string> {
    if (!this.#validated) throw new Error('Relocation command is unvalidated');
    const bytes = new TextEncoder().encode(
      JSON.stringify([
        'seams/wallet-d1-relocation-command/v1',
        this.wallet,
        this.moveId,
        this.requestDigest,
        this.participant,
        this.versionId,
        this.home,
        this.generation,
        this.operation,
      ]),
    );
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), hexByte).join(
      '',
    );
  }

  // This read admits a command, not its effects. The participant must serialize
  // effects with its local fence and persist the result under the command identity.
  static async authorize(
    database: D1DatabaseLike,
    wallet: WalletOwnershipKey,
    writer: TenantRuntimeWriterV1,
    attempt: WalletRelocationAttempt,
    kind: CommandEvidence['kind'],
  ): Promise<CommandAuthorization> {
    if (!attempt.wallet.matches(wallet)) return { ok: false, code: 'attempt_conflict' };
    const status = await readWalletPlacementStatus(database, wallet);
    if (status.state !== 'moving') return { ok: false, code: 'move_not_pending' };
    const move = status.move;
    const progress = move.progress;
    if (
      progress.state === 'completed' ||
      progress.execution.state !== 'running' ||
      !progress.execution.attempt.matches(attempt)
    ) {
      return { ok: false, code: 'attempt_conflict' };
    }
    const resources = await queryD1One(
      database,
      `SELECT resource_verifications_json,
         (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(json_extract(value, '$.physicalResource')) END
          FROM json_each(wallet_relocations.preparation_json, '$.receipts')
          WHERE json_extract(value, '$.participant') = ?7
            AND json_extract(wallet_relocations.preparation_json, '$.requestDigest') = request_digest
            AND json_extract(wallet_relocations.preparation_json, '$.destinationGeneration') = destination_generation
         ) AS prepared_resource
       FROM wallet_relocations
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
         AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6`,
      [
        wallet.namespace,
        wallet.organizationId,
        wallet.projectId,
        wallet.environmentId,
        wallet.walletId,
        move.moveId,
        writer.role,
      ],
    );
    if (!resources || !storedRuntimeVersionMatches(resources.resource_verifications_json, writer)) {
      return { ok: false, code: 'participant_conflict' };
    }
    let operation: CommandEvidence;
    let home: WalletHome;
    let generation: number;
    switch (kind) {
      case 'freeze':
        if (progress.state !== 'freezing') return { ok: false, code: 'phase_conflict' };
        operation = { kind: 'freeze' };
        home = move.source;
        generation = move.sourceGeneration;
        break;
      case 'verify':
        if (progress.state !== 'copying') return { ok: false, code: 'phase_conflict' };
        if (!isPhysicalResource(resources.prepared_resource)) {
          return { ok: false, code: 'participant_conflict' };
        }
        operation = {
          kind: 'verify',
          receipt: progress.sourceFence,
          physicalResource: resources.prepared_resource,
        };
        home = move.destination;
        generation = move.destinationGeneration;
        break;
      case 'activate':
        if (progress.state !== 'cutover' || progress.activation.state !== 'awaiting_activation') {
          return { ok: false, code: 'phase_conflict' };
        }
        if (!isPhysicalResource(resources.prepared_resource)) {
          return { ok: false, code: 'participant_conflict' };
        }
        operation = {
          kind: 'activate',
          receipt: progress.destinationVerification,
          physicalResource: resources.prepared_resource,
        };
        home = move.destination;
        generation = move.destinationGeneration;
        break;
      case 'cleanup':
        if (progress.state !== 'cutover' || progress.activation.state !== 'activated') {
          return { ok: false, code: 'phase_conflict' };
        }
        operation = { kind: 'cleanup', receipt: progress.activation.receipt };
        home = move.source;
        generation = move.sourceGeneration;
        break;
      default: {
        const unexpected: never = kind;
        throw new Error(`Unknown relocation command: ${String(unexpected)}`);
      }
    }
    if (
      writer.resource.accountId !== home.accountId ||
      writer.resource.databaseId !== home.databaseId
    ) {
      return { ok: false, code: 'participant_conflict' };
    }
    return {
      ok: true,
      command: new WalletD1RelocationCommand(
        wallet,
        move.moveId,
        move.requestDigest,
        writer.role,
        writer.versionId,
        home,
        generation,
        operation,
      ),
    };
  }
}

type CommandAuthorization =
  | { readonly ok: true; readonly command: WalletD1RelocationCommand; readonly code?: never }
  | {
      readonly ok: false;
      readonly code:
        | 'move_not_pending'
        | 'attempt_conflict'
        | 'phase_conflict'
        | 'participant_conflict';
      readonly command?: never;
    };

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}

export function parseWalletRelocationCommandKind(raw: unknown): CommandEvidence['kind'] {
  switch (raw) {
    case 'freeze':
    case 'verify':
    case 'activate':
    case 'cleanup':
      return raw;
    default:
      throw new WalletPlacementError('invalid_input', 'Relocation command kind is invalid');
  }
}

function isPhysicalResource(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 512 && raw.trim() === raw;
}
