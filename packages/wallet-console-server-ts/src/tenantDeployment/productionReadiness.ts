import type { ConsoleApiKey, ConsoleApiKeyService } from '@seams-internal/console-server/apiKeys';
import type { ConsoleOrgProjectEnvService } from '@seams-internal/console-server/orgProjectEnv/service';
import type { ConsoleEnvironment } from '@seams-internal/console-server/orgProjectEnv/types';
import {
  buildTenantDeploymentBindingV1,
  encodeTenantDeploymentJsonValueV1,
  type TenantDeploymentJsonValue,
  type ActiveTenantRootReferenceV1,
  type TenantDeploymentBindingV1,
  type TenantDeploymentModeV1,
} from '@seams-internal/wallet-console-shared/tenant-deployment';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '@seams-internal/wallet-console-shared/tenant-root';
import type { ConsoleRuntimeSnapshotService } from '../runtimeSnapshots/service';
import type { ConsolePolicyService } from '../policies/service';
import { resolveConsoleRuntimeSnapshotPayload } from '../router/runtimeSnapshotPayload';
import type { TenantRootSecurityStateReaderV1 } from '../tenantRootSecurity/consoleRoute';
import type { TenantRootIdentityV1 } from '../tenantRootCreation/types';
import type {
  TenantDeploymentReadinessEvidenceV1,
  TenantDeploymentReadinessInspectorV1,
} from './readiness';
import type { TenantDeploymentBindingReaderV1 } from './types';
import type {
  TenantDeploymentRuntimeInspectorV1,
  TenantDeploymentRuntimeScopeV1,
} from './runtimeInspection';

const SYSTEM_ACTOR_USER_ID = 'system:tenant-deployment-readiness';

export type TenantDeploymentCandidateSurfacesV1 = {
  readonly applicationOrigin: string;
  readonly hostedWalletOrigin: string;
  readonly gatewayOrigin: string;
  readonly relyingPartyId: string;
};

export interface TenantDeploymentCandidateResolverV1 {
  buildCandidate(input: {
    readonly identity: TenantRootIdentityV1;
    readonly activeTenantRoot: ActiveTenantRootReferenceV1;
    readonly credentialId: string;
    readonly publishableKey: string;
    readonly surfaces: TenantDeploymentCandidateSurfacesV1;
  }): Promise<TenantDeploymentBindingV1>;
}

export type ProductionTenantDeploymentReadinessAdapterV1 = TenantDeploymentReadinessInspectorV1 &
  TenantDeploymentCandidateResolverV1;

export type ProductionTenantDeploymentReadinessOptionsV1 = {
  readonly namespace: string;
  readonly deploymentLane: string;
  readonly orgProjectEnv: ConsoleOrgProjectEnvService;
  readonly apiKeys: ConsoleApiKeyService;
  readonly policies: ConsolePolicyService;
  readonly runtimeSnapshots: ConsoleRuntimeSnapshotService;
  readonly tenantRootState: TenantRootSecurityStateReaderV1;
  readonly bindings: TenantDeploymentBindingReaderV1;
  readonly walletRuntime: TenantDeploymentRuntimeInspectorV1;
  readonly now?: () => number;
};

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function canonicalOrigins(origins: readonly string[] | undefined): readonly [string, ...string[]] {
  const values = [...new Set((origins ?? []).map((origin) => new URL(origin).origin))].sort(
    compareCodeUnits,
  );
  const first = values[0];
  if (!first) throw new Error('publishable credential has no allowed origins');
  return [first, ...values.slice(1)];
}

function modeForEnvironment(environment: ConsoleEnvironment): TenantDeploymentModeV1 {
  switch (environment.key) {
    case 'dev':
      return { kind: 'development_testnet_v1', environment: 'development', network: 'testnet' };
    case 'prod':
      return { kind: 'production_mainnet_v1', environment: 'production', network: 'mainnet' };
    case 'staging':
      throw new Error('staging environments do not have a tenant deployment mode');
  }
}

