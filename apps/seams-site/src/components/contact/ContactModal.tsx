import { useTranslation } from '@/i18n/browser';
import type { Translate } from '@/i18n/catalog';
import { GrainField } from '@seams-internal/grain-field';
import React from 'react';
import '@/styles/h2.css';
import './ContactModal.css';

import { CONTACT_LINK_TARGET } from './contactLink';

const SALES_EMAIL_ADDRESS = 'sales@seams.sh';

function readFormValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

type PreparedMessage = {
  subject: string;
  body: string;
};

function prepareMessage(t: Translate, form: HTMLFormElement): PreparedMessage {
  const formData = new FormData(form);
  const name = readFormValue(formData, 'name');
  const email = readFormValue(formData, 'email');
  const company = readFormValue(formData, 'company');
  const details = readFormValue(formData, 'details');
  return {
    subject: t('salesSubject').replace('{name}', name).replace('{company}', company),
    body: [
      `${t('name')}: ${name}`,
      `${t('workEmail')}: ${email}`,
      `${t('companyName')}: ${company}`,
      '',
      details,
    ].join('\n'),
  };
}

function mailtoHref(message: PreparedMessage): string {
  return `mailto:${SALES_EMAIL_ADDRESS}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;
}

function readContactHash(): boolean {
  return typeof window !== 'undefined' && window.location.hash === CONTACT_LINK_TARGET;
}

function handleContactSubmit(t: Translate, event: React.FormEvent<HTMLFormElement>): void {
  event.preventDefault();
  window.location.assign(mailtoHref(prepareMessage(t, event.currentTarget)));
}

/* Mounted once by the app. The form opens while the URL hash is #contact, so a
   link from another site (for example https://seams.sh/#contact) opens it too. */
export function ContactModalHost(): React.JSX.Element {
  const t = useTranslation();
  const [open, setOpen] = React.useState<boolean>(readContactHash);
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const onChange = () => setOpen(readContactHash());
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    window.addEventListener('site:navigate', onChange as EventListener);
    // a redirect can change the URL before this listener is attached
    onChange();
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('site:navigate', onChange as EventListener);
    };
  }, []);

  const close = React.useCallback(() => {
    if (readContactHash()) {
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, '', `${pathname}${search}`);
    }
    setOpen(false);
  }, []);

  // Escape closes the dialog natively; keep the URL and the state in step
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.addEventListener('close', close);
    return () => dialog.removeEventListener('close', close);
  }, [close]);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // React does not write the autofocus attribute, so showModal() would
      // focus the close button first
      dialog.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="h2-page contact-modal"
      aria-labelledby="contact-modal-title"
      onClick={(event) => {
        // a click on the backdrop lands on the dialog element itself
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="contact-modal__panel">
        <button
          type="button"
          className="contact-modal__close"
          aria-label={t('close')}
          onClick={close}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              d="M3.5 3.5l9 9m0-9l-9 9"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className="contact-modal__intro">
          <GrainField field="teal-peach" playing={open} />
          <h2 id="contact-modal-title" className="h2-display contact-modal__title">
            {t('contactTitle')}
          </h2>
          <p className="contact-modal__copy">
            {t('contactCopy')} <a href={`mailto:${SALES_EMAIL_ADDRESS}`}>{SALES_EMAIL_ADDRESS}</a>.
          </p>
        </div>

        {open ? (
          <form
            className="contact-form"
            aria-label={t('contactForm')}
            onSubmit={handleContactSubmit.bind(null, t)}
          >
            <div className="contact-form__row">
              <label className="contact-form__field">
                <span className="contact-form__label">{t('name')}</span>
                <input type="text" name="name" autoComplete="name" required />
              </label>
              <label className="contact-form__field">
                <span className="contact-form__label">{t('workEmail')}</span>
                <input type="email" name="email" autoComplete="email" required />
              </label>
            </div>

            <label className="contact-form__field">
              <span className="contact-form__label">{t('companyName')}</span>
              <input type="text" name="company" autoComplete="organization" required />
            </label>

            <label className="contact-form__field">
              <span className="contact-form__label">{t('projectDetails')}</span>
              <textarea name="details" required rows={5} placeholder={t('projectPlaceholder')} />
            </label>

            <div className="contact-form__actions">
              <button type="submit" className="h2-btn h2-btn--primary">
                {t('emailSales')}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </dialog>
  );
}
