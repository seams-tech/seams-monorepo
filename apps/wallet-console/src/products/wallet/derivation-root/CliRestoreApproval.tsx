import React from 'react';
import { t } from '@core/i18n';
import { requireConsoleBaseUrl } from '@core/dashboard/consoleHttp';
import { buildWalletAcceptHeaders, buildWalletJsonHeaders } from '../consoleWalletHttp';
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
    throw new Error(t('derivationRestoreParseRead'));
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
        throw new Error(t('derivationRestoreParseInvalid'));
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
      throw new Error(t('derivationRestoreParseState'));
  }
}
async function load(id: string, setState: React.Dispatch<React.SetStateAction<State>>) {
  try {
    const response = await fetch(
      `${requireConsoleBaseUrl()}${path}/request?id=${encodeURIComponent(id)}`,
      { credentials: 'include', headers: buildWalletAcceptHeaders() },
    );
    if (!response.ok) throw new Error(t('derivationRestoreSelectOrgEnv'));
    setState(parseState(await response.json()));
  } catch (error) {
    setState({
      kind: 'error',
      message: error instanceof Error ? error.message : t('derivationUnableToReadRequestFallback'),
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
      headers: buildWalletJsonHeaders(),
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
      message: error instanceof Error ? error.message : t('derivationApprovalFailedFallback'),
    });
  }
}
function begin(id: string, setState: React.Dispatch<React.SetStateAction<State>>): void {
  void load(id, setState);
}
function message(state: State): string {
  switch (state.kind) {
    case 'loading':
      return t('derivationLoadingRestoreRequest');
    case 'error':
      return state.message;
    case 'active':
      return t('derivationRestoreCompleted');
    case 'approved':
      return t('derivationRestoreApproved');
    case 'denied':
      return t('derivationRestoreDenied');
    case 'expired':
      return t('derivationRestoreExpired');
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
        <h2 id={titleId}>{t('derivationApproveRestoreAccess')}</h2>
        <button
          type="button"
          className="dashboard-pagination-button derivation-root-backup-close"
          aria-label={t('derivationCloseRestoreApproval')}
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
          <p className="derivation-root-enrollment-help">{t('derivationRestoreCompare')}</p>
          <div className="derivation-root-enrollment-details">
            <div className="derivation-root-enrollment-code">
              <span>{t('derivationConfirmationCode')}</span>
              <strong>
                <code>{state.details.confirmationCode}</code>
              </strong>
            </div>
            <dl className="derivation-root-enrollment-fields derivation-root-backup-fields">
              <div>
                <dt>{t('derivationOrganization')}</dt>
                <dd>{state.details.organizationId}</dd>
              </div>
              <div>
                <dt>{t('derivationEnvironment')}</dt>
                <dd>{state.details.environmentId}</dd>
              </div>
              <div className="derivation-root-enrollment-field-wide">
                <dt>{t('derivationRecoveryDestination')}</dt>
                <dd>
                  <code>{state.details.destination}</code>
                </dd>
              </div>
            </dl>
          </div>
          <p className="derivation-root-enrollment-help">{t('derivationRestoreGrantAccess')}</p>
          <div className="derivation-root-enrollment-footer">
            <div className="derivation-root-restore-approval-actions">
              <button
                type="button"
                className="dashboard-pagination-button"
                disabled={state.kind === 'submitting'}
                onClick={decide.bind(null, 'deny', state.details, setState)}
              >
                {t('derivationDeny')}
              </button>
              <button
                type="button"
                className="dashboard-pagination-button dashboard-pagination-button--primary"
                disabled={state.kind === 'submitting'}
                onClick={decide.bind(null, 'approve', state.details, setState)}
              >
                {state.kind === 'submitting'
                  ? t('derivationVerifying')
                  : t('derivationApproveRestore')}
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
          {t('derivationTryAgain')}
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
    return t('derivationRestoreUnableToApprove');
  }
  switch (value.code) {
    case 'restore_destination_connection_failed':
      return t('derivationRestoreErrConnection');
    case 'restore_destination_identity_mismatch':
      return t('derivationRestoreErrIdentity');
    case 'restore_destination_redirect_refused':
      return t('derivationRestoreErrRedirect');
    case 'restore_destination_credential_rejected':
      return t('derivationRestoreErrCredential');
    case 'restore_destination_invalid_response':
      return t('derivationRestoreErrInvalidResponse');
    case 'restore_destination_unavailable':
      return t('derivationRestoreErrUnavailable', {
        status:
          'destinationStatus' in value && typeof value.destinationStatus === 'number'
            ? value.destinationStatus
            : 'error',
      });
    case 'step_up_required':
      return t('derivationRestoreStepUp');
    default:
      return t('derivationRestoreUnableToApprove');
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
