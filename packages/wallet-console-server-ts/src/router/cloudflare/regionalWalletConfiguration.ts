import type { WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import type { TenantDeploymentCandidateSurfacesV1 } from '../../tenantDeployment/productionReadiness';
import { WalletHomeCatalog, type WalletRegion } from '../../walletPlacement/home';

export interface RegionalWalletEnvironment {
  readonly SEAMS_WALLET_HOME_CATALOG_JSON?: string;
  readonly TENANT_DEPLOYMENT_SURFACES_JSON?: string;
  readonly WALLET_RUNTIME_US?: WalletRuntimeServiceBinding;
  readonly WALLET_RUNTIME_WEUR?: WalletRuntimeServiceBinding;
  readonly WALLET_RUNTIME_APAC?: WalletRuntimeServiceBinding;
  readonly WALLET_RUNTIME_OC?: WalletRuntimeServiceBinding;
  readonly WALLET_GATEWAY_US?: WalletRuntimeServiceBinding;
  readonly WALLET_GATEWAY_WEUR?: WalletRuntimeServiceBinding;
  readonly WALLET_GATEWAY_APAC?: WalletRuntimeServiceBinding;
  readonly WALLET_GATEWAY_OC?: WalletRuntimeServiceBinding;
}

type RegionalServices = Readonly<Record<WalletRegion, WalletRuntimeServiceBinding>>;

export type ConfiguredRegionalWallet = {
  readonly kind: 'configured';
  readonly catalog: WalletHomeCatalog;
  readonly surfaces: TenantDeploymentCandidateSurfacesV1;
  readonly runtimes: RegionalServices;
  readonly gateways: RegionalServices;
};

export type RegionalWalletConfiguration =
  | ConfiguredRegionalWallet
  | {
      readonly kind: 'unconfigured';
      readonly catalog?: never;
      readonly surfaces?: never;
      readonly runtimes?: never;
      readonly gateways?: never;
    };

/** Regional placement is configured only when its complete resource set exists. */
export function readRegionalWalletConfiguration(
  env: RegionalWalletEnvironment,
): RegionalWalletConfiguration {
  const runtimes = {
    US: env.WALLET_RUNTIME_US,
    WEUR: env.WALLET_RUNTIME_WEUR,
    APAC: env.WALLET_RUNTIME_APAC,
    OC: env.WALLET_RUNTIME_OC,
  };
  const gateways = {
    US: env.WALLET_GATEWAY_US,
    WEUR: env.WALLET_GATEWAY_WEUR,
    APAC: env.WALLET_GATEWAY_APAC,
    OC: env.WALLET_GATEWAY_OC,
  };
  const catalogJson = env.SEAMS_WALLET_HOME_CATALOG_JSON;
  if (
    catalogJson === undefined &&
    !Object.values(runtimes).some(isConfiguredBinding) &&
    !Object.values(gateways).some(isConfiguredBinding)
  ) {
    return { kind: 'unconfigured' };
  }
  if (!catalogJson) throw new Error('Regional Wallet configuration requires its home catalog');
  if (!env.TENANT_DEPLOYMENT_SURFACES_JSON) {
    throw new Error('Regional Wallet configuration requires its deployment surfaces');
  }
  return {
    kind: 'configured',
    catalog: WalletHomeCatalog.parse(JSON.parse(catalogJson)),
    surfaces: parseTenantDeploymentSurfaces(env.TENANT_DEPLOYMENT_SURFACES_JSON),
    runtimes: requireRegionalServices(runtimes),
    gateways: requireRegionalServices(gateways),
  };
}

function isConfiguredBinding(binding: WalletRuntimeServiceBinding | undefined): boolean {
  return binding !== undefined;
}

function requireRegionalServices(
  bindings: Readonly<Record<WalletRegion, WalletRuntimeServiceBinding | undefined>>,
): RegionalServices {
  if (!bindings.US || !bindings.WEUR || !bindings.APAC || !bindings.OC) {
    throw new Error('Regional Wallet configuration requires every Gateway and runtime binding');
  }
  return {
    US: bindings.US,
    WEUR: bindings.WEUR,
    APAC: bindings.APAC,
    OC: bindings.OC,
  };
}

function readTenantDeploymentSurfaceText(
  source: Record<string, unknown>,
  name: 'applicationOrigin' | 'hostedWalletOrigin' | 'gatewayOrigin' | 'relyingPartyId',
): string {
  const candidate = source[name];
  if (typeof candidate !== 'string' || !candidate || candidate.trim() !== candidate) {
    throw new Error(`TENANT_DEPLOYMENT_SURFACES_JSON.${name} is invalid`);
  }
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseTenantDeploymentSurfaces(raw: string): TenantDeploymentCandidateSurfacesV1 {
  if (!raw || raw.trim() !== raw) throw new Error('TENANT_DEPLOYMENT_SURFACES_JSON is required');
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) {
    throw new Error('TENANT_DEPLOYMENT_SURFACES_JSON must be an object');
  }
  const source = value;
  const required = [
    'applicationOrigin',
    'hostedWalletOrigin',
    'gatewayOrigin',
    'relyingPartyId',
  ] as const;
  if (Object.keys(source).sort().join(',') !== [...required].sort().join(',')) {
    throw new Error('TENANT_DEPLOYMENT_SURFACES_JSON has unexpected fields');
  }
  return {
    applicationOrigin: new URL(readTenantDeploymentSurfaceText(source, 'applicationOrigin')).origin,
    hostedWalletOrigin: new URL(readTenantDeploymentSurfaceText(source, 'hostedWalletOrigin'))
      .origin,
    gatewayOrigin: new URL(readTenantDeploymentSurfaceText(source, 'gatewayOrigin')).origin,
    relyingPartyId: readTenantDeploymentSurfaceText(source, 'relyingPartyId'),
  };
}
