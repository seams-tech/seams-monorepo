import type { ConsoleApiKeyService } from '@seams-internal/console-server/apiKeys/service';
import type { ConsoleAuditService } from '@seams-internal/console-server/audit/service';
import type { ConsoleOrgProjectEnvService } from '@seams-internal/console-server/orgProjectEnv/service';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '@seams-internal/wallet-console-shared/tenant-root';
import type { TenantDeploymentCutoverId } from '@seams-internal/wallet-console-shared/tenant-deployment';
import {
  ensureTenantRootActiveV1,
  type TenantRootCreationConsoleRouteDependenciesV1,
} from '../tenantRootCreation/consoleRoute';
import type { TenantRootIdentityV1 } from '../tenantRootCreation/types';
import type { TenantRootSecurityStateReaderV1 } from '../tenantRootSecurity/consoleRoute';
import { TenantRootSecurityStateUnavailableError } from '../tenantRootSecurity/stateReader';
import type {
  TenantDeploymentCandidateResolverV1,
  TenantDeploymentCandidateSurfacesV1,
} from './productionReadiness';
import type { TenantDeploymentReadinessServiceV1 } from './readiness';
import type { TenantDeploymentServiceV1 } from './service';

const SYSTEM_ACTOR_USER_ID = 'system:tenant-deployment-provisioner';

export type TenantDeploymentProvisioningRequestV1 = {
  readonly deploymentLane: string;
  readonly environmentId: string;
};

export type TenantDeploymentCanaryReceiptV1 = {
  readonly kind: 'tenant_deployment_registration_canary_receipt_v1';
  readonly bindingRevision: `tdb_${string}`;
  readonly checkedAtMs: number;
  readonly expiresAtMs: number;
  readonly responseDigestB64u: string;
};

export interface TenantDeploymentRegistrationCanaryV1 {
  run(input: {
    readonly bindingRevision: `tdb_${string}`;
    readonly environmentId: string;
    readonly publishableKey: `pk_${string}`;
    readonly surfaces: TenantDeploymentCandidateSurfacesV1;
  }): Promise<TenantDeploymentCanaryReceiptV1>;
}

export type TenantDeploymentProvisioningResultV1 =
  | {
      readonly disposition: 'activated';
      readonly operationId: TenantDeploymentCutoverId;
      readonly bindingRevision: `tdb_${string}`;
      readonly credentialId: `ak_${string}`;
      readonly activationSequence: number;
      readonly canaryReceipt: TenantDeploymentCanaryReceiptV1;
    }
  | {
      readonly disposition: 'reused';
      readonly operationId: null;
      readonly bindingRevision: `tdb_${string}`;
      readonly credentialId: `ak_${string}`;
      readonly activationSequence: number;
      readonly canaryReceipt: null;
    };

export interface TenantDeploymentProvisionerV1 {
  provision(
    request: TenantDeploymentProvisioningRequestV1,
  ): Promise<TenantDeploymentProvisioningResultV1>;
}

export type TenantDeploymentProvisionerOptionsV1 = {
  readonly deploymentLane: string;
  readonly surfaces: TenantDeploymentCandidateSurfacesV1;
  readonly orgProjectEnv: ConsoleOrgProjectEnvService;
  readonly apiKeys: ConsoleApiKeyService;
  readonly audit: ConsoleAuditService;
  readonly tenantRootCreation: TenantRootCreationConsoleRouteDependenciesV1;
  readonly tenantRootState: TenantRootSecurityStateReaderV1;
  readonly candidates: TenantDeploymentCandidateResolverV1;
  readonly readiness: TenantDeploymentReadinessServiceV1;
  readonly store: TenantDeploymentServiceV1;
  readonly canary: TenantDeploymentRegistrationCanaryV1;
  readonly newOperationId?: () => TenantDeploymentCutoverId;
};

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function defaultOperationId(): TenantDeploymentCutoverId {
  return `tco_${crypto.randomUUID().replace(/-/gu, '')}`;
}

function parseCredentialId(value: string): `ak_${string}` {
  if (!value.startsWith('ak_') || value.length <= 3) {
    throw new Error('publishable credential ID is invalid');
  }
  return `ak_${value.slice(3)}`;
}

