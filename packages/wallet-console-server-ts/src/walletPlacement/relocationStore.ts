import { GatewayRelocationOwnerApproval, hasFreshRelocationOwnerApproval } from './relocationOwnerApproval';
import { createWalletRelocationParticipants, type WalletRelocationBindings } from './relocationParticipants';
import { queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { walletHomeAssignmentFromRow } from './d1';
import {
  assertDeploymentResourcesVerified,
  type TenantDeploymentResourceVerificationsV1,
} from '../tenantDeployment/resourceVerification';
import {
  WalletHomeCatalog,
  WalletOwnershipKey,
  WalletPlacementError,
  type WalletHomeAssignment,
} from './home';
import {
  WALLET_RELOCATION_COOLDOWN_MS,
  WalletRelocation,
  WalletRelocationLocator,
  WalletRelocationReceipt,
  WalletRelocationRequest,
  relocationTimestamp,
} from './relocation';

import {
  WalletRelocationAttempt,
  relocationAttemptId,
  relocationRetryDelay,
  type WalletRelocationFailure,
  type WalletRelocationPhase,
} from './relocationExecution';

import {
  WalletRelocationPreparation,
} from './relocationPreparation';

const NEXT_EXECUTION_SQL = `execution_revision = execution_revision + 1,
  execution_attempt = 0, execution_attempt_id = NULL, execution_started_at_ms = NULL,
  execution_error = NULL, execution_retry_at_ms = NULL`;

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
        | 'owner_approval_required'
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
      readonly code:
        | 'not_found'
        | 'request_conflict'
        | 'phase_conflict'
        | 'receipt_conflict'
        | 'attempt_conflict'
        | 'execution_blocked';
      readonly retryAtMs?: never;
    }
  | { readonly ok: false; readonly code: 'retry_wait'; readonly retryAtMs: number };

function walletBindings(wallet: WalletOwnershipKey): string[] {
  return [
    wallet.namespace,
    wallet.organizationId,
    wallet.projectId,
    wallet.environmentId,
    wallet.walletId,
  ];
}

function moveBindings(request: WalletRelocationRequest | WalletRelocationLocator): string[] {
  return [...walletBindings(request.wallet), request.moveId];
}

function sameReceipt(left: WalletRelocationReceipt, right: WalletRelocationReceipt): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function runningAttemptMatches(move: WalletRelocation, attempt: WalletRelocationAttempt): boolean {
  if (move.progress.state === 'completed') return false;
  return (
    move.progress.execution.state === 'running' && move.progress.execution.attempt.matches(attempt)
  );
}

export async function readWalletRelocation(
  database: D1DatabaseLike,
  request: WalletRelocationRequest | WalletRelocationLocator,
): Promise<WalletRelocation | null> {
  const row = await queryD1One(
    database,
    `SELECT * FROM wallet_relocations WHERE namespace = ?1 AND organization_id = ?2
       AND project_id = ?3 AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6`,
    moveBindings(request),
  );
  return row ? WalletRelocation.fromRow(row) : null;
}