async function resolveEnvironment(
  options: ProductionTenantDeploymentReadinessOptionsV1,
  identity: TenantRootIdentityV1,
): Promise<ConsoleEnvironment> {
  const environments = await options.orgProjectEnv.listEnvironments(
    {
      orgId: identity.orgId,
      actorUserId: SYSTEM_ACTOR_USER_ID,
      projectId: identity.projectId,
      environmentId: identity.envId,
    },
    { projectId: identity.projectId, status: 'ACTIVE' },
  );
  const environment = environments.find(
    (candidate) =>
      candidate.id === identity.envId &&
      candidate.orgId === identity.orgId &&
      candidate.projectId === identity.projectId,
  );
  if (!environment) throw new Error('tenant deployment environment is not active');
  if (
    `${identity.projectId}:${environment.key}` !== identity.signingRootId ||
    environment.runtimeVersion !== identity.signingRootVersion
  ) {
    throw new Error('tenant deployment identity disagrees with the active environment');
  }
  return environment;
}

async function resolveCredential(
  options: ProductionTenantDeploymentReadinessOptionsV1,
  identity: TenantRootIdentityV1,
  credentialId: string,
): Promise<ConsoleApiKey> {
  const credentials = await options.apiKeys.listApiKeys({
    orgId: identity.orgId,
    actorUserId: SYSTEM_ACTOR_USER_ID,
  });
  const credential = credentials.find((candidate) => candidate.id === credentialId);
  if (
    !credential ||
    credential.kind !== 'publishable_key' ||
    credential.environmentId !== identity.envId
  ) {
    throw new Error('publishable credential does not belong to the target environment');
  }
  return credential;
}

async function authenticateCredential(
  options: ProductionTenantDeploymentReadinessOptionsV1,
  binding: TenantDeploymentBindingV1,
): Promise<ConsoleApiKey> {
  const authenticate = options.apiKeys.authenticatePublishableKey;
  if (!authenticate) throw new Error('publishable credential authentication is unavailable');
  let authenticated: ConsoleApiKey | null = null;
  for (const origin of binding.browserCredential.allowedOrigins) {
    const result = await authenticate.call(options.apiKeys, {
      secret: binding.browserCredential.publishableKey,
      origin,
      environmentId: binding.tenant.environmentId,
    });
    if (!result.ok || result.apiKey.id !== binding.browserCredential.credentialId) {
      throw new Error(`publishable credential failed readiness authentication for ${origin}`);
    }
    authenticated = result.apiKey;
  }
  if (!authenticated) throw new Error('publishable credential has no authenticated origin');
  return authenticated;
}

async function resolveRuntimePolicyDigest(
  options: ProductionTenantDeploymentReadinessOptionsV1,
  identity: TenantRootIdentityV1,
  publishInitialSnapshot: boolean,
): Promise<string> {
  let snapshot = await options.runtimeSnapshots.getLatestSnapshot(
    { orgId: identity.orgId, actorUserId: SYSTEM_ACTOR_USER_ID },
    { environmentId: identity.envId, projectId: identity.projectId },
  );
  if (!snapshot && publishInitialSnapshot) {
    const payload = await resolveConsoleRuntimeSnapshotPayload({
      orgId: identity.orgId,
      actorUserId: SYSTEM_ACTOR_USER_ID,
      environmentId: identity.envId,
      projectId: identity.projectId,
      policies: options.policies,
    });
    snapshot = await options.runtimeSnapshots.publishSnapshot(
      { orgId: identity.orgId, actorUserId: SYSTEM_ACTOR_USER_ID },
      {
        environmentId: identity.envId,
        projectId: identity.projectId,
        payload,
      },
    );
  }
  if (!snapshot) throw new Error('target environment has no published runtime snapshot');
  const payload = encodeTenantDeploymentJsonValueV1(
    jsonValue({
      snapshotId: snapshot.snapshotId,
      version: snapshot.version,
      effectiveAt: snapshot.effectiveAt,
      checksum: snapshot.checksum,
      payload: snapshot.payload,
    }),
  );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function identityFromBinding(binding: TenantDeploymentBindingV1): TenantRootIdentityV1 {
  const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: binding.tenant.organizationId,
    projectId: binding.tenant.projectId,
    envId: binding.tenant.environmentId,
    signingRootId: binding.tenantRoot.signingRootId,
    signingRootVersion: binding.tenantRoot.signingRootVersion,
  });
  if (!identity.ok) throw new Error('candidate binding has an invalid tenant-root identity');
  return identity.value;
}

