import React from 'react';
import { t } from '@core/i18n';

export type VerificationMethod = 'passkey' | 'authenticator';

function openVerificationDialog(ref: React.RefObject<HTMLDialogElement | null>): void {
  ref.current?.showModal();
}

function closeVerificationDialog(ref: React.RefObject<HTMLDialogElement | null>): void {
  ref.current?.close();
}

function confirmVerification(
  ref: React.RefObject<HTMLDialogElement | null>,
  action: { label: string; confirmLabel: string; onConfirm: () => void } | null,
): void {
  ref.current?.close();
  action?.onConfirm();
}

function containVerificationEscape(event: React.KeyboardEvent<HTMLDialogElement>): void {
  // Escape dismisses this choice without closing an underlying rotation dialog.
  if (event.key === 'Escape') event.stopPropagation();
}

export function VerificationMethodChoice({
  value,
  onChange,
  disabled,
  action,
}: {
  value: VerificationMethod;
  onChange: (method: VerificationMethod) => void;
  disabled: boolean;
  action: { label: string; confirmLabel: string; onConfirm: () => void } | null;
}) {
  const id = React.useId();
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  return (
    <>
      <div
        className={
          action === null
            ? 'derivation-root-verification-choice'
            : 'derivation-root-verification-action'
        }
      >
        {action === null && (
          <span>
            {t('derivationVerificationLabel')}{' '}
            <strong>
              {value === 'passkey' ? t('derivationPasskey') : t('derivationAuthenticatorApp')}
            </strong>
          </span>
        )}
        <button
          type="button"
          className="dashboard-pagination-button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-controls={`${id}-dialog`}
          onClick={openVerificationDialog.bind(null, dialogRef)}
        >
          {action === null ? t('derivationChange') : action.label}
        </button>
      </div>
      <dialog
        ref={dialogRef}
        id={`${id}-dialog`}
        className="derivation-root-verification-dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-help`}
        onKeyDown={containVerificationEscape}
      >
        <h2 id={`${id}-title`}>{t('derivationVerifyIdentity')}</h2>
        <fieldset className="derivation-root-policy-options" disabled={disabled}>
          <legend>{t('derivationVerificationMethod')}</legend>
          <label className="derivation-root-policy-choice">
            <input
              type="radio"
              name={id}
              checked={value === 'passkey'}
              onChange={onChange.bind(null, 'passkey')}
            />
            <span>
              <strong>{t('derivationPasskey')}</strong>
              <span>{t('derivationUseDeviceOrKey')}</span>
            </span>
          </label>
          <label className="derivation-root-policy-choice">
            <input
              type="radio"
              name={id}
              disabled
              checked={value === 'authenticator'}
              onChange={onChange.bind(null, 'authenticator')}
            />
            <span>
              <strong>{t('derivationAuthenticatorSoon')}</strong>
              <span>{t('derivationVerifySixDigit')}</span>
            </span>
          </label>
        </fieldset>
        <p id={`${id}-help`} role="status">
          {value === 'passkey'
            ? t('derivationPasskeyHelp')
            : t('derivationAuthenticatorUnavailable')}
        </p>
        <div className="derivation-root-modal-actions">
          {action !== null && (
            <button
              type="button"
              className="dashboard-pagination-button"
              onClick={closeVerificationDialog.bind(null, dialogRef)}
            >
              {t('derivationCancel')}
            </button>
          )}
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--primary"
            disabled={disabled || (action !== null && value !== 'passkey')}
            onClick={confirmVerification.bind(null, dialogRef, action)}
          >
            {action === null ? t('derivationDone') : action.confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
