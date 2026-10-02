import { decodeTenantDeploymentD1ResourceV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';

export type WalletRegion = 'US' | 'WEUR' | 'APAC';

export class WalletPlacementError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'invalid_record' | 'home_conflict' | 'scope_conflict',
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

export class WalletHomeCatalog {
  readonly #byRegion: ReadonlyMap<WalletRegion, WalletHome>;

  private constructor(homes: readonly WalletHome[]) {
    const byRegion = new Map<WalletRegion, WalletHome>();
    for (const home of homes) {
      if (byRegion.has(home.region)) {
        throw new WalletPlacementError('invalid_input', 'Wallet home region is duplicated');
      }
      if ([...byRegion.values()].some((existing) => existing.databaseId === home.databaseId)) {
        throw new WalletPlacementError('invalid_input', 'Wallet home database is duplicated');
      }
      byRegion.set(home.region, home);
    }
    if (
      byRegion.size !== 3 ||
      !byRegion.has('US') ||
      !byRegion.has('WEUR') ||
      !byRegion.has('APAC')
    ) {
      throw new WalletPlacementError(
        'invalid_input',
        'US, WEUR and APAC wallet homes are required',
      );
    }
    this.#byRegion = byRegion;
    Object.freeze(this);
  }

  static parse(raw: unknown): WalletHomeCatalog {
    if (!Array.isArray(raw) || raw.length !== 3) {
      throw new WalletPlacementError('invalid_input', 'Three wallet home resources are required');
    }
    return new WalletHomeCatalog(raw.map((value) => WalletHome.parse(value)));
  }

  select(region: WalletRegion): WalletHome {
    const home = this.#byRegion.get(region);
    if (!home) throw new WalletPlacementError('invalid_input', 'Wallet home region is unavailable');
    return home;
  }

  admits(home: WalletHome): boolean {
    return this.select(home.region).matches(home);
  }
}

export function regionForRegistrationIngress(
  request: Request & { readonly cf?: { readonly continent?: unknown; readonly country?: unknown } },
  unavailableLocationDefault: WalletRegion,
): WalletRegion {
  const continent = request.cf?.continent;
  const country = request.cf?.country;
  if (country === 'TR' || country === 'IL' || country === 'AE' || country === 'SA') return 'WEUR';
  switch (continent) {
    case 'NA':
    case 'SA':
      return 'US';
    case 'EU':
    case 'AF':
      return 'WEUR';
    case 'AS':
    case 'OC':
      return 'APAC';
    default:
      return unavailableLocationDefault;
  }
}

export class RegistrationSetupAllocation {
  readonly #validated = true;

  private constructor(
    readonly ceremonyId: string,
    readonly preparationId: string,
    readonly walletAuthorityId: string,
    readonly deviceId: string,
    readonly walletAuthMethodId: string,
  ) {
    Object.freeze(this);
  }

  static parse(raw: unknown): RegistrationSetupAllocation {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('ceremonyId' in raw) ||
      !('preparationId' in raw) ||
      !('walletAuthorityId' in raw) ||
      !('deviceId' in raw) ||
      !('walletAuthMethodId' in raw) ||
      Object.keys(raw).length !== 5
    ) {
      throw new WalletPlacementError('invalid_input', 'Registration allocation is invalid');
    }
    return new RegistrationSetupAllocation(
      allocationId(raw.ceremonyId, /^wrc_[A-Za-z0-9_-]+$/u),
      allocationId(raw.preparationId, /^regprep_[A-Za-z0-9_-]+$/u),
      allocationId(raw.walletAuthorityId, /^wallet-authority:[A-Za-z0-9_-]+$/u),
      allocationId(raw.deviceId, /^device:[A-Za-z0-9_-]+$/u),
      allocationId(raw.walletAuthMethodId, /^wallet-auth-method:[A-Za-z0-9_-]+$/u),
    );
  }

  static isValidated(value: unknown): value is RegistrationSetupAllocation {
    return value instanceof RegistrationSetupAllocation && value.#validated;
  }
}

function allocationId(raw: unknown, pattern: RegExp): string {
  if (typeof raw !== 'string' || !pattern.test(raw)) {
    throw new WalletPlacementError('invalid_input', 'Registration allocation identity is invalid');
  }
  return raw;
}

export type WalletHomeAssignment = {
  readonly wallet: WalletOwnershipKey;
  readonly home: WalletHome;
  readonly registrationId: string;
  readonly requestDigest: string;
  readonly allocation: 'provided' | 'server_allocated';
  readonly registrationAllocation: RegistrationSetupAllocation;
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
      readonly code: 'wallet_conflict' | 'registration_conflict' | 'request_conflict';
      readonly assignment: WalletHomeAssignment;
      readonly disposition?: never;
    };

export type WalletHomeReservationInput = {
  readonly proposedHome: WalletHome;
  readonly registrationId: string;
  readonly requestDigest: string;
  readonly proposedRegistrationAllocation: RegistrationSetupAllocation;
  readonly nowMs: number;
} & (
  | {
      readonly allocation: 'provided';
      readonly wallet: WalletOwnershipKey;
      readonly candidate?: never;
    }
  | {
      readonly allocation: 'server_allocated';
      readonly candidate: WalletOwnershipKey;
      readonly wallet?: never;
    }
);
