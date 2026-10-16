import {
  contractResult,
  digestValue,
  exactKeys,
  invalidContract,
  object,
  textValue,
  utcTimestamp,
  versionOne,
  type PlatformContractError,
  type PlatformResult,
} from './boundary';

/** Authenticates account setup before a native tenant or service instance exists. */
export class ServiceOnboardingAssertionV1 {
  readonly version = 1;
  readonly purpose = 'satyr_onboarding';

  private constructor(
    readonly issuer: string,
    readonly audience: string,
    readonly nativePrincipalId: string,
    readonly nativeSessionId: string,
    readonly subject: string,
    readonly requestDigest: string,
    readonly expiresAt: string,
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(
    input: unknown,
  ): PlatformResult<ServiceOnboardingAssertionV1, PlatformContractError> {
    return contractResult(ServiceOnboardingAssertionV1.read, input);
  }

  private static read(input: unknown): ServiceOnboardingAssertionV1 {
    const record = object(input, 'onboarding assertion');
    exactKeys(record, [
      'version',
      'purpose',
      'issuer',
      'audience',
      'nativePrincipalId',
      'nativeSessionId',
      'subject',
      'requestDigest',
      'expiresAt',
    ]);
    versionOne(record.version);
    if (record.purpose !== 'satyr_onboarding') return invalidContract('purpose');
    return new ServiceOnboardingAssertionV1(
      textValue(record.issuer, 'issuer'),
      textValue(record.audience, 'audience'),
      textValue(record.nativePrincipalId, 'nativePrincipalId'),
      textValue(record.nativeSessionId, 'nativeSessionId'),
      textValue(record.subject, 'subject'),
      digestValue(record.requestDigest, 'requestDigest'),
      utcTimestamp(record.expiresAt, 'expiresAt'),
    );
  }
}

export type AccountOnboardingSelection =
  | Readonly<{
      kind: 'existing_project';
      organizationId: string;
      projectId: string;
      organizationName?: never;
      projectName?: never;
    }>
  | Readonly<{
      kind: 'new_project';
      organizationId: string;
      projectName: string;
      projectId?: never;
      organizationName?: never;
    }>
  | Readonly<{
      kind: 'new_organization';
      organizationName: string;
      projectName: string;
      organizationId?: never;
      projectId?: never;
    }>;

export type AccountOnboardingRequest = Readonly<{
  version: 1;
  operationId: string;
  selection: AccountOnboardingSelection;
}>;

export type AccountOnboardingOrganization = Readonly<{
  id: string;
  name: string;
  projects: readonly Readonly<{ id: string; name: string }>[];
}>;

export type AccountOnboardingOptions = Readonly<{
  organizations: readonly AccountOnboardingOrganization[];
}>;

export type AccountOnboardingResult =
  | Readonly<{
      kind: 'pending';
      operationId: string;
      instanceId: string;
      nativeOrganizationId?: never;
    }>
  | Readonly<{
      kind: 'ready';
      nativeOrganizationId: string;
      operationId?: never;
      instanceId?: never;
    }>;

function onboardingText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200)
    return invalidContract('onboarding text');
  return value.trim();
}
export function readAccountOnboardingRequest(value: unknown): AccountOnboardingRequest {
  const record = object(value, 'onboarding request');
  exactKeys(record, ['version', 'operationId', 'selection']);
  versionOne(record.version);
  const operationId = onboardingText(record.operationId);
  const selection = object(record.selection, 'selection');
  switch (selection.kind) {
    case 'existing_project':
      exactKeys(selection, ['kind', 'organizationId', 'projectId']);
      return {
        version: 1,
        operationId,
        selection: {
          kind: selection.kind,
          organizationId: onboardingText(selection.organizationId),
          projectId: onboardingText(selection.projectId),
        },
      };
    case 'new_project':
      exactKeys(selection, ['kind', 'organizationId', 'projectName']);
      return {
        version: 1,
        operationId,
        selection: {
          kind: selection.kind,
          organizationId: onboardingText(selection.organizationId),
          projectName: onboardingText(selection.projectName),
        },
      };
    case 'new_organization':
      exactKeys(selection, ['kind', 'organizationName', 'projectName']);
      return {
        version: 1,
        operationId,
        selection: {
          kind: selection.kind,
          organizationName: onboardingText(selection.organizationName),
          projectName: onboardingText(selection.projectName),
        },
      };
    default:
      return invalidContract('selection.kind');
  }
}
function readOnboardingProject(value: unknown): Readonly<{ id: string; name: string }> {
  const record = object(value, 'onboarding project');
  return { id: onboardingText(record.id), name: onboardingText(record.name) };
}
function readOnboardingOrganization(value: unknown): AccountOnboardingOrganization {
  const record = object(value, 'onboarding organization');
  if (!Array.isArray(record.projects)) return invalidContract('projects');
  return {
    id: onboardingText(record.id),
    name: onboardingText(record.name),
    projects: record.projects.map(readOnboardingProject),
  };
}
export function readAccountOnboardingOptions(value: unknown): AccountOnboardingOptions {
  const record = object(value, 'onboarding options');
  if (!Array.isArray(record.organizations)) return invalidContract('organizations');
  return { organizations: record.organizations.map(readOnboardingOrganization) };
}
export function readAccountOnboardingResult(value: unknown): AccountOnboardingResult {
  const record = object(value, 'onboarding result');
  switch (record.kind) {
    case 'ready':
      exactKeys(record, ['kind', 'nativeOrganizationId']);
      return {
        kind: record.kind,
        nativeOrganizationId: onboardingText(record.nativeOrganizationId),
      };
    case 'pending':
      exactKeys(record, ['kind', 'operationId', 'instanceId']);
      return {
        kind: record.kind,
        operationId: onboardingText(record.operationId),
        instanceId: onboardingText(record.instanceId),
      };
    default:
      return invalidContract('onboarding result kind');
  }
}
