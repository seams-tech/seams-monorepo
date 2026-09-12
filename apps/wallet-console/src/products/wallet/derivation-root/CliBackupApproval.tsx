import React from 'react';
import { requireConsoleBaseUrl } from '@core/dashboard/consoleHttp';
import { VerificationMethodChoice, type VerificationMethod } from './VerificationMethodChoice';
import { verifyCustodyStepUp } from './consoleDerivationRootApi';

type RequestDetails = {
  id: string;
  recoverySetId: string;
  environmentId: string;
  organizationId: string;
  confirmationCode: string;
};
type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'pending'; details: RequestDetails }
  | { kind: 'submitting'; details: RequestDetails }
  | { kind: 'approved' }
  | { kind: 'denied' }
  | { kind: 'expired' };
const path = '/console/tenant-root/security/backup-access';
function parseState(value: unknown): State {
  if (typeof value !== 'object' || value === null || !('state' in value))
    throw new Error('Unable to read backup download request');
  switch (value.state) {
    case 'approved':
      return { kind: 'approved' };
    case 'denied':
      return { kind: 'denied' };
    case 'expired':
      return { kind: 'expired' };
    case 'pending': {
      if (
        !('organizationId' in value) ||
        typeof value.organizationId !== 'string' ||
        !('id' in value) ||
        typeof value.id !== 'string' ||
        !('environmentId' in value) ||
        typeof value.environmentId !== 'string' ||
        !('confirmationCode' in value) ||
        typeof value.confirmationCode !== 'string' ||
        !('recoverySetId' in value) ||
        typeof value.recoverySetId !== 'string'
      )
        throw new Error('Invalid backup download request');
      return {
        kind: 'pending',
        details: {
          id: value.id,
          recoverySetId: value.recoverySetId,
          environmentId: value.environmentId,
          organizationId: value.organizationId,
          confirmationCode: value.confirmationCode,
        },
      };
    }
    default:
      throw new Error('Invalid backup download state');
  }
}
async function loadBackup(
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
async function approveBackup(
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
    if (!response.ok)
      throw new Error(
        'Approval failed. Close this dialog and reopen the link from Terminal to try again.',
      );
    setState(parseState(await response.json()));
  } catch (error) {
    setState({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Approval failed',
    });
  }
}
export function CliBackupApproval({ id }: { id: string }) {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const titleId = React.useId();
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [verificationMethod, setVerificationMethod] = React.useState<VerificationMethod>('passkey');
  // Effect bodies are standalone to keep the component readable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(loadApprovalEffect.bind(null, id, setState), [id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(openBackupDialog.bind(null, dialogRef), []);
  return (
    <dialog
      ref={dialogRef}
      className="derivation-root-verification-dialog derivation-root-backup-dialog"
      aria-labelledby={titleId}
      onClose={dismissBackupApproval}
    >
      <div className="derivation-root-backup-header">
        <h2 id={titleId}>Approve recovery download</h2>
        <button
          type="button"
          className="dashboard-pagination-button derivation-root-backup-close"
          aria-label="Close recovery download"
          onClick={closeBackupDialog.bind(null, dialogRef)}
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
          <p>Compare this code with Terminal. Approve only if you requested this download.</p>
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
                <dt>Recovery set</dt>
                <dd>
                  <code>{state.details.recoverySetId}</code>
                </dd>
              </div>
            </dl>
          </div>
          <p>
            The CLI downloads this backup. Your private wrapper keys and ZIP password stay in
            Terminal.
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
                label: state.kind === 'submitting' ? 'Verifying…' : 'Approve download',
                confirmLabel: 'Verify and approve',
                onConfirm: approveBackup.bind(null, 'approve', state.details, setState),
              }}
            />
            <button
              type="button"
              className="dashboard-pagination-button"
              disabled={state.kind === 'submitting'}
              onClick={approveBackup.bind(null, 'deny', state.details, setState)}
            >
              Deny
            </button>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
function openBackupDialog(ref: React.RefObject<HTMLDialogElement | null>): void {
  ref.current?.showModal();
}
function closeBackupDialog(ref: React.RefObject<HTMLDialogElement | null>): void {
  ref.current?.close();
}
function dismissBackupApproval(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('cliBackup');
  window.history.replaceState(window.history.state, '', url);
}
function loadApprovalEffect(
  id: string,
  setState: React.Dispatch<React.SetStateAction<State>>,
): void {
  void loadBackup(id, setState);
}
function approvalMessage(state: Exclude<State, { kind: 'pending' | 'submitting' }>): string {
  switch (state.kind) {
    case 'loading':
      return 'Loading request…';
    case 'error':
      return state.message;
    case 'approved':
      return 'Approved. Return to Terminal to finish backup download.';
    case 'denied':
      return 'Request denied.';
    case 'expired':
      return 'Request expired. Run the recovery kit command again.';
  }
}