function parsePublishableKey(value: string): `pk_${string}` {
  if (!value.startsWith('pk_') || value.length <= 3) {
    throw new Error('publishable credential value is invalid');
  }
  return `pk_${value.slice(3)}`;
}

function bindingMatchesRequest(input: {
  readonly binding: Awaited<ReturnType<TenantDeploymentServiceV1['resolveActiveBinding']>>;
  readonly identity: TenantRootIdentityV1;
  readonly surfaces: TenantDeploymentCandidateSurfacesV1;
}): input is {
  readonly binding: NonNullable<
    Awaited<ReturnType<TenantDeploymentServiceV1['resolveActiveBinding']>>
  >;
  readonly identity: TenantRootIdentityV1;
  readonly surfaces: TenantDeploymentCandidateSurfacesV1;
} {
  const binding = input.binding;
  if (!binding) return false;
  return (
    binding.tenant.organizationId === input.identity.orgId &&
    binding.tenant.projectId === input.identity.projectId &&
    binding.tenant.environmentId === input.identity.envId &&
    binding.tenantRoot.signingRootId === input.identity.signingRootId &&
    binding.tenantRoot.signingRootVersion === input.identity.signingRootVersion &&
    binding.surfaces.applicationOrigin === input.surfaces.applicationOrigin &&
    binding.surfaces.hostedWalletOrigin === input.surfaces.hostedWalletOrigin &&
    binding.surfaces.gatewayOrigin === input.surfaces.gatewayOrigin &&
    binding.surfaces.relyingPartyId === input.surfaces.relyingPartyId
  );
}

function reuseActiveBinding(input: {
  readonly active: NonNullable<Awaited<ReturnType<TenantDeploymentServiceV1['findActiveBinding']>>>;
  readonly binding: NonNullable<
    Awaited<ReturnType<TenantDeploymentServiceV1['resolveActiveBinding']>>
  >;
}): TenantDeploymentProvisioningResultV1 {
  return {
    disposition: 'reused',
    operationId: null,
    bindingRevision: input.binding.revision,
    credentialId: input.binding.browserCredential.credentialId,
    activationSequence: input.active.activationSequence,
    canaryReceipt: null,
  };
}

async function ensureActiveTenantRoot(input: {
  readonly options: TenantDeploymentProvisionerOptionsV1;
  readonly operationId: TenantDeploymentCutoverId;
  readonly identity: TenantRootIdentityV1;
}): Promise<Awaited<ReturnType<TenantRootSecurityStateReaderV1['readStatus']>>> {
  try {
    return await input.options.tenantRootState.readStatus({ identity: input.identity });
  } catch (error) {
    if (!(error instanceof TenantRootSecurityStateUnavailableError)) throw error;
  }
  await ensureTenantRootActiveV1({
    dependencies: input.options.tenantRootCreation,
    operationId: `tenant-deployment:${input.operationId}`,
    identity: input.identity,
  });
  return await input.options.tenantRootState.readStatus({ identity: input.identity });
}

async function resolveIdentity(
  options: TenantDeploymentProvisionerOptionsV1,
  environmentId: string,
): Promise<TenantRootIdentityV1> {
  const organization = await options.orgProjectEnv.findOrganizationForScope({ environmentId });
  if (!organization) throw new Error('tenant deployment environment was not found');
  const context = { orgId: organization.id, actorUserId: SYSTEM_ACTOR_USER_ID };
  const environments = await options.orgProjectEnv.listEnvironments(context, { status: 'ACTIVE' });
  const environment = environments.find((candidate) => candidate.id === environmentId);
  if (!environment) throw new Error('tenant deployment environment is not active');
  const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: organization.id,
    projectId: environment.projectId,
    envId: environment.id,
    signingRootId: `${environment.projectId}:${environment.key}`,
    signingRootVersion: environment.runtimeVersion,
  });
  if (!identity.ok) throw new Error('tenant deployment environment identity is invalid');
  return identity.value;
}

