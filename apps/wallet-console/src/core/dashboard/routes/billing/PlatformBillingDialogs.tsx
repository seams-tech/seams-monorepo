import React from 'react';
import { t } from '@core/i18n';
import { DashboardInlineModal } from '../../components/DashboardInlineModal';
import {
  formatUsdMinor,
  type DashboardBillingManualAdjustmentKind,
  type DashboardPlatformBillingBalance,
} from './consoleBillingApi';

export type PlatformLiveAccessState = 'BLOCKED' | 'LOW_BALANCE' | 'HEALTHY';

/* Mirrors resolveBillingLiveEnvironmentState in
   packages/wallet-console-server-ts/src/environments/readiness.ts: live
   environments need a balance above $0. */
export function resolvePlatformLiveAccessState(
  balance: DashboardPlatformBillingBalance,
): PlatformLiveAccessState {
  if (balance.creditBalanceMinor <= 0) return 'BLOCKED';
  if (balance.creditBalanceMinor <= balance.lowBalanceThresholdMinor) return 'LOW_BALANCE';
  return 'HEALTHY';
}

export function describePlatformLiveAccess(state: PlatformLiveAccessState): {
  label: string;
  tone: 'success' | 'warning' | 'danger';
} {
  if (state === 'BLOCKED') return { label: t('platformBillingBlocked'), tone: 'danger' };
  if (state === 'LOW_BALANCE') {
    return { label: t('platformBillingAllowedLow'), tone: 'warning' };
  }
  return { label: t('platformBillingAllowed'), tone: 'success' };
}

/** The refund status as people read it. A status this Console does not know shows as sent. */
export function describePlatformRefundStatus(status: string): string {
  switch (status) {
    case 'requested':
      return t('platformBillingRefundStatusRequested');
    case 'provider_pending':
      return t('platformBillingRefundStatusProviderPending');
    case 'succeeded':
      return t('platformBillingRefundStatusSucceeded');
    case 'failed':
      return t('platformBillingRefundStatusFailed');
    case 'canceled':
      return t('platformBillingRefundStatusCanceled');
    default:
      return status.replace('_', ' ');
  }
}

/** "$50.00", or "−$50.00" for a negative balance. */
export function formatBalanceUsdMinor(amountMinor: number): string {
  return amountMinor < 0 ? `−${formatUsdMinor(-amountMinor)}` : formatUsdMinor(amountMinor);
}

/** "+$50.00" or "−$50.00": the sign tells a credit from a debit. */
export function formatSignedUsdMinor(amountMinor: number): string {
  return amountMinor < 0 ? `−${formatUsdMinor(-amountMinor)}` : `+${formatUsdMinor(amountMinor)}`;
}

export function parseUsdAmountInputToMinor(input: string): number | null {
  const normalized = String(input || '').trim();
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0'), 10);
}

