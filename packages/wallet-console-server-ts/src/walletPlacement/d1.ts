import {
  d1ChangedRows,
  queryD1One,
  type D1DatabaseLike,
  type D1ResultLike,
} from '@seams/wallet-server/cloud-host';
import {
  RegistrationSetupAllocation,
  WalletHome,
  WalletHomeCatalog,
  WalletOwnershipKey,
  WalletPlacementError,
  parseWalletOwnershipGeneration,
  type WalletHomeAssignment,
  type WalletHomeReservation,
  type WalletHomeReservationInput,
} from './home';
import type { SessionLocator } from './sessionLocators';

function registrationIdentity(raw: string): string {
  if (!raw || raw.trim() !== raw) {
    throw new WalletPlacementError('invalid_input', 'Registration identity is invalid');
  }
  return raw;
}

function requestDigest(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) {
    throw new WalletPlacementError('invalid_input', 'Registration request digest is invalid');
  }
  return raw;
}

function reservationWallet(input: WalletHomeReservationInput): WalletOwnershipKey {
  switch (input.allocation) {
    case 'provided':
      return input.wallet;
    case 'server_allocated':
      return input.candidate;
    default: {
      const unexpected: never = input;
      throw new Error(`Unexpected wallet allocation: ${String(unexpected)}`);
    }
  }
}

function timestamp(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    throw new WalletPlacementError('invalid_record', 'Wallet home timestamp is invalid');
  }
  return raw;
}

export function walletHomeAssignmentFromRow(row: Record<string, unknown>): WalletHomeAssignment {
  if (row.placement_state === 'paused') {
    throw new WalletPlacementError(
      'wallet_relocation_in_progress',
      'Wallet relocation is in progress',
    );
  }
  if (row.placement_state !== 'active') {
    throw new WalletPlacementError('invalid_record', 'Wallet placement state is invalid');
  }
  const ownershipGeneration = parseWalletOwnershipGeneration(row.ownership_generation);
  const wallet = WalletOwnershipKey.parse({
    namespace: row.namespace,
    organizationId: row.organization_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    walletId: row.wallet_id,
  });
  const home = WalletHome.parse({
    region: row.region,
    accountId: row.account_id,
    databaseId: row.database_id,
  });
  if (typeof row.registration_id !== 'string') {
    throw new WalletPlacementError('invalid_record', 'Stored registration identity is invalid');
  }
  const registrationId = registrationIdentity(row.registration_id);
  const digest = requestDigest(row.request_digest);
  const allocation = row.allocation;
  if (allocation !== 'provided' && allocation !== 'server_allocated') {
    throw new WalletPlacementError('invalid_record', 'Stored wallet allocation is invalid');
  }
  const reservedAtMs = timestamp(row.reserved_at_ms);
  const registrationAllocation = RegistrationSetupAllocation.parse({
    ceremonyId: row.ceremony_id,
    preparationId: row.preparation_id,
    walletAuthorityId: row.wallet_authority_id,
    deviceId: row.device_id,
    walletAuthMethodId: row.wallet_auth_method_id,
  });
  switch (row.state) {
    case 'reserved':
      if (row.completed_at_ms !== null) break;
      return {
        state: 'reserved',
        wallet,
        home,
        ownershipGeneration,
        registrationId,
        requestDigest: digest,
        allocation,
        registrationAllocation,
        reservedAtMs,
      };
    case 'established':
    case 'cancelled': {
      const completedAtMs = timestamp(row.completed_at_ms);
      if (completedAtMs < reservedAtMs) break;
      return {
        state: row.state,
        wallet,
        home,
        ownershipGeneration,
        registrationId,
        requestDigest: digest,
        allocation,
        registrationAllocation,
        reservedAtMs,
        completedAtMs,
      };
    }
  }
  throw new WalletPlacementError('invalid_record', 'Stored wallet home lifecycle is invalid');
}

