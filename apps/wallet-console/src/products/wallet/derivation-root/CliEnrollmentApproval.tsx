import React from 'react';
import { t } from '@core/i18n';
import { requireConsoleBaseUrl } from '@core/dashboard/consoleHttp';
import { buildWalletAcceptHeaders, buildWalletJsonHeaders } from '../consoleWalletHttp';
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
    throw new Error(t('derivationEnrollParseRead'));
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
        throw new Error(t('derivationEnrollParseInvalid'));
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
      throw new Error(t('derivationEnrollParseState'));
  }
}
async function loadEnrollment(
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
      headers: buildWalletJsonHeaders(),
      body: JSON.stringify({ id: details.id }),
    });
    if (!response.ok) throw new Error(t('derivationEnrollApprovalFailed'));
    setState(parseState(await response.json()));
  } catch (error) {
    setState({
      kind: 'error',
      message: error instanceof Error ? error.message : t('derivationApprovalFailedFallback'),
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
      aria-label={t('derivationApproveTerminalEnrollment')}
    >
      <h2>
        {state.kind === 'completed'
          ? t('derivationWrapperConnected')
          : t('derivationWrapperEnrollment')}
      </h2>
      {state.kind === 'pending' || state.kind === 'submitting' ? (
        <>
          <p>{t('derivationEnrollCompare')}</p>
          <div className="derivation-root-enrollment-details">
            <div className="derivation-root-enrollment-code">
              <span>{t('derivationConfirmationCode')}</span>
              <strong>
                <code>{state.details.confirmationCode}</code>
              </strong>
            </div>
            <dl className="derivation-root-enrollment-fields">
              <div>
                <dt>{t('derivationOrganization')}</dt>
                <dd>{state.details.organizationId}</dd>
              </div>
              <div>
                <dt>{t('derivationEnvironment')}</dt>
                <dd>{state.details.environmentId}</dd>
              </div>
              <div>
                <dt>{t('derivationHolder')}</dt>
                <dd>{state.details.role === 'deriver_a' ? 'Deriver A' : 'Deriver B'}</dd>
              </div>
              <div className="derivation-root-enrollment-field-wide">
                <dt>{t('derivationKeyFingerprint')}</dt>
                <dd>
                  <code>{state.details.fingerprintB64u}</code>
                </dd>
              </div>
              <div className="derivation-root-enrollment-field-wide">
                <dt>{t('derivationPublicWrapperKey')}</dt>
                <dd>
                  <code>{state.details.publicKeyB64u}</code>
                </dd>
              </div>
            </dl>
          </div>
          <p className="derivation-root-enrollment-help">{t('derivationEnrollPrivateStays')}</p>
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
                    : t('derivationApproveEnrollment'),
                confirmLabel: t('derivationVerifyAndApprove'),
                onConfirm: approveEnrollment.bind(null, 'approve', state.details, setState),
              }}
            />
            <button
              type="button"
              className="dashboard-pagination-button"
              disabled={state.kind === 'submitting'}
              onClick={approveEnrollment.bind(null, 'deny', state.details, setState)}
            >
              {t('derivationDeny')}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="dashboard-pagination-button derivation-root-enrollment-refresh"
          disabled={state.kind === 'submitting'}
          onClick={loadEnrollment.bind(null, id, setState)}
        >
          {t('derivationRefreshRequest')}
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
      return t('derivationLoadingRequest');
    case 'error':
      return state.message;
    case 'approved':
      return t('derivationEnrollApproved');
    case 'denied':
      return t('derivationRequestDenied');
    case 'expired':
      return t('derivationEnrollExpired');
    case 'completed':
      return t('derivationWrapperEnrolled');
  }
}
