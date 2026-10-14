import { ServiceProvisionCommandV1 } from '@seams-internal/console-shared/accountPlatform';
import {
  exactKeys,
  object,
  textValue,
  versionOne,
} from '@seams-internal/console-shared/accountPlatform/boundary';
import type { ConsoleAccountIdentityContext } from '../account/service';
import type { ConsoleAccountOrganization } from '../account/types';
import { createConsoleProviderIdentity } from '../boundary/providerIdentity';
import { billingCanonicalDigest } from '../billing/pricing';
import type { CloudflareD1AccountServiceBundle } from '../router/cloudflare/d1AccountServices';
import type { AuthenticatedAccountServiceProducerV1 } from './serviceIngressAuth';
import type { VerifiedAccountProvisionOwner } from './serviceAccess';
import {
  dispatchAccountServiceProvision,
  type AccountServiceProvisioningAdapterV1,
} from './provisioning';

type ProjectSelection =
  | {
      readonly kind: 'existing_project';
      readonly organizationId: string;
      readonly projectId: string;
    }
  | { readonly kind: 'new_project'; readonly organizationId: string; readonly projectName: string }
  | {
      readonly kind: 'new_organization';
      readonly organizationName: string;
      readonly projectName: string;
    };

interface OnboardingStart {
  readonly operationId: string;
  readonly selection: ProjectSelection;
}

function readStart(input: unknown): OnboardingStart {
  const record = object(input, 'onboarding');
  exactKeys(record, ['version', 'operationId', 'selection']);
  versionOne(record.version);
  const selection = object(record.selection, 'selection');
  const operationId = textValue(record.operationId, 'operationId');
  switch (selection.kind) {
    case 'existing_project':
      exactKeys(selection, ['kind', 'organizationId', 'projectId']);
      return {
        operationId,
        selection: {
          kind: selection.kind,
          organizationId: textValue(selection.organizationId, 'organizationId'),
          projectId: textValue(selection.projectId, 'projectId'),
        },
      };
    case 'new_project':
      exactKeys(selection, ['kind', 'organizationId', 'projectName']);
      return {
        operationId,
        selection: {
          kind: selection.kind,
          organizationId: textValue(selection.organizationId, 'organizationId'),
          projectName: textValue(selection.projectName, 'projectName'),
        },
      };
    case 'new_organization':
      exactKeys(selection, ['kind', 'organizationName', 'projectName']);
      return {
        operationId,
        selection: {
          kind: selection.kind,
          organizationName: textValue(selection.organizationName, 'organizationName'),
          projectName: textValue(selection.projectName, 'projectName'),
        },
      };
    default:
      throw new Error('Invalid onboarding selection');
  }
}

function canManageProjects(organization: ConsoleAccountOrganization): boolean {
  return (
    organization.role === 'OWNER' ||
    (organization.role === 'ADMIN' && organization.adminPermissions.includes('projects.manage'))
  );
}

function onboardingAccountIdentity(
  owner: VerifiedAccountProvisionOwner,
): Extract<ConsoleAccountIdentityContext, { readonly orgId: null }> {
  return {
    userId: owner.userId,
    email: owner.email,
    name: owner.displayName,
    provider: 'google',
    platformSupport: false,
    orgId: null,
    projectId: null,
  };
}

function accepted(value: unknown): Response {
  return Response.json({ kind: 'accepted', value }, { headers: { 'Cache-Control': 'no-store' } });
}

