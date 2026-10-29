export type ConsoleWalletEnvironmentKey = 'dev' | 'staging' | 'prod';
export type ConsoleWalletEnvironmentStatus = 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
export const DEFAULT_WALLET_SIGNING_ROOT_VERSION = 'default';

export interface ConsoleWalletEnvironment {
  readonly externalAuth: import('@seams/wallet-server/cloud-host').ExternalAuthConfiguration;
  readonly id: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly key: ConsoleWalletEnvironmentKey;
  readonly signingRootVersion: string;
  readonly name: string;
  readonly status: ConsoleWalletEnvironmentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface ListConsoleWalletEnvironmentsRequest {
  projectId?: string;
  status?: ConsoleWalletEnvironmentStatus;
}
export interface CreateConsoleWalletEnvironmentRequest {
  id?: string;
  projectId: string;
  key: ConsoleWalletEnvironmentKey;
  signingRootVersion: string;
  name?: string;
  status: Exclude<ConsoleWalletEnvironmentStatus, 'ARCHIVED'>;
}
export interface UpdateConsoleWalletEnvironmentRequest {
  externalAuth?: { kind: 'disabled' } | { kind: 'google'; clientId: string };
  name?: string;
  signingRootVersion?: string;
}
export interface ProvisionConsoleWalletEnvironmentsRequest {
  projectId: string;
  liveAccess: 'enabled' | 'disabled';
}

export interface SetConsoleWalletProjectAvailabilityRequest {
  readonly projectId: string;
  readonly availability: 'enabled' | 'disabled' | 'archived';
  readonly liveAccess: 'enabled' | 'disabled';
  readonly authority: {
    readonly scope: PlatformScopeV1;
    readonly instanceId: string;
    readonly desiredRevision: number;
  };
}

export type SetConsoleWalletProjectAvailabilityResult =
  | { readonly kind: 'applied'; readonly environments: readonly ConsoleWalletEnvironment[] }
  | { readonly kind: 'stale'; readonly environments?: never };
export interface ConsoleWalletEnvironmentWire {
  externalAuth: ConsoleWalletEnvironment['externalAuth'];
  id: string;
  orgId: string;
  projectId: string;
  key: ConsoleWalletEnvironmentKey;
  runtimeVersion: string;
  name: string;
  status: ConsoleWalletEnvironmentStatus;
  createdAt: string;
  updatedAt: string;
}
export function serializeWalletEnvironment(
  environment: ConsoleWalletEnvironment,
): ConsoleWalletEnvironmentWire {
  return {
    externalAuth: environment.externalAuth,
    id: environment.id,
    orgId: environment.orgId,
    projectId: environment.projectId,
    key: environment.key,
    runtimeVersion: environment.signingRootVersion,
    name: environment.name,
    status: environment.status,
    createdAt: environment.createdAt,
    updatedAt: environment.updatedAt,
  };
}
import type { PlatformScopeV1 } from '@seams-internal/console-shared/accountPlatform';
