import React from 'react';
import { assertNever } from '@seams-internal/console-shared/accountPlatform/boundary';
import { useDashboardConsoleSession } from '../../consoleSession';
import { useDashboardSelectedContext } from '../../selectedContext';
import { requireConsoleBaseUrl } from '../../consoleHttp';
import { DASHBOARD_ENVIRONMENTS_UPDATED_EVENT } from '../../consoleContextApi';
import { DashboardLoadingState } from '../../components/DashboardLoadingState';
import { DashboardPageActions } from '../../components/DashboardPageActions';
import {
  changeProjectService,
  getProjectServices,
  serviceName,
  type ProjectService,
  type ServiceAction,
  type ServiceOperation,
  type ServiceStatus,
} from './consoleServicesApi';

type PageState =
  | { kind: 'loading' }
  | { kind: 'ready'; services: readonly ProjectService[] }
  | { kind: 'failed'; message: string };

interface PendingChange {
  readonly action: ServiceAction;
  readonly operation: ServiceOperation;
}

type CardState =
  | { kind: 'ready'; status: ServiceStatus }
  | { kind: 'working'; status: ServiceStatus; pending: PendingChange }
  | { kind: 'uncertain'; status: ServiceStatus; pending: PendingChange; message: string }
  | { kind: 'blocked'; status: ServiceStatus; message: string }
  | { kind: 'confirm_archive'; status: Extract<ServiceStatus, { kind: 'disabled' }> };

function messageFor(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Service status is unavailable. Retry the request.';
}

function storageKey(
  organizationId: string,
  projectId: string,
  serviceId: ProjectService['serviceId'],
): string {
  return `seams:service-change:${JSON.stringify([requireConsoleBaseUrl(), organizationId, projectId, serviceId])}`;
}

function readPendingChange(key: string): PendingChange | null {
  const raw: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? 'null');
  if (raw === null) return null;
  if (
    typeof raw !== 'object' ||
    !('action' in raw) ||
    !('operation' in raw) ||
    (raw.action !== 'enable' && raw.action !== 'disable' && raw.action !== 'archive') ||
    typeof raw.operation !== 'object' ||
    raw.operation === null ||
    !('operationId' in raw.operation) ||
    typeof raw.operation.operationId !== 'string' ||
    !raw.operation.operationId.trim() ||
    !('desiredRevision' in raw.operation) ||
    typeof raw.operation.desiredRevision !== 'number' ||
    !Number.isSafeInteger(raw.operation.desiredRevision) ||
    raw.operation.desiredRevision < 1
  ) {
    throw new Error(
      'Saved service progress is invalid. Check the current status before making another change.',
    );
  }
  return {
    action: raw.action,
    operation: {
      operationId: raw.operation.operationId,
      desiredRevision: raw.operation.desiredRevision,
    },
  };
}

function initialCardState(service: ProjectService, key: string): CardState {
  try {
    const pending = readPendingChange(key);
    if (
      pending &&
      (service.status.kind === 'absent' ||
        service.status.desiredRevision < pending.operation.desiredRevision)
    ) {
      return {
        kind: 'uncertain',
        status: service.status,
        pending,
        message: 'The previous change has no confirmed reply. Resume it to check the result.',
      };
    }
    window.sessionStorage.removeItem(key);
    return { kind: 'ready', status: service.status };
  } catch (error: unknown) {
    return { kind: 'blocked', status: service.status, message: messageFor(error) };
  }
}

function useCurrentStatus(
  key: string,
  status: ServiceStatus,
  setState: React.Dispatch<React.SetStateAction<CardState>>,
): void {
  try {
    window.sessionStorage.removeItem(key);
    setState({ kind: 'ready', status });
  } catch (error: unknown) {
    setState({ kind: 'blocked', status, message: messageFor(error) });
  }
}

function pendingFor(status: ServiceStatus): PendingChange | null {
  switch (status.kind) {
    case 'provisioning':
      return {
        action: 'enable',
        operation: { operationId: status.operationId, desiredRevision: status.desiredRevision },
      };
    case 'disabled':
      return status.shutdown === 'pending'
        ? {
            action: 'disable',
            operation: { operationId: status.operationId, desiredRevision: status.desiredRevision },
          }
        : null;
    case 'absent':
    case 'active':
    case 'archived':
    case 'failed':
      return null;
    default:
      return assertNever(status);
  }
}