async function appendProvisioningAudit(input: {
  readonly options: TenantDeploymentProvisionerOptionsV1;
  readonly identity: TenantRootIdentityV1;
  readonly operationId: TenantDeploymentCutoverId;
  readonly bindingRevision: `tdb_${string}`;
  readonly credentialId: `ak_${string}`;
  readonly activationSequence: number;
  readonly canaryReceipt: TenantDeploymentCanaryReceiptV1;
}): Promise<void> {
  await input.options.audit.appendEvent(
    {
      orgId: input.identity.orgId,
      actorUserId: SYSTEM_ACTOR_USER_ID,
      projectId: input.identity.projectId,
      environmentId: input.identity.envId,
    },
    {
      projectId: input.identity.projectId,
      environmentId: input.identity.envId,
      actorUserId: SYSTEM_ACTOR_USER_ID,
      actorType: 'SYSTEM',
      category: 'SYSTEM',
      action: 'tenant_deployment.activate',
      outcome: 'SUCCESS',
      summary: 'Activated an automated tenant deployment binding',
      metadata: {
        operationId: input.operationId,
        deploymentLane: input.options.deploymentLane,
        bindingRevision: input.bindingRevision,
        credentialId: input.credentialId,
        activationSequence: input.activationSequence,
        canaryResponseDigestB64u: input.canaryReceipt.responseDigestB64u,
        canaryExpiresAtMs: input.canaryReceipt.expiresAtMs,
      },
    },
  );
}

export function createTenantDeploymentProvisionerV1(
  options: TenantDeploymentProvisionerOptionsV1,
): TenantDeploymentProvisionerV1 {
  const newOperationId = options.newOperationId ?? defaultOperationId;
  return {
    async provision(request) {
      const deploymentLane = requiredText(request.deploymentLane, 'deploymentLane');
      const environmentId = requiredText(request.environmentId, 'environmentId');
      if (deploymentLane !== options.deploymentLane) {
        throw new Error('tenant deployment lane does not match this runtime');
      }
      const identity = await resolveIdentity(options, environmentId);
      const active = await options.store.findActiveBinding(deploymentLane);
      const activeBinding = await options.store.resolveActiveBinding(deploymentLane);
      if (
        active &&
        active.revision === activeBinding?.revision &&
        bindingMatchesRequest({ binding: activeBinding, identity, surfaces: options.surfaces })
      ) {
        return reuseActiveBinding({ active, binding: activeBinding });
      }
      const operationId = newOperationId();
      const planning = await options.store.createCutover({
        kind: 'planning',
        operationId,
        deploymentLane,
        targetIdentity: {
          organizationId: identity.orgId,
          projectId: identity.projectId,
          environmentId: identity.envId,
          signingRootId: identity.signingRootId,
          signingRootVersion: identity.signingRootVersion,
        },
        expectedActiveRevision: active?.revision ?? null,
      });
      if (planning.state.kind !== 'planning') {
        throw new Error('tenant deployment cutover did not enter planning');
      }
      const awaitingRoot = await options.store.transitionCutover(planning, {
        kind: 'awaiting_tenant_root',
        operationId,
        deploymentLane,
        targetIdentity: planning.state.targetIdentity,
        expectedActiveRevision: active?.revision ?? null,
      });
      if (awaitingRoot.state.kind !== 'awaiting_tenant_root') {
        throw new Error('tenant deployment cutover did not await its tenant root');
      }
      const root = await ensureActiveTenantRoot({ options, operationId, identity });
      const awaitingCredential = await options.store.transitionCutover(awaitingRoot, {
        kind: 'awaiting_browser_credential',
        operationId,
        deploymentLane,
        targetIdentity: awaitingRoot.state.targetIdentity,
        activeTenantRoot: {
          identityDigestB64u: root.identityDigestB64u,
          custodyLineageId: root.custodyLineageB64u,
          signingRootId: identity.signingRootId,
          signingRootVersion: identity.signingRootVersion,
        },
        expectedActiveRevision: active?.revision ?? null,
      });
      if (awaitingCredential.state.kind !== 'awaiting_browser_credential') {
        throw new Error('tenant deployment cutover did not await its browser credential');
      }
      const credential = await options.apiKeys.createApiKey(
        { orgId: identity.orgId, actorUserId: SYSTEM_ACTOR_USER_ID },
        {
          kind: 'publishable_key',
          name: `Managed deployment ${deploymentLane}`,
          environmentId,
          allowedOrigins: [options.surfaces.applicationOrigin, options.surfaces.hostedWalletOrigin],
          rateLimitBucket: 'managed-registration',
          quotaBucket: 'included-registration',
        },
      );
      const credentialId = parseCredentialId(credential.apiKey.id);
      const publishableKey = parsePublishableKey(credential.secret);
      let activated = false;
      try {
        const binding = await options.candidates.buildCandidate({
          identity,
          activeTenantRoot: awaitingCredential.state.activeTenantRoot,
          credentialId,
          publishableKey,
          surfaces: options.surfaces,
        });
        await options.store.putBinding(binding);
        const readinessReceipt = await options.readiness.issue({
          binding,
          expectedActiveRevision: active?.revision ?? null,
        });
        const ready = await options.store.transitionCutover(awaitingCredential, {
          kind: 'ready',
          operationId,
          deploymentLane,
          binding,
          readinessReceipt,
          expectedActiveRevision: active?.revision ?? null,
        });
        const activation = await options.store.activateBinding({
          operationId,
          expectedCutoverRecordRevision: ready.recordRevision,
          deploymentLane,
          bindingRevision: binding.revision,
          expectedActive: active
            ? { revision: active.revision, activationSequence: active.activationSequence }
            : null,
          readinessReceipt,
        });
        activated = true;
        const canaryReceipt = await options.canary.run({
          bindingRevision: binding.revision,
          environmentId,
          publishableKey: binding.browserCredential.publishableKey,
          surfaces: options.surfaces,
        });
        await appendProvisioningAudit({
          options,
          identity,
          operationId,
          bindingRevision: binding.revision,
          credentialId,
          activationSequence: activation.receipt.activationSequence,
          canaryReceipt,
        });
        return {
          disposition: 'activated',
          operationId,
          bindingRevision: binding.revision,
          credentialId,
          activationSequence: activation.receipt.activationSequence,
          canaryReceipt,
        };
      } catch (error) {
        if (!activated) {
          const current = await options.store.findCutover(operationId);
          if (current && current.state.kind !== 'active' && current.state.kind !== 'failed') {
            await options.store.transitionCutover(current, {
              kind: 'failed',
              operationId,
              deploymentLane,
              failedPhase: 'readiness',
              failure: {
                code: 'automated_provisioning_failed',
                message: error instanceof Error ? error.message : 'automated provisioning failed',
              },
            });
          }
          await options.apiKeys.revokeApiKey(
            { orgId: identity.orgId, actorUserId: SYSTEM_ACTOR_USER_ID },
            credentialId,
            { reason: 'tenant deployment provisioning failed' },
          );
        }
        throw error;
      }
    },
  };
}

