import React from 'react';
import { CircleCheck, ShieldCheck } from 'lucide-react';
import { useDashboardConsoleSession } from '@core/dashboard/consoleSession';
import {
  useDashboardSelectedContext,
  useDashboardSelectedContextDisplay,
} from '@core/dashboard/selectedContext';
import { listDashboardAuditEvents } from '@core/dashboard/routes/audit/consoleAuditApi';
import { getActiveFrontendDeployment } from '@core/runtime';
import './tenantDeployment.css';

type DeploymentStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
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

function textField(source: Record<string, unknown>, name: string): string {
  const value = source[name];
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function loadDeploymentStatus(input: {
  readonly projectId: string;
  readonly environmentId: string;
}): Promise<DeploymentStatus> {
  const deployment = getActiveFrontendDeployment();
  const [projectionResponse, auditEvents] = await Promise.all([
    fetch(`${deployment.relayerUrl}/.well-known/seams-tenant-deployment.json`, {
      cache: 'no-store',
    }),
    listDashboardAuditEvents({
      projectId: input.projectId,
      environmentId: input.environmentId,
      category: 'SYSTEM',
      q: 'tenant_deployment.activate',
      limit: 10,
    }),
  ]);
  const raw: unknown = await projectionResponse.json().catch(() => null);
  if (!projectionResponse.ok || !isRecord(raw)) {
    throw new Error('The active deployment projection is unavailable.');
  }
  const projection = raw;
  if (textField(projection, 'environmentId') !== input.environmentId) {
    throw new Error('This environment does not have an active deployment binding.');
  }
  const latestActivation = auditEvents.find(
    (event) => event.action === 'tenant_deployment.activate' && event.outcome === 'SUCCESS',
  );
  const metadata = latestActivation?.metadata ?? {};
  const mode = projection.mode;
  return {
    kind: 'ready',
    revision: textField(projection, 'revision'),
    environmentId: textField(projection, 'environmentId'),
    mode: isRecord(mode) ? textField(mode, 'kind') : '',
    applicationOrigin: textField(projection, 'applicationOrigin'),
    hostedWalletOrigin: textField(projection, 'hostedWalletOrigin'),
    gatewayOrigin: textField(projection, 'gatewayOrigin'),
    relyingPartyId: textField(projection, 'relyingPartyId'),
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

export function TenantDeploymentPage(): React.JSX.Element {
  const session = useDashboardConsoleSession();
  const selectedContext = useDashboardSelectedContext();
  const selectedContextDisplay = useDashboardSelectedContextDisplay();
  const [status, setStatus] = React.useState<DeploymentStatus>({ kind: 'loading' });
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
  }, [isOwner, selectedContext.environment, selectedContext.project]);

  if (!isOwner) {
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

      {status.kind === 'loading' ? <p role="status">Loading deployment evidence…</p> : null}
      {status.kind === 'error' ? <p role="alert">{status.message}</p> : null}
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
