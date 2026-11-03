import React from 'react';
import { t } from '@core/i18n';
import {
  buildConsoleAcceptHeaders,
  buildConsoleJsonHeaders,
  requireConsoleBaseUrl,
  parseConsoleJson,
} from '../../consoleHttp';
import { formatUsdMinor } from './consoleBillingApi';

type MonthlyInvoice = {
  readonly month: string;
  readonly amount: number;
  readonly status: string;
  readonly url: string | null;
};
type PaymentAccount =
  | { readonly kind: 'prepaid' }
  | {
      readonly kind: 'postpaid';
      readonly limit: number;
      readonly unpaid: number;
      readonly held: number;
      readonly available: number;
      readonly grace: string | null;
      readonly blocked: boolean;
      readonly invoices: readonly MonthlyInvoice[];
    };
type PanelState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly account: PaymentAccount; readonly message: string };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid billing response');
  return value as Record<string, unknown>;
}
function amount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error('Invalid billing amount');
  return value;
}
function invoice(raw: unknown): MonthlyInvoice {
  const row = record(raw);
  if (typeof row.monthUtc !== 'string' || typeof row.kind !== 'string')
    throw new Error('Invalid monthly invoice');
  const url = row.hostedInvoiceUrl;
  if (url !== null && (typeof url !== 'string' || !url.startsWith('https://invoice.stripe.com/')))
    throw new Error('Invalid Stripe invoice link');
  return { month: row.monthUtc, status: row.kind, amount: amount(row.amountMinor), url };
}
function accountFromResponse(raw: unknown): PaymentAccount {
  const body = record(raw);
  if (body.ok !== true)
    throw new Error(typeof body.message === 'string' ? body.message : t('billingRequestFailed'));
  const account = record(body.account);
  const policy = record(account.policy);
  if (policy.kind === 'prepaid') return { kind: 'prepaid' };
  if (policy.kind !== 'postpaid' || !Array.isArray(account.invoices))
    throw new Error('Invalid billing account');
  const exposure = record(account.exposure);
  const grace = exposure.graceDeadlineAt;
  if (
    (grace !== null && typeof grace !== 'string') ||
    typeof exposure.collectionBlocked !== 'boolean'
  )
    throw new Error('Invalid payment recovery state');
  return {
    kind: 'postpaid',
    limit: amount(policy.creditLimitMinor),
    unpaid: amount(exposure.unpaidMinor),
    held: amount(exposure.reservedMinor),
    available: amount(exposure.availableCreditMinor),
    grace,
    blocked: exposure.collectionBlocked,
    invoices: account.invoices.map(invoice),
  };
}
async function refresh(setState: (state: PanelState) => void, signal: AbortSignal) {
  try {
    const response = await fetch(`${requireConsoleBaseUrl()}/console/billing/payment-account`, {
      headers: buildConsoleAcceptHeaders(),
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
    const account = accountFromResponse(await parseConsoleJson(response));
    if (!signal.aborted) setState({ kind: 'ready', account, message: '' });
  } catch (error) {
    if (!signal.aborted)
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : t('billingRequestFailed'),
      });
  }
}
function startLoad(setState: (state: PanelState) => void) {
  const controller = new AbortController();
  void refresh(setState, controller.signal);
  return controller.abort.bind(controller);
}

async function requestAction(
  path: string,
  setState: (state: PanelState) => void,
  state: Extract<PanelState, { kind: 'ready' }>,
) {
  try {
    const response = await fetch(`${requireConsoleBaseUrl()}${path}`, {
      method: 'POST',
      headers: buildConsoleJsonHeaders(),
      credentials: 'include',
      body: '{}',
    });
    const body = record(await parseConsoleJson(response));
    if (!response.ok || body.ok !== true)
      throw new Error(typeof body.message === 'string' ? body.message : t('billingActionFailed'));
    await refresh(setState, new AbortController().signal);
  } catch (error) {
    setState({
      kind: 'ready',
      account: state.account,
      message: error instanceof Error ? error.message : t('billingActionFailed'),
    });
  }
}
function renderInvoice(item: MonthlyInvoice) {
  return (
    <tr key={item.month}>
      <td>{item.month}</td>
      <td>{formatUsdMinor(item.amount)}</td>
      <td>{item.status}</td>
      <td>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            {t('billingOpenInvoiceOrPay')}
          </a>
        ) : item.status === 'carried' ? (
          t('billingCarriedToNextMonth')
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}
export function PaymentAccountPanel(props: {
  readonly canManage: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const [state, setState] = React.useState<PanelState>({ kind: 'loading' });
  React.useEffect(startLoad.bind(null, setState), []);
  if (state.kind === 'loading') return <p>{t('billingPaymentLoading')}</p>;
  if (state.kind === 'error') return <p role="alert">{state.message}</p>;
  if (state.account.kind === 'prepaid') return <>{props.children}</>;
  const account = state.account;
  return (
    <section className="dashboard-view__section" aria-label={t('billingMonthlyBilling')}>
      <h2>{t('billingMonthlyBilling')}</h2>
      <p>
        {t('billingMonthlyCreditSummary', {
          limit: formatUsdMinor(account.limit),
          unpaid: formatUsdMinor(account.unpaid),
          held: formatUsdMinor(account.held),
          available: formatUsdMinor(account.available),
        })}
      </p>
      <p>{t('billingMonthlyInvoiceNote')}</p>
      {account.grace ? (
        <p role="status">
          {t('billingGraceEnds', { time: new Date(account.grace).toLocaleString() })}
        </p>
      ) : null}
      {account.blocked ? <p role="alert">{t('billingCollectionBlocked')}</p> : null}
      {account.invoices.length ? (
        <table className="dashboard-data-table">
          <thead>
            <tr>
              <th>{t('billingColMonth')}</th>
              <th>{t('billingColAmount')}</th>
              <th>{t('billingColStatus')}</th>
              <th>{t('billingColPayment')}</th>
            </tr>
          </thead>
          <tbody>{account.invoices.map(renderInvoice)}</tbody>
        </table>
      ) : (
        <p>{t('billingNoMonthlyInvoices')}</p>
      )}
      {props.canManage ? (
        <div className="dashboard-form-actions">
          <button
            type="button"
            className="dashboard-pagination-button"
            onClick={requestAction.bind(
              null,
              '/console/billing/payment-account/reconcile',
              setState,
              state,
            )}
          >
            {t('billingRefreshPaymentStatus')}
          </button>
          <a className="dashboard-pagination-button" href="/dashboard/billing/plan">
            {t('billingManagePlan')}
          </a>
        </div>
      ) : null}
      {state.message ? <p role="status">{state.message}</p> : null}
    </section>
  );
}
