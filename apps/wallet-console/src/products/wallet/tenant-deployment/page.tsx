import React from 'react';
import { CircleCheck, ShieldCheck } from 'lucide-react';
import { decodeTenantDeploymentPublicProjectionV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';
import { useDashboardConsoleSession } from '@core/dashboard/consoleSession';
import { DashboardPageActions } from '@core/dashboard/components/DashboardPageActions';
import {
  useDashboardSelectedContext,
  useDashboardSelectedContextDisplay,
} from '@core/dashboard/selectedContext';
import { listDashboardAuditEvents } from '@core/dashboard/routes/audit/consoleAuditApi';
import { getActiveFrontendDeployment } from '@core/runtime';
import {
  DASHBOARD_ENVIRONMENTS_UPDATED_EVENT,
  listDashboardEnvironments,
} from '@core/dashboard/consoleContextApi';
import {
  changeProjectService,
  getServiceStatus,
  type ServiceStatus,
} from '@core/dashboard/routes/services/consoleServicesApi';
import {
  operationStorageKey,
  readStoredOperation,
  writeStoredOperation,
} from '../WalletServiceGate';
import './tenantDeployment.css';

type LiveAccessState =
  | { readonly kind: 'idle' | 'pending' | 'ready' }
  | { readonly kind: 'error'; readonly message: string };

function scheduleAccessCheck(resolve: () => void): void {
  window.setTimeout(resolve, 1000);
}

async function waitForWalletAccess(
  organizationId: string,
  projectId: string,
  initial: ServiceStatus,
): Promise<void> {
  let service = initial;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    switch (service.kind) {
      case 'active':
        return;
      case 'provisioning':
        await new Promise<void>(scheduleAccessCheck);
        service = await getServiceStatus(organizationId, projectId, 'wallet');
        break;
      case 'absent':
      case 'disabled':
      case 'archived':
      case 'failed':
        throw new Error('Wallet access could not be refreshed. Check the project service status.');
      default:
        return assertNeverStatus(service);
    }
  }
  throw new Error('Wallet access is still being prepared. Retry to check its progress.');
}

async function refreshLiveWalletAccess(
  organizationId: string,
  projectId: string,
  setState: React.Dispatch<React.SetStateAction<LiveAccessState>>,
): Promise<void> {
  setState({ kind: 'pending' });
  const key = `${operationStorageKey(organizationId, projectId)}:live-access`;
  try {
    const stored = readStoredOperation(key);
    let service = await getServiceStatus(organizationId, projectId, 'wallet');
    switch (service.kind) {
      case 'active':
        if (stored === null || service.operationId !== stored.operationId) {
          const operation = stored ?? {
            operationId: crypto.randomUUID(),
            desiredRevision: service.desiredRevision + 1,
          };
          writeStoredOperation(key, operation);
          service = await changeProjectService(
            organizationId,
            projectId,
            'wallet',
            'enable',
            operation,
          );
        }
        break;
      case 'provisioning':
        break;
      case 'absent':
      case 'disabled':
      case 'archived':
      case 'failed':
        throw new Error('Only an active Wallet service can refresh live access.');
      default:
        return assertNeverStatus(service);
    }
    await waitForWalletAccess(organizationId, projectId, service);
    window.sessionStorage.removeItem(key);
    const environments = await listDashboardEnvironments({ projectId });
    const production = environments.find(isProductionEnvironment);
    if (!production || production.status === 'ARCHIVED') {
      throw new Error(
        'The production environment is unavailable. Check the project service status.',
      );
    }
    if (production.status !== 'ACTIVE') {
      throw new Error(
        'Live Wallet access requires prepaid credit. Add credits, then refresh access.',
      );
    }
    window.dispatchEvent(new Event(DASHBOARD_ENVIRONMENTS_UPDATED_EVENT));
    setState({ kind: 'ready' });
  } catch (error: unknown) {
    setState({
      kind: 'error',
      message:
        error instanceof Error ? error.message : 'Live Wallet access could not be refreshed.',
    });
  }
}

function isProductionEnvironment(environment: { readonly key: string }): boolean {
  return environment.key === 'prod';
}

