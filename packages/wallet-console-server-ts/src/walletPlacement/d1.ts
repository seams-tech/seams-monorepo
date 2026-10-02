import { d1ChangedRows, queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  WalletHome,
  WalletOwnershipKey,
  WalletPlacementError,
  type WalletHomeAssignment,
  type WalletHomeReservation,
} from './home';

function registrationIdentity(raw: string): string {
  if (!raw || raw.trim() !== raw) {
    throw new WalletPlacementError('invalid_input', 'Registration identity is invalid');
  }
  return raw;
}

function timestamp(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    throw new WalletPlacementError('invalid_record', 'Wallet home timestamp is invalid');
  }
  return raw;
}

function assignmentFromRow(row: Record<string, unknown>): WalletHomeAssignment {
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
  const reservedAtMs = timestamp(row.reserved_at_ms);
  switch (row.state) {
    case 'reserved':
      if (row.completed_at_ms !== null) break;
      return { state: 'reserved', wallet, home, registrationId, reservedAtMs };
    case 'established':
    case 'cancelled': {
      const completedAtMs = timestamp(row.completed_at_ms);
      if (completedAtMs < reservedAtMs) break;
      return { state: row.state, wallet, home, registrationId, reservedAtMs, completedAtMs };
    }
  }
  throw new WalletPlacementError('invalid_record', 'Stored wallet home lifecycle is invalid');
}

function scopeBindings(wallet: WalletOwnershipKey): string[] {
  return [wallet.namespace, wallet.organizationId, wallet.projectId, wallet.environmentId];
}

export class D1WalletHomeDirectory {
  constructor(private readonly database: D1DatabaseLike) {}

  async find(wallet: WalletOwnershipKey): Promise<WalletHomeAssignment | null> {
    const row = await queryD1One(
      this.database,
      `SELECT * FROM wallet_homes WHERE namespace = ?1 AND organization_id = ?2
       AND project_id = ?3 AND environment_id = ?4 AND wallet_id = ?5`,
      [...scopeBindings(wallet), wallet.walletId],
    );
    return row ? assignmentFromRow(row) : null;
  }

  async reserve(input: {
    readonly wallet: WalletOwnershipKey;
    readonly proposedHome: WalletHome;
    readonly registrationId: string;
    readonly nowMs: number;
  }): Promise<WalletHomeReservation> {
    const registrationId = registrationIdentity(input.registrationId);
    const nowMs = timestamp(input.nowMs);
    const { wallet, proposedHome } = input;
    // The absence check and insert share one SQLite statement across all ingress workers.
    const inserted = await this.database
      .prepare(
        `INSERT INTO wallet_homes (namespace, organization_id, project_id, environment_id,
         wallet_id, registration_id, region, account_id, database_id, state, reserved_at_ms)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'reserved', ?10
       WHERE NOT EXISTS (SELECT 1 FROM wallet_homes
         WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
           AND (wallet_id = ?5 OR registration_id = ?6))`,
      )
      .bind(
        ...scopeBindings(wallet),
        wallet.walletId,
        registrationId,
        proposedHome.region,
        proposedHome.accountId,
        proposedHome.databaseId,
        nowMs,
      )
      .run();
    const row = await queryD1One(
      this.database,
      `SELECT * FROM wallet_homes WHERE namespace = ?1 AND organization_id = ?2
       AND project_id = ?3 AND environment_id = ?4
       AND (wallet_id = ?5 OR registration_id = ?6)
       ORDER BY CASE WHEN registration_id = ?6 THEN 0 ELSE 1 END LIMIT 1`,
      [...scopeBindings(wallet), wallet.walletId, registrationId],
    );
    if (!row)
      throw new WalletPlacementError('invalid_record', 'Wallet home reservation disappeared');
    const assignment = assignmentFromRow(row);
    if (!assignment.wallet.matches(wallet)) {
      return { ok: false, code: 'registration_conflict', assignment };
    }
    if (assignment.registrationId !== registrationId) {
      return { ok: false, code: 'wallet_conflict', assignment };
    }
    // A retry from another region retains the first committed home.
    return {
      ok: true,
      disposition: d1ChangedRows(inserted) === 1 ? 'reserved' : 'reused',
      assignment,
    };
  }

  async complete(input: {
    readonly wallet: WalletOwnershipKey;
    readonly home: WalletHome;
    readonly registrationId: string;
    readonly outcome: 'established' | 'cancelled';
    readonly nowMs: number;
  }): Promise<WalletHomeAssignment> {
    const registrationId = registrationIdentity(input.registrationId);
    const nowMs = timestamp(input.nowMs);
    await this.database
      .prepare(
        `UPDATE wallet_homes SET state = ?10, completed_at_ms = ?11
       WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
         AND wallet_id = ?5 AND registration_id = ?6 AND region = ?7 AND account_id = ?8
         AND database_id = ?9 AND state = 'reserved' AND reserved_at_ms <= ?11`,
      )
      .bind(
        ...scopeBindings(input.wallet),
        input.wallet.walletId,
        registrationId,
        input.home.region,
        input.home.accountId,
        input.home.databaseId,
        input.outcome,
        nowMs,
      )
      .run();
    const assignment = await this.find(input.wallet);
    if (
      !assignment ||
      assignment.registrationId !== registrationId ||
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
