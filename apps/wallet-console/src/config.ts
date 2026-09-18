import type { SeamsConfigsInput } from '@seams/wallet/react';
import { decodeTenantDeploymentPublicProjectionV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';
import {
  DEFAULT_WALLET_SESSION_REMAINING_USES,
  DEFAULT_WALLET_SESSION_TTL_MS,
  MAX_WALLET_SESSION_REMAINING_USES,
  MAX_WALLET_SESSION_TTL_MS,
} from '@seams/wallet/advanced';

const DEFAULT_NEAR_RPC_URL = 'https://rpc.testnet.fastnear.com';
const DEFAULT_NEAR_EXPLORER_URL = 'https://testnet.nearblocks.io';
const DEFAULT_DOCS_ORIGIN = 'https://docs.localhost:4003';
const DEFAULT_TEMPO_RPC_URL = 'https://rpc.moderato.tempo.xyz';
const DEFAULT_TEMPO_EXPLORER_URL = 'https://explore.testnet.tempo.xyz';
const DEFAULT_TEMPO_FEE_TOKEN = '0x20c0000000000000000000000000000000000001';
const DEFAULT_ARC_RPC_URL = 'https://rpc.drpc.testnet.arc.network';
const DEFAULT_ARC_EXPLORER_URL = 'https://testnet.arcscan.app';
const DEFAULT_DEMO_CONTRACT_ID = 'seams-v1.testnet';

export type FrontendNetwork = 'testnet' | 'mainnet';

type ManagedRegistrationConfig = NonNullable<SeamsConfigsInput['registration']>;

export type FrontendDeployment = {
  network: FrontendNetwork;
  apiOrigin: string;
  relayerUrl: string;
  consoleBaseUrl: string;
  projectEnvironmentId: string;
  publishableKey: string;
  signingWorkerId: string;
  managedRegistration: ManagedRegistrationConfig | undefined;
  nearNetwork: FrontendNetwork;
  nearRpcUrl: string;
  nearExplorerUrl: string;
  tempoRpcUrl: string;
  tempoExplorerUrl: string;
  tempoFeeToken: string;
  arcRpcUrl: string;
  arcRpcRequestUrl: string;
  arcExplorerUrl: string;
  chains: NonNullable<SeamsConfigsInput['chains']>;
  walletOrigin: string;
  walletServicePath: string;
  sdkBasePath: string;
  rpIdBase: string;
  demoContractId: string;
  signingSessionDefaults: {
    ttlMs: number;
    remainingUses: number;
  };
  signingSessionPersistenceMode: NonNullable<SeamsConfigsInput['signingSessionPersistenceMode']>;
  routerAb: SeamsConfigsInput['routerAb'];
  dashboardFlags: {
    walletsRoutesEnabled: boolean;
  };
};

type FrontendSiteCommon = FrontendDeployment & {
  siteOrigin: string;
  docsOrigin: string;
  baseUrl: string;
  siteKind: 'staging' | 'production';
  defaultNetwork: FrontendNetwork;
};

export type StagingFrontendConfig = FrontendSiteCommon & {
  siteKind: 'staging';
  defaultNetwork: 'testnet';
  availableNetworks: readonly ['testnet'];
  deployments: {
    testnet: FrontendDeployment;
    mainnet?: never;
  };
};

export type ProductionFrontendConfig = FrontendSiteCommon & {
  siteKind: 'production';
  defaultNetwork: 'testnet';
  availableNetworks: readonly ['testnet', 'mainnet'];
  deployments: {
    testnet: FrontendDeployment;
    mainnet: FrontendDeployment;
  };
};

export type FrontendConfig = StagingFrontendConfig | ProductionFrontendConfig;

function toTrimmedString(value: unknown): string {
  return String(value ?? '').trim();
}

function toOptionalString(value: unknown): string | undefined {
  const trimmed = toTrimmedString(value);
  return trimmed || undefined;
}

function parseSigningSessionPolicyValue(args: {
  value: unknown;
  fallback: number;
  maximum: number;
  field: string;
}): number {
  const raw = toTrimmedString(args.value);
  if (!raw) return args.fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > args.maximum) {
    throw new Error(
      `${args.field} must be a positive safe integer no greater than ${args.maximum}`,
    );
  }
  return parsed;
}