function scopeBindings(wallet: WalletOwnershipKey): string[] {
  return [wallet.namespace, wallet.organizationId, wallet.projectId, wallet.environmentId];
}

export class D1WalletHomeDirectory {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly catalog: WalletHomeCatalog,
  ) {}

  async find(wallet: WalletOwnershipKey): Promise<WalletHomeAssignment | null> {
    const row = await queryD1One(
      this.database,
      `SELECT * FROM wallet_homes WHERE namespace = ?1 AND organization_id = ?2
       AND project_id = ?3 AND environment_id = ?4 AND wallet_id = ?5`,
      [...scopeBindings(wallet), wallet.walletId],
    );
    return row ? walletHomeAssignmentFromRow(row) : null;
  }

  async findByCeremony(
    namespace: string,
    ceremonyId: string,
  ): Promise<WalletHomeAssignment | null> {
    if (!namespace || namespace.trim() !== namespace) {
      throw new WalletPlacementError('invalid_input', 'Wallet namespace is invalid');
    }
    if (!/^wrc_[A-Za-z0-9_-]+$/u.test(ceremonyId)) {
      throw new WalletPlacementError('invalid_input', 'Registration ceremony identity is invalid');
    }
    const row = await queryD1One(
      this.database,
      'SELECT * FROM wallet_homes WHERE namespace = ?1 AND ceremony_id = ?2',
      [namespace, ceremonyId],
    );
    return row ? walletHomeAssignmentFromRow(row) : null;
  }

  async reserve(input: WalletHomeReservationInput): Promise<WalletHomeReservation> {
    const registrationId = registrationIdentity(input.registrationId);
    const deploymentLane = registrationIdentity(input.deploymentLane);
    const nowMs = timestamp(input.nowMs);
    const wallet = reservationWallet(input);
    const proposedHome = input.proposedHome;
    if (!this.catalog.admits(proposedHome)) {
      throw new WalletPlacementError('invalid_input', 'Wallet home resource is not admitted');
    }
    if (!RegistrationSetupAllocation.isValidated(input.proposedRegistrationAllocation)) {
      throw new WalletPlacementError('invalid_input', 'Registration allocation is not validated');
    }
    const digest = requestDigest(input.requestDigest);
    // The absence check and insert share one SQLite statement across all ingress workers.
    const inserted = await this.database
      .prepare(
        `INSERT INTO wallet_homes (namespace, organization_id, project_id, environment_id,
         wallet_id, registration_id, region, account_id, database_id, state, reserved_at_ms, request_digest, allocation,
         ceremony_id, preparation_id, wallet_authority_id, device_id, wallet_auth_method_id)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'reserved', ?10, ?11, ?12,
         ?13, ?14, ?15, ?16, ?17
       WHERE NOT EXISTS (SELECT 1 FROM wallet_homes
         WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
           AND (wallet_id = ?5 OR registration_id = ?6))
         AND NOT EXISTS (SELECT 1 FROM wallet_homes WHERE namespace = ?1 AND ceremony_id = ?13)
         AND NOT EXISTS (SELECT 1 FROM tenant_deployment_cutovers
           WHERE deployment_lane = ?18 AND state_kind IN ('awaiting_browser_credential', 'ready'))
       RETURNING *, 0 AS setup_paused`,
      )
      .bind(
        ...scopeBindings(wallet),
        wallet.walletId,
        registrationId,
        proposedHome.region,
        proposedHome.accountId,
        proposedHome.databaseId,
        nowMs,
        digest,
        input.allocation,
        input.proposedRegistrationAllocation.ceremonyId,
        input.proposedRegistrationAllocation.preparationId,
        input.proposedRegistrationAllocation.walletAuthorityId,
        input.proposedRegistrationAllocation.deviceId,
        input.proposedRegistrationAllocation.walletAuthMethodId,
        deploymentLane,
      )
      .first<Record<string, unknown>>();
    const row =
      inserted ??
      (await queryD1One(
        this.database,
        `SELECT wallet_homes.*,
              EXISTS (SELECT 1 FROM tenant_deployment_cutovers
                WHERE deployment_lane = ?7
                  AND state_kind IN ('awaiting_browser_credential', 'ready')) AS setup_paused
       FROM wallet_homes WHERE namespace = ?1 AND organization_id = ?2
       AND project_id = ?3 AND environment_id = ?4
       AND (wallet_id = ?5 OR registration_id = ?6)
       ORDER BY CASE WHEN registration_id = ?6 THEN 0 ELSE 1 END LIMIT 1`,
        [...scopeBindings(wallet), wallet.walletId, registrationId, deploymentLane],
      ));
    if (row?.setup_paused === 1) {
      throw new WalletPlacementError('registration_paused', 'Wallet registration is paused');
    }
    if (!row) {
      const paused = await queryD1One(
        this.database,
        `SELECT operation_id FROM tenant_deployment_cutovers
         WHERE deployment_lane = ?1 AND state_kind IN ('awaiting_browser_credential', 'ready')
         LIMIT 1`,
        [deploymentLane],
      );
      if (paused) {
        throw new WalletPlacementError('registration_paused', 'Wallet registration is paused');
      }
      const collision = await this.findByCeremony(
        wallet.namespace,
        input.proposedRegistrationAllocation.ceremonyId,
      );
      if (collision) return { ok: false, code: 'ceremony_conflict' };
      throw new WalletPlacementError('invalid_record', 'Wallet home reservation disappeared');
    }
    const assignment = walletHomeAssignmentFromRow(row);
    if (input.allocation === 'provided' && !assignment.wallet.matches(wallet)) {
      return { ok: false, code: 'registration_conflict', assignment };
    }
    if (assignment.registrationId !== registrationId) {
      return { ok: false, code: 'wallet_conflict', assignment };
    }
    if (assignment.requestDigest !== digest || assignment.allocation !== input.allocation) {
      return { ok: false, code: 'request_conflict', assignment };
    }
    if (assignment.state === 'cancelled') {
      return { ok: false, code: 'registration_cancelled', assignment };
    }
    // A retry from another region retains the first committed home.
    return {
      ok: true,
      disposition: inserted ? 'reserved' : 'reused',
      assignment,
    };
  }

  async complete(
    input: {
      readonly wallet: WalletOwnershipKey;
      readonly home: WalletHome;
      readonly ceremonyId: string;
      readonly nowMs: number;
    } & (
      | {
          readonly outcome: 'established';
          readonly session: {
            readonly locator: SessionLocator<'credential'>;
            readonly expiresAtMs: number;
          };
        }
      | { readonly outcome: 'cancelled'; readonly session?: never }
    ),
  ): Promise<WalletHomeAssignment> {
    const nowMs = timestamp(input.nowMs);
    const session = input.outcome === 'established' ? input.session : null;
    if (session && (!Number.isSafeInteger(session.expiresAtMs) || session.expiresAtMs <= 0)) {
      throw new WalletPlacementError('invalid_input', 'Session locator expiry is invalid');
    }
    const completion = this.database
      .prepare(
        `UPDATE wallet_homes SET state = ?10,
           completed_at_ms = CASE WHEN state = 'reserved' THEN ?11 ELSE completed_at_ms END
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
         AND wallet_id = ?5 AND ceremony_id = ?6 AND region = ?7 AND account_id = ?8
         AND database_id = ?9 AND (state = 'reserved' OR (?10 = 'established' AND state = 'established'))
         AND reserved_at_ms <= ?11
         AND placement_state = 'active'
         AND (?10 != 'established' OR EXISTS (
           SELECT 1 FROM wallet_session_locators locator
           WHERE locator.namespace = ?1 AND locator.organization_id = ?2 AND locator.project_id = ?3
             AND locator.environment_id = ?4 AND locator.wallet_id = ?5
             AND locator.kind = 'credential' AND locator.digest = ?12 AND locator.expires_at_ms = ?13))
         AND (?10 != 'cancelled' OR NOT EXISTS (
           SELECT 1 FROM wallet_passkey_claims claim
           WHERE claim.namespace = ?1 AND claim.organization_id = ?2 AND claim.project_id = ?3
             AND claim.environment_id = ?4 AND claim.wallet_id = ?5))
       RETURNING *`,
      )
      .bind(
        ...scopeBindings(input.wallet),
        input.wallet.walletId,
        input.ceremonyId,
        input.home.region,
        input.home.accountId,
        input.home.databaseId,
        input.outcome,
        nowMs,
        session?.locator.digest ?? null,
        session?.expiresAtMs ?? null,
      );
    let row: Record<string, unknown> | null;
    if (input.outcome === 'established') {
      // Publication, home completion, and the Console display row commit together.
      // Exact retries retain the original expiry, completion time, and display updates.
      const results = await this.database.batch<D1ResultLike<Record<string, unknown>>>([
        this.database
          .prepare(
            `INSERT INTO wallet_session_locators
              (namespace, organization_id, project_id, environment_id, kind, digest, wallet_id, expires_at_ms)
             SELECT namespace, organization_id, project_id, environment_id, 'credential', ?10, wallet_id, ?11
             FROM wallet_homes
             WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
               AND wallet_id = ?5 AND ceremony_id = ?6 AND region = ?7 AND account_id = ?8
               AND database_id = ?9 AND state IN ('reserved', 'established')
               AND placement_state = 'active' AND reserved_at_ms <= ?12
               AND NOT EXISTS (SELECT 1 FROM wallet_session_locators
                 WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
                   AND kind = 'credential' AND digest = ?10)
             ON CONFLICT DO NOTHING`,
          )
          .bind(
            ...scopeBindings(input.wallet),
            input.wallet.walletId,
            input.ceremonyId,
            input.home.region,
            input.home.accountId,
            input.home.databaseId,
            input.session.locator.digest,
            input.session.expiresAtMs,
            nowMs,
          ),
        completion,
        this.database
          .prepare(
            `INSERT INTO wallet_index (
              namespace, org_id, id, project_id, environment_id, user_id, external_ref_id,
              address, chain, wallet_type, status, policy_id, balance_minor,
              last_activity_at_ms, created_at_ms, updated_at_ms
            )
            SELECT namespace, organization_id, wallet_id, project_id, environment_id,
              wallet_id, wallet_id, wallet_id, 'Multichain', 'EOA', 'ACTIVE', NULL, 0,
              completed_at_ms, completed_at_ms, completed_at_ms
            FROM wallet_homes
            WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
              AND environment_id = ?4 AND wallet_id = ?5 AND ceremony_id = ?6
              AND region = ?7 AND account_id = ?8 AND database_id = ?9
              AND state = 'established' AND placement_state = 'active'
              AND changes() = 1
            ON CONFLICT (namespace, org_id, project_id, environment_id, id) DO NOTHING`,
          )
          .bind(
            ...scopeBindings(input.wallet),
            input.wallet.walletId,
            input.ceremonyId,
            input.home.region,
            input.home.accountId,
            input.home.databaseId,
          ),
      ]);
      row = results[1]?.results?.[0] ?? null;
    } else {
      row = await completion.first<Record<string, unknown>>();
    }
    let assignment: WalletHomeAssignment | null = null;
    if (row) {
      assignment = walletHomeAssignmentFromRow(row);
    } else {
      assignment = await this.find(input.wallet);
    }
    if (
      !assignment ||
      (input.outcome === 'established' && !row) ||
      assignment.registrationAllocation.ceremonyId !== input.ceremonyId ||
      !assignment.home.matches(input.home) ||
      assignment.state !== input.outcome
    ) {
      throw new WalletPlacementError(
        'home_conflict',
        'Wallet home completion conflicts with its reservation',
      );
    }
    return assignment;
  }
}