function statusDescription(status: ServiceStatus): string {
  switch (status.kind) {
    case 'absent':
      return 'Not enabled';
    case 'active':
      return 'Active';
    case 'provisioning':
      return 'Activation pending';
    case 'disabled':
      return status.shutdown === 'pending' ? 'Disabled · native shutdown pending' : 'Disabled';
    case 'archived':
      return 'Archived';
    case 'failed':
      return `Change failed: ${status.failureCode}`;
    default:
      return assertNever(status);
  }
}

async function loadServices(
  organizationId: string,
  projectId: string,
  setState: React.Dispatch<React.SetStateAction<PageState>>,
): Promise<void> {
  setState({ kind: 'loading' });
  try {
    const services = await getProjectServices(organizationId, projectId);
    setState({ kind: 'ready', services });
  } catch (error: unknown) {
    setState({ kind: 'failed', message: messageFor(error) });
  }
}

function beginLoad(
  organizationId: string,
  projectId: string,
  setState: React.Dispatch<React.SetStateAction<PageState>>,
): void {
  if (organizationId && projectId) void loadServices(organizationId, projectId, setState);
}

async function submitChange(
  organizationId: string,
  projectId: string,
  service: ProjectService,
  key: string,
  status: ServiceStatus,
  pending: PendingChange,
  setState: React.Dispatch<React.SetStateAction<CardState>>,
): Promise<void> {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(pending));
    setState({ kind: 'working', status, pending });
    const next = await changeProjectService(
      organizationId,
      projectId,
      service.serviceId,
      pending.action,
      pending.operation,
    );
    window.sessionStorage.removeItem(key);
    setState({ kind: 'ready', status: next });
    if (service.serviceId === 'wallet')
      window.dispatchEvent(new Event(DASHBOARD_ENVIRONMENTS_UPDATED_EVENT));
  } catch (error: unknown) {
    setState({ kind: 'uncertain', status, pending, message: messageFor(error) });
  }
}

function beginChange(
  organizationId: string,
  projectId: string,
  service: ProjectService,
  key: string,
  status: ServiceStatus,
  action: ServiceAction,
  setState: React.Dispatch<React.SetStateAction<CardState>>,
): void {
  const pending = pendingFor(status) ?? {
    action,
    operation: {
      operationId: crypto.randomUUID(),
      desiredRevision: status.kind === 'absent' ? 1 : status.desiredRevision + 1,
    },
  };
  void submitChange(organizationId, projectId, service, key, status, pending, setState);
}

