import {
  ServiceTenantBindingV1,
  type AcceptedServiceReceiptV1,
  type DurableSourceEvidenceV1,
  type PlatformResult,
  type PlatformScopeV1,
  type ServiceBindingRequestV1,
  type WalletTenantScopeV1,
} from '@seams-internal/console-shared/accountPlatform';
import type { AccountServiceProvisioningAdapterV1 } from '@seams-internal/console-server/accountPlatform/provisioning';
import type {
  ServiceProducerAuthorityV1,
  ServiceProvisionDeliveryV1,
} from '@seams-internal/console-server/accountPlatform/types';
import { getBillingLiveEnvironmentReadiness } from '@seams-internal/wallet-console-server/environments/readiness';
import type { ConsoleBillingService } from '@seams-internal/console-server/billing/service';
import type { ConsoleOrgProjectService } from '@seams-internal/console-server/orgProjectEnv/service';
import type { ConsoleProject } from '@seams-internal/console-server/orgProjectEnv/types';
import type { ConsoleWalletEnvironmentService } from '../environments/service';
import { DEFAULT_WALLET_SIGNING_ROOT_VERSION } from '../environments/types';

export interface WalletServiceProvisioningOptions {
  readonly deploymentId: string;
  readonly namespace: string;
  readonly environments: ConsoleWalletEnvironmentService;
  readonly orgProjects: ConsoleOrgProjectService;
  readonly billing: ConsoleBillingService;
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Migration evidence covers immutable native project identity. It carries no credentials. */
export async function walletProjectAttachmentEvidence(
  native: WalletTenantScopeV1,
  project: ConsoleProject,
): Promise<DurableSourceEvidenceV1> {
  if (native.nativeProjectId !== project.id || native.nativeOrganizationId !== project.orgId) {
    throw new Error('Wallet attachment project does not match its native scope');
  }
  return {
    sourceRecordId: project.id,
    sourceDigest: await digest(
      JSON.stringify([
        native.deploymentId,
        native.namespace,
        project.orgId,
        project.id,
        project.createdAt,
      ]),
    ),
  };
}

function expectedResult(
  command: ServiceProvisionDeliveryV1['command']['command'],
): AcceptedServiceReceiptV1['result'] {
  switch (command) {
    case 'enable':
      return 'active';
    case 'disable':
      return 'disabled';
    case 'archive':
      return 'archived';
  }
}

function desiredAvailability(
  command: ServiceProvisionDeliveryV1['command']['command'],
): 'enabled' | 'disabled' | 'archived' {
  switch (command) {
    case 'enable':
      return 'enabled';
    case 'disable':
      return 'disabled';
    case 'archive':
      return 'archived';
  }
}

function rejected(
  code: 'unavailable' | 'provisioning_failed',
): PlatformResult<never, { readonly code: 'unavailable' | 'provisioning_failed' }> {
  return { kind: 'rejected', error: { code } };
}

export class WalletServiceProvisioningAdapter implements AccountServiceProvisioningAdapterV1 {
  readonly authority: ServiceProducerAuthorityV1;

  constructor(private readonly options: WalletServiceProvisioningOptions) {
    this.authority = Object.freeze({ serviceId: 'wallet', deploymentId: options.deploymentId });
  }

  createBinding(scope: PlatformScopeV1): ServiceBindingRequestV1 {
    return Object.freeze({
      kind: 'create_native_scope',
      serviceId: 'wallet',
      parent: scope,
      configuration: Object.freeze({
        deploymentId: this.options.deploymentId,
        namespace: this.options.namespace,
        signingRootVersion: DEFAULT_WALLET_SIGNING_ROOT_VERSION,
      }),
    });
  }

  private async nativeScope(
    delivery: ServiceProvisionDeliveryV1,
  ): Promise<WalletTenantScopeV1 | null> {
    const target = delivery.command.binding;
    if (target instanceof ServiceTenantBindingV1) {
      return target.nativeScope.serviceId === 'wallet' ? target.nativeScope : null;
    }
    if (target.kind === 'create_native_scope') {
      if (
        target.serviceId !== 'wallet' ||
        target.configuration.namespace !== this.options.namespace ||
        target.configuration.deploymentId !== this.options.deploymentId ||
        target.configuration.signingRootVersion !== DEFAULT_WALLET_SIGNING_ROOT_VERSION
      )
        return null;
      return {
        serviceId: 'wallet',
        deploymentId: this.options.deploymentId,
        namespace: this.options.namespace,
        nativeOrganizationId: delivery.scope.organizationId,
        nativeProjectId: delivery.scope.projectId,
      };
    }
    if (target.nativeScope.serviceId !== 'wallet') return null;
    const native = target.nativeScope;
    if (
      native.namespace !== this.options.namespace ||
      native.deploymentId !== this.options.deploymentId
    )
      return null;
    const projects = await this.options.orgProjects.listProjects({
      orgId: native.nativeOrganizationId,
      actorUserId: 'wallet-account-migration',
    });
    let project = null;
    for (const candidate of projects)
      if (candidate.id === native.nativeProjectId) project = candidate;
    if (!project) return null;
    const evidence = await walletProjectAttachmentEvidence(native, project);
    if (
      evidence.sourceRecordId !== target.authorityEvidence.sourceRecordId ||
      evidence.sourceDigest !== target.authorityEvidence.sourceDigest
    )
      return null;
    return native;
  }

  async provision(
    delivery: ServiceProvisionDeliveryV1,
  ): Promise<
    PlatformResult<
      AcceptedServiceReceiptV1,
      { readonly code: 'unavailable' | 'provisioning_failed' }
    >
  > {
    if (
      delivery.authority.serviceId !== 'wallet' ||
      delivery.authority.deploymentId !== this.options.deploymentId
    )
      return rejected('provisioning_failed');
    const native = await this.nativeScope(delivery);
    if (
      !native ||
      native.namespace !== this.options.namespace ||
      native.deploymentId !== this.options.deploymentId
    ) {
      return rejected('provisioning_failed');
    }
    const context = {
      orgId: native.nativeOrganizationId,
      actorUserId: 'wallet-service-provisioner',
    };
    let liveAccess: 'enabled' | 'disabled' = 'disabled';
    if (delivery.command.command === 'enable') {
      const readiness = await getBillingLiveEnvironmentReadiness(this.options.billing, {
        orgId: delivery.scope.organizationId,
        actorUserId: context.actorUserId,
      });
      liveAccess = readiness.canUseLiveEnvironments ? 'enabled' : 'disabled';
    }
    const applied = await this.options.environments.setProjectAvailability(context, {
      projectId: native.nativeProjectId,
      availability: desiredAvailability(delivery.command.command),
      liveAccess,
      authority: {
        scope: delivery.scope,
        instanceId: delivery.command.instanceId,
        desiredRevision: delivery.command.desiredRevision,
      },
    });
    if (applied.kind === 'stale') return rejected('unavailable');
    const binding = ServiceTenantBindingV1.parse({
      instanceId: delivery.command.instanceId,
      scope: delivery.scope,
      nativeScope: native,
    });
    if (binding.kind === 'rejected') return rejected('provisioning_failed');
    return {
      kind: 'accepted',
      value: {
        version: 1,
        operationId: delivery.command.operationId,
        instanceId: delivery.command.instanceId,
        desiredRevision: delivery.command.desiredRevision,
        result: expectedResult(delivery.command.command),
        binding: binding.value,
      },
    };
  }
}
