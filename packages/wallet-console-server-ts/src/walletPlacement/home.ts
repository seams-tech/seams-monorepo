import { decodeTenantDeploymentD1ResourceV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';

export type WalletRegion = 'US' | 'WEUR' | 'APAC';

export class WalletPlacementError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'invalid_record' | 'home_conflict',
    message: string,
  ) {
    super(message);
    this.name = 'WalletPlacementError';
  }
}

function identityPart(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new WalletPlacementError('invalid_input', 'Wallet ownership identity is invalid');
  }
  return value;
}

export class WalletOwnershipKey {
  readonly #validated = true;

  private constructor(
    readonly namespace: string,
    readonly organizationId: string,
    readonly projectId: string,
    readonly environmentId: string,
    readonly walletId: string,
  ) {
    Object.freeze(this);
  }

  static parse(raw: unknown): WalletOwnershipKey {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('namespace' in raw) ||
      !('organizationId' in raw) ||
      !('projectId' in raw) ||
      !('environmentId' in raw) ||
      !('walletId' in raw) ||
      Object.keys(raw).length !== 5
    ) {
      throw new WalletPlacementError('invalid_input', 'Wallet ownership key is invalid');
    }
    return new WalletOwnershipKey(
      identityPart(raw.namespace),
      identityPart(raw.organizationId),
      identityPart(raw.projectId),
      identityPart(raw.environmentId),
      identityPart(raw.walletId),
    );
  }

  matches(other: WalletOwnershipKey): boolean {
    return (
      this.#validated &&
      other.#validated &&
      this.namespace === other.namespace &&
      this.organizationId === other.organizationId &&
      this.projectId === other.projectId &&
      this.environmentId === other.environmentId &&
      this.walletId === other.walletId
    );
  }
}

export class WalletHome {
  readonly #validated = true;

  private constructor(
    readonly region: WalletRegion,
    readonly accountId: string,
    readonly databaseId: string,
  ) {
    Object.freeze(this);
  }

  static parse(raw: unknown): WalletHome {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('region' in raw) ||
      !('accountId' in raw) ||
      !('databaseId' in raw) ||
      Object.keys(raw).length !== 3 ||
      (raw.region !== 'US' && raw.region !== 'WEUR' && raw.region !== 'APAC')
    ) {
      throw new WalletPlacementError('invalid_input', 'Wallet home is invalid');
    }
    const resource = decodeTenantDeploymentD1ResourceV1({
      accountId: raw.accountId,
      databaseId: raw.databaseId,
    });
    if (!resource.ok) throw new WalletPlacementError('invalid_input', resource.message);
    return new WalletHome(raw.region, resource.value.accountId, resource.value.databaseId);
  }

  matches(other: WalletHome): boolean {
    return (
      this.#validated &&
      other.#validated &&
      this.region === other.region &&
      this.accountId === other.accountId &&
      this.databaseId === other.databaseId
    );
  }
}

export type WalletHomeAssignment = {
  readonly wallet: WalletOwnershipKey;
  readonly home: WalletHome;
  readonly registrationId: string;
  readonly reservedAtMs: number;
} & (
  | { readonly state: 'reserved'; readonly completedAtMs?: never }
  | { readonly state: 'established'; readonly completedAtMs: number }
  | { readonly state: 'cancelled'; readonly completedAtMs: number }
);

export type WalletHomeReservation =
  | {
      readonly ok: true;
      readonly disposition: 'reserved' | 'reused';
      readonly assignment: WalletHomeAssignment;
      readonly code?: never;
    }
  | {
      readonly ok: false;
      readonly code: 'wallet_conflict' | 'registration_conflict';
      readonly assignment: WalletHomeAssignment;
      readonly disposition?: never;
    };