// Trusted move orchestration supplies owner authorization and role receipts before these transitions.
export class D1WalletRelocations {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly catalog: WalletHomeCatalog,
  ) {}

  async find(request: WalletRelocationRequest): Promise<WalletRelocation | null> {
    return readWalletRelocation(this.database, request);
  }

  async admit(
    request: WalletRelocationRequest,
    resourceVerifications: TenantDeploymentResourceVerificationsV1,
    deploymentLane: string,
    bindings: WalletRelocationBindings,
    clock: () => number,
  ): Promise<WalletRelocationAdmission> {
    let admittedAtMs = relocationTimestamp(clock());
    const digest = await request.digest();
    const existing = await this.find(request);
    if (existing) {
      return existing.matchesRequest(request, digest)
        ? { ok: true, disposition: 'reused', move: existing }
        : { ok: false, code: 'request_conflict' };
    }
    if (!this.catalog.admits(request.destination)) {
      throw new WalletPlacementError(
        'invalid_input',
        'Wallet relocation destination is not admitted',
      );
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
    assertDeploymentResourcesVerified(
      [
        { accountId: assignment.home.accountId, databaseId: assignment.home.databaseId },
        { accountId: request.destination.accountId, databaseId: request.destination.databaseId },
      ],
      request.wallet.namespace,
      deploymentLane,
      resourceVerifications,
      admittedAtMs,
    );
    if (!Number.isSafeInteger(request.expectedGeneration + 1)) {
      throw new WalletPlacementError('invalid_record', 'Wallet ownership generation is exhausted');
    }

    const ownerApproval = new GatewayRelocationOwnerApproval(bindings.gateways);
    if (!await hasFreshRelocationOwnerApproval(ownerApproval, request, assignment.home, clock))
      return { ok: false, code: 'owner_approval_required' };
    const participants = createWalletRelocationParticipants({
      request, source: assignment.home, verifications: resourceVerifications,
      gateways: bindings.gateways, runtimes: bindings.runtimes, clock,
    });
    const preparation = await WalletRelocationPreparation.prepare(request, participants, clock);
    if (!await hasFreshRelocationOwnerApproval(ownerApproval, request, assignment.home, clock))
      return { ok: false, code: 'owner_approval_required' };
    admittedAtMs = relocationTimestamp(clock());
    preparation.assertFor(digest, request.expectedGeneration + 1, admittedAtMs);
    assertDeploymentResourcesVerified(
      [
        { accountId: assignment.home.accountId, databaseId: assignment.home.databaseId },
        { accountId: request.destination.accountId, databaseId: request.destination.databaseId },
      ],
      request.wallet.namespace,
      deploymentLane,
      resourceVerifications,
      admittedAtMs,
    );


    // Admission and the source pause are one transaction, including racing owner requests.
    const inserted = await this.database
      .prepare(
        `INSERT INTO wallet_relocations (namespace, organization_id, project_id, environment_id,
         wallet_id, move_id, request_digest, authority_id, source_region, source_account_id,
         source_database_id, destination_region, destination_account_id, destination_database_id,
         source_generation, destination_generation, state, admitted_at_ms, resource_verifications_json, preparation_json)
       SELECT home.namespace, home.organization_id, home.project_id, home.environment_id,
         home.wallet_id, ?6, ?7, ?8, home.region, home.account_id, home.database_id,
         ?9, ?10, ?11, home.ownership_generation, home.ownership_generation + 1, 'freezing', ?12, ?15, ?16
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
        JSON.stringify(resourceVerifications),
        JSON.stringify(preparation),
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
    attempt: WalletRelocationAttempt,
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
    if (!runningAttemptMatches(current.move, attempt))
      return { ok: false, code: 'attempt_conflict' };
    await this.database
      .prepare(
        `UPDATE wallet_relocations SET state = 'copying', source_fence_json = ?7,
         execution_state = 'ready', ${NEXT_EXECUTION_SQL}
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
         AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6 AND state = 'freezing'
         AND execution_state = 'running' AND execution_revision = ?8 AND execution_attempt_id = ?9`,
      )
      .bind(...moveBindings(request), JSON.stringify(receipt), attempt.revision, attempt.id)
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
    attempt: WalletRelocationAttempt,
    receipt: WalletRelocationReceipt<'destination_verification'>,
  ): Promise<WalletRelocationTransition> {
    const current = await this.readMatching(request);
    if (!current.ok) return current;
    const progress = current.move.progress;
    if (progress.state === 'freezing') return { ok: false, code: 'phase_conflict' };
    if (
      !receipt.matches(current.move) ||
      receipt.recordedAtMs < progress.sourceFence.recordedAtMs ||
      receipt.manifestDigest !== progress.sourceFence.manifestDigest
    ) {
      return { ok: false, code: 'receipt_conflict' };
    }
    if (progress.state !== 'copying') {
      return sameReceipt(progress.destinationVerification, receipt)
        ? current
        : { ok: false, code: 'receipt_conflict' };
    }
    if (!runningAttemptMatches(current.move, attempt))
      return { ok: false, code: 'attempt_conflict' };
    await this.database
      .prepare(
        `UPDATE wallet_relocations SET state = 'verified', destination_verification_json = ?7,
         execution_state = 'ready', ${NEXT_EXECUTION_SQL}
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
         AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6 AND state = 'copying'
         AND execution_state = 'running' AND execution_revision = ?8 AND execution_attempt_id = ?9`,
      )
      .bind(...moveBindings(request), JSON.stringify(receipt), attempt.revision, attempt.id)
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
    attempt: WalletRelocationAttempt,
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
    if (!runningAttemptMatches(current.move, attempt))
      return { ok: false, code: 'attempt_conflict' };
    await this.database
      .prepare(
        `UPDATE wallet_relocations SET state = 'cutover', cutover_at_ms = ?7,
         execution_state = 'ready', ${NEXT_EXECUTION_SQL}
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
         AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6 AND state = 'verified'
         AND execution_state = 'running' AND execution_revision = ?8 AND execution_attempt_id = ?9`,
      )
      .bind(...moveBindings(request), cutoverAtMs, attempt.revision, attempt.id)
      .run();
    const committed = await this.readMatching(request);
    if (!committed.ok) return committed;
    return committed.move.progress.state === 'cutover' ||
      committed.move.progress.state === 'completed'
      ? committed
      : { ok: false, code: 'phase_conflict' };
  }

  async recordDestinationActivation(
    request: WalletRelocationRequest,
    attempt: WalletRelocationAttempt,
    activation: WalletRelocationReceipt<'destination_activation'>,
  ): Promise<WalletRelocationTransition> {
    const current = await this.readMatching(request);
    if (!current.ok) return current;
    const progress = current.move.progress;
    if (progress.state === 'completed') {
      return sameReceipt(progress.destinationActivation, activation)
        ? current
        : { ok: false, code: 'receipt_conflict' };
    }
    if (progress.state !== 'cutover') return { ok: false, code: 'phase_conflict' };
    if (progress.activation.state === 'activated') {
      return sameReceipt(progress.activation.receipt, activation)
        ? current
        : { ok: false, code: 'receipt_conflict' };
    }
    if (
      !activation.matches(current.move) ||
      activation.manifestDigest !== progress.sourceFence.manifestDigest ||
      activation.recordedAtMs < progress.cutoverAtMs
    )
      return { ok: false, code: 'receipt_conflict' };
    if (!runningAttemptMatches(current.move, attempt))
      return { ok: false, code: 'attempt_conflict' };
    await this.database
      .prepare(
        `UPDATE wallet_relocations SET destination_activation_json = ?7
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
         AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6 AND state = 'cutover'
         AND destination_activation_json IS NULL AND execution_state = 'running'
         AND execution_revision = ?8 AND execution_attempt_id = ?9`,
      )
      .bind(...moveBindings(request), JSON.stringify(activation), attempt.revision, attempt.id)
      .run();
    const committed = await this.readMatching(request);
    if (!committed.ok) return committed;
    const updated = committed.move.progress;
    if (updated.state === 'completed') {
      return sameReceipt(updated.destinationActivation, activation)
        ? committed
        : { ok: false, code: 'receipt_conflict' };
    }
    if (updated.state !== 'cutover' || updated.activation.state !== 'activated')
      return { ok: false, code: 'attempt_conflict' };
    return sameReceipt(updated.activation.receipt, activation)
      ? committed
      : { ok: false, code: 'receipt_conflict' };
  }

  async complete(
    request: WalletRelocationRequest,
    attempt: WalletRelocationAttempt,
    cleanup: WalletRelocationReceipt<'source_cleanup'>,
    nowMs: number,
  ): Promise<WalletRelocationTransition> {
    const completedAtMs = relocationTimestamp(nowMs);
    const current = await this.readMatching(request);
    if (!current.ok) return current;
    const progress = current.move.progress;
    if (progress.state === 'completed') {
      return sameReceipt(progress.sourceCleanup, cleanup)
        ? current
        : { ok: false, code: 'receipt_conflict' };
    }
    if (progress.state !== 'cutover' || progress.activation.state !== 'activated')
      return { ok: false, code: 'phase_conflict' };
    if (
      !cleanup.matches(current.move) ||
      cleanup.manifestDigest !== progress.sourceFence.manifestDigest ||
      cleanup.recordedAtMs < progress.activation.receipt.recordedAtMs ||
      completedAtMs < cleanup.recordedAtMs
    )
      return { ok: false, code: 'receipt_conflict' };
    if (!runningAttemptMatches(current.move, attempt))
      return { ok: false, code: 'attempt_conflict' };
    await this.database
      .prepare(
        `UPDATE wallet_relocations SET state = 'completed', completed_at_ms = ?7,
       source_cleanup_json = ?8,
       execution_state = NULL, ${NEXT_EXECUTION_SQL}
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
         AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6 AND state = 'cutover'
         AND destination_activation_json IS NOT NULL
         AND execution_state = 'running' AND execution_revision = ?9 AND execution_attempt_id = ?10`,
      )
      .bind(
        ...moveBindings(request),
        completedAtMs,
        JSON.stringify(cleanup),
        attempt.revision,
        attempt.id,
      )
      .run();
    const committed = await this.readMatching(request);
    if (!committed.ok) return committed;
    if (committed.move.progress.state !== 'completed')
      return { ok: false, code: 'attempt_conflict' };
    return sameReceipt(committed.move.progress.sourceCleanup, cleanup)
      ? committed
      : { ok: false, code: 'receipt_conflict' };
  }

  async claimAttempt(
    request: WalletRelocationRequest,
    phase: WalletRelocationPhase,
    attemptId: string,
    nowMs: number,
  ): Promise<WalletRelocationTransition> {
    const id = relocationAttemptId(attemptId);
    const startedAtMs = relocationTimestamp(nowMs);
    const current = await this.readMatching(request);
    if (!current.ok) return current;
    const progress = current.move.progress;
    if (
      progress.state === 'completed' ||
      progress.state !== phase ||
      startedAtMs < current.move.admittedAtMs
    )
      return { ok: false, code: 'phase_conflict' };
    const execution = progress.execution;
    switch (execution.state) {
      case 'running':
        return execution.attempt.id === id ? current : { ok: false, code: 'attempt_conflict' };
      case 'blocked':
        return { ok: false, code: 'execution_blocked' };
      case 'retry_wait':
        if (execution.attempt.id === id) return { ok: false, code: 'attempt_conflict' };
        if (startedAtMs < execution.retryAtMs)
          return { ok: false, code: 'retry_wait', retryAtMs: execution.retryAtMs };
        break;
      case 'ready':
        break;
      default: {
        const unexpected: never = execution;
        throw new Error(`Unexpected relocation execution: ${String(unexpected)}`);
      }
    }
    const revision = execution.state === 'ready' ? execution.revision : execution.attempt.revision;
    await this.database
      .prepare(
        `UPDATE wallet_relocations SET execution_state = 'running', execution_revision = execution_revision + 1,
       execution_attempt = execution_attempt + 1, execution_attempt_id = ?8, execution_started_at_ms = ?9,
       execution_error = NULL, execution_retry_at_ms = NULL
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
         AND wallet_id = ?5 AND move_id = ?6 AND state = ?7 AND execution_revision = ?10
         AND execution_state IN ('ready', 'retry_wait')`,
      )
      .bind(...moveBindings(request), phase, id, startedAtMs, revision)
      .run();
    const committed = await this.readMatching(request);
    if (!committed.ok) return committed;
    const result = committed.move.progress;
    return result.state === phase &&
      result.execution.state === 'running' &&
      result.execution.attempt.id === id
      ? committed
      : { ok: false, code: 'attempt_conflict' };
  }

  async failAttempt(
    request: WalletRelocationRequest,
    attempt: WalletRelocationAttempt,
    code: WalletRelocationFailure,
    nowMs: number,
  ): Promise<WalletRelocationTransition> {
    const failedAtMs = relocationTimestamp(nowMs);
    const current = await this.readMatching(request);
    if (!current.ok) return current;
    const progress = current.move.progress;
    if (progress.state === 'completed' || failedAtMs < attempt.startedAtMs)
      return { ok: false, code: 'attempt_conflict' };
    const execution = progress.execution;
    if (execution.state === 'retry_wait' || execution.state === 'blocked') {
      return execution.attempt.matches(attempt) && execution.code === code
        ? current
        : { ok: false, code: 'attempt_conflict' };
    }
    if (!runningAttemptMatches(current.move, attempt))
      return { ok: false, code: 'attempt_conflict' };
    const delay = relocationRetryDelay(attempt.number, code);
    const state = delay === null ? 'blocked' : 'retry_wait';
    const retryAtMs = delay === null ? null : relocationTimestamp(failedAtMs + delay);
    await this.database
      .prepare(
        `UPDATE wallet_relocations SET execution_state = ?7, execution_error = ?8, execution_retry_at_ms = ?9
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
         AND wallet_id = ?5 AND move_id = ?6 AND state = ?10 AND execution_state = 'running'
         AND execution_revision = ?11 AND execution_attempt_id = ?12`,
      )
      .bind(
        ...moveBindings(request),
        state,
        code,
        retryAtMs,
        attempt.phase,
        attempt.revision,
        attempt.id,
      )
      .run();
    const committed = await this.readMatching(request);
    if (!committed.ok) return committed;
    const result = committed.move.progress;
    if (result.state === 'completed') return { ok: false, code: 'attempt_conflict' };
    const outcome = result.execution;
    return (outcome.state === 'retry_wait' || outcome.state === 'blocked') &&
      outcome.attempt.matches(attempt) &&
      outcome.code === code
      ? committed
      : { ok: false, code: 'attempt_conflict' };
  }

  // The authenticated recovery coordinator invokes this only after repairing a blocked stage.
  async resumeAttempt(
    request: WalletRelocationRequest,
    attempt: WalletRelocationAttempt,
  ): Promise<WalletRelocationTransition> {
    if (!attempt.wallet.matches(request.wallet) || attempt.moveId !== request.moveId)
      return { ok: false, code: 'attempt_conflict' };
    const current = await this.readMatching(request);
    if (!current.ok) return current;
    const progress = current.move.progress;
    if (progress.state === 'completed' || progress.state !== attempt.phase)
      return { ok: false, code: 'attempt_conflict' };
    const execution = progress.execution;
    if (
      execution.state === 'ready' &&
      execution.revision === attempt.revision + 1 &&
      execution.run === attempt.run + 1
    )
      return current;
    if (execution.state !== 'blocked' || !execution.attempt.matches(attempt))
      return { ok: false, code: 'attempt_conflict' };
    await this.database
      .prepare(
        `UPDATE wallet_relocations SET execution_state = 'ready', execution_run = execution_run + 1,
       ${NEXT_EXECUTION_SQL}
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
         AND wallet_id = ?5 AND move_id = ?6 AND state = ?7 AND execution_state = 'blocked'
         AND execution_revision = ?8 AND execution_attempt_id = ?9`,
      )
      .bind(...moveBindings(request), attempt.phase, attempt.revision, attempt.id)
      .run();
    const committed = await this.readMatching(request);
    if (!committed.ok) return committed;
    const result = committed.move.progress;
    return result.state === attempt.phase &&
      result.execution.state === 'ready' &&
      result.execution.revision === attempt.revision + 1 &&
      result.execution.run === attempt.run + 1
      ? committed
      : { ok: false, code: 'attempt_conflict' };
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
