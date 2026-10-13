import React from 'react';
import { useSiteRouter } from '@core/router/useSiteRouter';
import { canDashboardManageBilling, useDashboardConsoleSession } from '../../consoleSession';
import { useDashboardSelectedContext } from '../../selectedContext';
import { BillingAccountView } from './BillingAccountView';
import { BillingUsageCostsSection } from './BillingUsageCostsSection';
import { BillingInvoiceDetailView } from './BillingInvoiceDetailView';
import { BillingInvoicesView } from './BillingInvoicesView';
import { PlatformBillingView } from './PlatformBillingView';
import { BillingAccountActivitySection } from './billingSections';
import {
  createDashboardStripeCheckoutSession,
  downloadDashboardBillingInvoicePdf,
  formatUsdMinor,
  getDashboardBillingInvoice,
  getDashboardBillingInvoiceActivity,
  getDashboardBillingOverview,
  getDashboardBillingUsageCharges,
  listDashboardBillingInvoiceLineItems,
  listDashboardBillingInvoices,
  listDashboardBillingAccountActivity,
  listDashboardBillingRefunds,
  reconcileDashboardStripeCheckoutSession,
  type DashboardBillingInvoice,
  type DashboardBillingInvoiceActivity,
  type DashboardBillingInvoiceLineItem,
  type DashboardBillingInvoiceListSummary,
  type DashboardBillingOverview,
  type DashboardBillingCostsState,
  type DashboardBillingRefund,
  type DashboardBillingAccountActivityEntry,
  type DashboardStripeCheckoutSessionRequest,
} from './consoleBillingApi';
import {
  BillingMetricsGrid,
  buildInvoicePdfFilename,
  parseBillingSubview,
  type BillingMetric,
} from './billingShared';

export interface BillingConsoleShellProps {
  defaultPath: '/dashboard/billing/account' | '/dashboard/invoices' | '/platform/billing';
}

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const ONE_DAY_MS = 86_400_000;

function billingUsagePeriod(search: string): string {
  const requested = new URLSearchParams(search).get('periodMonthUtc');
  if (requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested)) return requested;
  return new Date().toISOString().slice(0, 7);
}

function parseDateInputMs(value: string, endOfDay: boolean): number | null {
  const match = DATE_INPUT_PATTERN.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return endOfDay ? timestamp + ONE_DAY_MS - 1 : timestamp;
}

function buildAccountSummaryMetrics(overview: DashboardBillingOverview | null): BillingMetric[] {
  if (!overview) return [];
  return [
    {
      label: 'Balance',
      value: formatUsdMinor(overview.creditBalanceMinor),
      hint: 'Posted organization balance',
    },
    {
      label: 'Available balance',
      value: formatUsdMinor(overview.availableBalanceMinor),
      hint: 'Balance after reserved funds and pending refunds',
      tone: overview.availableBalanceMinor <= 0 ? 'danger' : 'success',
    },
    {
      label: 'Reserved funds',
      value: formatUsdMinor(overview.reservedMinor),
      hint: `${overview.activeReservationCount} unresolved reservation${overview.activeReservationCount === 1 ? '' : 's'}`,
    },
    {
      label: 'Pending refunds',
      value: formatUsdMinor(overview.pendingRefundMinor),
      hint: 'Funds held while refunds are processed',
    },
    {
      label: 'Recent top-ups',
      value: formatUsdMinor(overview.recentCreditPurchasedMinor),
      hint: `${overview.documentCount} billing document${overview.documentCount === 1 ? '' : 's'}`,
    },
  ];
}

