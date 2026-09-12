import React from 'react';
import { requireConsoleBaseUrl } from '@core/dashboard/consoleHttp';
import { verifyCustodyStepUp } from './consoleDerivationRootApi';

type Details = {
  id: string;
  confirmationCode: string;
  organizationId: string;
  environmentId: string;
  destination: string;
};
type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'pending' | 'submitting'; details: Details }
  | { kind: 'approved' | 'active' | 'denied' | 'expired' };
const path = '/console/tenant-root/security/restore-access';
function parseState(value: unknown): State {
  if (typeof value !== 'object' || value === null || !('state' in value))
    throw new Error('Unable to read restore approval');
  switch (value.state) {
    case 'approved':
      return {
        kind: 'restoration' in value && value.restoration === 'active' ? 'active' : 'approved',
      };
    case 'denied':
      return { kind: 'denied' };
    case 'expired':
      return { kind: 'expired' };
    case 'pending': {
      if (
        !('id' in value) ||
        typeof value.id !== 'string' ||
        !('confirmationCode' in value) ||
        typeof value.confirmationCode !== 'string' ||
        !('organizationId' in value) ||
        typeof value.organizationId !== 'string' ||
        !('environmentId' in value) ||
        typeof value.environmentId !== 'string' ||
        !('destination' in value) ||
        typeof value.destination !== 'string'
      )
        throw new Error('Invalid restore approval');
      return {
        kind: 'pending',
        details: {
          id: value.id,
          confirmationCode: value.confirmationCode,
          organizationId: value.organizationId,
          environmentId: value.environmentId,
          destination: value.destination,
        },
      };
    }
    default:
      throw new Error('Invalid restore approval state');
  }
}
async function load(id: string, setState: React.Dispatch<React.SetStateAction<State>>) {
  try {
    const response = await fetch(
      `${requireConsoleBaseUrl()}${path}/request?id=${encodeURIComponent(id)}`,
      { credentials: 'include' },
    );
    if (!response.ok)
      throw new Error(
        'Select the organization and environment used in your terminal, then try again.',
      );
    setState(parseState(await response.json()));
  } catch (error) {
    setState({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Unable to read request',
    });
  }
}
async function decide(
  action: 'approve' | 'deny',
  details: Details,
  setState: React.Dispatch<React.SetStateAction<State>>,
) {
  setState({ kind: 'submitting', details });
  try {
    await verifyCustodyStepUp();
    const response = await fetch(`${requireConsoleBaseUrl()}${path}/${action}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: details.id }),
    });
    if (!response.ok) {
      const failure: unknown = await response.json();
      throw new Error(restoreApprovalError(failure));
    }
    setState(parseState(await response.json()));
  } catch (error) {
    setState({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Approval failed',
    });
  }
}
function begin(id: string, setState: React.Dispatch<React.SetStateAction<State>>): void {
  void load(id, setState);
}
function message(state: State): string {
  switch (state.kind) {
    case 'loading':
      return 'Loading restore request…';
    case 'error':
      return state.message;
    case 'active':
      return 'Recovery completed successfully. The destination confirms your restored root is active.';
    case 'approved':
      return 'Restore access approved. Return to your terminal to continue.';
    case 'denied':
      return 'Restore access denied.';
    case 'expired':
      return 'Request expired. Run the CLI command again.';
    case 'pending':
    case 'submitting':
      return '';
  }
}
export function CliRestoreApproval({ id }: { id: string }) {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const titleId = React.useId();
  // Effect bodies are standalone to keep the component readable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(openRestoreDialog.bind(null, dialogRef), []);
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(begin.bind(null, id, setState), [id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(pollApprovedRestore.bind(null, state.kind, id, setState), [state.kind, id]);
  return (
    <dialog
      ref={dialogRef}
      className="derivation-root-verification-dialog derivation-root-backup-dialog derivation-root-restore-approval"
      aria-labelledby={titleId}
      onClose={dismissRestoreApproval}
    >
      <div className="derivation-root-backup-header">
        <h2 id={titleId}>Approve restore access</h2>
        <button
          type="button"
          className="dashboard-pagination-button derivation-root-backup-close"
          aria-label="Close restore approval"
          onClick={closeRestoreDialog.bind(null, dialogRef)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      {state.kind === 'pending' || state.kind === 'submitting' ? (
        <>
          <p className="derivation-root-enrollment-help">
            Compare this code with Terminal. Approve only if you started this restore.
          </p>
          <div className="derivation-root-enrollment-details">
            <div className="derivation-root-enrollment-code">
              <span>Confirmation code</span>
              <strong>
                <code>{state.details.confirmationCode}</code>
              </strong>
            </div>
            <dl className="derivation-root-enrollment-fields derivation-root-backup-fields">
              <div>
                <dt>Organization</dt>
                <dd>{state.details.organizationId}</dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{state.details.environmentId}</dd>
              </div>
              <div className="derivation-root-enrollment-field-wide">
                <dt>Recovery destination</dt>
                <dd>
                  <code>{state.details.destination}</code>
                </dd>
              </div>
            </dl>
          </div>
          <p className="derivation-root-enrollment-help">
            Grant temporary restore access with your passkey. Your private wrapper keys stay on your
            device.
          </p>
          <div className="derivation-root-enrollment-footer">
            <div className="derivation-root-restore-approval-actions">
              <button
                type="button"
                className="dashboard-pagination-button"
                disabled={state.kind === 'submitting'}
                onClick={decide.bind(null, 'deny', state.details, setState)}
              >
                Deny
              </button>
              <button
                type="button"
                className="dashboard-pagination-button dashboard-pagination-button--primary"
                disabled={state.kind === 'submitting'}
                onClick={decide.bind(null, 'approve', state.details, setState)}
              >
                {state.kind === 'submitting' ? 'Verifying…' : 'Approve restore'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <p
          role="status"
          className={state.kind === 'active' ? 'derivation-root-restore-success' : undefined}
        >
          {state.kind === 'active' && '✓ '}
          {message(state)}
        </p>
      )}
      {state.kind === 'error' && (
        <button
          type="button"
          className="dashboard-pagination-button"
          onClick={load.bind(null, id, setState)}
        >
          Try again
        </button>
      )}
    </dialog>
  );
}

function openRestoreDialog(ref: React.RefObject<HTMLDialogElement | null>): void {
  ref.current?.showModal();
}
function closeRestoreDialog(ref: React.RefObject<HTMLDialogElement | null>): void {
  ref.current?.close();
}
function dismissRestoreApproval(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('cliRestore');
  window.history.replaceState(window.history.state, '', url);
}

function restoreApprovalError(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('code' in value)) {
    return 'Unable to approve restore access. Try again.';
  }
  switch (value.code) {
    case 'restore_destination_connection_failed':
      return 'The console could not connect securely to the recovery destination. Check that it is running and its HTTPS certificate is trusted, then try again. (restore_destination_connection_failed)';
    case 'restore_destination_identity_mismatch':
      return 'The destination belongs to a different environment. Check the configured recovery destination.';
    case 'restore_destination_redirect_refused':
      return 'The recovery destination redirected the request. Configure its direct HTTPS address; restore credentials cannot be forwarded. (restore_destination_redirect_refused)';
    case 'restore_destination_credential_rejected':
      return 'The destination rejected the console’s restore credential. Update the destination access configuration before retrying. (restore_destination_credential_rejected)';
    case 'restore_destination_invalid_response':
      return 'The destination returned an invalid restore session. Check that the destination runs the matching console version. (restore_destination_invalid_response)';
    case 'restore_destination_unavailable':
      return `The recovery destination returned HTTP ${'destinationStatus' in value && typeof value.destinationStatus === 'number' ? value.destinationStatus : 'error'}. Check the destination service before retrying. (restore_destination_unavailable)`;
    case 'step_up_required':
      return 'Verify your identity again to approve this restore.';
    default:
      return 'Unable to approve restore access. Try again.';
  }
}

function pollApprovedRestore(
  kind: State['kind'],
  id: string,
  setState: React.Dispatch<React.SetStateAction<State>>,
): (() => void) | undefined {
  if (kind !== 'approved') return;
  const interval = window.setInterval(load.bind(null, id, setState), 3000);
  return window.clearInterval.bind(window, interval);
}