function rejected(code: string, status = 403): Response {
  return Response.json(
    { kind: 'rejected', error: { code } },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

/** Called only by the private Satyr binding; ordinary account routes stay unchanged. */
export class SatyrAccountOnboarding {
  constructor(
    private readonly services: CloudflareD1AccountServiceBundle,
    private readonly producer: AuthenticatedAccountServiceProducerV1,
    private readonly provisioning: AccountServiceProvisioningAdapterV1,
    private readonly waitUntil: (work: Promise<unknown>) => void,
    private readonly googleFetch: typeof fetch = fetch,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return rejected('method_not_allowed', 405);
    const path = new URL(request.url).pathname;
    const verified = await this.producer.verifyOnboardingAssertion(request, new Date());
    if (verified.kind === 'rejected') return rejected('scope_forbidden');
    const assertion = verified.value;
    let body: unknown;
    try {
      const text = await request.text();
      if (text.length > 32_000) return rejected('invalid_body', 400);
      body = JSON.parse(text);
      if ((await billingCanonicalDigest({ path, body })) !== assertion.requestDigest)
        return rejected('scope_forbidden');
    } catch {
      return rejected('invalid_body', 400);
    }
    try {
      if (path === '/account-platform/v1/onboarding/identity') {
        const record = object(body, 'onboarding identity');
        exactKeys(record, ['version', 'googleIdToken']);
        versionOne(record.version);
        const googleIdToken = textValue(record.googleIdToken, 'googleIdToken');
        const provider = createConsoleProviderIdentity({
          googleOidcClientId: this.producer.googleClientId,
          fetchImpl: this.googleFetch,
        });
        const identity = await provider.verifyGoogleLogin({ idToken: googleIdToken });
        if (!identity.ok || identity.sub !== assertion.subject || identity.emailVerified !== true)
          return rejected('scope_forbidden');
        await this.services.serviceAccess.recordVerifiedGoogleIdentity(
          identity,
          `google:${await billingCanonicalDigest(googleIdToken)}`,
        );
        const owner = await this.services.serviceAccess.getVerifiedProvisionOwner(identity.userId);
        if (!owner) return rejected('scope_forbidden');
        return accepted({
          nativeUserId: assertion.nativePrincipalId,
          platformUserId: owner.userId,
          issuer: owner.issuer,
          subject: owner.subject,
          verificationReceiptId: owner.verificationReceiptId,
        });
      }
      const owner = await this.services.serviceAccess.getVerifiedProvisionOwner(
        `google:${assertion.subject}`,
      );
      if (!owner) return rejected('membership_ineligible');
      const identity = onboardingAccountIdentity(owner);
      if (path === '/account-platform/v1/onboarding/options') {
        const record = object(body, 'onboarding options');
        exactKeys(record, ['version']);
        versionOne(record.version);
        return await this.options(identity);
      }
      if (path === '/account-platform/v1/onboarding/start')
        return await this.start(identity, readStart(body));
      return rejected('operation_unsupported', 404);
    } catch {
      return rejected('authority_unavailable', 503);
    }
  }

  private async options(identity: ConsoleAccountIdentityContext): Promise<Response> {
    const organizations = [];
    for (const organization of await this.services.account.listOrganizations(identity)) {
      if (!canManageProjects(organization)) continue;
      const projects = await this.services.orgProjects.listProjects(
        { orgId: organization.id, actorUserId: identity.userId },
        { status: 'ACTIVE' },
      );
      organizations.push({ id: organization.id, name: organization.name, projects });
    }
    return accepted({ organizations });
  }

  private async start(
    identity: ConsoleAccountIdentityContext,
    input: OnboardingStart,
  ): Promise<Response> {
    if (
      this.provisioning.authority.serviceId !== 'satyr' ||
      this.provisioning.authority.deploymentId !== this.producer.authority.deploymentId
    )
      return rejected('scope_forbidden');
    const digest = await billingCanonicalDigest({
      userId: identity.userId,
      deploymentId: this.producer.authority.deploymentId,
      operationId: input.operationId,
    });
    const selection = input.selection;
    const organizationId =
      selection.kind === 'new_organization'
        ? `org_${digest.slice(0, 12)}`
        : selection.organizationId;
    let organization = (await this.services.account.listOrganizations(identity)).find(
      matchesOrganization.bind(null, organizationId),
    );
    if (selection.kind === 'new_organization') {
      if (!organization) {
        organization = await this.services.account.createOrganization(identity, {
          id: organizationId,
          name: selection.organizationName,
        });
      }
      if (organization.name !== selection.organizationName)
        return rejected('operation_conflict', 409);
    }
    if (!organization || !canManageProjects(organization)) return rejected('scope_forbidden');
    const context = { orgId: organizationId, actorUserId: identity.userId };
    const projectId =
      selection.kind === 'existing_project'
        ? selection.projectId
        : `proj_satyr_${digest.slice(0, 24)}`;
    const projects = await this.services.orgProjects.listProjects(context);
    let project = projects.find(matchesProject.bind(null, projectId));
    if (project?.status === 'ARCHIVED') return rejected('scope_forbidden');
    if (selection.kind !== 'existing_project') {
      if (!project)
        project = await this.services.orgProjects.createProject(context, {
          id: projectId,
          name: selection.projectName,
        });
      if (project.name !== selection.projectName) return rejected('operation_conflict', 409);
    }
    if (!project) return rejected('scope_forbidden');
    const listed = await this.services.accountPlatform.listInstances(context, projectId);
    if (listed.kind === 'rejected') return rejected(listed.error.code);
    let instance = listed.value.find(isSatyrInstance);
    if (instance && instance.deploymentId !== this.producer.authority.deploymentId)
      return rejected('scope_forbidden');
    if (instance && (instance.state.kind === 'disabled' || instance.state.kind === 'archived'))
      return rejected('instance_ineligible');
    if (
      instance?.state.kind === 'failed' &&
      (instance.command.command !== 'enable' ||
        instance.command.operationId ===
          `satyr_onboarding:${digest}:${instance.command.desiredRevision}`)
    )
      return rejected('provisioning_failed', 409);
    if (!instance || instance.state.kind === 'failed') {
      const scope = await this.services.accountPlatform.bindProjectBilling(context, projectId);
      if (scope.kind === 'rejected') return rejected(scope.error.code);
      const command = ServiceProvisionCommandV1.parse({
        version: 1,
        operationId: `satyr_onboarding:${digest}:${instance ? instance.command.desiredRevision + 1 : 1}`,
        instanceId: instance ? instance.instanceId : `instance_satyr_${projectId}`,
        desiredRevision: instance ? instance.command.desiredRevision + 1 : 1,
        command: 'enable',
        binding: instance ? instance.command.binding : this.provisioning.createBinding(scope.value),
      });
      if (command.kind === 'rejected') return rejected('invalid_body', 400);
      const result = await this.services.accountPlatform.requestProvision(context, {
        scope: scope.value,
        command: command.value,
      });
      if (result.kind === 'rejected') return rejected(result.error.code, 409);
      instance = result.value;
    }
    if (instance.state.kind === 'active') {
      const native = instance.state.binding.nativeScope;
      if (native.serviceId !== 'satyr') return rejected('scope_forbidden');
      return accepted({ kind: 'ready', nativeOrganizationId: native.nativeOrganizationId });
    }
    this.waitUntil(
      dispatchAccountServiceProvision({
        platform: this.services.accountPlatform,
        adapter: this.provisioning,
        operationId: instance.command.operationId,
      }),
    );
    return accepted({
      kind: 'pending',
      operationId: instance.command.operationId,
      instanceId: instance.instanceId,
    });
  }
}

function matchesOrganization(id: string, organization: ConsoleAccountOrganization): boolean {
  return organization.id === id;
}
function matchesProject(id: string, project: { readonly id: string }): boolean {
  return project.id === id;
}
function isSatyrInstance(instance: { readonly serviceId: string }): boolean {
  return instance.serviceId === 'satyr';
}
