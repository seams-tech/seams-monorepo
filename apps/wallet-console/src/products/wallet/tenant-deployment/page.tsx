import React from 'react';
import { CircleCheck, LoaderCircle, Rocket, TriangleAlert } from 'lucide-react';
import { getActiveFrontendDeployment } from '@core/runtime';
import {
  activateTenantDeployment,
  type TenantDeploymentCutoverInput,
  type TenantDeploymentCutoverProgress,
} from './consoleTenantDeploymentApi';
import './tenantDeployment.css';

type FormFields = {
  readonly credentialId: string;
  readonly publishableKey: string;
  readonly applicationOrigin: string;
  readonly hostedWalletOrigin: string;
  readonly gatewayOrigin: string;
  readonly relyingPartyId: string;
};

function initialFields(): FormFields {
  const deployment = getActiveFrontendDeployment();
  const hostedWalletOrigin = new URL(deployment.walletOrigin).origin;
  return {
    credentialId: '',
    publishableKey: '',
    applicationOrigin: window.location.origin,
    hostedWalletOrigin,
    gatewayOrigin: new URL(deployment.relayerUrl).origin,
    relyingPartyId: new URL(hostedWalletOrigin).hostname,
  };
}

function fieldChanged(
  setFields: React.Dispatch<React.SetStateAction<FormFields>>,
  field: keyof FormFields,
  event: React.ChangeEvent<HTMLInputElement>,
): void {
  const value = event.currentTarget.value;
  setFields((current) => ({ ...current, [field]: value }));
}

function cutoverInput(fields: FormFields): TenantDeploymentCutoverInput {
  return {
    credentialId: parseCredentialId(fields.credentialId),
    publishableKey: parsePublishableKey(fields.publishableKey),
    surfaces: {
      applicationOrigin: new URL(fields.applicationOrigin.trim()).origin,
      hostedWalletOrigin: new URL(fields.hostedWalletOrigin.trim()).origin,
      gatewayOrigin: new URL(fields.gatewayOrigin.trim()).origin,
      relyingPartyId: fields.relyingPartyId.trim(),
    },
  };
}

function parseCredentialId(value: string): `ak_${string}` {
  const normalized = value.trim();
  if (!normalized.startsWith('ak_') || normalized.length <= 3) {
    throw new Error('Use a credential ID that starts with ak_.');
  }
  return `ak_${normalized.slice(3)}`;
}

function parsePublishableKey(value: string): `pk_${string}` {
  const normalized = value.trim();
  if (!normalized.startsWith('pk_') || normalized.length <= 3) {
    throw new Error('Use a publishable key that starts with pk_.');
  }
  return `pk_${normalized.slice(3)}`;
}

function submitCutover(
  fields: FormFields,
  progress: TenantDeploymentCutoverProgress,
  setProgress: React.Dispatch<React.SetStateAction<TenantDeploymentCutoverProgress>>,
  event: React.FormEvent<HTMLFormElement>,
): void {
  event.preventDefault();
  if (progress.kind !== 'idle' && progress.kind !== 'error') return;
  void activateTenantDeployment({ cutover: cutoverInput(fields), setProgress });
}

function progressMessage(progress: TenantDeploymentCutoverProgress): string {
  switch (progress.kind) {
    case 'idle':
      return '';
    case 'verifying_passkey':
      return 'Verify your identity with a Console passkey.';
    case 'planning':
      return 'Creating the versioned deployment plan…';
    case 'preparing_tenant_root':
      return 'Verifying the active tenant root…';
    case 'draining':
      return `Pausing new registrations for ${progress.secondsRemaining} more seconds…`;
    case 'checking_readiness':
      return 'Checking the API key, origins, tenant root, and wallet runtime…';
    case 'activating':
      return 'Activating the verified deployment binding…';
    case 'complete':
      return `Deployment ${progress.bindingRevision} is active.`;
    case 'error':
      return progress.message;
  }
}

function isPending(progress: TenantDeploymentCutoverProgress): boolean {
  return !['idle', 'error', 'complete'].includes(progress.kind);
}

function statusIcon(progress: TenantDeploymentCutoverProgress): React.JSX.Element | null {
  if (progress.kind === 'idle') return null;
  if (progress.kind === 'error') return <TriangleAlert size={18} aria-hidden="true" />;
  if (progress.kind === 'complete') return <CircleCheck size={18} aria-hidden="true" />;
  return <LoaderCircle className="tenant-deployment-spinner" size={18} aria-hidden="true" />;
}