function parseInvoicePeriodRange(
  periodMonthUtc: string,
): { startMs: number; endMs: number } | null {
  const match = PERIOD_MONTH_PATTERN.exec(String(periodMonthUtc || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  const startMs = Date.UTC(year, month - 1, 1);
  const endMs = Date.UTC(year, month, 1) - 1;
  return { startMs, endMs };
}

function isInvoiceOverdueAt(invoice: DashboardBillingInvoice, referenceNowMs: number): boolean {
  if (invoice.status !== 'OPEN' || !invoice.dueAt) return false;
  const dueAtMs = Date.parse(invoice.dueAt);
  if (!Number.isFinite(dueAtMs)) return false;
  return dueAtMs < referenceNowMs;
}

function buildInvoiceListSummary(
  invoices: readonly DashboardBillingInvoice[],
  referenceNowMs: number,
): DashboardBillingInvoiceListSummary {
  const openCount = invoices.filter((invoice) => invoice.status === 'OPEN').length;
  const overdueCount = invoices.filter((invoice) =>
    isInvoiceOverdueAt(invoice, referenceNowMs),
  ).length;
  const paidCount = invoices.filter((invoice) => invoice.status === 'PAID').length;
  const outstandingAmountMinor = invoices.reduce((total, invoice) => {
    return total + Math.max(invoice.amountDueMinor - invoice.amountPaidMinor, 0);
  }, 0);
  const receiptCount = invoices.filter(
    (invoice) => invoice.documentType === 'PURCHASE_RECEIPT',
  ).length;
  const statementCount = invoices.filter(
    (invoice) => invoice.documentType === 'USAGE_STATEMENT',
  ).length;
  return {
    totalCount: invoices.length,
    openCount,
    overdueCount,
    paidCount,
    outstandingAmountMinor,
    latestPeriodMonthUtc: invoices[0]?.periodMonthUtc || null,
    receiptCount,
    statementCount,
  };
}

function filterInvoices(input: {
  invoices: readonly DashboardBillingInvoice[];
  statusFilter: string;
  documentTypeFilter: string;
  periodStartDate: string;
  periodEndDate: string;
  referenceNowMs: number;
}): DashboardBillingInvoice[] {
  const periodStartMs = parseDateInputMs(input.periodStartDate, false);
  const periodEndMs = parseDateInputMs(input.periodEndDate, true);
  return input.invoices.filter((invoice) => {
    if (input.documentTypeFilter !== 'all' && invoice.documentType !== input.documentTypeFilter) {
      return false;
    }
    if (input.statusFilter === 'overdue') {
      if (!isInvoiceOverdueAt(invoice, input.referenceNowMs)) return false;
    } else if (
      input.statusFilter !== 'all' &&
      invoice.status !== input.statusFilter.toUpperCase()
    ) {
      return false;
    }
    if (periodStartMs === null && periodEndMs === null) return true;
    const periodRange = parseInvoicePeriodRange(invoice.periodMonthUtc);
    if (!periodRange) return false;
    if (periodStartMs !== null && periodRange.endMs < periodStartMs) return false;
    if (periodEndMs !== null && periodRange.startMs > periodEndMs) return false;
    return true;
  });
}

export function BillingConsoleShell(props: BillingConsoleShellProps): React.JSX.Element {
  const { defaultPath } = props;
  const session = useDashboardConsoleSession();
  const selectedContext = useDashboardSelectedContext();
  const { go } = useSiteRouter();
  const pathname = typeof window === 'undefined' ? defaultPath : window.location.pathname;
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const subview = React.useMemo(() => parseBillingSubview(pathname), [pathname]);
  const isPlatformBillingPage = pathname === '/platform/billing';
  const activeInvoiceId = subview.kind === 'invoice' ? subview.invoiceId : '';

  const [loading, setLoading] = React.useState<boolean>(true);
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [overview, setOverview] = React.useState<DashboardBillingOverview | null>(null);
  const [costs, setCosts] = React.useState<DashboardBillingCostsState>({ kind: 'unavailable' });
  const [accountActivity, setAccountActivity] = React.useState<
    DashboardBillingAccountActivityEntry[]
  >([]);
  const [accountActivityError, setAccountActivityError] = React.useState('');

  const [invoices, setInvoices] = React.useState<DashboardBillingInvoice[]>([]);
  const [invoiceListLoading, setInvoiceListLoading] = React.useState<boolean>(false);
  const [invoiceListError, setInvoiceListError] = React.useState<string>('');
  const [refunds, setRefunds] = React.useState<DashboardBillingRefund[]>([]);
  const [refundsLoading, setRefundsLoading] = React.useState<boolean>(false);
  const [refundsError, setRefundsError] = React.useState<string>('');

  const [startingCheckoutPackId, setStartingCheckoutPackId] = React.useState<
    DashboardStripeCheckoutSessionRequest['creditPackId'] | ''
  >('');
  const [checkoutActionError, setCheckoutActionError] = React.useState<string>('');
  const [checkoutReturnMessage, setCheckoutReturnMessage] = React.useState<string>('');
  const [billingWarningMessage, setBillingWarningMessage] = React.useState<string>('');
  const [billingWarningDismissed, setBillingWarningDismissed] = React.useState<boolean>(false);

  const [invoiceDetailLoading, setInvoiceDetailLoading] = React.useState<boolean>(false);
  const [invoiceDetailError, setInvoiceDetailError] = React.useState<string>('');
  const [invoiceDetail, setInvoiceDetail] = React.useState<DashboardBillingInvoice | null>(null);
  const [invoiceActivityLoading, setInvoiceActivityLoading] = React.useState<boolean>(false);
  const [invoiceActivityError, setInvoiceActivityError] = React.useState<string>('');
  const [invoiceActivity, setInvoiceActivity] =
    React.useState<DashboardBillingInvoiceActivity | null>(null);
  const [lineItemsLoading, setLineItemsLoading] = React.useState<boolean>(false);
  const [lineItemsError, setLineItemsError] = React.useState<string>('');
  const [lineItems, setLineItems] = React.useState<DashboardBillingInvoiceLineItem[]>([]);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = React.useState<string>('all');
  const [invoiceDocumentTypeFilter, setInvoiceDocumentTypeFilter] = React.useState<string>('all');
  const [invoicePeriodStartDateFilter, setInvoicePeriodStartDateFilter] =
    React.useState<string>('');
  const [invoicePeriodEndDateFilter, setInvoicePeriodEndDateFilter] = React.useState<string>('');
  const [downloadingInvoicePdfId, setDownloadingInvoicePdfId] = React.useState<string>('');
  const [invoiceDownloadError, setInvoiceDownloadError] = React.useState<string>('');
  const checkoutReconcileAttemptedRef = React.useRef<Set<string>>(new Set());
  const activeCheckoutReconcileRef = React.useRef<string>('');
  const refreshRequestIdRef = React.useRef(0);

  const refreshBillingShellData = React.useCallback(async () => {
    const refreshRequestId = ++refreshRequestIdRef.current;
    if (!session.claims) {
      setLoading(false);
      setOverview(null);
      setCosts({ kind: 'unavailable' });
      setAccountActivity([]);
      setAccountActivityError('');
      setRefunds([]);
      setRefundsLoading(false);
      setRefundsError('');
      setErrorMessage(session.errorMessage || 'Console session is unavailable');
      return;
    }
    setLoading(true);
    setRefundsLoading(true);
    setErrorMessage('');
    setAccountActivityError('');
    setRefundsError('');
    const organizationId = session.claims.orgId;
    setCosts({ kind: 'loading', organizationId });
    const periodMonthUtc = billingUsagePeriod(search);
    const [overviewResult, activityResult, refundsResult, costsResult] = await Promise.allSettled([
      getDashboardBillingOverview(),
      listDashboardBillingAccountActivity({ limit: 50 }),
      listDashboardBillingRefunds(),
      getDashboardBillingUsageCharges(organizationId, periodMonthUtc),
    ]);
    if (refreshRequestId !== refreshRequestIdRef.current) return;
    if (costsResult.status === 'fulfilled') {
      setCosts({ kind: 'ready', organizationId, data: costsResult.value });
    } else {
      setCosts({
        kind: 'failed',
        organizationId,
        message:
          costsResult.reason instanceof Error
            ? costsResult.reason.message
            : String(costsResult.reason),
      });
    }
    if (overviewResult.status === 'fulfilled') {
      setOverview(overviewResult.value);
    } else {
      setOverview(null);
      setErrorMessage(
        overviewResult.reason instanceof Error
          ? overviewResult.reason.message
          : String(overviewResult.reason),
      );
    }
    if (activityResult.status === 'fulfilled') {
      setAccountActivity(activityResult.value);
    } else {
      setAccountActivity([]);
      setAccountActivityError(
        activityResult.reason instanceof Error
          ? activityResult.reason.message
          : String(activityResult.reason),
      );
    }
    if (refundsResult.status === 'fulfilled') {
      setRefunds(refundsResult.value);
    } else {
      setRefunds([]);
      setRefundsError(
        refundsResult.reason instanceof Error
          ? refundsResult.reason.message
          : String(refundsResult.reason),
      );
    }
    setLoading(false);
    setRefundsLoading(false);
  }, [search, session.claims, session.errorMessage]);

  const loadInvoiceListPage = React.useCallback(async () => {
    if (!session.claims) return;
    setInvoiceListLoading(true);
    setInvoiceListError('');
    try {
      let cursor: string | null = null;
      const allInvoices: DashboardBillingInvoice[] = [];
      for (;;) {
        const response = await listDashboardBillingInvoices({
          ...(cursor ? { cursor } : {}),
          limit: 100,
        });
        allInvoices.push(...response.invoices);
        cursor = response.nextCursor;
        if (!cursor) break;
      }
      setInvoices(allInvoices);
    } catch (error: unknown) {
      setInvoices([]);
      setInvoiceListError(error instanceof Error ? error.message : String(error));
    } finally {
      setInvoiceListLoading(false);
    }
  }, [session.claims]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const legacyInvoiceDetailMatch = pathname.match(/^\/dashboard\/billing\/invoices\/([^/]+)$/);
    const currentUrl = new URL(window.location.href);
    let nextPath = '';
    if (pathname === '/dashboard/billing' || pathname === '/dashboard/billing/') {
      nextPath = '/dashboard/billing/account';
    } else if (
      pathname === '/dashboard/billing/invoices' ||
      pathname === '/dashboard/billing/invoices/'
    ) {
      nextPath = '/dashboard/invoices';
    } else if (legacyInvoiceDetailMatch?.[1]) {
      nextPath = `/dashboard/invoices/${legacyInvoiceDetailMatch[1]}`;
    }
    if (!nextPath) return;
    const nextRelative = `${nextPath}${currentUrl.search}${currentUrl.hash}`;
    window.history.replaceState({}, document.title, nextRelative);
    window.dispatchEvent(new Event('site:navigate'));
  }, [pathname]);

  React.useEffect(() => {
    if (session.loading) {
      setLoading(true);
      return;
    }
    if (subview.kind !== 'account' || isPlatformBillingPage) {
      setLoading(false);
      setErrorMessage('');
      setBillingWarningMessage('');
      return;
    }
    void refreshBillingShellData();
  }, [isPlatformBillingPage, refreshBillingShellData, session.loading, subview.kind]);

  React.useEffect(() => {
    if (!session.claims || subview.kind === 'invoice' || isPlatformBillingPage) return;
    void loadInvoiceListPage();
  }, [isPlatformBillingPage, loadInvoiceListPage, session.claims, subview.kind]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isPlatformBillingPage) {
      activeCheckoutReconcileRef.current = '';
      setCheckoutReturnMessage('');
      return;
    }
    const params = new URLSearchParams(search);
    const checkout = String(params.get('checkout') || '')
      .trim()
      .toLowerCase();
    const checkoutSessionId = String(params.get('checkout_session_id') || '').trim();
    if (checkout === 'cancel') {
      activeCheckoutReconcileRef.current = '';
      setCheckoutReturnMessage('Top-up checkout was canceled before settlement.');
      return;
    }
    if (checkout !== 'success') {
      activeCheckoutReconcileRef.current = '';
      setCheckoutReturnMessage('');
      return;
    }
    if (!checkoutSessionId) {
      activeCheckoutReconcileRef.current = '';
      setCheckoutReturnMessage(
        'Top-up checkout completed. Balance updates after settlement confirmation.',
      );
      return;
    }
    if (!session.claims || subview.kind !== 'account') {
      activeCheckoutReconcileRef.current = '';
      setCheckoutReturnMessage('Top-up checkout completed. Verifying settlement...');
      return;
    }
    const reconcileKey = `${session.claims.orgId}:${session.claims.userId}:${checkoutSessionId}`;
    if (checkoutReconcileAttemptedRef.current.has(reconcileKey)) return;
    checkoutReconcileAttemptedRef.current.add(reconcileKey);
    activeCheckoutReconcileRef.current = reconcileKey;
    setCheckoutReturnMessage('Top-up checkout completed. Verifying settlement...');
    void (async () => {
      try {
        const result = await reconcileDashboardStripeCheckoutSession({ checkoutSessionId });
        if (activeCheckoutReconcileRef.current !== reconcileKey) return;
        if (result.settled) {
          setCheckoutReturnMessage(
            result.settledNow
              ? 'Top-up checkout completed. Balance updated.'
              : 'Top-up checkout is already settled. Balance is up to date.',
          );
          await Promise.all([refreshBillingShellData(), loadInvoiceListPage()]);
          return;
        }
        setCheckoutReturnMessage(
          'Top-up checkout completed. Balance updates after settlement confirmation.',
        );
      } catch {
        if (activeCheckoutReconcileRef.current !== reconcileKey) return;
        setCheckoutReturnMessage(
          'Top-up checkout completed, but settlement verification is still pending. Refresh again in a moment.',
        );
      }
    })();
  }, [
    isPlatformBillingPage,
    loadInvoiceListPage,
    pathname,
    refreshBillingShellData,
    search,
    session.claims,
    subview.kind,
  ]);

  React.useEffect(() => {
    if (!overview) {
      setBillingWarningMessage('');
      return;
    }
    if (overview.creditBalanceMinor <= 0) {
      setBillingWarningDismissed(false);
      setBillingWarningMessage('Prepaid balance is depleted. Add credits to fund service usage.');
      return;
    }
    if (overview.creditBalanceMinor <= overview.lowBalanceThresholdMinor) {
      setBillingWarningDismissed(false);
      setBillingWarningMessage(
        `Prepaid balance is at or below the warning threshold (${formatUsdMinor(
          overview.lowBalanceThresholdMinor,
        )}). Add credits before service usage increases.`,
      );
      return;
    }
    setBillingWarningMessage('');
  }, [overview]);

  React.useEffect(() => {
    if (!activeInvoiceId || subview.kind !== 'invoice' || !session.claims) return;
    let cancelled = false;
    setInvoiceDetail(null);
    setInvoiceActivity(null);
    setLineItems([]);
    setInvoiceDetailLoading(true);
    setInvoiceDetailError('');
    setInvoiceActivityLoading(true);
    setInvoiceActivityError('');
    setLineItemsLoading(true);
    setLineItemsError('');

    getDashboardBillingInvoice(activeInvoiceId)
      .then((nextInvoice) => {
        if (!cancelled) setInvoiceDetail(nextInvoice);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setInvoiceDetail(null);
        setInvoiceDetailError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setInvoiceDetailLoading(false);
      });

    getDashboardBillingInvoiceActivity(activeInvoiceId)
      .then((activity) => {
        if (!cancelled) setInvoiceActivity(activity);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setInvoiceActivity(null);
          setInvoiceActivityError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setInvoiceActivityLoading(false);
      });

    listDashboardBillingInvoiceLineItems(activeInvoiceId)
      .then((rows) => {
        if (!cancelled) setLineItems(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLineItems([]);
          setLineItemsError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLineItemsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeInvoiceId, session.claims, subview.kind]);

  const filteredInvoices = React.useMemo<DashboardBillingInvoice[]>(() => {
    return filterInvoices({
      invoices,
      statusFilter: invoiceStatusFilter,
      documentTypeFilter: invoiceDocumentTypeFilter,
      periodStartDate: invoicePeriodStartDateFilter,
      periodEndDate: invoicePeriodEndDateFilter,
      referenceNowMs: Date.now(),
    });
  }, [
    invoiceDocumentTypeFilter,
    invoicePeriodEndDateFilter,
    invoicePeriodStartDateFilter,
    invoiceStatusFilter,
    invoices,
  ]);

  const filteredInvoiceSummary = React.useMemo<DashboardBillingInvoiceListSummary>(() => {
    return buildInvoiceListSummary(filteredInvoices, Date.now());
  }, [filteredInvoices]);

  const invoiceSummaryMetrics = React.useMemo<BillingMetric[]>(() => {
    return [
      {
        label: 'Documents',
        value: String(filteredInvoiceSummary.totalCount),
        hint: `${filteredInvoiceSummary.statementCount} statement${
          filteredInvoiceSummary.statementCount === 1 ? '' : 's'
        }`,
      },
      {
        label: 'Purchase receipts',
        value: String(filteredInvoiceSummary.receiptCount),
        hint: `${filteredInvoiceSummary.paidCount} paid document${
          filteredInvoiceSummary.paidCount === 1 ? '' : 's'
        }`,
      },
      {
        label: 'Outstanding',
        value: formatUsdMinor(filteredInvoiceSummary.outstandingAmountMinor),
        hint: `${filteredInvoiceSummary.openCount} open`,
      },
      {
        label: 'Latest period',
        value: filteredInvoiceSummary.latestPeriodMonthUtc || '-',
        hint: 'Most recent billing month',
      },
    ];
  }, [filteredInvoiceSummary]);

  const summaryMetrics = buildAccountSummaryMetrics(overview);

  const invoiceDetailRecord = React.useMemo(() => {
    if (!activeInvoiceId) return null;
    return (
      (invoiceDetail?.id === activeInvoiceId ? invoiceDetail : null) ||
      (invoiceActivity?.invoice.id === activeInvoiceId ? invoiceActivity.invoice : null) ||
      invoices.find((entry) => entry.id === activeInvoiceId) ||
      null
    );
  }, [activeInvoiceId, invoiceActivity?.invoice, invoiceDetail, invoices]);

  const isPlatformAdmin = session.claims?.platformSupport === true;

  const onStartStripeCheckout = React.useCallback(
    async ({ creditPackId }: Pick<DashboardStripeCheckoutSessionRequest, 'creditPackId'>) => {
      if (!session.claims) {
        setCheckoutActionError(session.errorMessage || 'Console session is unavailable');
        return;
      }
      setStartingCheckoutPackId(creditPackId);
      setCheckoutActionError('');
      try {
        const checkoutSession = await createDashboardStripeCheckoutSession({
          creditPackId,
        });
        window.location.assign(checkoutSession.url);
      } catch (error: unknown) {
        setCheckoutActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setStartingCheckoutPackId('');
      }
    },
    [session.claims, session.errorMessage],
  );

  const onDownloadInvoicePdf = React.useCallback(
    async (invoiceId: string) => {
      const normalizedInvoiceId = String(invoiceId || '').trim();
      if (!normalizedInvoiceId) return;
      setDownloadingInvoicePdfId(normalizedInvoiceId);
      setInvoiceDownloadError('');
      try {
        await downloadDashboardBillingInvoicePdf(normalizedInvoiceId);
      } catch (error: unknown) {
        const invoice = invoices.find((entry) => entry.id === normalizedInvoiceId) || null;
        const fallbackFilename = buildInvoicePdfFilename(invoice, normalizedInvoiceId);
        const message = error instanceof Error ? error.message : String(error);
        setInvoiceDownloadError(`Failed to download ${fallbackFilename}: ${message}`);
      } finally {
        setDownloadingInvoicePdfId('');
      }
    },
    [invoices],
  );

  return (
    <div className="dashboard-view" aria-label="Billing page">
      {billingWarningMessage && !billingWarningDismissed ? (
        <section className="dashboard-view__section">
          <div className="dashboard-warning-banner" role="alert">
            <p>{billingWarningMessage}</p>
            <button
              type="button"
              className="dashboard-warning-banner__dismiss"
              aria-label="Dismiss billing warning"
              onClick={() => setBillingWarningDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      {checkoutReturnMessage ? (
        <section className="dashboard-view__section">
          <p className="dashboard-info-banner">{checkoutReturnMessage}</p>
        </section>
      ) : null}

      {session.loading || loading ? (
        <section className="dashboard-view__section">
          <p>Loading billing data...</p>
        </section>
      ) : !session.claims ? (
        <section className="dashboard-view__section">
          <p>Billing unavailable: {session.errorMessage || 'unauthorized'}.</p>
        </section>
      ) : errorMessage ? (
        <section className="dashboard-view__section">
          <p>Billing data unavailable: {errorMessage}</p>
        </section>
      ) : subview.kind === 'account' ? (
        isPlatformBillingPage ? (
          isPlatformAdmin ? (
            <PlatformBillingView />
          ) : (
            <section className="dashboard-view__section">
              <p>Customer Accounts is only available to platform admin users.</p>
            </section>
          )
        ) : (
          <>
            <p className="dashboard-pagination-note">
              Billing is organization-scoped. All projects and services use the same prepaid
              balance.
            </p>
            <BillingMetricsGrid
              metrics={summaryMetrics}
              ariaLabel="Billing account summary metrics"
            />
            <BillingUsageCostsSection
              organizationId={selectedContext.organization || session.claims.orgId}
              state={costs}
            />
            <BillingAccountView
              canManageBilling={canDashboardManageBilling(session.claims)}
              checkoutActionError={checkoutActionError}
              startingCheckoutPackId={startingCheckoutPackId}
              refunds={refunds}
              refundsLoading={refundsLoading}
              refundsError={refundsError}
              onStartStripeCheckout={(checkoutRequest) => {
                void onStartStripeCheckout(checkoutRequest);
              }}
            />
            <section
              id="billing-account-activity"
              className="dashboard-view__section dashboard-view__section--plain"
            >
              <BillingAccountActivitySection
                accountActivity={accountActivity}
                accountActivityError={accountActivityError}
              />
            </section>
          </>
        )
      ) : subview.kind === 'invoices' ? (
        <BillingInvoicesView
          invoiceMetrics={invoiceSummaryMetrics}
          invoiceListLoading={invoiceListLoading}
          invoiceListError={invoiceListError}
          invoiceStatusFilter={invoiceStatusFilter}
          setInvoiceStatusFilter={setInvoiceStatusFilter}
          invoiceDocumentTypeFilter={invoiceDocumentTypeFilter}
          setInvoiceDocumentTypeFilter={setInvoiceDocumentTypeFilter}
          invoicePeriodStartDateFilter={invoicePeriodStartDateFilter}
          setInvoicePeriodStartDateFilter={setInvoicePeriodStartDateFilter}
          invoicePeriodEndDateFilter={invoicePeriodEndDateFilter}
          setInvoicePeriodEndDateFilter={setInvoicePeriodEndDateFilter}
          invoices={filteredInvoices}
          hasAnyInvoices={invoices.length > 0}
          downloadingInvoicePdfId={downloadingInvoicePdfId}
          invoiceDownloadError={invoiceDownloadError}
          onOpenInvoice={(invoiceId) => go(`/dashboard/invoices/${encodeURIComponent(invoiceId)}`)}
          onDownloadInvoicePdf={onDownloadInvoicePdf}
        />
      ) : (
        <BillingInvoiceDetailView
          invoiceId={activeInvoiceId}
          invoice={invoiceDetailRecord}
          invoiceDetailLoading={invoiceDetailLoading}
          invoiceDetailError={invoiceDetailError}
          invoiceActivityLoading={invoiceActivityLoading}
          invoiceActivityError={invoiceActivityError}
          invoiceActivity={invoiceActivity}
          lineItemsLoading={lineItemsLoading}
          lineItemsError={lineItemsError}
          lineItems={lineItems}
          downloadingInvoicePdfId={downloadingInvoicePdfId}
          invoiceDownloadError={invoiceDownloadError}
          onBackToInvoices={() => go('/dashboard/invoices')}
          onDownloadInvoicePdf={onDownloadInvoicePdf}
        />
      )}
    </div>
  );
}

export default BillingConsoleShell;