export function createGatewayTenantDeploymentRegistrationCanaryV1(options?: {
  readonly now?: () => number;
}): TenantDeploymentRegistrationCanaryV1 {
  const now = options?.now ?? Date.now;
  return {
    async run(input) {
      const checkedAtMs = now();
      const response = await fetch(`${input.surfaces.gatewayOrigin}/wallets/register/setup`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.publishableKey}`,
          'content-type': 'application/json',
          origin: input.surfaces.hostedWalletOrigin,
          'x-seams-environment-id': input.environmentId,
        },
        body: JSON.stringify({
          wallet: { kind: 'provided', walletId: `canary-${crypto.randomUUID()}` },
          signerSelection: {
            kind: 'signer_set',
            signers: [
              {
                kind: 'near_ed25519',
                accountProvisioning: {
                  kind: 'implicit_account',
                  accountIdSource: 'ed25519_public_key',
                },
                signerSlot: 1,
                participantIds: [1, 2],
                derivationVersion: 1,
              },
            ],
          },
          authMethod: { kind: 'passkey', rpId: input.surfaces.relyingPartyId },
        }),
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`registration canary failed with HTTP ${response.status}: ${body}`);
      }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
      const responseDigestB64u = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/gu, '-')
        .replace(/\//gu, '_')
        .replace(/=+$/u, '');
      return {
        kind: 'tenant_deployment_registration_canary_receipt_v1',
        bindingRevision: input.bindingRevision,
        checkedAtMs,
        expiresAtMs: checkedAtMs + 300_000,
        responseDigestB64u,
      };
    },
  };
}
