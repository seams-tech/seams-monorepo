import React from 'react';
import { requireConsoleBaseUrl } from '@core/dashboard/consoleHttp';
import { VerificationMethodChoice, type VerificationMethod } from './VerificationMethodChoice';
import { verifyCustodyStepUp } from './consoleDerivationRootApi';

type RequestDetails = {
  id: string;
  environmentId: string;
  organizationId: string;
  role: string;
  publicKeyB64u: string;
  fingerprintB64u: string;
  confirmationCode: string;
  expiresAtMs: number;
};
type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'pending'; details: RequestDetails }
  | { kind: 'submitting'; details: RequestDetails }
  | { kind: 'approved' }
  | { kind: 'denied' }
  | { kind: 'expired' }
  | { kind: 'completed' };
const path = '/console/tenant-root/security/cli-enrollment';
function parseState(value: unknown): State {
  if (typeof value !== 'object' || value === null || !('state' in value))
    throw new Error('Unable to read enrollment request');
  switch (value.state) {
    case 'approved':
      return { kind: 'approved' };
    case 'denied':
      return { kind: 'denied' };
    case 'expired':
      return { kind: 'expired' };
    case 'completed':
      return { kind: 'completed' };
    case 'pending': {
      if (
        !('organizationId' in value) ||
        typeof value.organizationId !== 'string' ||
        !('fingerprintB64u' in value) ||
        typeof value.fingerprintB64u !== 'string' ||
        !('id' in value) ||
        typeof value.id !== 'string' ||
        !('environmentId' in value) ||
        typeof value.environmentId !== 'string' ||
        !('role' in value) ||
        typeof value.role !== 'string' ||
        !('publicKeyB64u' in value) ||
        typeof value.publicKeyB64u !== 'string' ||
        !('confirmationCode' in value) ||
        typeof value.confirmationCode !== 'string' ||
        !('expiresAtMs' in value) ||
        typeof value.expiresAtMs !== 'number'
      )
        throw new Error('Invalid enrollment request');
      return {
        kind: 'pending',
        details: {
          id: value.id,
          environmentId: value.environmentId,
          organizationId: value.organizationId,
          role: value.role,
          publicKeyB64u: value.publicKeyB64u,
          fingerprintB64u: value.fingerprintB64u,
          confirmationCode: value.confirmationCode,
          expiresAtMs: value.expiresAtMs,
        },
      };
    }
    default:
      throw new Error('Invalid enrollment state');
  }
}
async function loadEnrollment(
  id: string,
  setState: React.Dispatch<React.SetStateAction<State>>,
): Promise<void> {
  try {
    const response = await fetch(
      `${requireConsoleBaseUrl()}${path}/request?id=${encodeURIComponent(id)}`,
      { credentials: 'include' },
    );
    if (!response.ok)
      throw new Error(
        'Unable to read this request. Check that the correct organization and environment are selected.',
      );
    setState(parseState(await response.json()));
  } catch (error) {
    setState({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Unable to read request',
    });
  }
}
async function approveEnrollment(
  action: 'approve' | 'deny',
  details: RequestDetails,
  setState: React.Dispatch<React.SetStateAction<State>>,
): Promise<void> {
  setState({ kind: 'submitting', details });
  try {
    await verifyCustodyStepUp();
    const response = await fetch(`${requireConsoleBaseUrl()}${path}/${action}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: details.id }),
    });
    if (!response.ok) throw new Error('Approval failed. Refresh the request and try again.');
    setState(parseState(await response.json()));
  } catch (error) {
    setState({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Approval failed',
    });
  }
}
export function CliEnrollmentApproval({ id }: { id: string }) {
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [verificationMethod, setVerificationMethod] = React.useState<VerificationMethod>('passkey');
  // Effect bodies are standalone to keep the component readable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(loadApprovalEffect.bind(null, id, setState), [id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(pollApprovedEffect.bind(null, id, state.kind, setState), [id, state.kind]);
  return (
    <section
      className={`derivation-root-panel derivation-root-enrollment${state.kind === 'completed' ? ' derivation-root-enrollment--complete' : ''}`}
      aria-label="Approve terminal enrollment"
    >
      <h2>{state.kind === 'completed' ? 'Wrapper key connected' : 'Wrapper key enrollment'}</h2>
      {state.kind === 'pending' || state.kind === 'submitting' ? (
        <>
          <p>Compare this code with Terminal. Approve only if you started this setup.</p>
          <div className="derivation-root-enrollment-details">
            <div className="derivation-root-enrollment-code">
              <span>Confirmation code</span>
              <strong>
                <code>{state.details.confirmationCode}</code>
              </strong>
            </div>
            <dl className="derivation-root-enrollment-fields">
              <div>
                <dt>Organization</dt>
                <dd>{state.details.organizationId}</dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{state.details.environmentId}</dd>
              </div>
              <div>
                <dt>Holder</dt>
                <dd>{state.details.role === 'deriver_a' ? 'Deriver A' : 'Deriver B'}</dd>
              </div>
              <div className="derivation-root-enrollment-field-wide">
                <dt>Key fingerprint</dt>
                <dd>
                  <code>{state.details.fingerprintB64u}</code>
                </dd>
              </div>
              <div className="derivation-root-enrollment-field-wide">
                <dt>Public wrapper key</dt>
                <dd>
                  <code>{state.details.publicKeyB64u}</code>
                </dd>
              </div>
            </dl>
          </div>
          <p className="derivation-root-enrollment-help">
            Your private wrapper key stays on your computer. Approval registers this public key
            only.
          </p>
        </>
      ) : (
        <p role="status">{approvalMessage(state)}</p>
      )}
      <div className="derivation-root-enrollment-footer">
        {state.kind === 'pending' || state.kind === 'submitting' ? (
          <div className="derivation-root-enrollment-actions">
            <VerificationMethodChoice
              value={verificationMethod}
              onChange={setVerificationMethod}
              disabled={state.kind === 'submitting'}
              action={{
                label: state.kind === 'submitting' ? 'Verifying…' : 'Approve enrollment',
                confirmLabel: 'Verify and approve',
                onConfirm: approveEnrollment.bind(null, 'approve', state.details, setState),
              }}
            />
            <button
              type="button"
              className="dashboard-pagination-button"
              disabled={state.kind === 'submitting'}
              onClick={approveEnrollment.bind(null, 'deny', state.details, setState)}
            >
              Deny
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="dashboard-pagination-button derivation-root-enrollment-refresh"
          disabled={state.kind === 'submitting'}
          onClick={loadEnrollment.bind(null, id, setState)}
        >
          Refresh request
        </button>
      </div>
    </section>
  );
}
function loadApprovalEffect(
  id: string,
  setState: React.Dispatch<React.SetStateAction<State>>,
): void {
  void loadEnrollment(id, setState);
}
function pollApprovedEffect(
  id: string,
  kind: State['kind'],
  setState: React.Dispatch<React.SetStateAction<State>>,
): void | (() => void) {
  if (kind !== 'approved') return;
  const timer = window.setInterval(loadEnrollment.bind(null, id, setState), 3000);
  return window.clearInterval.bind(window, timer);
}

function approvalMessage(state: Exclude<State, { kind: 'pending' | 'submitting' }>): string {
  switch (state.kind) {
    case 'loading':
      return 'Loading request…';
    case 'error':
      return state.message;
    case 'approved':
      return 'Approved. Return to Terminal to finish enrollment.';
    case 'denied':
      return 'Request denied.';
    case 'expired':
      return 'Request expired. Run setup again using your saved key.';
    case 'completed':
      return 'Wrapper key enrolled.';
  }
}
