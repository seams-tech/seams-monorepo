import React from 'react';

/** Public billing terms shared by the account, plan, and invoice pages. */
export function BillingRulesSection(): React.JSX.Element {
  return (
    <section className="dashboard-view__section" aria-labelledby="billing-rules-title">
      <h2 id="billing-rules-title">Billing rules</h2>
      <p>
        Projects and services share one organization billing account. Prices are in USD. Billing
        months follow the UTC calendar.
      </p>
      <details>
        <summary>Read how usage, invoices, and payment limits work</summary>
        <h3>Monthly active users</h3>
        <p>
          A production user counts after registration, sign-in, or a session refresh during the
          month. Each user identity counts once that month. Repeated logins and signatures do not
          add another MAU. A login that creates a new charge must fit the available credit. Recovery
          and key export stay available. Development environments do not count toward Wallet plan
          usage.
        </p>
        <h3>Free and paid plans</h3>
        <p>
          Free includes 300 production active users and 30,000 monthly signatures. Production
          requires a usable card after 30 days. Reaching a Free limit starts Growth when the card
          and billing account are eligible. Otherwise, new production sign-ups and signing pause.
          Recovery and key export stay available.
        </p>
        <p>
          The <a href="/dashboard/billing/plan">plan page</a> shows prices and included usage. Paid
          plans pool the signature allowance across their monthly active users. Base fees start on
          activation. The first month is prorated. Accepted charges keep their recorded price.
        </p>
        <h3>Monthly invoices</h3>
        <p>
          Monthly postpaid billing combines plan fees and usage after the month ends. Amounts below
          USD 0.50 carry forward. Late usage appears on a later invoice with its original usage
          month. Usage credits reduce a later invoice and retain their billing history.
        </p>
        <h3>Credit and reservations</h3>
        <p>
          Available credit is the approved limit minus unpaid charges and execution commitments. We
          reserve credit before paid work and replace the reservation with its final charge. If an
          execution outcome is unknown, its reservation remains until the service resolves it. A
          saved card does not grant a credit limit.
        </p>
        <h3>Failed payments</h3>
        <p>
          The first recorded payment failure starts a seven-day grace period. Credit limits still
          apply during grace. New paid work stops when grace expires or credit is exhausted.
          Replacing a card preserves the deadline and leaves existing invoices due. Use the invoice
          payment link to settle them.
        </p>
        <h3>Returning to Free</h3>
        <p>
          Request Free for the next eligible UTC month. Usage must fit the Free limits. Open
          invoices and accepted work must resolve before the transition completes. Accrued charges
          remain due, and the original card deadline remains in effect.
        </p>
        <h3>Prepaid accounts</h3>
        <p>
          Prepaid purchases add balance and produce purchase receipts. Existing prepaid history
          remains available. Moving to postpaid requires approval, a usable card, zero prepaid
          balance, and no unsettled billing obligations.
        </p>
      </details>
    </section>
  );
}