function ServiceCard({
  organizationId,
  projectId,
  service,
  canManage,
}: {
  organizationId: string;
  projectId: string;
  service: ProjectService;
  canManage: boolean;
}): React.JSX.Element {
  const key = storageKey(organizationId, projectId, service.serviceId);
  const [state, setState] = React.useState<CardState>(initialCardState.bind(null, service, key));
  const name = serviceName(service.serviceId);
  const status = state.status;
  const pending = pendingFor(status);
  return (
    <section className="dashboard-view__section" aria-label={`${name} service`}>
      <h2>{name}</h2>
      <p role="status">{statusDescription(status)}</p>
      {status.kind !== 'absent' ? (
        <p>
          <small>
            Instance: {status.instanceId} · Revision {status.desiredRevision}
          </small>
        </p>
      ) : null}
      {service.serviceId === 'satyr' ? (
        <p>
          Satyr manages work projects, private content, roles, and operational readiness in its own
          portal. Customer service fees are unpriced.
        </p>
      ) : (
        <p>Wallet manages environments, keys, and signing. Existing Wallet prices apply.</p>
      )}
      {service.availability.kind === 'unavailable' ? (
        <p>
          This deployment has no service connection. An administrator must configure it before
          activation.
        </p>
      ) : null}
      {state.kind === 'working' ? <p>Applying service change…</p> : null}
      {state.kind === 'blocked' ? (
        <>
          <p role="alert">{state.message}</p>
          <button
            type="button"
            className="dashboard-pagination-button"
            onClick={useCurrentStatus.bind(null, key, status, setState)}
          >
            Use current service status
          </button>
        </>
      ) : null}
      {state.kind === 'uncertain' && canManage ? (
        <>
          <p role="alert">{state.message}</p>
          <button
            type="button"
            className="dashboard-pagination-button"
            onClick={submitChange.bind(
              null,
              organizationId,
              projectId,
              service,
              key,
              status,
              state.pending,
              setState,
            )}
          >
            Resume pending change
          </button>
        </>
      ) : null}
      {state.kind === 'confirm_archive' ? (
        <>
          <p>
            Archive this {name} instance permanently? This project cannot enable another {name}{' '}
            instance. Accepted work and financial records remain.
          </p>
          <button
            type="button"
            className="dashboard-pagination-button"
            onClick={beginChange.bind(
              null,
              organizationId,
              projectId,
              service,
              key,
              status,
              'archive',
              setState,
            )}
          >
            Confirm archive {name}
          </button>
          <button
            type="button"
            className="dashboard-pagination-button"
            onClick={setState.bind(null, { kind: 'ready', status })}
          >
            Cancel
          </button>
        </>
      ) : null}
      {canManage && state.kind === 'ready' ? (
        <>
          {pending ? (
            <button
              type="button"
              className="dashboard-pagination-button"
              onClick={submitChange.bind(
                null,
                organizationId,
                projectId,
                service,
                key,
                status,
                pending,
                setState,
              )}
            >
              Resume {name} change
            </button>
          ) : null}
          {!pending &&
          (status.kind === 'absent' || status.kind === 'disabled') &&
          service.availability.kind === 'available' ? (
            <button
              type="button"
              className="dashboard-pagination-button"
              onClick={beginChange.bind(
                null,
                organizationId,
                projectId,
                service,
                key,
                status,
                'enable',
                setState,
              )}
            >
              Enable {name}
            </button>
          ) : null}
          {status.kind === 'failed' ? (
            <button
              type="button"
              className="dashboard-pagination-button"
              onClick={beginChange.bind(
                null,
                organizationId,
                projectId,
                service,
                key,
                status,
                status.command,
                setState,
              )}
            >
              Retry {name} change
            </button>
          ) : null}
          {!pending && status.kind === 'active' ? (
            <button
              type="button"
              className="dashboard-pagination-button"
              onClick={beginChange.bind(
                null,
                organizationId,
                projectId,
                service,
                key,
                status,
                'disable',
                setState,
              )}
            >
              Disable {name}
            </button>
          ) : null}
          {!pending && status.kind === 'disabled' ? (
            <button
              type="button"
              className="dashboard-pagination-button"
              onClick={setState.bind(null, { kind: 'confirm_archive', status })}
            >
              Archive {name}
            </button>
          ) : null}
        </>
      ) : null}
      {status.kind === 'active' && service.availability.kind === 'available' ? (
        <p>
          <a className="dashboard-pagination-button" href={service.availability.consoleHref}>
            Open {name}
          </a>
        </p>
      ) : null}
    </section>
  );
}

export function ServicesPage(): React.JSX.Element {
  const { claims } = useDashboardConsoleSession();
  const { project } = useDashboardSelectedContext();
  const organizationId = claims?.orgId ?? '';
  const [state, setState] = React.useState<PageState>({ kind: 'loading' });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Bound arguments are the dependencies.
  React.useEffect(beginLoad.bind(null, organizationId, project, setState), [
    organizationId,
    project,
  ]);
  if (!organizationId || !project) return <p>Select a platform project to manage its services.</p>;
  const canManage =
    claims?.role === 'OWNER' ||
    (claims?.role === 'ADMIN' && claims.adminPermissions.includes('projects.manage'));
  switch (state.kind) {
    case 'loading':
      return <DashboardLoadingState title="Loading project services…" />;
    case 'failed':
      return (
        <section className="dashboard-view__section">
          <p role="alert">{state.message}</p>
          <button
            type="button"
            className="dashboard-pagination-button"
            onClick={beginLoad.bind(null, organizationId, project, setState)}
          >
            Retry service status
          </button>
        </section>
      );
    case 'ready': {
      const cards: React.JSX.Element[] = [];
      for (const service of state.services)
        cards.push(
          <ServiceCard
            key={service.serviceId}
            organizationId={organizationId}
            projectId={project}
            service={service}
            canManage={canManage}
          />,
        );
      return (
        <>
          <p>
            Services share this organisation’s billing account. Each service keeps its own access
            rules and operational data.
          </p>
          <p>
            <a href="/dashboard/billing/account">View costs by project, service, and meter</a>
          </p>
          <DashboardPageActions>
            <button
              type="button"
              className="dashboard-pagination-button"
              onClick={beginLoad.bind(null, organizationId, project, setState)}
            >
              Refresh service status
            </button>
          </DashboardPageActions>
          {!canManage ? (
            <p>An owner or administrator with project management access can change services.</p>
          ) : null}
          {cards}
        </>
      );
    }
    default:
      return assertNever(state);
  }
}
