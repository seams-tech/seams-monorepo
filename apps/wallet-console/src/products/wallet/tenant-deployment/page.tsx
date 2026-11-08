import React from 'react';
import { t } from '@core/i18n';
import { CircleCheck, ShieldCheck, TriangleAlert } from 'lucide-react';
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
        throw new Error(t('walletDeployAccessRefreshFailed'));
      default:
        return assertNeverStatus(service);
    }
  }
  throw new Error(t('walletDeployAccessPreparing'));
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
        throw new Error(t('walletDeployOnlyActiveService'));
      default:
        return assertNeverStatus(service);
    }
    await waitForWalletAccess(organizationId, projectId, service);
    window.sessionStorage.removeItem(key);
    const environments = await listDashboardEnvironments({ projectId });
    const production = environments.find(isProductionEnvironment);
    if (!production || production.status === 'ARCHIVED') {
      throw new Error(t('walletDeployProductionUnavailable'));
    }
    if (production.status !== 'ACTIVE') {
      throw new Error(t('walletDeployNeedsCredit'));
    }
    window.dispatchEvent(new Event(DASHBOARD_ENVIRONMENTS_UPDATED_EVENT));
    setState({ kind: 'ready' });
  } catch (error: unknown) {
    setState({
      kind: 'error',
      message: error instanceof Error ? error.message : t('walletDeployLiveRefreshFailed'),
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
      <div className="tenant-deployment-action-row">
        <div className="tenant-deployment-section-copy">
          <h2 id="live-wallet-access-title">{t('walletDeployLiveTitle')}</h2>
          <p>{t('walletDeployLiveDescription')}</p>
        </div>
        <button
          type="button"
          className="dashboard-pagination-button dashboard-pagination-button--secondary"
          disabled={state.kind === 'pending'}
          onClick={refreshLiveWalletAccess.bind(
            null,
            props.organizationId,
            props.projectId,
            setState,
          )}
        >
          {state.kind === 'pending'
            ? t('walletDeployLiveRefreshing')
            : t('walletDeployLiveRefresh')}
        </button>
      </div>
      {state.kind === 'ready' ? (
        <p
          className="dashboard-form-alert dashboard-form-alert--notice tenant-deployment-feedback"
          role="status"
        >
          {t('walletDeployLiveEnabled')}
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p className="dashboard-form-alert tenant-deployment-feedback" role="alert">
          {state.message}
        </p>
      ) : null}
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
    throw new Error(t('walletDeployProjectionUnavailable'));
  }
  const decoded = decodeTenantDeploymentPublicProjectionV1(raw);
  if (!decoded.ok) throw new Error(t('walletDeployProjectionInvalid'));
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
      <dd>{props.value || t('walletDeployUnavailableValue')}</dd>
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
      return (
        <p className="tenant-deployment-state-note" role="status">
          {t('walletDeployLoadingEvidence')}
        </p>
      );
    case 'error':
      return (
        <p className="dashboard-form-alert" role="alert">
          {status.message}
        </p>
      );
    case 'unavailable':
      return (
        <section
          className="tenant-deployment-section"
          aria-label={t('walletDeployUnavailableTitle')}
        >
          <div className="tenant-deployment-section-heading">
            <span className="tenant-deployment-section-icon tenant-deployment-section-icon--warning">
              <TriangleAlert size={18} aria-hidden="true" />
            </span>
            <div className="tenant-deployment-section-copy">
              <h2>{t('walletDeployUnavailableTitle')}</h2>
              <p>{t('walletDeployUnavailableGateway')}</p>
            </div>
          </div>
          <dl className="tenant-deployment-status-grid tenant-deployment-status-grid--single">
            <StatusValue
              label={t('walletDeploySelectedEnvironment')}
              value={status.environmentId}
            />
          </dl>
          <p className="tenant-deployment-section-footnote">{t('walletDeployUnavailableAsk')}</p>
        </section>
      );
    case 'environment_mismatch':
      return (
        <section className="tenant-deployment-section" aria-label={t('walletDeployMismatchTitle')}>
          <div className="tenant-deployment-section-heading">
            <span className="tenant-deployment-section-icon tenant-deployment-section-icon--warning">
              <TriangleAlert size={18} aria-hidden="true" />
            </span>
            <div className="tenant-deployment-section-copy">
              <h2>{t('walletDeployMismatchTitle')}</h2>
              <p>{t('walletDeployMismatchBody')}</p>
            </div>
          </div>
          <dl className="tenant-deployment-status-grid">
            <StatusValue
              label={t('walletDeploySelectedEnvironment')}
              value={status.environmentId}
            />
            <StatusValue
              label={t('walletDeployActiveEnvironment')}
              value={status.activeEnvironmentId}
            />
          </dl>
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
            message: error instanceof Error ? error.message : t('walletDeployStatusUnavailable'),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner, selectedContext.environment, selectedContext.project, refreshSequence]);

  if (!session.claims || !isOwner) {
    return (
      <section className="dashboard-view tenant-deployment-page">
        <p className="dashboard-form-alert" role="alert">
          {t('walletDeployOwnersOnly')}
        </p>
      </section>
    );
  }

  return (
    <section className="dashboard-view tenant-deployment-page">
      <p className="tenant-deployment-lead">
        {t('walletDeployReadOnly', {
          project: selectedContextDisplay.project,
          environment: selectedContextDisplay.environment,
        })}
      </p>

      <DashboardPageActions>
        <button
          type="button"
          className="dashboard-pagination-button dashboard-pagination-button--secondary"
          onClick={refresh}
          disabled={status.kind === 'loading'}
        >
          {t('walletDeployRefresh')}
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
              <strong>{t('walletDeployActiveVerified')}</strong>
              <span>{status.revision}</span>
            </div>
          </div>
          <section className="tenant-deployment-section" aria-labelledby="binding-status-title">
            <div className="tenant-deployment-section-heading">
              <span className="tenant-deployment-section-icon">
                <ShieldCheck size={18} aria-hidden="true" />
              </span>
              <div className="tenant-deployment-section-copy">
                <h2 id="binding-status-title">{t('walletDeployBindingTitle')}</h2>
                <p>{t('walletDeployBindingDescription')}</p>
              </div>
            </div>
            <dl className="tenant-deployment-status-grid">
              <StatusValue label={t('walletDeployEnvironmentId')} value={status.environmentId} />
              <StatusValue label={t('walletDeployMode')} value={status.mode} />
              <StatusValue
                label={t('walletDeployApplicationOrigin')}
                value={status.applicationOrigin}
              />
              <StatusValue
                label={t('walletDeployHostedWalletOrigin')}
                value={status.hostedWalletOrigin}
              />
              <StatusValue label={t('walletDeployGatewayOrigin')} value={status.gatewayOrigin} />
              <StatusValue label={t('walletDeployRelyingParty')} value={status.relyingPartyId} />
              <StatusValue
                label={t('walletDeployActivation')}
                value={
                  status.activatedAt && status.activationSequence
                    ? `#${status.activationSequence} · ${status.activatedAt}`
                    : ''
                }
              />
              <StatusValue
                label={t('walletDeployCanaryDigest')}
                value={status.canaryDigest ?? ''}
              />
            </dl>
          </section>
        </>
      ) : null}
    </section>
  );
}

export default TenantDeploymentPage;
