import { WalletOwnershipKey, WalletPlacementError } from './home';

export type WalletRelocationPhase = 'freezing' | 'copying' | 'verified' | 'cutover';
export type WalletRelocationFailure =
  | 'transport_unavailable'
  | 'authority_unavailable'
  | 'identity_conflict'
  | 'receipt_conflict'
  | 'content_conflict';

export function relocationPhase(raw: unknown): WalletRelocationPhase {
  switch (raw) {
    case 'freezing':
    case 'copying':
    case 'verified':
    case 'cutover':
      return raw;
    default:
      throw new WalletPlacementError('invalid_record', 'Relocation execution phase is invalid');
  }
}

export function relocationFailure(raw: unknown): WalletRelocationFailure {
  switch (raw) {
    case 'transport_unavailable':
    case 'authority_unavailable':
    case 'identity_conflict':
    case 'receipt_conflict':
    case 'content_conflict':
      return raw;
    default:
      throw new WalletPlacementError('invalid_record', 'Relocation execution failure is invalid');
  }
}

export function relocationAttemptId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^wattempt_[A-Za-z0-9_-]{43}$/u.test(raw)) {
    throw new WalletPlacementError('invalid_input', 'Relocation attempt identity is invalid');
  }
  return raw;
}

function executionInteger(raw: unknown, minimum: number): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < minimum) {
    throw new WalletPlacementError('invalid_record', 'Relocation execution number is invalid');
  }
  return raw;
}

export function relocationRetryDelay(
  attempt: number,
  code: WalletRelocationFailure,
): number | null {
  if (code !== 'transport_unavailable' && code !== 'authority_unavailable') return null;
  if (attempt >= 6) return null;
  return 1_000 * 2 ** (attempt - 1);
}

export class WalletRelocationAttempt {
  readonly #validated = true;

  private constructor(
    readonly wallet: WalletOwnershipKey,
    readonly moveId: string,
    readonly phase: WalletRelocationPhase,
    readonly id: string,
    readonly revision: number,
    readonly run: number,
    readonly number: number,
    readonly startedAtMs: number,
  ) {
    Object.freeze(this);
  }

  static parse(raw: unknown): WalletRelocationAttempt {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new WalletPlacementError('invalid_record', 'Relocation attempt is invalid');
    }
    const value = raw as Record<string, unknown>;
    if (
      Object.keys(value).length !== 8 ||
      typeof value.moveId !== 'string' ||
      !/^wmove_[A-Za-z0-9_-]{43}$/u.test(value.moveId)
    ) {
      throw new WalletPlacementError('invalid_record', 'Relocation attempt scope is invalid');
    }
    const number = executionInteger(value.number, 1);
    if (number > 6) {
      throw new WalletPlacementError('invalid_record', 'Relocation attempt budget is invalid');
    }
    return new WalletRelocationAttempt(
      WalletOwnershipKey.parse(value.wallet),
      value.moveId,
      relocationPhase(value.phase),
      relocationAttemptId(value.id),
      executionInteger(value.revision, 1),
      executionInteger(value.run, 1),
      number,
      executionInteger(value.startedAtMs, 1),
    );
  }

  matches(other: WalletRelocationAttempt): boolean {
    return (
      this.#validated &&
      other.#validated &&
      this.wallet.matches(other.wallet) &&
      this.moveId === other.moveId &&
      this.phase === other.phase &&
      this.id === other.id &&
      this.revision === other.revision &&
      this.run === other.run &&
      this.number === other.number &&
      this.startedAtMs === other.startedAtMs
    );
  }
}

export type WalletRelocationExecution =
  | {
      readonly state: 'ready';
      readonly revision: number;
      readonly run: number;
      readonly attempt?: never;
      readonly code?: never;
      readonly retryAtMs?: never;
    }
  | {
      readonly state: 'running';
      readonly attempt: WalletRelocationAttempt;
      readonly code?: never;
      readonly retryAtMs?: never;
    }
  | {
      readonly state: 'retry_wait';
      readonly attempt: WalletRelocationAttempt;
      readonly code: 'transport_unavailable' | 'authority_unavailable';
      readonly retryAtMs: number;
    }
  | {
      readonly state: 'blocked';
      readonly attempt: WalletRelocationAttempt;
      readonly code: WalletRelocationFailure;
      readonly retryAtMs?: never;
    };

export function relocationExecutionFromRow(
  row: Record<string, unknown>,
): WalletRelocationExecution {
  const revision = executionInteger(row.execution_revision, 0);
  const run = executionInteger(row.execution_run, 1);
  if (row.execution_state === 'ready') {
    if (
      row.execution_attempt !== 0 ||
      row.execution_attempt_id !== null ||
      row.execution_started_at_ms !== null ||
      row.execution_error !== null ||
      row.execution_retry_at_ms !== null
    ) {
      throw new WalletPlacementError('invalid_record', 'Ready relocation execution is invalid');
    }
    return { state: 'ready', revision, run };
  }
  const attempt = WalletRelocationAttempt.parse({
    wallet: {
      namespace: row.namespace,
      organizationId: row.organization_id,
      projectId: row.project_id,
      environmentId: row.environment_id,
      walletId: row.wallet_id,
    },
    moveId: row.move_id,
    phase: row.state,
    id: row.execution_attempt_id,
    revision,
    run,
    number: row.execution_attempt,
    startedAtMs: row.execution_started_at_ms,
  });
  if (attempt.startedAtMs < executionInteger(row.admitted_at_ms, 1)) {
    throw new WalletPlacementError('invalid_record', 'Relocation attempt predates admission');
  }
  switch (row.execution_state) {
    case 'running':
      if (row.execution_error !== null || row.execution_retry_at_ms !== null) break;
      return { state: 'running', attempt };
    case 'retry_wait': {
      const code = relocationFailure(row.execution_error);
      if (code !== 'transport_unavailable' && code !== 'authority_unavailable') break;
      const delay = relocationRetryDelay(attempt.number, code);
      const retryAtMs = executionInteger(row.execution_retry_at_ms, 1);
      if (delay === null || retryAtMs < attempt.startedAtMs + delay) break;
      return { state: 'retry_wait', attempt, code, retryAtMs };
    }
    case 'blocked': {
      const code = relocationFailure(row.execution_error);
      if (row.execution_retry_at_ms !== null || relocationRetryDelay(attempt.number, code) !== null)
        break;
      return { state: 'blocked', attempt, code };
    }
  }
  throw new WalletPlacementError('invalid_record', 'Relocation execution state is invalid');
}