function LiveWalletAccessControl(props: {
  readonly organizationId: string;
  readonly projectId: string;
}): React.JSX.Element {
  const [state, setState] = React.useState<LiveAccessState>({ kind: 'idle' });
  return (
    <section className="tenant-deployment-section" aria-labelledby="live-wallet-access-title">
      <h2 id="live-wallet-access-title">Live Wallet access</h2>
      <p>After you add prepaid credits, refresh access to enable production for this project.</p>
      <button
        type="button"
        className="dashboard-pagination-button"
        disabled={state.kind === 'pending'}
        onClick={refreshLiveWalletAccess.bind(
          null,
          props.organizationId,
          props.projectId,
          setState,
        )}
      >
        {state.kind === 'pending' ? 'Refreshing live access…' : 'Refresh live Wallet access'}
      </button>
      {state.kind === 'ready' ? <p role="status">Live Wallet access is enabled.</p> : null}
      {state.kind === 'error' ? <p role="alert">{state.message}</p> : null}
    </section>
  );
}

type DeploymentStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'unavailable'; readonly environmentId: string }
  | {
      readonly kind: 'environment_mismatch';
      readonly environmentId: string;
      readonly activeEnvironmentId: string;
    }
  | {
      readonly kind: 'ready';
      readonly revision: string;
      readonly environmentId: string;
      readonly mode: string;
      readonly applicationOrigin: string;
      readonly hostedWalletOrigin: string;
      readonly gatewayOrigin: string;
      readonly relyingPartyId: string;
      readonly activatedAt: string | null;
      readonly activationSequence: number | null;
      readonly canaryDigest: string | null;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function loadDeploymentStatus(input: {
  readonly projectId: string;
  readonly environmentId: string;
}): Promise<DeploymentStatus> {
  const deployment = getActiveFrontendDeployment();
  const projectionResponse = await fetch(
    `${deployment.relayerUrl}/.well-known/seams-tenant-deployment.json`,
    { cache: 'no-store' },
  );
  const raw: unknown = await projectionResponse.json().catch(() => null);
  if (
    projectionResponse.status === 503 &&
    isRecord(raw) &&
    raw.code === 'tenant_deployment_unavailable'
  ) {
    return { kind: 'unavailable', environmentId: input.environmentId };
  }
  if (!projectionResponse.ok) {
    throw new Error('The active deployment projection is unavailable.');
  }
  const decoded = decodeTenantDeploymentPublicProjectionV1(raw);
  if (!decoded.ok) throw new Error('The active deployment projection is invalid.');
  const projection = decoded.value;
  if (projection.environmentId !== input.environmentId) {
    return {
      kind: 'environment_mismatch',
      environmentId: input.environmentId,
      activeEnvironmentId: projection.environmentId,
    };
  }
  const auditEvents = await listDashboardAuditEvents({
    projectId: input.projectId,
    environmentId: input.environmentId,
    category: 'SYSTEM',
    q: 'tenant_deployment.activate',
    limit: 10,
  });
  const latestActivation = auditEvents.find(
    (event) => event.action === 'tenant_deployment.activate' && event.outcome === 'SUCCESS',
  );
  const metadata = latestActivation?.metadata ?? {};
  return {
    kind: 'ready',
    revision: projection.revision,
    environmentId: projection.environmentId,
    mode: projection.mode.kind,
    applicationOrigin: projection.applicationOrigin,
    hostedWalletOrigin: projection.hostedWalletOrigin,
    gatewayOrigin: projection.gatewayOrigin,
    relyingPartyId: projection.relyingPartyId,
    activatedAt: latestActivation?.createdAt ?? null,
    activationSequence:
      typeof metadata.activationSequence === 'number' ? metadata.activationSequence : null,
    canaryDigest:
      typeof metadata.canaryResponseDigestB64u === 'string'
        ? metadata.canaryResponseDigestB64u
        : null,
  };
}

function StatusValue(props: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <div className="tenant-deployment-status-value">
      <dt>{props.label}</dt>
      <dd>{props.value || 'Unavailable'}</dd>
    </div>
  );
}

function assertNeverStatus(status: never): never {
  throw new Error(`Unexpected deployment status: ${status}`);
}