export function TenantDeploymentPage(): React.JSX.Element {
  const [fields, setFields] = React.useState<FormFields>(initialFields);
  const [progress, setProgress] = React.useState<TenantDeploymentCutoverProgress>({ kind: 'idle' });
  const deployment = getActiveFrontendDeployment();
  const pending = isPending(progress);
  const completed = progress.kind === 'complete';

  return (
    <section className="dashboard-page tenant-deployment-page">
      <header className="tenant-deployment-header">
        <p className="tenant-deployment-eyebrow">Environment operation</p>
        <h1>Tenant deployment</h1>
        <p>
          Verify and activate one immutable binding for the project, tenant root, browser key, and
          runtime surfaces.
        </p>
      </header>

      <div className="tenant-deployment-summary" aria-label="Selected environment">
        <span className="tenant-deployment-summary-icon">
          <Rocket size={20} aria-hidden="true" />
        </span>
        <div>
          <strong>
            {deployment.network === 'testnet' ? 'Development · Testnet' : 'Production · Mainnet'}
          </strong>
          <span>{deployment.consoleBaseUrl}</span>
        </div>
      </div>

      <form
        className="tenant-deployment-form"
        onSubmit={submitCutover.bind(null, fields, progress, setProgress)}
      >
        <section
          className="tenant-deployment-section"
          aria-labelledby="deployment-credential-title"
        >
          <div className="tenant-deployment-section-heading">
            <span>1</span>
            <div>
              <h2 id="deployment-credential-title">Browser credential</h2>
              <p>Use the publishable credential created for this environment.</p>
            </div>
          </div>
          <div className="tenant-deployment-field-grid">
            <label>
              <span>Credential ID</span>
              <input
                name="credentialId"
                value={fields.credentialId}
                onChange={fieldChanged.bind(null, setFields, 'credentialId')}
                placeholder="ak_dev_…"
                pattern="ak_(dev|prod)_[A-Za-z0-9_-]+"
                required
                disabled={pending || completed}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Publishable key</span>
              <input
                name="publishableKey"
                value={fields.publishableKey}
                onChange={fieldChanged.bind(null, setFields, 'publishableKey')}
                placeholder="pk_dev_…"
                pattern="pk_(dev|prod)_[A-Za-z0-9_-]+"
                required
                disabled={pending || completed}
                autoComplete="off"
              />
            </label>
          </div>
        </section>

        <section className="tenant-deployment-section" aria-labelledby="deployment-surfaces-title">
          <div className="tenant-deployment-section-heading">
            <span>2</span>
            <div>
              <h2 id="deployment-surfaces-title">Runtime surfaces</h2>
              <p>Confirm the exact origins that must agree before activation.</p>
            </div>
          </div>
          <div className="tenant-deployment-field-grid">
            <label>
              <span>Application origin</span>
              <input
                type="url"
                name="applicationOrigin"
                value={fields.applicationOrigin}
                onChange={fieldChanged.bind(null, setFields, 'applicationOrigin')}
                required
                disabled={pending || completed}
              />
            </label>
            <label>
              <span>Hosted wallet origin</span>
              <input
                type="url"
                name="hostedWalletOrigin"
                value={fields.hostedWalletOrigin}
                onChange={fieldChanged.bind(null, setFields, 'hostedWalletOrigin')}
                required
                disabled={pending || completed}
              />
            </label>
            <label>
              <span>Gateway origin</span>
              <input
                type="url"
                name="gatewayOrigin"
                value={fields.gatewayOrigin}
                onChange={fieldChanged.bind(null, setFields, 'gatewayOrigin')}
                required
                disabled={pending || completed}
              />
            </label>
            <label>
              <span>Passkey relying party ID</span>
              <input
                name="relyingPartyId"
                value={fields.relyingPartyId}
                onChange={fieldChanged.bind(null, setFields, 'relyingPartyId')}
                placeholder="test.sign.seams.sh"
                required
                disabled={pending || completed}
                autoComplete="off"
              />
            </label>
          </div>
        </section>

        <section
          className="tenant-deployment-activation"
          aria-labelledby="deployment-activation-title"
        >
          <div>
            <h2 id="deployment-activation-title">Verify and activate</h2>
            <p>
              The Console verifies your passkey, pauses new registrations, checks every dependency,
              and activates the binding atomically.
            </p>
          </div>
          <button
            type="submit"
            className="dashboard-pagination-button dashboard-pagination-button--primary"
            disabled={pending || completed}
          >
            {pending
              ? 'Activation in progress…'
              : completed
                ? 'Deployment active'
                : 'Verify passkey and activate'}
          </button>
        </section>

        <div
          className={`tenant-deployment-status tenant-deployment-status--${progress.kind}`}
          role={progress.kind === 'error' ? 'alert' : 'status'}
          aria-live={progress.kind === 'error' ? 'assertive' : 'polite'}
        >
          {statusIcon(progress)}
          <span>{progressMessage(progress)}</span>
        </div>
      </form>
    </section>
  );
}

export default TenantDeploymentPage;
