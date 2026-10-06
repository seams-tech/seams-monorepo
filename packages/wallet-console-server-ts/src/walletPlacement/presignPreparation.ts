import { isPlainObject, sha256Bytes, type WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import { WalletPlacementError, type WalletHome } from './home';
import { relocationTimestamp } from './relocation';
import { preparationEvidenceDigest, type WalletRelocationParticipants } from './relocationPreparation';

type Command = Parameters<WalletRelocationParticipants['presignSessions']['prepare']>[0];
type Scope = {
  readonly org_id: string;
  readonly project_id: string;
  readonly project_environment_id: string;
  readonly wallet_id: string;
};
type Move = { readonly move_id: string; readonly source_generation: number };
type Session = {
  readonly presign_session_id: string;
  readonly server_presignature_id: string;
  readonly request_digest_hex: string;
};
type Page =
  | { readonly state: 'complete'; readonly sessions: readonly Session[]; readonly next?: never }
  | { readonly state: 'more'; readonly sessions: readonly Session[]; readonly next: string };
type Cursor = { readonly kind: 'start'; readonly presign_session_id?: never }
  | { readonly kind: 'after'; readonly presign_session_id: string };
const BASE = 'https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation';
const PAGE_SIZE = 128;

// Preparation observes a live inventory. Transfer must reconcile the fenced inventory.
export class PresignRelocationPreparation {
  constructor(
    private readonly destination: WalletHome,
    private readonly sourceRuntime: WalletRuntimeServiceBinding,
    private readonly destinationRuntime: WalletRuntimeServiceBinding,
    private readonly clock: () => number,
  ) {}

  async prepare(command: Command): Promise<unknown> {
    if (command.participant !== 'presignSessions' || !command.request.destination.matches(this.destination)) {
      throw new WalletPlacementError('invalid_input', 'Presign preparation destination conflicts');
    }
    const preparedAtMs = relocationTimestamp(this.clock());
    const expiresAtMs = preparedAtMs + 300_000;
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
    let cursor: Cursor = { kind: 'start' };
    let evidence = await preparationEvidenceDigest(['seams/presign/preparation/v1', command.requestDigest]);
    for (;;) {
      if (relocationTimestamp(this.clock()) >= expiresAtMs) return { kind: 'unavailable' };
      const page = parsePage(await call(this.sourceRuntime, 'presign-preparation-inventory', {
        scope, source_generation: request.source_generation, cursor, limit: PAGE_SIZE,
      }));
      if (!page) return { kind: 'unavailable' };
      let previous: string = cursor.kind === 'after' ? cursor.presign_session_id : '';
      for (const session of page.sessions) {
        if (!orderedAfter(session.presign_session_id, previous)) return { kind: 'unavailable' };
        previous = session.presign_session_id;
        if (relocationTimestamp(this.clock()) >= expiresAtMs) return { kind: 'unavailable' };
        const prepared = await call(this.destinationRuntime, 'presign-transfer', {
          kind: 'prepare',
          command: {
            wallet_scope: scope,
            presign_session_id: session.presign_session_id,
            server_presignature_id: session.server_presignature_id,
            request,
          },
          chunk_bytes: 4096,
        });
        if (!matchesPreparation(prepared, scope, request, session)) return { kind: 'unavailable' };
      }
      evidence = await preparationEvidenceDigest([evidence, page]);
      if (page.state === 'complete') break;
      if (page.next !== previous) return { kind: 'unavailable' };
      cursor = { kind: 'after', presign_session_id: page.next };
    }
    const objectInput = new TextEncoder().encode(`seams/signing-worker/wallet-do/v1${JSON.stringify(scope)}`);
    const objectDigest = Array.from(await sha256Bytes(objectInput), hexByte).join('');
    // The admission gate also requires SigningWorker's inactive wallet reservation.
    // This receipt covers the source inventory and its individual destination reservations.
    return {
      kind: 'prepared', admission: 'closed', participant: 'presignSessions',
      requestDigest: command.requestDigest,
      destinationGeneration: command.destinationGeneration,
      physicalResource: `signing-worker-wallet-${objectDigest}`,
      evidenceDigest: evidence,
      preparedAtMs, expiresAtMs,
    };
  }
}

async function call(runtime: WalletRuntimeServiceBinding, operation: 'presign-preparation-inventory' | 'presign-transfer', body: unknown): Promise<unknown> {
  const response = await runtime.fetch(new Request(`${BASE}/${operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  return response.status === 200 ? response.json() : null;
}

function parsePage(raw: unknown): Page | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.sessions) || raw.sessions.length > PAGE_SIZE) return null;
  const sessions: Session[] = [];
  for (const value of raw.sessions) {
    if (!isPlainObject(value) || Object.keys(value).length !== 3 ||
        typeof value.presign_session_id !== 'string' || !value.presign_session_id ||
        typeof value.server_presignature_id !== 'string' || !value.server_presignature_id ||
        typeof value.request_digest_hex !== 'string' || !/^[a-f0-9]{64}$/u.test(value.request_digest_hex)) return null;
    sessions.push({
      presign_session_id: value.presign_session_id,
      server_presignature_id: value.server_presignature_id,
      request_digest_hex: value.request_digest_hex,
    });
  }
  if (raw.state === 'complete' && Object.keys(raw).length === 2) return { state: 'complete', sessions };
  if (raw.state === 'more' && Object.keys(raw).length === 3 && sessions.length > 0 &&
      typeof raw.next_presign_session_id === 'string') {
    return { state: 'more', sessions, next: raw.next_presign_session_id };
  }
  return null;
}

function matchesPreparation(raw: unknown, scope: Scope, request: Move, session: Session): boolean {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 3 || raw.kind !== 'prepared' ||
      raw.chunk_bytes !== 4096 || !isPlainObject(raw.command) || Object.keys(raw.command).length !== 4) return false;
  const value = raw.command;
  return value.presign_session_id === session.presign_session_id &&
    value.server_presignature_id === session.server_presignature_id &&
    isPlainObject(value.wallet_scope) && Object.keys(value.wallet_scope).length === 4 &&
    value.wallet_scope.org_id === scope.org_id && value.wallet_scope.project_id === scope.project_id &&
    value.wallet_scope.project_environment_id === scope.project_environment_id && value.wallet_scope.wallet_id === scope.wallet_id &&
    isPlainObject(value.request) && Object.keys(value.request).length === 2 &&
    value.request.move_id === request.move_id && value.request.source_generation === request.source_generation;
}

// SQLite's BINARY collation orders UTF-8 bytes, including non-ASCII identities.
function orderedAfter(value: string, previous: string): boolean {
  const left = new TextEncoder().encode(value);
  const right = new TextEncoder().encode(previous);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return left.length > right.length;
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}
