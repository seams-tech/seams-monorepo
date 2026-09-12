import React from 'react';

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
            Verification: <strong>{value === 'passkey' ? 'Passkey' : 'Authenticator app'}</strong>
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
          {action === null ? 'Change' : action.label}
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
        <h2 id={`${id}-title`}>Verify your identity</h2>
        <fieldset className="derivation-root-policy-options" disabled={disabled}>
          <legend>Verification method</legend>
          <label className="derivation-root-policy-choice">
            <input
              type="radio"
              name={id}
              checked={value === 'passkey'}
              onChange={onChange.bind(null, 'passkey')}
            />
            <span>
              <strong>Passkey</strong>
              <span>Use your device or security key.</span>
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
              <strong>Authenticator app · Coming soon</strong>
              <span>Verify with a six-digit code.</span>
            </span>
          </label>
        </fieldset>
        <p id={`${id}-help`} role="status">
          {value === 'passkey'
            ? 'Your browser will prompt you to verify. If you need a passkey, it will guide you through setup first.'
            : 'Authenticator verification is not available yet. Select Passkey to continue.'}
        </p>
        <div className="derivation-root-modal-actions">
          {action !== null && (
            <button
              type="button"
              className="dashboard-pagination-button"
              onClick={closeVerificationDialog.bind(null, dialogRef)}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--primary"
            disabled={disabled || (action !== null && value !== 'passkey')}
            onClick={confirmVerification.bind(null, dialogRef, action)}
          >
            {action === null ? 'Done' : action.confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