function jsonValue(value: unknown): TenantDeploymentJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (!value || typeof value !== 'object') throw new Error('credential policy is not JSON');
  const result: Record<string, TenantDeploymentJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = jsonValue(entry);
  return result;
}

function jsonObject(
  value: Record<string, unknown> | undefined,
): Readonly<Record<string, TenantDeploymentJsonValue>> {
  const result: Record<string, TenantDeploymentJsonValue> = {};
  for (const [key, entry] of Object.entries(value ?? {})) result[key] = jsonValue(entry);
  return result;
}

function runtimeScope(binding: TenantDeploymentBindingV1): TenantDeploymentRuntimeScopeV1 {
  return {
    namespace: binding.tenant.namespace,
    organizationId: binding.tenant.organizationId,
    projectId: binding.tenant.projectId,
    environmentId: binding.tenant.environmentId,
  };
}

function sameEnvironment(
  left: TenantDeploymentBindingV1,
  right: TenantDeploymentBindingV1,
): boolean {
  return (
    left.tenant.namespace === right.tenant.namespace &&
    left.tenant.organizationId === right.tenant.organizationId &&
    left.tenant.projectId === right.tenant.projectId &&
    left.tenant.environmentId === right.tenant.environmentId
  );
}

function expirationMs(credential: ConsoleApiKey): number | null {
  if (credential.expiresAt === null) return null;
  const value = Date.parse(credential.expiresAt);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('publishable credential expiry is invalid');
  }
  return value;
}

function assertRootStatus(
  binding: TenantDeploymentBindingV1,
  root: Awaited<ReturnType<TenantRootSecurityStateReaderV1['readStatus']>>,
): void {
  if (
    root.identityDigestB64u !== binding.tenantRoot.identityDigestB64u ||
    root.custodyLineageB64u !== binding.tenantRoot.custodyLineageId ||
    root.status.identity.signingRootId !== binding.tenantRoot.signingRootId ||
    root.status.identity.signingRootVersion !== binding.tenantRoot.signingRootVersion ||
    root.status.operationalShares.deriverAStatus !== 'healthy' ||
    root.status.operationalShares.deriverBStatus !== 'healthy'
  ) {
    throw new Error('active tenant root is not ready for the candidate binding');
  }
}

class ProductionTenantDeploymentReadinessAdapter implements ProductionTenantDeploymentReadinessAdapterV1 {
  constructor(private readonly options: ProductionTenantDeploymentReadinessOptionsV1) {}

  async buildCandidate(input: {
    readonly identity: TenantRootIdentityV1;
    readonly activeTenantRoot: ActiveTenantRootReferenceV1;
    readonly credentialId: string;
    readonly publishableKey: string;
    readonly surfaces: TenantDeploymentCandidateSurfacesV1;
  }): Promise<TenantDeploymentBindingV1> {
    const environment = await resolveEnvironment(this.options, input.identity);
    const credential = await resolveCredential(this.options, input.identity, input.credentialId);
    const runtimePolicyDigestB64u = await resolveRuntimePolicyDigest(
      this.options,
      input.identity,
      true,
    );
    const decoded = await buildTenantDeploymentBindingV1({
      kind: 'tenant_deployment_binding_v1',
      schemaVersion: 1,
      deploymentLane: this.options.deploymentLane,
      mode: modeForEnvironment(environment),
      tenant: {
        namespace: this.options.namespace,
        organizationId: input.identity.orgId,
        projectId: input.identity.projectId,
        environmentId: input.identity.envId,
      },
      tenantRoot: input.activeTenantRoot,
      browserCredential: {
        credentialId: input.credentialId,
        publishableKey: input.publishableKey,
        expiresAtMs: expirationMs(credential),
        allowedOrigins: canonicalOrigins(credential.allowedOrigins),
        quotaPolicy: {
          rateLimitBucket: requiredText(credential.rateLimitBucket, 'rate limit bucket'),
          quotaBucket: requiredText(credential.quotaBucket, 'quota bucket'),
          riskPolicy: credential.riskPolicy ?? {},
          paymentPolicy: credential.paymentPolicy ?? {},
        },
      },
      surfaces: input.surfaces,
      runtimePolicyDigestB64u,
      createdAtMs: this.options.now?.() ?? Date.now(),
    });
    if (!decoded.ok) throw new Error(decoded.message);
    return decoded.value;
  }

