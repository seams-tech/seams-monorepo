import React from 'react';
import { createPortal } from 'react-dom';
import { useDashboardInlineModalEscape } from '../useDashboardInlineModalEscape';

interface DashboardInlineModalProps {
  isOpen: boolean;
  ariaLabel: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  onRequestClose: () => void;
  children: React.ReactNode;
  className?: string;
}

interface DashboardModalCloseButtonProps {
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
}

export function DashboardModalCloseButton({
  ariaLabel,
  onClick,
  disabled,
}: DashboardModalCloseButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="dashboard-modal__close"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
  );
}

export function DashboardInlineModal({
  isOpen,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  onRequestClose,
  children,
  className,
}: DashboardInlineModalProps): React.JSX.Element | null {
  const modalRef = React.useRef<HTMLElement | null>(null);
  const backdropClickArmedRef = React.useRef(false);
  const [portalHost, setPortalHost] = React.useState<HTMLElement | null>(null);
  const [scrollHost, setScrollHost] = React.useState<HTMLElement | null>(null);

  useDashboardInlineModalEscape({
    isOpen,
    onClose: onRequestClose,
  });

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    setPortalHost(
      (document.querySelector('.dashboard-overlay-layer') as HTMLElement | null) || document.body,
    );
    setScrollHost((document.querySelector('.dashboard-main') as HTMLElement | null) || null);
  }, []);

  React.useEffect(() => {
    backdropClickArmedRef.current = false;
    if (!isOpen || typeof document === 'undefined') return;
    const host =
      scrollHost || (document.querySelector('.dashboard-main') as HTMLElement | null) || null;
    const overlayHost =
      portalHost?.classList.contains('dashboard-overlay-layer') === true ? portalHost : null;

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousOverlayAriaHidden = overlayHost?.getAttribute('aria-hidden') ?? null;
    if (overlayHost) {
      overlayHost.classList.add('dashboard-overlay-layer--modal-open');
      overlayHost.removeAttribute('aria-hidden');
    }
    if (host) {
      host.classList.add('dashboard-main--modal-open');
    } else {
      document.body.style.overflow = 'hidden';
    }

    const focusModal = window.requestAnimationFrame(() => {
      modalRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusModal);
      if (overlayHost) {
        overlayHost.classList.remove('dashboard-overlay-layer--modal-open');
        if (previousOverlayAriaHidden === null) {
          overlayHost.removeAttribute('aria-hidden');
        } else {
          overlayHost.setAttribute('aria-hidden', previousOverlayAriaHidden);
        }
      }
      if (host) {
        host.classList.remove('dashboard-main--modal-open');
      } else {
        document.body.style.overflow = previousBodyOverflow;
      }
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus();
      }
    };
  }, [isOpen, portalHost, scrollHost]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;
  if (!portalHost) return null;

  const modalClassName = ['dashboard-modal', className].filter(Boolean).join(' ');
  const backdropClassName = [
    'dashboard-inline-modal-backdrop',
    portalHost.classList.contains('dashboard-overlay-layer')
      ? ''
      : 'dashboard-inline-modal-backdrop--self-styled',
  ]
    .filter(Boolean)
    .join(' ');

  return createPortal(
    <div
      className={backdropClassName}
      role="presentation"
      onMouseDownCapture={(event) => {
        backdropClickArmedRef.current = event.button === 0 && event.target === event.currentTarget;
      }}
      onMouseUpCapture={(event) => {
        if (event.button !== 0 || event.target !== event.currentTarget) {
          backdropClickArmedRef.current = false;
        }
      }}
      onClick={(event) => {
        const shouldClose = backdropClickArmedRef.current && event.target === event.currentTarget;
        backdropClickArmedRef.current = false;
        if (shouldClose) {
          onRequestClose();
        }
      }}
    >
      <section
        ref={modalRef}
        className={modalClassName}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>,
    portalHost,
  );
}
