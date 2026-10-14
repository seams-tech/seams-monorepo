import {
  BoundServiceInstanceV1,
  PlatformScopeV1,
  ServiceProvisionCommandV1,
  ServiceTenantBindingV1,
  parseServiceProvisionReceiptV1,
  type PlatformServiceIdV1,
} from '@seams-internal/console-shared/accountPlatform';
import { object, textValue } from '@seams-internal/console-shared/accountPlatform/boundary';
import {
  buildConsoleAcceptHeaders,
  buildConsoleJsonHeaders,
  consoleErrorMessage,
  parseConsoleJson,
  requireConsoleBaseUrl,
} from '../../consoleHttp';

export type ServiceAction = 'enable' | 'disable' | 'archive';

interface ServiceIdentity {
  readonly instanceId: string;
  readonly operationId: string;
  readonly desiredRevision: number;
}

export type ServiceStatus =
  | {
      readonly kind: 'absent';
      readonly instanceId?: never;
      readonly operationId?: never;
      readonly desiredRevision?: never;
      readonly shutdown?: never;
      readonly command?: never;
      readonly failureCode?: never;
    }
  | (ServiceIdentity & {
      readonly kind: 'active';
      readonly shutdown?: never;
      readonly command?: never;
      readonly failureCode?: never;
    })
  | (ServiceIdentity & {
      readonly kind: 'provisioning';
      readonly shutdown?: never;
      readonly command?: never;
      readonly failureCode?: never;
    })
  | (ServiceIdentity & {
      readonly kind: 'disabled';
      readonly shutdown: 'pending' | 'confirmed';
      readonly command?: never;
      readonly failureCode?: never;
    })
  | (ServiceIdentity & {
      readonly kind: 'archived';
      readonly shutdown?: never;
      readonly command?: never;
      readonly failureCode?: never;
    })
  | (ServiceIdentity & {
      readonly kind: 'failed';
      readonly shutdown?: never;
      readonly command: ServiceAction;
      readonly failureCode: string;
    });

export type EnableableService =
  | Extract<ServiceStatus, { kind: 'absent' | 'disabled' | 'provisioning' }>
  | (Extract<ServiceStatus, { kind: 'failed' }> & { readonly command: 'enable' });

export function isEnableableService(status: ServiceStatus): status is EnableableService {
  return (
    status.kind === 'absent' ||
    status.kind === 'disabled' ||
    status.kind === 'provisioning' ||
    (status.kind === 'failed' && status.command === 'enable')
  );
}

function commandMatchesService(
  command: ServiceProvisionCommandV1,
  scope: PlatformScopeV1,
  serviceId: PlatformServiceIdV1,
): boolean {
  const binding = command.binding;
  if (binding instanceof ServiceTenantBindingV1)
    return binding.nativeScope.serviceId === serviceId && sameScope(binding.scope, scope);
  if (binding.kind === 'attach_existing_scope') return binding.nativeScope.serviceId === serviceId;
  return binding.serviceId === serviceId && sameScope(binding.parent, scope);
}

export interface ServiceOperation {
  readonly operationId: string;
  readonly desiredRevision: number;
}

export interface ProjectService {
  readonly serviceId: PlatformServiceIdV1;
  readonly availability:
    | { readonly kind: 'available'; readonly consoleHref: string }
    | { readonly kind: 'unavailable'; readonly consoleHref?: never };
  readonly status: ServiceStatus;
}

function sameScope(left: PlatformScopeV1, right: PlatformScopeV1): boolean {
  return (
    left.namespace === right.namespace &&
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.billingAccountId === right.billingAccountId
  );
}

function readServiceInstance(
  input: unknown,
  organizationId: string,
  projectId: string,
  serviceId: PlatformServiceIdV1,
): ServiceStatus {
  const raw = object(input, 'service instance');
  const state = object(raw.state, 'service state');
  const scope = PlatformScopeV1.parse(raw.scope);
  const command = ServiceProvisionCommandV1.parse(raw.command);
  if (
    raw.serviceId !== serviceId ||
    scope.kind === 'rejected' ||
    scope.value.organizationId !== organizationId ||
    scope.value.projectId !== projectId ||
    command.kind === 'rejected' ||
    !commandMatchesService(command.value, scope.value, serviceId) ||
    raw.instanceId !== command.value.instanceId ||
    state.desiredRevision !== command.value.desiredRevision
  )
    throw new Error('Service status did not match this project.');
  const { instanceId, operationId, desiredRevision } = command.value;
  switch (state.kind) {
    case 'active':
    case 'archived': {
      const input = {
        instanceId,
        operationId,
        desiredRevision,
        desiredState: state.kind === 'active' ? 'enabled' : 'archived',
        receipt: state.receipt,
      };
      const bound =
        state.kind === 'active'
          ? BoundServiceInstanceV1.active(input)
          : BoundServiceInstanceV1.archived(input);
      if (
        command.value.command !== (state.kind === 'active' ? 'enable' : 'archive') ||
        state.observedRevision !== desiredRevision ||
        bound.kind === 'rejected' ||
        bound.value.serviceId !== serviceId ||
        !sameScope(bound.value.state.binding.scope, scope.value)
      )
        throw new Error('The service receipt could not be confirmed. Refresh its status.');
      return { kind: state.kind, instanceId, operationId, desiredRevision };
    }
    case 'provisioning':
      if (command.value.command !== 'enable') throw new Error('Invalid provisioning command.');
      return { kind: 'provisioning', instanceId, operationId, desiredRevision };
    case 'disabled': {
      if (command.value.command !== 'disable') throw new Error('Invalid disable command.');
      const shutdown = object(state.shutdown, 'shutdown');
      if (shutdown.kind !== 'pending' && shutdown.kind !== 'confirmed')
        throw new Error('Invalid shutdown status.');
      if (shutdown.kind === 'confirmed') {
        const receipt = parseServiceProvisionReceiptV1(shutdown.receipt);
        if (
          receipt.kind === 'rejected' ||
          receipt.value.result !== 'disabled' ||
          receipt.value.instanceId !== instanceId ||
          receipt.value.operationId !== operationId ||
          receipt.value.desiredRevision !== desiredRevision ||
          receipt.value.binding.nativeScope.serviceId !== serviceId ||
          !sameScope(receipt.value.binding.scope, scope.value)
        )
          throw new Error('Invalid shutdown receipt.');
      }
      return {
        kind: 'disabled',
        instanceId,
        operationId,
        desiredRevision,
        shutdown: shutdown.kind,
      };
    }
    case 'failed':
      return {
        kind: 'failed',
        instanceId,
        operationId,
        desiredRevision,
        command: command.value.command,
        failureCode: textValue(state.failureCode, 'failureCode'),
      };
    default:
      throw new Error('The service returned an unknown state.');
  }
}

