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

function prepareMessage(form: HTMLFormElement): PreparedMessage {
  const formData = new FormData(form);
  const name = readFormValue(formData, 'name');
  const email = readFormValue(formData, 'email');
  const company = readFormValue(formData, 'company');
  const details = readFormValue(formData, 'details');
  return {
    subject: `Sales inquiry from ${name} at ${company}`,
    body: [`Name: ${name}`, `Work email: ${email}`, `Company: ${company}`, '', details].join('\n'),
  };
}

function mailtoHref(message: PreparedMessage): string {
  return `mailto:${SALES_EMAIL_ADDRESS}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;
}

type CopyTarget = 'message' | 'address';

/* The async clipboard API can be blocked, e.g. in an embedded browser; the
   older copy command still works there. */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) throw new Error('copy command failed');
  }
}

/* A mailto link does nothing when the visitor has no email app set up, and the
   page cannot detect that. So after every submit, show the prepared message
   with copy buttons as a path that always works. */
function PreparedMessageNotice({ message }: { message: PreparedMessage }): React.JSX.Element {
  const [copied, setCopied] = React.useState<CopyTarget | 'failed' | null>(null);
  const text = `To: ${SALES_EMAIL_ADDRESS}\nSubject: ${message.subject}\n\n${message.body}`;

  async function copy(target: CopyTarget): Promise<void> {
    try {
      await copyText(target === 'message' ? text : SALES_EMAIL_ADDRESS);
      setCopied(target);
    } catch {
      setCopied('failed');
    }
  }

  return (
    <div className="contact-notice" role="status">
      <p className="contact-notice__lead">
        Your message is ready. If your email app did not open, copy the message and send it to{' '}
        <a href={mailtoHref(message)}>{SALES_EMAIL_ADDRESS}</a>.
      </p>
      <pre className="contact-notice__message">{text}</pre>
      <div className="contact-notice__actions">
        <button
          type="button"
          className="h2-btn h2-btn--outline"
          onClick={() => void copy('message')}
        >
          {copied === 'message' ? 'Message copied' : 'Copy message'}
        </button>
        <button
          type="button"
          className="h2-btn h2-btn--outline"
          onClick={() => void copy('address')}
        >
          {copied === 'address' ? 'Address copied' : 'Copy address'}
        </button>
        {copied === 'failed' ? <span>Copy failed. Select the text above and copy it.</span> : null}
      </div>
    </div>
  );
}

function readContactHash(): boolean {
  return typeof window !== 'undefined' && window.location.hash === CONTACT_LINK_TARGET;
}

/* Mounted once by the app. The form opens while the URL hash is #contact, so a
   link from another site (for example https://seams.sh/#contact) opens it too. */
export function ContactModalHost(): React.JSX.Element {
  const [open, setOpen] = React.useState<boolean>(readContactHash);
  const [prepared, setPrepared] = React.useState<PreparedMessage | null>(null);
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
    if (!open) setPrepared(null);
  }, [open]);

  function handleContactSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const message = prepareMessage(event.currentTarget);
    setPrepared(message);
    window.location.assign(mailtoHref(message));
  }

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
        <button type="button" className="contact-modal__close" aria-label="Close" onClick={close}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              d="M3.5 3.5l9 9m0-9l-9 9"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <h2 id="contact-modal-title" className="h2-display contact-modal__title">
          Tell us what you are building
        </h2>
        <p className="contact-modal__copy">
          The form opens your email app with the message ready to send. You can also write to{' '}
          <a href={`mailto:${SALES_EMAIL_ADDRESS}`}>{SALES_EMAIL_ADDRESS}</a>.
        </p>

        {open ? (
          <form
            className="contact-form"
            aria-label="Contact sales form"
            onSubmit={handleContactSubmit}
          >
            <div className="contact-form__row">
              <label className="contact-form__field">
                <span className="contact-form__label">Name</span>
                <input type="text" name="name" autoComplete="name" required />
              </label>
              <label className="contact-form__field">
                <span className="contact-form__label">Work email</span>
                <input type="email" name="email" autoComplete="email" required />
              </label>
            </div>

            <label className="contact-form__field">
              <span className="contact-form__label">Company</span>
              <input type="text" name="company" autoComplete="organization" required />
            </label>

            <label className="contact-form__field">
              <span className="contact-form__label">Project details</span>
              <textarea
                name="details"
                required
                rows={5}
                placeholder="What are you building, and where can Seams help?"
              />
            </label>

            <div className="contact-form__actions">
              <button type="submit" className="h2-btn h2-btn--primary">
                Email sales
              </button>
              <span>Opens your email app</span>
            </div>

            {prepared ? <PreparedMessageNotice message={prepared} /> : null}
          </form>
        ) : null}
      </div>
    </dialog>
  );
}