function DeploymentStatusNotice({
  status,
}: {
  readonly status: DeploymentStatus;
}): React.JSX.Element | null {
  switch (status.kind) {
    case 'loading':
      return <p role="status">Loading deployment evidence…</p>;
    case 'error':
      return <p role="alert">{status.message}</p>;
    case 'unavailable':
      return (
        <section className="tenant-deployment-section" aria-label="Deployment unavailable">
          <h2>Deployment unavailable</h2>
          <p>The gateway cannot serve a verified deployment.</p>
          <p>
            Selected environment: <code>{status.environmentId}</code>
          </p>
          <p>Ask an operator to check activation, deployment data, and gateway configuration.</p>
        </section>
      );
    case 'environment_mismatch':
      return (
        <section className="tenant-deployment-section" aria-label="Gateway environment mismatch">
          <h2>Gateway environment mismatch</h2>
          <p>
            This gateway serves a different environment. Ask an operator to check the deployment
            assignment.
          </p>
          <p>
            Selected environment: <code>{status.environmentId}</code>
          </p>
          <p>
            Active environment: <code>{status.activeEnvironmentId}</code>
          </p>
        </section>
      );
    case 'ready':
      return null;
    default:
      return assertNeverStatus(status);
  }
}

function incrementRefreshSequence(sequence: number): number {
  return sequence + 1;
}

export function TenantDeploymentPage(): React.JSX.Element {
  const session = useDashboardConsoleSession();
  const selectedContext = useDashboardSelectedContext();
  const selectedContextDisplay = useDashboardSelectedContextDisplay();
  const [status, setStatus] = React.useState<DeploymentStatus>({ kind: 'loading' });
  const [refreshSequence, refresh] = React.useReducer(incrementRefreshSequence, 0);
  const isOwner = session.claims?.role === 'OWNER';

  React.useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    setStatus({ kind: 'loading' });
    void loadDeploymentStatus({
      projectId: selectedContext.project,
      environmentId: selectedContext.environment,
    })
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Deployment status is unavailable.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner, selectedContext.environment, selectedContext.project, refreshSequence]);

  if (!session.claims || !isOwner) {
    return (
      <section className="dashboard-page tenant-deployment-page">
        <h1>Deployment status</h1>
        <p role="alert">Only organization owners can view deployment status and audit evidence.</p>
      </section>
    );
  }

  return (
    <section className="dashboard-page tenant-deployment-page">
      <header className="tenant-deployment-header">
        <p className="tenant-deployment-eyebrow">Owner view</p>
        <h1>Deployment status</h1>
        <p>
          Read-only evidence for {selectedContextDisplay.project} ·{' '}
          {selectedContextDisplay.environment}. Cutovers run from the protected repository workflow.
        </p>
      </header>

      <DashboardPageActions>
        <button
          type="button"
          className="dashboard-pagination-button dashboard-pagination-button--secondary"
          onClick={refresh}
          disabled={status.kind === 'loading'}
        >
          Refresh deployment status
        </button>
      </DashboardPageActions>
      <LiveWalletAccessControl
        key={JSON.stringify([session.claims.orgId, selectedContext.project])}
        organizationId={session.claims.orgId}
        projectId={selectedContext.project}
      />
      <DeploymentStatusNotice status={status} />
      {status.kind === 'ready' ? (
        <>
          <div className="tenant-deployment-summary">
            <span className="tenant-deployment-summary-icon">
              <CircleCheck size={20} aria-hidden="true" />
            </span>
            <div>
              <strong>Active and verified</strong>
              <span>{status.revision}</span>
            </div>
          </div>
          <section className="tenant-deployment-section" aria-labelledby="binding-status-title">
            <div className="tenant-deployment-section-heading">
              <span>
                <ShieldCheck size={18} aria-hidden="true" />
              </span>
              <div>
                <h2 id="binding-status-title">Immutable binding</h2>
                <p>The active tenant identity, origins, and canary receipt are audit-only here.</p>
              </div>
            </div>
            <dl className="tenant-deployment-status-grid">
              <StatusValue label="Environment ID" value={status.environmentId} />
              <StatusValue label="Mode" value={status.mode} />
              <StatusValue label="Application origin" value={status.applicationOrigin} />
              <StatusValue label="Hosted wallet origin" value={status.hostedWalletOrigin} />
              <StatusValue label="Gateway origin" value={status.gatewayOrigin} />
              <StatusValue label="Passkey relying party" value={status.relyingPartyId} />
              <StatusValue
                label="Activation"
                value={
                  status.activatedAt && status.activationSequence
                    ? `#${status.activationSequence} · ${status.activatedAt}`
                    : ''
                }
              />
              <StatusValue label="Canary receipt digest" value={status.canaryDigest ?? ''} />
            </dl>
          </section>
        </>
      ) : null}
    </section>
  );
}

export default TenantDeploymentPage;
