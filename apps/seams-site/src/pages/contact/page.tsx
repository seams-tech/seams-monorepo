import React from 'react';
import { GrainField } from '@seams-internal/grain-field';
import { H2Footer } from '@/components/h2/sections';
import NavbarCompact from '@/components/Navbar/NavbarCompact';
import '@/styles/h2.css';
import './styles.css';

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

export function ContactPage(): React.JSX.Element {
  const [prepared, setPrepared] = React.useState<PreparedMessage | null>(null);

  function handleContactSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const message = prepareMessage(event.currentTarget);
    setPrepared(message);
    window.location.assign(mailtoHref(message));
  }

  return (
    <div className="h2-page">
      <NavbarCompact appearance="light" />
      <div className="h2-col">
        <main aria-labelledby="contact-page-title">
          <header className="h2-hero-simple h2-hero-simple--sage h2-hero-simple--grain">
            <div className="h2-shell">
              <GrainField field="mauve-ember" flow={1.6} />
              <h1 id="contact-page-title" className="h2-display h2-hero-simple__title">
                Tell us what you are building.
              </h1>
              <p className="h2-hero-simple__sub">
                Share some context, and we will help you plan wallets, agent access, and policy for
                your product.
              </p>
            </div>
          </header>

          <section
            className="h2-section h2-section--compact h2-rule"
            aria-labelledby="contact-form-title"
          >
            <div className="h2-shell contact-split">
              <div>
                <p className="h2-kicker contact-split__kicker">Contact sales</p>
                <h2 id="contact-form-title" className="h2-display contact-split__title">
                  Send us a message
                </h2>
                <p className="contact-split__copy">
                  The form opens your email app with the message ready to send. You can also write
                  to <a href={`mailto:${SALES_EMAIL_ADDRESS}`}>{SALES_EMAIL_ADDRESS}</a>.
                </p>
              </div>

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
            </div>
          </section>
        </main>
        <H2Footer />
      </div>
    </div>
  );
}

export default ContactPage;
