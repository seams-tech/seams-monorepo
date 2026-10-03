import { queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { walletHomeAssignmentFromRow } from './d1';
import {
  WalletHomeCatalog,
  WalletOwnershipKey,
  WalletPlacementError,
  type WalletHomeAssignment,
} from './home';
import {
  WALLET_RELOCATION_COOLDOWN_MS,
  WalletRelocation,
  WalletRelocationReceipt,
  WalletRelocationRequest,
  relocationTimestamp,
} from './relocation';

export type WalletRelocationAdmission =
  | {
      readonly ok: true;
      readonly disposition: 'admitted' | 'reused';
      readonly move: WalletRelocation;
      readonly assignment?: never;
    }
  | {
      readonly ok: true;
      readonly disposition: 'unchanged';
      readonly assignment: WalletHomeAssignment & { readonly state: 'established' };
      readonly move?: never;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'not_found'
        | 'wallet_not_established'
        | 'stale_generation'
        | 'request_conflict'
        | 'move_in_progress';
      readonly retryAtMs?: never;
    }
  | { readonly ok: false; readonly code: 'cooldown'; readonly retryAtMs: number };

export type WalletRelocationTransition =
  | { readonly ok: true; readonly move: WalletRelocation }
  | {
      readonly ok: false;
      readonly code: 'not_found' | 'request_conflict' | 'phase_conflict' | 'receipt_conflict';
    };

function walletBindings(wallet: WalletOwnershipKey): string[] {
  return [
    wallet.namespace,
    wallet.organizationId,
    wallet.projectId,
    wallet.environmentId,
    wallet.walletId,
  ];
}

function moveBindings(request: WalletRelocationRequest): string[] {
  return [...walletBindings(request.wallet), request.moveId];
}

function sameReceipt(left: WalletRelocationReceipt, right: WalletRelocationReceipt): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Trusted move orchestration supplies owner authorization and role receipts before these transitions.
export class D1WalletRelocations {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly catalog: WalletHomeCatalog,
  ) {}

  async find(request: WalletRelocationRequest): Promise<WalletRelocation | null> {
    const row = await queryD1One(
      this.database,
      `SELECT * FROM wallet_relocations WHERE namespace = ?1 AND organization_id = ?2
       AND project_id = ?3 AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6`,
      moveBindings(request),
    );
    return row ? WalletRelocation.fromRow(row) : null;
  }

  async admit(request: WalletRelocationRequest, nowMs: number): Promise<WalletRelocationAdmission> {
    const admittedAtMs = relocationTimestamp(nowMs);
    if (!this.catalog.admits(request.destination)) {
      throw new WalletPlacementError(
        'invalid_input',
        'Wallet relocation destination is not admitted',
      );
    }
    const digest = await request.digest();
    const existing = await this.find(request);
    if (existing) {
      return existing.matchesRequest(request, digest)
        ? { ok: true, disposition: 'reused', move: existing }
        : { ok: false, code: 'request_conflict' };
    }
    const homeRow = await this.readHome(request.wallet);
    const rejection = await this.admissionRejection(homeRow, request, admittedAtMs);
    if (rejection) {
      const raced = await this.find(request);
      if (raced) {
        return raced.matchesRequest(request, digest)
          ? { ok: true, disposition: 'reused', move: raced }
          : { ok: false, code: 'request_conflict' };
      }
      return rejection;
    }
    if (!homeRow) throw new WalletPlacementError('invalid_record', 'Wallet home disappeared');
    const assignment = walletHomeAssignmentFromRow(homeRow);
    if (assignment.state !== 'established') {
      throw new WalletPlacementError('invalid_record', 'Wallet home is not established');
    }
    if (assignment.home.matches(request.destination)) {
      return { ok: true, disposition: 'unchanged', assignment };
    }
    if (!Number.isSafeInteger(request.expectedGeneration + 1)) {
      throw new WalletPlacementError('invalid_record', 'Wallet ownership generation is exhausted');
    }

    // Admission and the source pause are one transaction, including racing owner requests.
    const inserted = await this.database
      .prepare(
        `INSERT INTO wallet_relocations (namespace, organization_id, project_id, environment_id,
         wallet_id, move_id, request_digest, authority_id, source_region, source_account_id,
         source_database_id, destination_region, destination_account_id, destination_database_id,
         source_generation, destination_generation, state, admitted_at_ms)
       SELECT home.namespace, home.organization_id, home.project_id, home.environment_id,
         home.wallet_id, ?6, ?7, ?8, home.region, home.account_id, home.database_id,
         ?9, ?10, ?11, home.ownership_generation, home.ownership_generation + 1, 'freezing', ?12
       FROM wallet_homes home WHERE home.namespace = ?1 AND home.organization_id = ?2
         AND home.project_id = ?3 AND home.environment_id = ?4 AND home.wallet_id = ?5
         AND home.state = 'established' AND home.placement_state = 'active'
         AND home.ownership_generation = ?13
         AND NOT EXISTS (SELECT 1 FROM wallet_relocations prior
           WHERE prior.namespace = ?1 AND prior.organization_id = ?2 AND prior.project_id = ?3
             AND prior.environment_id = ?4 AND prior.wallet_id = ?5
             AND (prior.move_id = ?6 OR prior.state != 'completed' OR prior.admitted_at_ms + ?14 > ?12))
       RETURNING move_id`,
      )
      .bind(
        ...moveBindings(request),
        digest,
        request.authorityId,
        request.destination.region,
        request.destination.accountId,
        request.destination.databaseId,
        admittedAtMs,
        request.expectedGeneration,
        WALLET_RELOCATION_COOLDOWN_MS,
      )
      .first<string>('move_id');
    const committed = await this.find(request);
    if (committed) {
      if (!committed.matchesRequest(request, digest))
        return { ok: false, code: 'request_conflict' };
      return {
        ok: true,
        disposition: inserted === request.moveId ? 'admitted' : 'reused',
        move: committed,
      };
    }
    const conflict = await this.admissionRejection(
      await this.readHome(request.wallet),
      request,
      admittedAtMs,
    );
    if (conflict) return conflict;
    throw new WalletPlacementError('invalid_record', 'Wallet relocation admission disappeared');
  }

  async recordSourceFence(
    request: WalletRelocationRequest,
    receipt: WalletRelocationReceipt<'source_fence'>,
  ): Promise<WalletRelocationTransition> {
    const current = await this.readMatching(request);
    if (!current.ok) return current;
    if (!receipt.matches(current.move)) return { ok: false, code: 'receipt_conflict' };
    if (current.move.progress.state !== 'freezing') {
      return sameReceipt(current.move.progress.sourceFence, receipt)
        ? current
        : { ok: false, code: 'receipt_conflict' };
    }
    await this.database
      .prepare(
        `UPDATE wallet_relocations SET state = 'copying', source_fence_json = ?7
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
         AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6 AND state = 'freezing'`,
      )
      .bind(...moveBindings(request), JSON.stringify(receipt))
      .run();
    const committed = await this.readMatching(request);
    if (!committed.ok) return committed;
    if (committed.move.progress.state === 'freezing') return { ok: false, code: 'phase_conflict' };
    return sameReceipt(committed.move.progress.sourceFence, receipt)
      ? committed
      : { ok: false, code: 'receipt_conflict' };
  }

  async recordDestinationVerification(
    request: WalletRelocationRequest,
    receipt: WalletRelocationReceipt<'destination_verification'>,
  ): Promise<WalletRelocationTransition> {
    const current = await this.readMatching(request);
    if (!current.ok) return current;
    const progress = current.move.progress;
    if (progress.state === 'freezing') return { ok: false, code: 'phase_conflict' };
    if (
      !receipt.matches(current.move) ||
      receipt.recordedAtMs < progress.sourceFence.recordedAtMs
    ) {
      return { ok: false, code: 'receipt_conflict' };
    }
    if (progress.state !== 'copying') {
      return sameReceipt(progress.destinationVerification, receipt)
        ? current
        : { ok: false, code: 'receipt_conflict' };
    }
    await this.database
      .prepare(
        `UPDATE wallet_relocations SET state = 'verified', destination_verification_json = ?7
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
         AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6 AND state = 'copying'`,
      )
      .bind(...moveBindings(request), JSON.stringify(receipt))
      .run();
    const committed = await this.readMatching(request);
    if (!committed.ok) return committed;
    const committedProgress = committed.move.progress;
    if (committedProgress.state === 'freezing' || committedProgress.state === 'copying') {
      return { ok: false, code: 'phase_conflict' };
    }
    return sameReceipt(committedProgress.destinationVerification, receipt)
      ? committed
      : { ok: false, code: 'receipt_conflict' };
  }

  async switchOwnership(
    request: WalletRelocationRequest,
    nowMs: number,
  ): Promise<WalletRelocationTransition> {
    const cutoverAtMs = relocationTimestamp(nowMs);
    const current = await this.readMatching(request);
    if (!current.ok) return current;
    const progress = current.move.progress;
    switch (progress.state) {
      case 'freezing':
      case 'copying':
        return { ok: false, code: 'phase_conflict' };
      case 'cutover':
      case 'completed':
        return current;
      case 'verified':
        if (cutoverAtMs < progress.destinationVerification.recordedAtMs) {
          return { ok: false, code: 'phase_conflict' };
        }
        break;
      default: {
        const unexpected: never = progress;
        throw new Error(`Unexpected relocation progress: ${String(unexpected)}`);
      }
    }
    await this.database
      .prepare(
        `UPDATE wallet_relocations SET state = 'cutover', cutover_at_ms = ?7
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
         AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6 AND state = 'verified'`,
      )
      .bind(...moveBindings(request), cutoverAtMs)
      .run();
    const committed = await this.readMatching(request);
    if (!committed.ok) return committed;
    return committed.move.progress.state === 'cutover' ||
      committed.move.progress.state === 'completed'
      ? committed
      : { ok: false, code: 'phase_conflict' };
  }

  async complete(
    request: WalletRelocationRequest,
    nowMs: number,
  ): Promise<WalletRelocationTransition> {
    const completedAtMs = relocationTimestamp(nowMs);
    const current = await this.readMatching(request);
    if (!current.ok) return current;
    if (current.move.progress.state === 'completed') return current;
    if (
      current.move.progress.state !== 'cutover' ||
      completedAtMs < current.move.progress.cutoverAtMs
    ) {
      return { ok: false, code: 'phase_conflict' };
    }
    await this.database
      .prepare(
        `UPDATE wallet_relocations SET state = 'completed', completed_at_ms = ?7
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
         AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6 AND state = 'cutover'`,
      )
      .bind(...moveBindings(request), completedAtMs)
      .run();
    const committed = await this.readMatching(request);
    if (!committed.ok) return committed;
    return committed.move.progress.state === 'completed'
      ? committed
      : { ok: false, code: 'phase_conflict' };
  }

  private async readMatching(
    request: WalletRelocationRequest,
  ): Promise<WalletRelocationTransition> {
    const move = await this.find(request);
    if (!move) return { ok: false, code: 'not_found' };
    if (!move.matchesRequest(request, await request.digest()))
      return { ok: false, code: 'request_conflict' };
    return { ok: true, move };
  }

  private async readHome(wallet: WalletOwnershipKey): Promise<Record<string, unknown> | null> {
    return queryD1One(
      this.database,
      `SELECT * FROM wallet_homes WHERE namespace = ?1 AND organization_id = ?2
       AND project_id = ?3 AND environment_id = ?4 AND wallet_id = ?5`,
      walletBindings(wallet),
    );
  }

  private async admissionRejection(
    homeRow: Record<string, unknown> | null,
    request: WalletRelocationRequest,
    nowMs: number,
  ): Promise<Extract<WalletRelocationAdmission, { readonly ok: false }> | null> {
    if (!homeRow) return { ok: false, code: 'not_found' };
    if (homeRow.state !== 'established') return { ok: false, code: 'wallet_not_established' };
    if (homeRow.ownership_generation !== request.expectedGeneration)
      return { ok: false, code: 'stale_generation' };
    if (homeRow.placement_state === 'paused') return { ok: false, code: 'move_in_progress' };
    const assignment = walletHomeAssignmentFromRow(homeRow);
    if (assignment.home.matches(request.destination)) return null;
    const priorRow = await queryD1One(
      this.database,
      `SELECT * FROM wallet_relocations WHERE namespace = ?1 AND organization_id = ?2
       AND project_id = ?3 AND environment_id = ?4 AND wallet_id = ?5
       ORDER BY admitted_at_ms DESC LIMIT 1`,
      walletBindings(request.wallet),
    );
    if (!priorRow) return null;
    const prior = WalletRelocation.fromRow(priorRow);
    if (prior.progress.state !== 'completed') return { ok: false, code: 'move_in_progress' };
    const retryAtMs = prior.admittedAtMs + WALLET_RELOCATION_COOLDOWN_MS;
    return nowMs < retryAtMs ? { ok: false, code: 'cooldown', retryAtMs } : null;
  }
}
