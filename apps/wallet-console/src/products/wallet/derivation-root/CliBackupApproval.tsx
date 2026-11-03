import React from 'react';
import { t } from '@core/i18n';
import { requireConsoleBaseUrl } from '@core/dashboard/consoleHttp';
import { buildWalletAcceptHeaders, buildWalletJsonHeaders } from '../consoleWalletHttp';
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
    throw new Error(t('derivationBackupParseRead'));
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
        throw new Error(t('derivationBackupParseInvalid'));
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
      throw new Error(t('derivationBackupParseState'));
  }
}
async function loadBackup(
  id: string,
  setState: React.Dispatch<React.SetStateAction<State>>,
): Promise<void> {
  try {
    const response = await fetch(
      `${requireConsoleBaseUrl()}${path}/request?id=${encodeURIComponent(id)}`,
      { credentials: 'include', headers: buildWalletAcceptHeaders() },
    );
    if (!response.ok) throw new Error(t('derivationUnableToReadThisRequest'));
    setState(parseState(await response.json()));
  } catch (error) {
    setState({
      kind: 'error',
      message: error instanceof Error ? error.message : t('derivationUnableToReadRequestFallback'),
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
      headers: buildWalletJsonHeaders(),
      body: JSON.stringify({ id: details.id }),
    });
    if (!response.ok) throw new Error(t('derivationBackupApprovalFailed'));
    setState(parseState(await response.json()));
  } catch (error) {
    setState({
      kind: 'error',
      message: error instanceof Error ? error.message : t('derivationApprovalFailedFallback'),
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
        <h2 id={titleId}>{t('derivationApproveRecoveryDownload')}</h2>
        <button
          type="button"
          className="dashboard-pagination-button derivation-root-backup-close"
          aria-label={t('derivationCloseRecoveryDownload')}
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
          <p>{t('derivationBackupCompare')}</p>
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
                <dt>{t('derivationRecoverySet')}</dt>
                <dd>
                  <code>{state.details.recoverySetId}</code>
                </dd>
              </div>
            </dl>
          </div>
          <p>{t('derivationBackupCliDownloads')}</p>
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
                label:
                  state.kind === 'submitting'
                    ? t('derivationVerifying')
                    : t('derivationApproveDownload'),
                confirmLabel: t('derivationVerifyAndApprove'),
                onConfirm: approveBackup.bind(null, 'approve', state.details, setState),
              }}
            />
            <button
              type="button"
              className="dashboard-pagination-button"
              disabled={state.kind === 'submitting'}
              onClick={approveBackup.bind(null, 'deny', state.details, setState)}
            >
              {t('derivationDeny')}
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
      return t('derivationLoadingRequest');
    case 'error':
      return state.message;
    case 'approved':
      return t('derivationBackupApproved');
    case 'denied':
      return t('derivationRequestDenied');
    case 'expired':
      return t('derivationBackupExpired');
  }
}
