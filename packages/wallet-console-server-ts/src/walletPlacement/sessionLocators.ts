import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { D1WalletHomeDirectory, walletHomeAssignmentFromRow } from './d1';
import { WalletOwnershipKey, WalletPlacementError, type WalletHomeAssignment } from './home';

type Scope = {
  readonly namespace: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly environmentId: string;
};

function sessionDigest(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(raw)) {
    throw new WalletPlacementError('invalid_input', 'Session locator digest is invalid');
  }
  return raw;
}

export class SessionLocator<Kind extends 'credential' | 'exchange' = 'credential' | 'exchange'> {
  readonly #validated = true;
  private constructor(
    readonly kind: Kind,
    readonly digest: string,
  ) {
    Object.freeze(this);
  }

  matches(other: SessionLocator): boolean {
    return (
      this.#validated &&
      other.#validated &&
      this.kind === other.kind &&
      this.digest === other.digest
    );
  }

  static credential(digest: unknown): SessionLocator<'credential'> {
    return new SessionLocator('credential', sessionDigest(digest));
  }

  static exchange(digest: unknown): SessionLocator<'exchange'> {
    return new SessionLocator('exchange', sessionDigest(digest));
  }

  static parse(raw: unknown): SessionLocator {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('kind' in raw) ||
      !('digest' in raw) ||
      (raw.kind !== 'credential' && raw.kind !== 'exchange') ||
      Object.keys(raw).length !== 2
    ) {
      throw new WalletPlacementError('invalid_input', 'Session locator is invalid');
    }
    return new SessionLocator(raw.kind, sessionDigest(raw.digest));
  }
}

export class D1WalletSessionLocators {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: Scope,
    private readonly directory: D1WalletHomeDirectory,
  ) {}

  async find(locator: SessionLocator): Promise<WalletHomeAssignment | null> {
    return (await this.read(locator))?.assignment ?? null;
  }

  private async read(locator: SessionLocator): Promise<{
    readonly assignment: WalletHomeAssignment;
    readonly expiresAtMs: number;
  } | null> {
    const row = await this.database
      .prepare(
        `SELECT home.*, locator.expires_at_ms AS locator_expires_at_ms
      FROM wallet_session_locators AS locator JOIN wallet_homes AS home
        ON home.namespace = locator.namespace AND home.organization_id = locator.organization_id
        AND home.project_id = locator.project_id AND home.environment_id = locator.environment_id
        AND home.wallet_id = locator.wallet_id
      WHERE locator.namespace = ?1 AND locator.organization_id = ?2 AND locator.project_id = ?3
        AND locator.environment_id = ?4 AND locator.kind = ?5 AND locator.digest = ?6
        AND home.state IN ('reserved', 'established')`,
      )
      .bind(
        this.scope.namespace,
        this.scope.organizationId,
        this.scope.projectId,
        this.scope.environmentId,
        locator.kind,
        locator.digest,
      )
      .first<Record<string, unknown>>();
    if (!row) return null;
    const expiresAtMs = row.locator_expires_at_ms;
    if (typeof expiresAtMs !== 'number' || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
      throw new WalletPlacementError('invalid_record', 'Session locator expiry is invalid');
    }
    return { assignment: walletHomeAssignmentFromRow(row), expiresAtMs };
  }

  async publish(input: {
    readonly locator: SessionLocator;
    readonly wallet: WalletOwnershipKey;
    readonly expiresAtMs: number;
    readonly writer: TenantRuntimeWriterV1;
  }): Promise<void> {
    if (!Number.isSafeInteger(input.expiresAtMs) || input.expiresAtMs <= 0) {
      throw new WalletPlacementError('invalid_input', 'Session locator expiry is invalid');
    }
    const { locator, wallet, writer } = input;
    const result = await this.database
      .prepare(
        `INSERT INTO wallet_session_locators
      (namespace, organization_id, project_id, environment_id, kind, digest, wallet_id, expires_at_ms)
      SELECT namespace, organization_id, project_id, environment_id, ?5, ?6, wallet_id, ?8
      FROM wallet_homes WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
        AND environment_id = ?4 AND wallet_id = ?7 AND account_id = ?9 AND database_id = ?10
        AND state IN ('reserved', 'established') AND placement_state = 'active'
        AND NOT EXISTS (SELECT 1 FROM wallet_session_locators
          WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
            AND kind = ?5 AND digest = ?6)
      ON CONFLICT DO NOTHING RETURNING wallet_id`,
      )
      .bind(
        wallet.namespace,
        wallet.organizationId,
        wallet.projectId,
        wallet.environmentId,
        locator.kind,
        locator.digest,
        wallet.walletId,
        input.expiresAtMs,
        writer.resource.accountId,
        writer.resource.databaseId,
      )
      .first();
    if (result) return;
    const assignment = await this.directory.find(wallet);
    if (
      !assignment ||
      assignment.state === 'cancelled' ||
      assignment.home.accountId !== writer.resource.accountId ||
      assignment.home.databaseId !== writer.resource.databaseId
    ) {
      throw new WalletPlacementError(
        'home_conflict',
        'Session locator requires its wallet home writer',
      );
    }
    const existing = await this.database
      .prepare(
        `SELECT wallet_id, expires_at_ms FROM wallet_session_locators
      WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
        AND kind = ?5 AND digest = ?6`,
      )
      .bind(
        wallet.namespace,
        wallet.organizationId,
        wallet.projectId,
        wallet.environmentId,
        locator.kind,
        locator.digest,
      )
      .first<{ wallet_id: unknown; expires_at_ms: unknown }>();
    if (
      !existing ||
      existing.wallet_id !== wallet.walletId ||
      existing.expires_at_ms !== input.expiresAtMs
    ) {
      throw new WalletPlacementError('home_conflict', 'Session locator identity conflicts');
    }
  }

  async publishExchangedCredential(input: {
    readonly exchange: SessionLocator<'exchange'>;
    readonly credential: SessionLocator<'credential'>;
    readonly writer: TenantRuntimeWriterV1;
  }): Promise<void> {
    const source = await this.read(input.exchange);
    if (!source) throw new WalletPlacementError('home_conflict', 'Exchange home is unavailable');
    await this.publish({
      locator: input.credential,
      wallet: source.assignment.wallet,
      expiresAtMs: source.expiresAtMs,
      writer: input.writer,
    });
  }
}
