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

function handleContactSubmit(event: React.FormEvent<HTMLFormElement>): void {
  event.preventDefault();

  const formData = new FormData(event.currentTarget);
  const name = readFormValue(formData, 'name');
  const email = readFormValue(formData, 'email');
  const company = readFormValue(formData, 'company');
  const details = readFormValue(formData, 'details');
  const subject = `Sales inquiry from ${name} at ${company}`;
  const body = [`Name: ${name}`, `Work email: ${email}`, `Company: ${company}`, '', details].join(
    '\n',
  );

  window.location.assign(
    `mailto:${SALES_EMAIL_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  );
}

export function ContactPage(): React.JSX.Element {
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