function readConsoleHref(input: unknown): string {
  const href = textValue(input, 'consoleHref');
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  const url = new URL(href);
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password)
    throw new Error('Invalid service link.');
  return url.href;
}

function readProjectServices(
  input: unknown,
  organizationId: string,
  projectId: string,
): ProjectService[] {
  const body = object(input, 'project services');
  if (body.ok !== true || !Array.isArray(body.services) || !Array.isArray(body.instances)) {
    throw new Error('The project services response was invalid.');
  }
  const result: ProjectService[] = [];
  const seen = new Set<PlatformServiceIdV1>();
  for (const entry of body.services) {
    const service = object(entry, 'service');
    const serviceId = service.serviceId;
    if ((serviceId !== 'wallet' && serviceId !== 'satyr') || seen.has(serviceId))
      throw new Error('Invalid service catalog.');
    seen.add(serviceId);
    const availability = object(service.availability, 'service availability');
    let available: ProjectService['availability'];
    switch (availability.kind) {
      case 'available':
        available = { kind: 'available', consoleHref: readConsoleHref(availability.consoleHref) };
        break;
      case 'unavailable':
        available = { kind: 'unavailable' };
        break;
      default:
        throw new Error('Invalid service availability.');
    }
    let status: ServiceStatus = { kind: 'absent' };
    for (const entry of body.instances) {
      const instance = object(entry, 'instance');
      if (instance.serviceId !== serviceId) continue;
      if (status.kind !== 'absent')
        throw new Error('This project has conflicting service instances.');
      status = readServiceInstance(instance, organizationId, projectId, serviceId);
    }
    result.push({ serviceId, availability: available, status });
  }
  if (seen.size !== 2) throw new Error('The service catalog is incomplete.');
  for (const entry of body.instances) {
    const instance = object(entry, 'instance');
    if (instance.serviceId !== 'wallet' && instance.serviceId !== 'satyr')
      throw new Error('Unknown service instance.');
  }
  return result;
}

export async function getProjectServices(
  organizationId: string,
  projectId: string,
): Promise<ProjectService[]> {
  const response = await fetch(
    `${requireConsoleBaseUrl()}/console/projects/${encodeURIComponent(projectId)}/services`,
    { credentials: 'include', cache: 'no-store', headers: buildConsoleAcceptHeaders() },
  );
  const body: unknown = await parseConsoleJson(response);
  if (!response.ok)
    throw new Error(consoleErrorMessage(response, body, 'Service status request failed'));
  return readProjectServices(body, organizationId, projectId);
}

export async function getServiceStatus(
  organizationId: string,
  projectId: string,
  serviceId: PlatformServiceIdV1,
): Promise<ServiceStatus> {
  const services = await getProjectServices(organizationId, projectId);
  for (const service of services) if (service.serviceId === serviceId) return service.status;
  throw new Error('The requested service is unavailable.');
}

export async function changeProjectService(
  organizationId: string,
  projectId: string,
  serviceId: PlatformServiceIdV1,
  action: ServiceAction,
  operation: ServiceOperation,
): Promise<ServiceStatus> {
  const response = await fetch(
    `${requireConsoleBaseUrl()}/console/projects/${encodeURIComponent(projectId)}/services/${serviceId}/${action}`,
    {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: buildConsoleJsonHeaders(),
      body: JSON.stringify(operation),
    },
  );
  const body: unknown = await parseConsoleJson(response);
  const raw = object(body, 'service result');
  if (!response.ok || raw.ok !== true)
    throw new Error(consoleErrorMessage(response, body, 'Service change failed'));
  return readServiceInstance(raw.instance, organizationId, projectId, serviceId);
}
