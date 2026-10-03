import {
  WalletLifecycleLocator,
  parseRecoveryCodeLocatorV1,
  parseWalletRecoveryOperationId,
  type D1DatabaseLike,
} from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { walletHomeAssignmentFromRow } from './d1';
import { WalletOwnershipKey, WalletPlacementError, type WalletHomeAssignment } from './home';

type Scope = Pick<
  WalletOwnershipKey,
  'namespace' | 'organizationId' | 'projectId' | 'environmentId'
>;

export class WalletRouteLocator {
  readonly #validated = true;
  private constructor(
    readonly kind:
      | 'code'
      | 'operation'
      | 'yao_recovery'
      | 'yao_export'
      | 'passkey_challenge'
      | 'linked_device',
    readonly value: string,
  ) {
    Object.freeze(this);
  }

  matches(other: WalletRouteLocator): boolean {
    return (
      this.#validated && other.#validated && this.kind === other.kind && this.value === other.value
    );
  }

  static parse(raw: unknown): WalletRouteLocator {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('kind' in raw) ||
      !('value' in raw) ||
      Object.keys(raw).length !== 2
    )
      throw new WalletPlacementError('invalid_input', 'Wallet route locator is invalid');
    try {
      switch (raw.kind) {
        case 'linked_device':
        case 'passkey_challenge':
        case 'yao_recovery':
        case 'yao_export': {
          const locator = WalletLifecycleLocator.parse(raw);
          return new WalletRouteLocator(locator.kind, locator.value);
        }
        case 'code':
          return new WalletRouteLocator('code', parseRecoveryCodeLocatorV1(raw.value));
        case 'operation': {
          const parsed = parseWalletRecoveryOperationId(raw.value);
          if (!parsed.ok) throw new Error(parsed.error.message);
          return new WalletRouteLocator('operation', parsed.value);
        }
      }
    } catch {
      throw new WalletPlacementError('invalid_input', 'Wallet route locator is invalid');
    }
    throw new WalletPlacementError('invalid_input', 'Wallet route locator kind is invalid');
  }
}

export class D1WalletRoutes {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: Scope,
  ) {}

  async find(locator: WalletRouteLocator): Promise<WalletHomeAssignment | null> {
    const row = await this.database
      .prepare(
        `SELECT home.* FROM wallet_routes AS route
      JOIN wallet_homes AS home ON home.namespace = route.namespace
        AND home.organization_id = route.organization_id AND home.project_id = route.project_id
        AND home.environment_id = route.environment_id AND home.wallet_id = route.wallet_id
      WHERE route.namespace = ?1 AND route.organization_id = ?2 AND route.project_id = ?3
        AND route.environment_id = ?4 AND route.kind = ?5 AND route.value = ?6
        AND home.state IN ('reserved', 'established')`,
      )
      .bind(
        this.scope.namespace,
        this.scope.organizationId,
        this.scope.projectId,
        this.scope.environmentId,
        locator.kind,
        locator.value,
      )
      .first<Record<string, unknown>>();
    return row ? walletHomeAssignmentFromRow(row) : null;
  }

  async publish(
    wallet: WalletOwnershipKey,
    locators: readonly WalletRouteLocator[],
    writer: TenantRuntimeWriterV1,
  ): Promise<boolean> {
    const bindings = [
      wallet.namespace,
      wallet.organizationId,
      wallet.projectId,
      wallet.environmentId,
      JSON.stringify(locators),
      wallet.walletId,
      writer.resource.accountId,
      writer.resource.databaseId,
    ];
    await this.database
      .prepare(
        `INSERT INTO wallet_routes
      (namespace, organization_id, project_id, environment_id, kind, value, wallet_id)
      SELECT home.namespace, home.organization_id, home.project_id, home.environment_id,
        json_extract(item.value, '$.kind'), json_extract(item.value, '$.value'), home.wallet_id
      FROM wallet_homes AS home JOIN json_each(?5) AS item
      WHERE home.namespace = ?1 AND home.organization_id = ?2 AND home.project_id = ?3
        AND home.environment_id = ?4 AND home.wallet_id = ?6
        AND home.account_id = ?7 AND home.database_id = ?8 AND home.state IN ('reserved', 'established')
        AND NOT EXISTS (SELECT 1 FROM json_each(?5) AS candidate JOIN wallet_routes AS claimed
          ON claimed.kind = json_extract(candidate.value, '$.kind') AND claimed.value = json_extract(candidate.value, '$.value')
          WHERE claimed.namespace = ?1 AND claimed.organization_id = ?2 AND claimed.project_id = ?3
            AND claimed.environment_id = ?4 AND claimed.wallet_id != ?6)
        AND NOT EXISTS (SELECT 1 FROM wallet_routes AS route
          WHERE route.namespace = ?1 AND route.organization_id = ?2 AND route.project_id = ?3
            AND route.environment_id = ?4 AND route.kind = json_extract(item.value, '$.kind')
            AND route.value = json_extract(item.value, '$.value'))
      ON CONFLICT DO NOTHING`,
      )
      .bind(...bindings)
      .run();
    const count = await this.database
      .prepare(
        `SELECT COUNT(*) AS matched
      FROM json_each(?5) AS item JOIN wallet_routes AS route
        ON route.kind = json_extract(item.value, '$.kind') AND route.value = json_extract(item.value, '$.value')
      JOIN wallet_homes AS home ON home.namespace = route.namespace
        AND home.organization_id = route.organization_id AND home.project_id = route.project_id
        AND home.environment_id = route.environment_id AND home.wallet_id = route.wallet_id
      WHERE route.namespace = ?1 AND route.organization_id = ?2 AND route.project_id = ?3
        AND route.environment_id = ?4 AND route.wallet_id = ?6
        AND home.account_id = ?7 AND home.database_id = ?8 AND home.state IN ('reserved', 'established')`,
      )
      .bind(...bindings)
      .first<number>('matched');
    return count === locators.length;
  }
}