  async inspect(binding: TenantDeploymentBindingV1): Promise<TenantDeploymentReadinessEvidenceV1> {
    const identity = identityFromBinding(binding);
    const environment = await resolveEnvironment(this.options, identity);
    const mode = modeForEnvironment(environment);
    const [root, storedCredential, runtimePolicyDigestB64u, active] = await Promise.all([
      this.options.tenantRootState.readStatus({ identity }),
      resolveCredential(this.options, identity, binding.browserCredential.credentialId),
      resolveRuntimePolicyDigest(this.options, identity, false),
      this.options.bindings.resolveActiveBinding(binding.deploymentLane),
    ]);
    assertRootStatus(binding, root);
    const authenticatedCredential = await authenticateCredential(this.options, binding);
    if (authenticatedCredential.id !== storedCredential.id) {
      throw new Error('publishable credential lookup and authentication disagree');
    }
    const sourceEnvironmentChanged = active !== null && !sameEnvironment(active, binding);
    const runtime = await this.options.walletRuntime.inspect({
      bindingRevision: binding.revision,
      source: sourceEnvironmentChanged && active ? runtimeScope(active) : null,
      target: runtimeScope(binding),
    });
    return {
      mode,
      environmentId: environment.id,
      tenantRoot: {
        identityDigestB64u: root.identityDigestB64u,
        custodyLineageId: root.custodyLineageB64u,
        signingRootId: root.status.identity.signingRootId,
        signingRootVersion: root.status.identity.signingRootVersion,
      },
      credential: {
        credentialId: storedCredential.id,
        publishableKey: binding.browserCredential.publishableKey,
        environmentId: storedCredential.environmentId,
        allowedOrigins: canonicalOrigins(storedCredential.allowedOrigins),
        quotaPolicy: {
          rateLimitBucket: requiredText(storedCredential.rateLimitBucket, 'rate limit bucket'),
          quotaBucket: requiredText(storedCredential.quotaBucket, 'quota bucket'),
          riskPolicy: jsonObject(storedCredential.riskPolicy),
          paymentPolicy: jsonObject(storedCredential.paymentPolicy),
        },
        status: 'active',
        expiresAtMs: expirationMs(storedCredential),
      },
      runtimePolicyDigestB64u,
      applicationOrigin: binding.surfaces.applicationOrigin,
      hostedWalletOrigin: binding.surfaces.hostedWalletOrigin,
      gatewayOrigin: binding.surfaces.gatewayOrigin,
      relyingPartyId: binding.surfaces.relyingPartyId,
      acknowledgedBindingRevision: runtime.acknowledgedBindingRevision,
      sourceEnvironmentChanged,
      sourceDurableWalletCount: runtime.sourceDurableWalletCount,
      targetDurableWalletCount: runtime.targetDurableWalletCount,
      inFlightCeremonyCount: runtime.inFlightCeremonyCount,
      migrationAuthorized: false,
    };
  }
}

export function createProductionTenantDeploymentReadinessAdapterV1(
  options: ProductionTenantDeploymentReadinessOptionsV1,
): ProductionTenantDeploymentReadinessAdapterV1 {
  return new ProductionTenantDeploymentReadinessAdapter(options);
}