function formatUsdAmountInput(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

/* Fixed reasons keep the audit log consistent; the note carries the details. */
const SUPPORT_CREDIT_REASONS = [
  { code: 'correction', label: t('platformBillingReasonCorrection') },
  { code: 'platform_owner_account', label: t('platformBillingReasonPlatformOwner') },
  { code: 'incident_credit', label: t('platformBillingReasonIncident') },
  { code: 'goodwill', label: t('platformBillingReasonGoodwill') },
] as const;

const ADMIN_DEBIT_REASONS = [
  { code: 'correction', label: t('platformBillingReasonCorrection') },
  { code: 'unbilled_usage', label: t('platformBillingReasonUnbilled') },
  { code: 'account_closure', label: t('platformBillingReasonClosure') },
] as const;

const SUPPORT_CREDIT_PRESETS_MINOR = [2500, 5000, 10000] as const;

export function describePlatformAdjustmentReason(reasonCode: string | null): string | null {
  if (!reasonCode) return null;
  const known = [...SUPPORT_CREDIT_REASONS, ...ADMIN_DEBIT_REASONS].find(
    (reason) => reason.code === reasonCode,
  );
  return known ? known.label : reasonCode;
}

const PLATFORM_BILLING_REVERSAL_KEY_PREFIX = 'platform_billing_reversal:';

/* A reversal uses one idempotency key per ledger entry, so the ledger accepts
   at most one reversal of an entry, whoever submits it. */
export function platformBillingReversalKey(ledgerEntryId: string): string {
  return `${PLATFORM_BILLING_REVERSAL_KEY_PREFIX}${ledgerEntryId}`;
}

export function readPlatformBillingReversedEntryId(idempotencyKey: string | null): string | null {
  if (!idempotencyKey?.startsWith(PLATFORM_BILLING_REVERSAL_KEY_PREFIX)) return null;
  return idempotencyKey.slice(PLATFORM_BILLING_REVERSAL_KEY_PREFIX.length) || null;
}

export interface PlatformBillingReversal {
  ledgerEntryId: string;
  amountMinor: number;
}

export interface PlatformAdjustmentDialogRequest {
  kind: DashboardBillingManualAdjustmentKind;
  /** Set when the dialog reverses one manual adjustment: the amount is fixed. */
  reversal: PlatformBillingReversal | null;
}

export interface PlatformAdjustmentSubmission {
  kind: DashboardBillingManualAdjustmentKind;
  amountMinor: number;
  reasonCode: string;
  note: string;
  idempotencyKey: string;
  relatedInvoiceId?: string;
}

function createAdjustmentIdempotencyKey(
  orgId: string,
  request: PlatformAdjustmentDialogRequest,
): string {
  if (request.reversal) return platformBillingReversalKey(request.reversal.ledgerEntryId);
  return [
    'platform_billing_adjustment',
    orgId,
    request.kind,
    String(Date.now()),
    Math.random().toString(16).slice(2, 10),
  ].join(':');
}

function describeReversalNote(request: PlatformAdjustmentDialogRequest): string {
  if (!request.reversal) return '';
  const reversed = request.kind === 'support_credit' ? 'admin debit' : 'support credit';
  return `Reverses ${reversed} ${request.reversal.ledgerEntryId}.`;
}

export function PlatformAdjustmentDialog(props: {
  request: PlatformAdjustmentDialogRequest | null;
  organization: { id: string; name: string };
  balance: DashboardPlatformBillingBalance;
  onClose: () => void;
  onSubmit: (submission: PlatformAdjustmentSubmission) => Promise<void>;
}): React.JSX.Element | null {
  const { request, organization, balance, onClose, onSubmit } = props;
  if (!request) return null;
  return (
    <PlatformAdjustmentDialogBody
      key={`${request.kind}:${request.reversal?.ledgerEntryId ?? 'new'}`}
      request={request}
      organization={organization}
      balance={balance}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

function PlatformAdjustmentDialogBody(props: {
  request: PlatformAdjustmentDialogRequest;
  organization: { id: string; name: string };
  balance: DashboardPlatformBillingBalance;
  onClose: () => void;
  onSubmit: (submission: PlatformAdjustmentSubmission) => Promise<void>;
}): React.JSX.Element {
  const { request, organization, balance, onClose, onSubmit } = props;
  const isCredit = request.kind === 'support_credit';
  const reasons = isCredit ? SUPPORT_CREDIT_REASONS : ADMIN_DEBIT_REASONS;
  const titleId = React.useId();
  const descriptionId = React.useId();
  // One key per opened dialog: a second click on the same draft cannot post twice.
  const [idempotencyKey] = React.useState(() =>
    createAdjustmentIdempotencyKey(organization.id, request),
  );
  const [amountInput, setAmountInput] = React.useState(() =>
    request.reversal ? formatUsdAmountInput(request.reversal.amountMinor) : '',
  );
  // A new adjustment starts with no reason, so the audit log never records a default.
  const [reasonCode, setReasonCode] = React.useState<string>(() =>
    request.reversal ? 'correction' : '',
  );
  const [note, setNote] = React.useState(() => describeReversalNote(request));
  const [relatedInvoiceId, setRelatedInvoiceId] = React.useState('');
  const [confirmInput, setConfirmInput] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  const amountMinor = parseUsdAmountInputToMinor(amountInput);
  const isAmountValid = amountMinor != null && amountMinor > 0;
  const deltaMinor = isAmountValid ? (isCredit ? amountMinor : -amountMinor) : 0;
  const afterBalance = {
    creditBalanceMinor: balance.creditBalanceMinor + deltaMinor,
    lowBalanceThresholdMinor: balance.lowBalanceThresholdMinor,
  };
  const beforeState = resolvePlatformLiveAccessState(balance);
  const afterState = resolvePlatformLiveAccessState(afterBalance);
  const beforeAccess = describePlatformLiveAccess(beforeState);
  const afterAccess = describePlatformLiveAccess(afterState);
  const blocksLiveAccess = beforeState !== 'BLOCKED' && afterState === 'BLOCKED';
  const isConfirmed =
    isCredit || (isAmountValid && parseUsdAmountInputToMinor(confirmInput) === amountMinor);
  const canSubmit =
    isAmountValid && Boolean(reasonCode) && Boolean(note.trim()) && isConfirmed && !submitting;
  const amountLabel = isAmountValid ? formatUsdMinor(amountMinor) : '';
  const submitLabel = submitting
    ? isCredit
      ? t('platformBillingAddingCredit')
      : t('platformBillingDebiting')
    : isCredit
      ? amountLabel
        ? t('platformBillingAddAmountCredit', { amount: amountLabel })
        : t('platformBillingAddCredit')
      : amountLabel
        ? t('platformBillingDebitAmount', { amount: amountLabel })
        : t('platformBillingDebit');

  const close = React.useCallback(() => {
    if (!submitting) onClose();
  }, [onClose, submitting]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || amountMinor == null) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        kind: request.kind,
        amountMinor,
        reasonCode,
        note: note.trim(),
        idempotencyKey,
        ...(relatedInvoiceId.trim() ? { relatedInvoiceId: relatedInvoiceId.trim() } : {}),
      });
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setSubmitting(false);
    }
  };

  const title = request.reversal
    ? isCredit
      ? t('platformBillingReverseAdminDebit')
      : t('platformBillingReverseSupportCredit')
    : isCredit
      ? t('platformBillingAddCredit')
      : t('platformBillingDebitOrganization', { name: organization.name });

  return (
    <DashboardInlineModal
      isOpen
      ariaLabel={title}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      onRequestClose={close}
      className={`dashboard-platform-adjustment-dialog${isCredit ? '' : ' dashboard-platform-adjustment-dialog--danger'}`}
    >
      <div className="dashboard-platform-adjustment-dialog__heading">
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId} className="dashboard-pagination-note">
          {organization.name} · <code>{organization.id}</code>
          {isCredit ? null : <> · {t('platformBillingRemovesCredit')}</>}
        </p>
      </div>
      <form className="dashboard-billing-adjustment-form" onSubmit={submit}>
        <div className="dashboard-form-field">
          <span>{t('platformBillingAmountUsd')}</span>
          <div className="dashboard-platform-adjustment-dialog__amount">
            {isCredit && !request.reversal
              ? SUPPORT_CREDIT_PRESETS_MINOR.map((presetMinor) => (
                  <button
                    key={presetMinor}
                    type="button"
                    className="dashboard-pagination-button dashboard-platform-adjustment-dialog__preset"
                    aria-pressed={amountMinor === presetMinor}
                    onClick={() => setAmountInput(formatUsdAmountInput(presetMinor))}
                  >
                    {formatUsdMinor(presetMinor).replace('.00', '')}
                  </button>
                ))
              : null}
            <input
              className="dashboard-input"
              type="text"
              inputMode="decimal"
              aria-label={t('platformBillingAmountAria')}
              autoFocus={!request.reversal}
              readOnly={Boolean(request.reversal)}
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder={
                isCredit ? t('platformBillingOtherAmount') : t('platformBillingColAmount')
              }
            />
          </div>
          {amountInput && !isAmountValid ? (
            <p className="dashboard-form-alert">{t('platformBillingAmountInvalid')}</p>
          ) : request.reversal ? (
            <p className="dashboard-form-hint">
              {t('platformBillingReversalAmountBefore')}
              <code>{request.reversal.ledgerEntryId}</code>
              {t('platformBillingReversalAmountAfter')}
            </p>
          ) : null}
        </div>
        <label className="dashboard-form-field">
          <span>{t('platformBillingColReason')}</span>
          <select
            className="dashboard-input"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
          >
            <option value="" disabled>
              {t('platformBillingChooseReason')}
            </option>
            {reasons.map((reason) => (
              <option key={reason.code} value={reason.code}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>
        <label className="dashboard-form-field">
          <span>{t('platformBillingNote')}</span>
          <textarea
            className="dashboard-input dashboard-textarea"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('platformBillingNotePlaceholder')}
          />
        </label>
        <details className="dashboard-platform-adjustment-dialog__more">
          <summary>{t('platformBillingLinkDocument')}</summary>
          <label className="dashboard-form-field">
            <span>{t('platformBillingDocumentId')}</span>
            <input
              className="dashboard-input"
              type="text"
              value={relatedInvoiceId}
              onChange={(event) => setRelatedInvoiceId(event.target.value)}
              placeholder={t('platformBillingDocumentPlaceholder')}
            />
          </label>
        </details>
        <div
          className={`dashboard-platform-adjustment-preview dashboard-platform-adjustment-preview--${isCredit ? 'credit' : 'debit'}`}
          aria-live="polite"
        >
          <div className="dashboard-platform-adjustment-preview__row">
            <span>{t('platformBillingBalance')}</span>
            <span>
              {formatBalanceUsdMinor(balance.creditBalanceMinor)} →{' '}
              <strong>{formatBalanceUsdMinor(afterBalance.creditBalanceMinor)}</strong>
            </span>
          </div>
          <div className="dashboard-platform-adjustment-preview__row">
            <span>{t('platformBillingLiveEnvironments')}</span>
            <span>
              {beforeAccess.label} → <strong>{afterAccess.label}</strong>
            </span>
          </div>
          {blocksLiveAccess ? (
            <p className="dashboard-platform-adjustment-preview__warning">
              {t('platformBillingDebitBlocks', { name: organization.name })}
            </p>
          ) : null}
        </div>
        {isCredit ? null : (
          <label className="dashboard-form-field">
            <span>{t('platformBillingConfirmAmount')}</span>
            <input
              className="dashboard-input"
              type="text"
              inputMode="decimal"
              value={confirmInput}
              onChange={(event) => setConfirmInput(event.target.value)}
              placeholder={t('platformBillingSameAmount')}
            />
          </label>
        )}
        {error ? (
          <p className="dashboard-form-alert" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dashboard-form-actions">
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--secondary"
            onClick={close}
            disabled={submitting}
          >
            {t('platformBillingCancel')}
          </button>
          <button
            type="submit"
            className={`dashboard-pagination-button ${isCredit ? 'dashboard-pagination-button--primary' : 'dashboard-pagination-button--danger'}`}
            disabled={!canSubmit}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </DashboardInlineModal>
  );
}

export interface PlatformRefundTarget {
  purchaseId: string;
  purchasedMinor: number;
  refundableMinor: number;
}

export interface PlatformRefundSubmission {
  purchaseId: string;
  amountMinor: number;
  reason: string;
  idempotencyKey: string;
}

export function PlatformRefundDialog(props: {
  target: PlatformRefundTarget | null;
  organization: { id: string; name: string };
  onClose: () => void;
  onSubmit: (submission: PlatformRefundSubmission) => Promise<void>;
}): React.JSX.Element | null {
  const { target, organization, onClose, onSubmit } = props;
  if (!target) return null;
  return (
    <PlatformRefundDialogBody
      key={target.purchaseId}
      target={target}
      organization={organization}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

function PlatformRefundDialogBody(props: {
  target: PlatformRefundTarget;
  organization: { id: string; name: string };
  onClose: () => void;
  onSubmit: (submission: PlatformRefundSubmission) => Promise<void>;
}): React.JSX.Element {
  const { target, organization, onClose, onSubmit } = props;
  const titleId = React.useId();
  const descriptionId = React.useId();
  const [idempotencyKey] = React.useState(() =>
    [
      'platform_billing_refund',
      organization.id,
      String(Date.now()),
      Math.random().toString(16).slice(2, 10),
    ].join(':'),
  );
  const [amountInput, setAmountInput] = React.useState(() =>
    formatUsdAmountInput(target.refundableMinor),
  );
  const [reason, setReason] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const amountMinor = parseUsdAmountInputToMinor(amountInput);
  const isAmountValid =
    amountMinor != null && amountMinor > 0 && amountMinor <= target.refundableMinor;
  const canSubmit = isAmountValid && Boolean(reason.trim()) && !submitting;

  const close = React.useCallback(() => {
    if (!submitting) onClose();
  }, [onClose, submitting]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || amountMinor == null) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        purchaseId: target.purchaseId,
        amountMinor,
        reason: reason.trim(),
        idempotencyKey,
      });
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setSubmitting(false);
    }
  };

  return (
    <DashboardInlineModal
      isOpen
      ariaLabel={t('platformBillingRefundPurchase')}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      onRequestClose={close}
      className="dashboard-platform-adjustment-dialog dashboard-platform-adjustment-dialog--danger"
    >
      <div className="dashboard-platform-adjustment-dialog__heading">
        <h2 id={titleId}>{t('platformBillingRefundPurchase')}</h2>
        <p id={descriptionId} className="dashboard-pagination-note">
          {organization.name} · <code>{target.purchaseId}</code> ·{' '}
          {t('platformBillingRefundPaid', { amount: formatUsdMinor(target.purchasedMinor) })}
        </p>
      </div>
      <form className="dashboard-billing-adjustment-form" onSubmit={submit}>
        <label className="dashboard-form-field">
          <span>
            {t('platformBillingRefundAmountUpTo', { max: formatUsdMinor(target.refundableMinor) })}
          </span>
          <input
            className="dashboard-input"
            type="text"
            inputMode="decimal"
            autoFocus
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
          />
        </label>
        {amountInput && !isAmountValid ? (
          <p className="dashboard-form-alert">
            {t('platformBillingRefundAmountInvalid', {
              max: formatUsdMinor(target.refundableMinor),
            })}
          </p>
        ) : null}
        <label className="dashboard-form-field">
          <span>{t('platformBillingColReason')}</span>
          <input
            className="dashboard-input"
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('platformBillingRefundReasonPlaceholder')}
          />
        </label>
        {error ? (
          <p className="dashboard-form-alert" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dashboard-form-actions">
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--secondary"
            onClick={close}
            disabled={submitting}
          >
            {t('platformBillingCancel')}
          </button>
          <button
            type="submit"
            className="dashboard-pagination-button dashboard-pagination-button--danger"
            disabled={!canSubmit}
          >
            {submitting
              ? t('platformBillingRequestingRefund')
              : isAmountValid && amountMinor != null
                ? t('platformBillingRefundAmount', { amount: formatUsdMinor(amountMinor) })
                : t('platformBillingRefund')}
          </button>
        </div>
      </form>
    </DashboardInlineModal>
  );
}
