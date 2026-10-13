import {
  BoundServiceInstanceV1,
  PlatformScopeV1,
  ServiceProvisionCommandV1,
} from '@seams-internal/console-shared/accountPlatform';
import {
  buildConsoleAcceptHeaders,
  buildConsoleJsonHeaders,
  consoleErrorMessage,
  parseConsoleJson,
  requireConsoleBaseUrl,
} from '@core/dashboard/consoleHttp';

interface WalletServiceIdentity {
  instanceId: string;
  operationId: string;
  desiredRevision: number;
}

export type WalletServiceStatus =
  | { kind: 'absent'; instanceId?: never; operationId?: never; desiredRevision?: never }
  | (WalletServiceIdentity & { kind: 'active' })
  | (WalletServiceIdentity & { kind: 'provisioning' })
  | (WalletServiceIdentity & { kind: 'disabled' })
  | (WalletServiceIdentity & { kind: 'archived' })
  | (WalletServiceIdentity & { kind: 'failed'; failureCode: string });

export type EnableableWalletService = Exclude<WalletServiceStatus, { kind: 'active' | 'archived' }>;

export interface WalletEnableOperation {
  operationId: string;
  desiredRevision: number;
}

function responseObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readWalletServiceInstance(
  raw: unknown,
  organizationId: string,
  projectId: string,
): WalletServiceStatus {
  if (!responseObject(raw) || raw.serviceId !== 'wallet' || !responseObject(raw.state)) {
    throw new Error('Wallet setup response was invalid. Refresh the page to retry.');
  }
  const scope = PlatformScopeV1.parse(raw.scope);
  const command = ServiceProvisionCommandV1.parse(raw.command);
  if (
    scope.kind === 'rejected' ||
    scope.value.organizationId !== organizationId ||
    scope.value.projectId !== projectId ||
    command.kind === 'rejected' ||
    raw.instanceId !== command.value.instanceId ||
    raw.state.desiredRevision !== command.value.desiredRevision
  ) {
    throw new Error('Wallet setup response did not match this project.');
  }
  const instanceId = command.value.instanceId;
  const operationId = command.value.operationId;
  const desiredRevision = command.value.desiredRevision;
  switch (raw.state.kind) {
    case 'active': {
      const active = BoundServiceInstanceV1.active({
        instanceId,
        operationId,
        desiredState: 'enabled',
        desiredRevision,
        receipt: raw.state.receipt,
      });
      if (
        command.value.command !== 'enable' ||
        raw.state.observedRevision !== desiredRevision ||
        active.kind === 'rejected' ||
        active.value.state.binding.scope.namespace !== scope.value.namespace ||
        active.value.state.binding.scope.organizationId !== scope.value.organizationId ||
        active.value.state.binding.scope.projectId !== scope.value.projectId ||
        active.value.state.binding.scope.billingAccountId !== scope.value.billingAccountId
      ) {
        throw new Error('Wallet activation could not be confirmed. Refresh the page to retry.');
      }
      return { kind: 'active', instanceId, operationId, desiredRevision };
    }
    case 'provisioning':
    case 'disabled':
    case 'archived':
      return { kind: raw.state.kind, instanceId, operationId, desiredRevision };
    case 'failed':
      if (typeof raw.state.failureCode !== 'string' || !raw.state.failureCode.trim()) {
        throw new Error('Wallet setup response did not include its failure state.');
      }
      return {
        kind: 'failed',
        instanceId,
        operationId,
        desiredRevision,
        failureCode: raw.state.failureCode,
      };
    default:
      throw new Error('Wallet setup response included an unknown state.');
  }
}

export async function getWalletServiceStatus(
  organizationId: string,
  projectId: string,
): Promise<WalletServiceStatus> {
  const response = await fetch(
    `${requireConsoleBaseUrl()}/console/projects/${encodeURIComponent(projectId)}/services`,
    { credentials: 'include', cache: 'no-store', headers: buildConsoleAcceptHeaders() },
  );
  const body: unknown = await parseConsoleJson(response);
  if (!response.ok || !responseObject(body) || body.ok !== true || !Array.isArray(body.instances)) {
    throw new Error(consoleErrorMessage(response, body, 'Wallet setup request failed'));
  }
  const walletInstances = body.instances.filter(isWalletInstance);
  if (walletInstances.length === 0) return { kind: 'absent' };
  if (walletInstances.length !== 1)
    throw new Error('This project has conflicting Wallet instances.');
  return readWalletServiceInstance(walletInstances[0], organizationId, projectId);
}

function isWalletInstance(value: unknown): boolean {
  return responseObject(value) && value.serviceId === 'wallet';
}

export async function enableWalletService(
  organizationId: string,
  projectId: string,
  operation: WalletEnableOperation,
): Promise<WalletServiceStatus> {
  const response = await fetch(
    `${requireConsoleBaseUrl()}/console/projects/${encodeURIComponent(projectId)}/services/wallet/enable`,
    {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: buildConsoleJsonHeaders(),
      body: JSON.stringify(operation),
    },
  );
  const body: unknown = await parseConsoleJson(response);
  if (!response.ok || !responseObject(body) || body.ok !== true) {
    throw new Error(consoleErrorMessage(response, body, 'Wallet activation failed'));
  }
  return readWalletServiceInstance(body.instance, organizationId, projectId);
}