function parseBooleanFlag(value: unknown, fallback: boolean): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function currentBrowserHostname(): string {
  if (typeof globalThis.location === 'undefined') return '';
  return toTrimmedString(globalThis.location.hostname);
}

function parseSigningSessionPersistenceMode(
  value: unknown,
): NonNullable<SeamsConfigsInput['signingSessionPersistenceMode']> {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'sealed_refresh_v1') return 'sealed_refresh_v1';
  return 'none';
}

function stripTrailingSlash(path: string): string {
  if (path.length <= 1) return path;
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

function resolveRouterAbConfig(
  source: Record<string, unknown>,
  prefix: string,
  managedRegistration: ManagedRegistrationConfig | undefined,
): SeamsConfigsInput['routerAb'] | undefined {
  const signingWorkerId = toOptionalString(source[`${prefix}ROUTER_AB_NORMAL_SIGNING_WORKER_ID`]);
  if (signingWorkerId) {
    return {
      normalSigning: {
        mode: 'enabled',
        signingWorkerId,
      },
    };
  }

  if (managedRegistration) {
    throw new Error(
      `Missing ${prefix}ROUTER_AB_NORMAL_SIGNING_WORKER_ID: managed threshold registrations require Router A/B normal signing`,
    );
  }

  return undefined;
}

function resolveArcRpcRequestUrl(arcRpcUrl: string): string {
  return Array.from(
    new Set(
      [arcRpcUrl, DEFAULT_ARC_RPC_URL]
        .flatMap((value) => value.split(/[\s,]+/u))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).join(',');
}

function readEnvironmentValue(source: Record<string, unknown>, key: string, fallback = ''): string {
  return toTrimmedString(source[key]) || fallback;
}

function resolveLanePrefix(network: FrontendNetwork, siteKind: 'staging' | 'production'): string {
  return siteKind === 'staging' ? 'VITE_' : `VITE_${network.toUpperCase()}_`;
}

function resolveRequiredLaneValue(
  source: Record<string, unknown>,
  key: string,
  prefix: string,
  network: FrontendNetwork,
): string {
  const value = toOptionalString(source[`${prefix}${key}`]);
  if (!value) {
    throw new Error(`Missing ${prefix}${key}: ${network} frontend configuration is incomplete`);
  }
  return value;
}

function buildChains(
  source: Record<string, unknown>,
  prefix: string,
  network: FrontendNetwork,
  nearRpcUrl: string,
  nearExplorerUrl: string,
): NonNullable<SeamsConfigsInput['chains']> {
  const nearChainNetwork: 'near-mainnet' | 'near-testnet' =
    network === 'mainnet' ? 'near-mainnet' : 'near-testnet';
  const chains: NonNullable<SeamsConfigsInput['chains']> = [
    {
      network: nearChainNetwork,
      rpcUrl: nearRpcUrl,
      explorerUrl: nearExplorerUrl,
    },
  ];

  if (network === 'testnet') {
    const tempoRpcUrl =
      readEnvironmentValue(source, `${prefix}TEMPO_RPC_URL`) || DEFAULT_TEMPO_RPC_URL;
    const tempoExplorerUrl =
      readEnvironmentValue(source, `${prefix}TEMPO_EXPLORER`) || DEFAULT_TEMPO_EXPLORER_URL;
    const arcRpcUrl = readEnvironmentValue(source, `${prefix}ARC_RPC_URL`) || DEFAULT_ARC_RPC_URL;
    const arcExplorerUrl =
      readEnvironmentValue(source, `${prefix}ARC_EXPLORER`) || DEFAULT_ARC_EXPLORER_URL;
    chains.push(
      {
        network: 'tempo-testnet',
        rpcUrl: tempoRpcUrl,
        explorerUrl: tempoExplorerUrl,
        chainId: 42_431,
      },
      {
        network: 'arc-testnet',
        rpcUrl: resolveArcRpcRequestUrl(arcRpcUrl),
        explorerUrl: arcExplorerUrl,
        chainId: 5_042_002,
      },
    );
  }
  return chains;
}

function buildDeployment(
  source: ImportMetaEnv,
  siteKind: 'staging' | 'production',
  network: FrontendNetwork,
  laneOrigin: string,
  walletOrigin: string,
): FrontendDeployment {
  const laneValues = source as Record<string, unknown>;
  const prefix = resolveLanePrefix(network, siteKind);
  const registration: ManagedRegistrationConfig | undefined = undefined;
  const configuredNearNetwork = toOptionalString(laneValues[`${prefix}NEAR_NETWORK`]);
  if (configuredNearNetwork && configuredNearNetwork !== network) {
    throw new Error(
      `Invalid ${prefix}NEAR_NETWORK: expected ${network}, received ${configuredNearNetwork || 'empty'}`,
    );
  }
  const relayerUrl =
    siteKind === 'staging' ? readEnvironmentValue(laneValues, `${prefix}RELAYER_URL`) : laneOrigin;
  const consoleBaseUrl =
    siteKind === 'staging'
      ? readEnvironmentValue(laneValues, `${prefix}CONSOLE_BASE_URL`, relayerUrl)
      : laneOrigin;
  const nearRpcUrl =
    siteKind === 'staging'
      ? readEnvironmentValue(laneValues, `${prefix}NEAR_RPC_URL`, DEFAULT_NEAR_RPC_URL)
      : resolveRequiredLaneValue(laneValues, 'NEAR_RPC_URL', prefix, network);
  const nearExplorerUrl =
    siteKind === 'staging'
      ? readEnvironmentValue(laneValues, `${prefix}NEAR_EXPLORER`, DEFAULT_NEAR_EXPLORER_URL)
      : resolveRequiredLaneValue(laneValues, 'NEAR_EXPLORER', prefix, network);
  const tempoRpcUrl =
    network === 'testnet'
      ? readEnvironmentValue(laneValues, `${prefix}TEMPO_RPC_URL`, DEFAULT_TEMPO_RPC_URL)
      : '';
  const tempoExplorerUrl =
    network === 'testnet'
      ? readEnvironmentValue(laneValues, `${prefix}TEMPO_EXPLORER`, DEFAULT_TEMPO_EXPLORER_URL)
      : '';
  const tempoFeeToken =
    network === 'testnet'
      ? readEnvironmentValue(laneValues, `${prefix}TEMPO_FEE_TOKEN`, DEFAULT_TEMPO_FEE_TOKEN)
      : '';
  const arcRpcUrl =
    network === 'testnet'
      ? readEnvironmentValue(laneValues, `${prefix}ARC_RPC_URL`, DEFAULT_ARC_RPC_URL)
      : '';
  const arcExplorerUrl =
    network === 'testnet'
      ? readEnvironmentValue(laneValues, `${prefix}ARC_EXPLORER`, DEFAULT_ARC_EXPLORER_URL)
      : '';
  const rpIdBase =
    readEnvironmentValue(laneValues, `${prefix}RP_ID_BASE`) ||
    (walletOrigin ? new URL(walletOrigin).hostname : currentBrowserHostname());
  const signingSessionPersistenceMode = parseSigningSessionPersistenceMode(
    readEnvironmentValue(laneValues, `${prefix}SIGNING_SESSION_PERSISTENCE_MODE`),
  );
  const routerAb = resolveRouterAbConfig(laneValues, prefix, registration);
  const signingWorkerId =
    toOptionalString(laneValues[`${prefix}ROUTER_AB_NORMAL_SIGNING_WORKER_ID`]) || '';

  return {
    network,
    apiOrigin: laneOrigin,
    relayerUrl,
    consoleBaseUrl,
    projectEnvironmentId: '',
    publishableKey: '',
    signingWorkerId,
    managedRegistration: registration,
    nearNetwork: network,
    nearRpcUrl,
    nearExplorerUrl,
    tempoRpcUrl,
    tempoExplorerUrl,
    tempoFeeToken,
    arcRpcUrl,
    arcRpcRequestUrl: arcRpcUrl ? resolveArcRpcRequestUrl(arcRpcUrl) : '',
    arcExplorerUrl,
    chains: buildChains(source, prefix, network, nearRpcUrl, nearExplorerUrl),
    walletOrigin,
    walletServicePath: readEnvironmentValue(laneValues, `${prefix}WALLET_SERVICE_PATH`),
    sdkBasePath: readEnvironmentValue(laneValues, `${prefix}SDK_BASE_PATH`),
    rpIdBase,
    demoContractId: readEnvironmentValue(
      laneValues,
      `${prefix}DEMO_CONTRACT_ID`,
      network === 'mainnet' ? '' : DEFAULT_DEMO_CONTRACT_ID,
    ),
    signingSessionDefaults: {
      ttlMs: parseSigningSessionPolicyValue({
        value: readEnvironmentValue(laneValues, `${prefix}SIGNING_SESSION_TTL_MS`),
        fallback: DEFAULT_WALLET_SESSION_TTL_MS,
        maximum: MAX_WALLET_SESSION_TTL_MS,
        field: `${prefix}SIGNING_SESSION_TTL_MS`,
      }),
      remainingUses: parseSigningSessionPolicyValue({
        value: readEnvironmentValue(laneValues, `${prefix}SIGNING_SESSION_REMAINING_USES`),
        fallback: DEFAULT_WALLET_SESSION_REMAINING_USES,
        maximum: MAX_WALLET_SESSION_REMAINING_USES,
        field: `${prefix}SIGNING_SESSION_REMAINING_USES`,
      }),
    },
    signingSessionPersistenceMode,
    routerAb,
    dashboardFlags: {
      walletsRoutesEnabled: parseBooleanFlag(source.VITE_DASHBOARD_WALLETS_ROUTES_ENABLED, true),
    },
  };
}

function buildSiteConfig(source: ImportMetaEnv): FrontendConfig {
  const siteKind = source.VITE_SITE_ID === 'production' ? 'production' : 'staging';
  const docsOrigin = stripTrailingSlash(
    toTrimmedString(source.VITE_DOCS_ORIGIN) || DEFAULT_DOCS_ORIGIN,
  );
  const baseUrl = stripTrailingSlash(toTrimmedString(source.BASE_URL || '/')) || '/';
  const siteOrigin =
    toTrimmedString(source.VITE_SITE_ORIGIN) ||
    (siteKind === 'production' ? 'https://seams.sh' : 'https://staging.seams.sh');
  const testnetOrigin =
    siteKind === 'production'
      ? 'https://test.api.wallet.seams.sh'
      : readEnvironmentValue(source as Record<string, unknown>, 'VITE_RELAYER_URL');
  const testnetWalletOrigin =
    siteKind === 'production'
      ? 'https://test.sign.seams.sh'
      : readEnvironmentValue(source as Record<string, unknown>, 'VITE_WALLET_ORIGIN');
  const testnet = buildDeployment(source, siteKind, 'testnet', testnetOrigin, testnetWalletOrigin);

  if (siteKind === 'staging') {
    return {
      ...testnet,
      siteOrigin,
      docsOrigin,
      baseUrl,
      siteKind,
      defaultNetwork: 'testnet',
      availableNetworks: ['testnet'],
      deployments: { testnet },
    };
  }

  const mainnet = buildDeployment(
    source,
    siteKind,
    'mainnet',
    'https://api.wallet.seams.sh',
    'https://sign.seams.sh',
  );
  if (mainnet.nearNetwork !== 'mainnet') {
    throw new Error('Production mainnet frontend must use mainnet NEAR configuration');
  }

  return {
    ...testnet,
    siteOrigin,
    docsOrigin,
    baseUrl,
    siteKind,
    defaultNetwork: 'testnet',
    availableNetworks: ['testnet', 'mainnet'],
    deployments: { testnet, mainnet },
  };
}

async function hydrateDeploymentBinding(
  deployment: FrontendDeployment,
  siteOrigin: string,
): Promise<FrontendDeployment> {
  const response = await fetch(`${deployment.apiOrigin}/.well-known/seams-tenant-deployment.json`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok)
    throw new Error(`Tenant deployment discovery failed with HTTP ${response.status}`);
  const decoded = decodeTenantDeploymentPublicProjectionV1(await response.json());
  if (!decoded.ok) throw new Error(decoded.message);
  const binding = decoded.value;
  if (!deployment.routerAb) throw new Error('Tenant deployment requires Router A/B normal signing');
  const expectedMode =
    deployment.network === 'testnet' ? 'development_testnet_v1' : 'production_mainnet_v1';
  if (
    binding.mode.kind !== expectedMode ||
    binding.gatewayOrigin !== deployment.apiOrigin ||
    binding.hostedWalletOrigin !== deployment.walletOrigin ||
    !binding.allowedOrigins.includes(siteOrigin)
  ) {
    throw new Error('Tenant deployment discovery does not match this frontend surface');
  }
  return {
    ...deployment,
    projectEnvironmentId: binding.environmentId,
    publishableKey: binding.publishableKey,
    rpIdBase: binding.relyingPartyId,
    managedRegistration: {
      mode: 'managed',
      projectEnvironmentId: binding.environmentId,
      publishableKey: binding.publishableKey,
    },
  };
}

async function hydrateSiteBindings(config: FrontendConfig): Promise<FrontendConfig> {
  const testnet = await hydrateDeploymentBinding(config.deployments.testnet, config.siteOrigin);
  if (config.siteKind === 'staging') return { ...config, ...testnet, deployments: { testnet } };
  const mainnet = await hydrateDeploymentBinding(config.deployments.mainnet, config.siteOrigin);
  return { ...config, ...testnet, deployments: { testnet, mainnet } };
}

export const FRONTEND_CONFIG = Object.freeze(
  await hydrateSiteBindings(buildSiteConfig(import.meta.env)),
);

export function getFrontendDeployment(
  config: FrontendConfig,
  network: FrontendNetwork = config.defaultNetwork,
): FrontendDeployment {
  switch (config.siteKind) {
    case 'staging':
      if (network !== 'testnet') {
        throw new Error('Staging frontend only supports testnet');
      }
      return config.deployments.testnet;
    case 'production':
      return config.deployments[network];
    default:
      return assertNever(config);
  }
}

export function buildSeamsSdkConfig(deployment: FrontendDeployment): SeamsConfigsInput {
  return {
    chains: deployment.chains,
    iframeWallet: deployment.walletOrigin
      ? {
          walletOrigin: deployment.walletOrigin,
          ...(deployment.walletServicePath
            ? { walletServicePath: deployment.walletServicePath }
            : {}),
          ...(deployment.rpIdBase ? { rpIdOverride: deployment.rpIdBase } : {}),
          ...(deployment.sdkBasePath ? { sdkBasePath: deployment.sdkBasePath } : {}),
        }
      : undefined,
    signingSessionDefaults: deployment.signingSessionDefaults,
    signingSessionPersistenceMode: deployment.signingSessionPersistenceMode,
    ...(deployment.routerAb ? { routerAb: deployment.routerAb } : {}),
    relayer: {
      url: deployment.relayerUrl,
    },
    ...(deployment.managedRegistration ? { registration: deployment.managedRegistration } : {}),
  };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported frontend configuration branch: ${String(value)}`);
}
