import React from 'react';
import { useDashboardConsoleSession } from '@core/dashboard/consoleSession';
import { DashboardLoadingState } from '@core/dashboard/components/DashboardLoadingState';
import { requireConsoleBaseUrl } from '@core/dashboard/consoleHttp';
import { DASHBOARD_ENVIRONMENTS_UPDATED_EVENT } from '@core/dashboard/consoleContextApi';
import { useDashboardSelectedContext } from '@core/dashboard/selectedContext';
import {
  enableWalletService,
  getWalletServiceStatus,
  type EnableableWalletService,
  type WalletEnableOperation,
  type WalletServiceStatus,
} from './consoleWalletServiceApi';

type SetupState =
  | { kind: 'loading' }
  | { kind: 'ready'; service: WalletServiceStatus }
  | { kind: 'enabling'; operation: WalletEnableOperation }
  | { kind: 'failed'; message: string };

function operationStorageKey(organizationId: string, projectId: string): string {
  return `seams:wallet-enable:${JSON.stringify([requireConsoleBaseUrl(), organizationId, projectId])}`;
}

function readStoredOperation(key: string): WalletEnableOperation | null {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? 'null');
    if (
      typeof value !== 'object' ||
      value === null ||
      !('operationId' in value) ||
      typeof value.operationId !== 'string' ||
      !value.operationId.trim() ||
      !('desiredRevision' in value) ||
      typeof value.desiredRevision !== 'number' ||
      !Number.isSafeInteger(value.desiredRevision) ||
      value.desiredRevision < 1
    )
      return null;
    return { operationId: value.operationId, desiredRevision: value.desiredRevision };
  } catch {
    return null;
  }
}

function retainPendingOperation(key: string, service: WalletServiceStatus): void {
  if (service.kind === 'absent') return;
  if (service.kind === 'provisioning') {
    writeStoredOperation(key, {
      operationId: service.operationId,
      desiredRevision: service.desiredRevision,
    });
    return;
  }
  try {
    window.sessionStorage.removeItem(key);
  } catch {}
}

function writeStoredOperation(key: string, operation: WalletEnableOperation): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(operation));
  } catch {
    throw new Error(
      'This browser could not save Wallet setup progress. Allow site storage and retry.',
    );
  }
}

async function loadWalletService(
  organizationId: string,
  projectId: string,
  key: string,
  setState: React.Dispatch<React.SetStateAction<SetupState>>,
): Promise<void> {
  setState({ kind: 'loading' });
  try {
    const service = await getWalletServiceStatus(organizationId, projectId);
    retainPendingOperation(key, service);
    setState({ kind: 'ready', service });
    if (service.kind === 'active') {
      window.dispatchEvent(new Event(DASHBOARD_ENVIRONMENTS_UPDATED_EVENT));
    }
  } catch (error: unknown) {
    setState({
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Wallet setup could not be loaded.',
    });
  }
}

function beginWalletServiceLoad(
  organizationId: string,
  projectId: string,
  key: string,
  setState: React.Dispatch<React.SetStateAction<SetupState>>,
): void {
  if (!organizationId || !projectId) return;
  void loadWalletService(organizationId, projectId, key, setState);
}

async function submitWalletEnable(
  organizationId: string,
  projectId: string,
  key: string,
  service: EnableableWalletService,
  setState: React.Dispatch<React.SetStateAction<SetupState>>,
): Promise<void> {
  try {
    const operation = readStoredOperation(key) ?? {
      operationId: crypto.randomUUID(),
      desiredRevision: service.kind === 'absent' ? 1 : service.desiredRevision + 1,
    };
    writeStoredOperation(key, operation);
    setState({ kind: 'enabling', operation });
    const nextService = await enableWalletService(organizationId, projectId, operation);
    retainPendingOperation(key, nextService);
    setState({ kind: 'ready', service: nextService });
    if (nextService.kind === 'active') {
      window.dispatchEvent(new Event(DASHBOARD_ENVIRONMENTS_UPDATED_EVENT));
    }
  } catch (error: unknown) {
    setState({
      kind: 'failed',
      message:
        error instanceof Error
          ? error.message
          : 'Wallet activation could not be confirmed. Retry to resume.',
    });
  }
}

function setupDescription(service: WalletServiceStatus): string {
  switch (service.kind) {
    case 'absent':
      return 'Enable Wallet for this project to create its environments and configure wallet operations.';
    case 'disabled':
      return 'Wallet is disabled for this project. Enable it to resume wallet operations.';
    case 'provisioning':
      return 'Wallet setup is in progress. Check its status or retry the same setup operation.';
    case 'failed':
      return 'Wallet setup failed. Retry setup to try again.';
    case 'archived':
      return 'This Wallet instance is archived. Create a project to enable a new Wallet instance.';
    case 'active':
      return 'Wallet is active. Select a Wallet environment to continue.';
    default:
      return assertNever(service);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown Wallet setup state: ${String(value)}`);
}

export function WalletServiceGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { claims } = useDashboardConsoleSession();
  const selected = useDashboardSelectedContext();
  const projectId = selected.project;
  const organizationId = claims?.orgId ?? '';
  const key = operationStorageKey(organizationId, projectId);
  const [state, setState] = React.useState<SetupState>({ kind: 'loading' });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- The bound callback receives every dependency listed here.
  React.useEffect(beginWalletServiceLoad.bind(null, organizationId, projectId, key, setState), [
    organizationId,
    projectId,
    key,
  ]);
  const canEnable =
    claims?.role === 'OWNER' ||
    (claims?.role === 'ADMIN' && claims.adminPermissions.includes('projects.manage'));
  switch (state.kind) {
    case 'loading':
      return <DashboardLoadingState title="Checking Wallet setup..." />;
    case 'enabling':
      return <DashboardLoadingState title="Enabling Wallet..." />;
    case 'failed':
      return (
        <section className="dashboard-view__section">
          <h2>Wallet setup unavailable</h2>
          <p role="alert">{state.message}</p>
          <button
            type="button"
            className="dashboard-pagination-button"
            onClick={beginWalletServiceLoad.bind(null, organizationId, projectId, key, setState)}
          >
            Check setup
          </button>
        </section>
      );
    case 'ready':
      if (state.service.kind === 'active' && selected.environment) return <>{children}</>;
      return (
        <section className="dashboard-view__section">
          <h2>Set up Wallet</h2>
          <p>{setupDescription(state.service)}</p>
          {canEnable && state.service.kind !== 'active' && state.service.kind !== 'archived' ? (
            <button
              type="button"
              className="dashboard-pagination-button"
              onClick={submitWalletEnable.bind(
                null,
                organizationId,
                projectId,
                key,
                state.service,
                setState,
              )}
            >
              {state.service.kind === 'provisioning' ? 'Retry setup' : 'Enable Wallet'}
            </button>
          ) : null}
          {!canEnable && state.service.kind !== 'active' && state.service.kind !== 'archived' ? (
            <p>
              Ask an organization owner or administrator with project management access to enable
              Wallet.
            </p>
          ) : null}
          {state.service.kind === 'provisioning' || state.service.kind === 'active' ? (
            <button
              type="button"
              className="dashboard-pagination-button"
              onClick={beginWalletServiceLoad.bind(null, organizationId, projectId, key, setState)}
            >
              Check setup
            </button>
          ) : null}
        </section>
      );
    default:
      return assertNever(state);
  }
}
