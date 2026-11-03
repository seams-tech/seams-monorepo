import { t } from '@core/i18n';
import { blinkMenuItem } from '@seams-internal/site-navbar';
import React from 'react';
import { toast } from 'sonner';
import {
  createDashboardPlatformBillingManualAdminDebit,
  createDashboardPlatformBillingManualSupportCredit,
  createDashboardPlatformBillingRefund,
  formatUsdMinor,
  getDashboardPlatformBillingAccount,
  reconcileDashboardPlatformBillingRefund,
  searchDashboardPlatformBillingAccounts,
  type DashboardBillingAccountActivityEntry,
  type DashboardBillingAccountActivityEventType,
  type DashboardBillingRefund,
  type DashboardPlatformBillingAccountSummary,
  type DashboardPlatformBillingBalance,
  type DashboardPlatformBillingLookupRequest,
  type DashboardPlatformBillingLookupResult,
  type DashboardPlatformBillingOrganization,
} from './consoleBillingApi';
import {
  DashboardTable,
  DashboardTableActionButton,
  DashboardTableActionMenu,
  DashboardTableCell,
  DashboardTableHeader,
  DashboardTableHeaderCell,
  DashboardTableIntro,
  DashboardTableRow,
  DashboardTableState,
  DashboardTableStatus,
  dashboardTableColumns,
  useDashboardTablePagination,
} from '../../components/DashboardTable';
import { describeAccountActivityType, formatTimestampUtcParts } from './billingSections';
import {
  PlatformAdjustmentDialog,
  PlatformRefundDialog,
  describePlatformAdjustmentReason,
  describePlatformLiveAccess,
  describePlatformRefundStatus,
  formatBalanceUsdMinor,
  formatSignedUsdMinor,
  readPlatformBillingReversedEntryId,
  resolvePlatformLiveAccessState,
  type PlatformAdjustmentDialogRequest,
  type PlatformAdjustmentSubmission,
  type PlatformRefundSubmission,
  type PlatformRefundTarget,
} from './PlatformBillingDialogs';
import { DashboardTableSkeletonRows } from '../../components/DashboardSkeleton';

const PLATFORM_BILLING_ACTIVITY_LIMIT = 50;
const PLATFORM_BILLING_SEARCH_LIMIT = 10;
const PLATFORM_BILLING_RECENT_ORGANIZATION_LIMIT = 5;
const PLATFORM_BILLING_ROUTE_ORG_ID_QUERY_KEY = 'billingOrgId';
const PLATFORM_BILLING_ROUTE_ORG_NAME_QUERY_KEY = 'billingOrgName';
const PLATFORM_BILLING_EVENT_TYPE_OPTIONS: Array<{
  value: 'all' | DashboardBillingAccountActivityEventType;
  label: string;
}> = [
  { value: 'all', label: t('platformBillingEventAll') },
  { value: 'CREDIT_PURCHASE', label: t('platformBillingCreditPurchases') },
  { value: 'USAGE_DEBIT', label: t('platformBillingEventUsageDebit') },
  { value: 'PRODUCT_EXECUTION_DEBIT', label: t('platformBillingEventSponsoredDebit') },
  { value: 'MANUAL_ADJUSTMENT', label: t('platformBillingEventManual') },
  { value: 'REFUND', label: t('platformBillingRefunds') },
  { value: 'DISPUTE_OPENED', label: t('platformBillingEventDisputeOpened') },
  { value: 'DISPUTE_WON', label: t('platformBillingEventDisputeWon') },
];
const PLATFORM_ACTIVITY_TABLE_COLUMNS = dashboardTableColumns(
  '1fr',
  '1.7fr',
  '0.8fr',
  '1.3fr',
  '0.7fr',
);
const PLATFORM_PAYMENTS_TABLE_COLUMNS = dashboardTableColumns(
  '1fr',
  '1.5fr',
  '0.8fr',
  '0.8fr',
  '0.7fr',
);
const PLATFORM_REFUNDS_TABLE_COLUMNS = dashboardTableColumns(
  '1.4fr',
  '1.4fr',
  '0.8fr',
  '0.9fr',
  '0.7fr',
);
/* Refunds in these states hold part of a purchase; failed and canceled ones do not. */
const PLATFORM_REFUND_HOLDING_STATUSES: ReadonlySet<DashboardBillingRefund['status']> = new Set([
  'requested',
  'provider_pending',
  'succeeded',
]);

type PlatformBillingTab = 'activity' | 'payments';

interface PlatformPaymentsState {
  orgId: string;
  loading: boolean;
  error: string;
  purchases: DashboardBillingAccountActivityEntry[];
}

function normalizePlatformBillingSearchValue(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function scorePlatformBillingSearchCandidate(query: string, value: string, offset: number): number {
  const normalized = normalizePlatformBillingSearchValue(value);
  if (!normalized) return Number.POSITIVE_INFINITY;
  if (normalized === query) return offset;
  if (normalized.startsWith(query)) {
    return offset + 10 + Math.max(0, normalized.length - query.length);
  }
  const tokens = normalized.split(/[\s_@.-]+/).filter(Boolean);
  const tokenIndex = tokens.findIndex((token) => token.startsWith(query));
  if (tokenIndex >= 0) return offset + 30 + tokenIndex;
  const containsIndex = normalized.indexOf(query);
  if (containsIndex >= 0) return offset + 60 + containsIndex;
  return Number.POSITIVE_INFINITY;
}

function scorePlatformBillingAccount(
  query: string,
  account: DashboardPlatformBillingAccountSummary,
): number {
  return Math.min(
    scorePlatformBillingSearchCandidate(query, account.organization.name, 0),
    scorePlatformBillingSearchCandidate(query, account.organization.id, 20),
    ...account.ownerEmails.map((email) => scorePlatformBillingSearchCandidate(query, email, 40)),
  );
}

function sortPlatformBillingAccounts(
  accounts: DashboardPlatformBillingAccountSummary[],
  query: string,
): DashboardPlatformBillingAccountSummary[] {
  const normalizedQuery = normalizePlatformBillingSearchValue(query);
  if (!normalizedQuery) return [...accounts];
  return [...accounts].sort((left, right) => {
    const scoreDiff =
      scorePlatformBillingAccount(normalizedQuery, left) -
      scorePlatformBillingAccount(normalizedQuery, right);
    if (scoreDiff !== 0) return scoreDiff;
    const primaryDiff = left.organization.name.localeCompare(right.organization.name);
    if (primaryDiff !== 0) return primaryDiff;
    return left.organization.id.localeCompare(right.organization.id);
  });
}

function buildLookupRequest(input: {
  orgId?: string;
  projectId?: string;
  periodMonthUtc: string;
  eventType: 'all' | DashboardBillingAccountActivityEventType;
}): DashboardPlatformBillingLookupRequest {
  const orgId = String(input.orgId || '').trim();
  const projectId = String(input.projectId || '').trim();
  const periodMonthUtc = String(input.periodMonthUtc || '').trim();
  return {
    ...(orgId ? { orgId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(periodMonthUtc ? { periodMonthUtc } : {}),
    ...(input.eventType !== 'all' ? { eventType: input.eventType } : {}),
    limit: PLATFORM_BILLING_ACTIVITY_LIMIT,
  };
}

function buildOrganizationKey(organization: DashboardPlatformBillingOrganization): string {
  return `organization:${organization.id}`;
}

function describeOrganizationTitle(organization: DashboardPlatformBillingOrganization): string {
  return organization.name || organization.id;
}

function describeOwners(ownerEmails: readonly string[]): string {
  if (ownerEmails.length === 0) return t('platformBillingNoOwner');
  if (ownerEmails.length === 1) return t('platformBillingOwnerOne', { email: ownerEmails[0] });
  return t('platformBillingOwnerMany', {
    email: ownerEmails[0],
    more: ownerEmails.length - 1,
  });
}

function readLookupBalance(
  lookupResult: DashboardPlatformBillingLookupResult,
): DashboardPlatformBillingBalance {
  return {
    creditBalanceMinor: lookupResult.overview.creditBalanceMinor,
    lowBalanceThresholdMinor: lookupResult.overview.lowBalanceThresholdMinor,
  };
}

function readPlatformBillingRouteSelection(): { orgId: string; orgName: string } {
  if (typeof window === 'undefined') {
    return {
      orgId: '',
      orgName: '',
    };
  }
  const searchParams = new URLSearchParams(window.location.search);
  return {
    orgId: String(searchParams.get(PLATFORM_BILLING_ROUTE_ORG_ID_QUERY_KEY) || '').trim(),
    orgName: String(searchParams.get(PLATFORM_BILLING_ROUTE_ORG_NAME_QUERY_KEY) || '').trim(),
  };
}

function writePlatformBillingRouteSelection(input: {
  orgId: string;
  orgName?: string;
  historyMode?: 'push' | 'replace';
}): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const normalizedOrgId = String(input.orgId || '').trim();
  const normalizedOrgName = String(input.orgName || '').trim();
  if (normalizedOrgId) {
    params.set(PLATFORM_BILLING_ROUTE_ORG_ID_QUERY_KEY, normalizedOrgId);
    if (normalizedOrgName) {
      params.set(PLATFORM_BILLING_ROUTE_ORG_NAME_QUERY_KEY, normalizedOrgName);
    } else {
      params.delete(PLATFORM_BILLING_ROUTE_ORG_NAME_QUERY_KEY);
    }
  } else {
    params.delete(PLATFORM_BILLING_ROUTE_ORG_ID_QUERY_KEY);
    params.delete(PLATFORM_BILLING_ROUTE_ORG_NAME_QUERY_KEY);
  }
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    const historyMethod = input.historyMode === 'push' ? 'pushState' : 'replaceState';
    window.history[historyMethod]({}, '', nextUrl);
  }
}

function PlatformLiveAccessPill(props: { balance: DashboardPlatformBillingBalance }) {
  const access = describePlatformLiveAccess(resolvePlatformLiveAccessState(props.balance));
  return (
    <DashboardTableStatus tone={access.tone}>
      {access.tone === 'danger'
        ? t('platformBillingBlocked')
        : access.tone === 'warning'
          ? t('platformBillingLow')
          : t('platformBillingEnabled')}
    </DashboardTableStatus>
  );
}

function PlatformTimestamp(props: { value: string }): React.JSX.Element {
  const createdAt = formatTimestampUtcParts(props.value);
  return (
    <div className="dashboard-billing-activity-table__stack" title={props.value}>
      <strong className="dashboard-data-table__summary dashboard-billing-activity-table__timestamp">
        {createdAt.primary}
      </strong>
      {createdAt.secondary ? (
        <span className="dashboard-data-table__subline dashboard-data-table__subline--muted dashboard-billing-activity-table__timestamp-detail">
          {createdAt.secondary}
        </span>
      ) : null}
    </div>
  );
}

function PlatformSignedAmount(props: { amountMinor: number }): React.JSX.Element {
  const { amountMinor } = props;
  return (
    <strong
      className={`dashboard-data-table__summary dashboard-platform-amount dashboard-platform-amount--${amountMinor < 0 ? 'debit' : 'credit'}`}
    >
      {formatSignedUsdMinor(amountMinor)}
    </strong>
  );
}

function PlatformActivityTable(props: {
  entries: DashboardBillingAccountActivityEntry[];
  controls: React.ReactNode;
  onReverse: (entry: DashboardBillingAccountActivityEntry) => void;
}): React.JSX.Element {
  const { entries, controls, onReverse } = props;
  const pagination = useDashboardTablePagination(entries, {
    initialRowsPerPage: 10,
    itemLabel: t('platformBillingItemEvent'),
    itemLabelPlural: t('platformBillingItemEvents'),
  });
  const reversedEntryIds = React.useMemo(
    () =>
      new Set(
        entries
          .map((entry) => readPlatformBillingReversedEntryId(entry.idempotencyKey))
          .filter((entryId): entryId is string => entryId !== null),
      ),
    [entries],
  );
  return (
    <DashboardTable
      ariaLabel={t('platformBillingActivityAria')}
      className="dashboard-billing-activity-table dashboard-platform-account__table"
      columns={PLATFORM_ACTIVITY_TABLE_COLUMNS}
      pagination={pagination.pagination}
    >
      <DashboardTableIntro className="dashboard-billing-table__intro">
        {controls}
      </DashboardTableIntro>
      {entries.length === 0 ? (
        <DashboardTableState>{t('platformBillingNoLedgerEvents')}</DashboardTableState>
      ) : (
        <>
          <DashboardTableHeader>
            <DashboardTableHeaderCell>{t('platformBillingColWhen')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('platformBillingColEvent')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell className="dashboard-data-table__header-cell--end">
              {t('platformBillingColAmount')}
            </DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('platformBillingColReason')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell className="dashboard-data-table__header-cell--end">
              {t('platformBillingColAction')}
            </DashboardTableHeaderCell>
          </DashboardTableHeader>
          {pagination.rows.map((entry) => {
            const reversedEntryId = readPlatformBillingReversedEntryId(entry.idempotencyKey);
            const detail = reversedEntryId
              ? t('platformBillingReverses', { id: reversedEntryId })
              : entry.note || entry.relatedPurchaseId || entry.relatedInvoiceId || null;
            const isManual = entry.type === 'MANUAL_ADJUSTMENT';
            return (
              <DashboardTableRow key={entry.id}>
                <DashboardTableCell>
                  <PlatformTimestamp value={entry.createdAt} />
                </DashboardTableCell>
                <DashboardTableCell title={entry.id}>
                  <div className="dashboard-billing-activity-table__stack">
                    <strong className="dashboard-data-table__summary">
                      {describeAccountActivityType(entry)}
                    </strong>
                    {detail ? (
                      <span className="dashboard-data-table__subline dashboard-data-table__subline--muted">
                        {detail}
                      </span>
                    ) : null}
                  </div>
                </DashboardTableCell>
                <DashboardTableCell align="end">
                  <PlatformSignedAmount amountMinor={entry.amountMinor} />
                </DashboardTableCell>
                <DashboardTableCell>
                  <div className="dashboard-billing-activity-table__stack">
                    <span className="dashboard-data-table__summary">
                      {describePlatformAdjustmentReason(entry.reasonCode) || '-'}
                    </span>
                    {entry.actorUserId ? (
                      <span className="dashboard-data-table__subline dashboard-data-table__subline--muted">
                        {t('platformBillingBy', { actor: entry.actorUserId })}
                      </span>
                    ) : null}
                  </div>
                </DashboardTableCell>
                <DashboardTableCell align="end">
                  {!isManual || reversedEntryId ? (
                    '-'
                  ) : reversedEntryIds.has(entry.id) ? (
                    <DashboardTableStatus tone="neutral">
                      {t('platformBillingReversed')}
                    </DashboardTableStatus>
                  ) : (
                    <DashboardTableActionButton onClick={() => onReverse(entry)}>
                      {t('platformBillingReverse')}
                    </DashboardTableActionButton>
                  )}
                </DashboardTableCell>
              </DashboardTableRow>
            );
          })}
        </>
      )}
    </DashboardTable>
  );
}

function PlatformPaymentsPanel(props: {
  payments: PlatformPaymentsState | null;
  refunds: DashboardBillingRefund[];
  refundActionId: string;
  onRefund: (target: PlatformRefundTarget) => void;
  onReconcile: (refundId: string) => void;
}): React.JSX.Element {
  const { payments, refunds, refundActionId, onRefund, onReconcile } = props;
  const heldByPurchase = React.useMemo(() => {
    const held = new Map<string, number>();
    for (const refund of refunds) {
      if (!PLATFORM_REFUND_HOLDING_STATUSES.has(refund.status)) continue;
      held.set(refund.purchaseId, (held.get(refund.purchaseId) || 0) + refund.amountMinor);
    }
    return held;
  }, [refunds]);
  const purchases = (payments?.purchases || []).filter((entry) => entry.relatedPurchaseId);
  return (
    <div className="dashboard-platform-account__payments">
      <DashboardTable
        ariaLabel={t('platformBillingCreditPurchases')}
        className="dashboard-platform-account__table"
        columns={PLATFORM_PAYMENTS_TABLE_COLUMNS}
      >
        <DashboardTableIntro className="dashboard-billing-table__intro">
          <h3 className="dashboard-billing-table__title">{t('platformBillingCreditPurchases')}</h3>
        </DashboardTableIntro>
        {!payments || payments.loading ? (
          <DashboardTableSkeletonRows
            label={t('platformBillingLoadingPurchases')}
            columns={5}
            rows={2}
          />
        ) : payments.error ? (
          <DashboardTableState>{payments.error}</DashboardTableState>
        ) : purchases.length === 0 ? (
          <DashboardTableState>{t('platformBillingNoStripePurchases')}</DashboardTableState>
        ) : (
          <>
            <DashboardTableHeader>
              <DashboardTableHeaderCell>{t('platformBillingColWhen')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('platformBillingColPurchase')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell className="dashboard-data-table__header-cell--end">
                {t('platformBillingColPaid')}
              </DashboardTableHeaderCell>
              <DashboardTableHeaderCell className="dashboard-data-table__header-cell--end">
                {t('platformBillingColRefunded')}
              </DashboardTableHeaderCell>
              <DashboardTableHeaderCell className="dashboard-data-table__header-cell--end">
                {t('platformBillingColAction')}
              </DashboardTableHeaderCell>
            </DashboardTableHeader>
            {purchases.map((entry) => {
              const purchaseId = entry.relatedPurchaseId as string;
              const heldMinor = heldByPurchase.get(purchaseId) || 0;
              const refundableMinor = Math.max(0, entry.amountMinor - heldMinor);
              return (
                <DashboardTableRow key={entry.id}>
                  <DashboardTableCell>
                    <PlatformTimestamp value={entry.createdAt} />
                  </DashboardTableCell>
                  <DashboardTableCell title={purchaseId}>
                    <code className="dashboard-billing-activity-table__token">{purchaseId}</code>
                  </DashboardTableCell>
                  <DashboardTableCell align="end">
                    {formatUsdMinor(entry.amountMinor)}
                  </DashboardTableCell>
                  <DashboardTableCell align="end">
                    {heldMinor > 0 ? formatUsdMinor(heldMinor) : '-'}
                  </DashboardTableCell>
                  <DashboardTableCell align="end">
                    <DashboardTableActionButton
                      tone="danger"
                      disabled={refundableMinor <= 0 || Boolean(refundActionId)}
                      onClick={() =>
                        onRefund({
                          purchaseId,
                          purchasedMinor: entry.amountMinor,
                          refundableMinor,
                        })
                      }
                    >
                      {t('platformBillingRefund')}
                    </DashboardTableActionButton>
                  </DashboardTableCell>
                </DashboardTableRow>
              );
            })}
          </>
        )}
      </DashboardTable>
      <DashboardTable
        ariaLabel={t('platformBillingRefunds')}
        className="dashboard-platform-account__table"
        columns={PLATFORM_REFUNDS_TABLE_COLUMNS}
      >
        <DashboardTableIntro className="dashboard-billing-table__intro">
          <h3 className="dashboard-billing-table__title">{t('platformBillingRefunds')}</h3>
        </DashboardTableIntro>
        {refunds.length === 0 ? (
          <DashboardTableState>{t('platformBillingNoRefunds')}</DashboardTableState>
        ) : (
          <>
            <DashboardTableHeader>
              <DashboardTableHeaderCell>{t('platformBillingRefund')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('platformBillingColPurchase')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell className="dashboard-data-table__header-cell--end">
                {t('platformBillingColAmount')}
              </DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('platformBillingColStatus')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell className="dashboard-data-table__header-cell--end">
                {t('platformBillingColAction')}
              </DashboardTableHeaderCell>
            </DashboardTableHeader>
            {refunds.map((refund) => (
              <DashboardTableRow key={refund.id}>
                <DashboardTableCell title={refund.reason}>
                  <div className="dashboard-billing-activity-table__stack">
                    <code className="dashboard-billing-activity-table__token">{refund.id}</code>
                    <span className="dashboard-data-table__subline dashboard-data-table__subline--muted">
                      {refund.reason}
                    </span>
                  </div>
                </DashboardTableCell>
                <DashboardTableCell title={refund.purchaseId}>
                  <code className="dashboard-billing-activity-table__token">
                    {refund.purchaseId}
                  </code>
                </DashboardTableCell>
                <DashboardTableCell align="end">
                  {formatUsdMinor(refund.amountMinor)}
                </DashboardTableCell>
                <DashboardTableCell>
                  <DashboardTableStatus
                    tone={
                      refund.status === 'succeeded'
                        ? 'success'
                        : refund.status === 'failed'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {describePlatformRefundStatus(refund.status)}
                  </DashboardTableStatus>
                </DashboardTableCell>
                <DashboardTableCell align="end">
                  {refund.status === 'requested' || refund.status === 'provider_pending' ? (
                    <DashboardTableActionButton
                      disabled={Boolean(refundActionId)}
                      onClick={() => onReconcile(refund.id)}
                    >
                      {refundActionId === refund.id
                        ? t('platformBillingChecking')
                        : t('platformBillingCheckStatus')}
                    </DashboardTableActionButton>
                  ) : (
                    '-'
                  )}
                </DashboardTableCell>
              </DashboardTableRow>
            ))}
          </>
        )}
      </DashboardTable>
    </div>
  );
}

export function PlatformBillingView(): React.JSX.Element {
  const initialRouteSelection = readPlatformBillingRouteSelection();
  const [searchInput, setSearchInput] = React.useState<string>(
    () => initialRouteSelection.orgName || initialRouteSelection.orgId,
  );
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = React.useState<boolean>(false);
  const [activeSearchIndex, setActiveSearchIndex] = React.useState<number>(-1);
  const [searchResultsMode, setSearchResultsMode] = React.useState<'recent' | 'search'>('search');
  const [periodMonthUtcFilter, setPeriodMonthUtcFilter] = React.useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = React.useState<
    'all' | DashboardBillingAccountActivityEventType
  >('all');
  const [loading, setLoading] = React.useState<boolean>(false);
  const [searchLoading, setSearchLoading] = React.useState<boolean>(false);
  const [searchError, setSearchError] = React.useState<string>('');
  const [searchResults, setSearchResults] = React.useState<
    DashboardPlatformBillingAccountSummary[]
  >([]);
  const [searchPerformed, setSearchPerformed] = React.useState<boolean>(false);
  const [lookupError, setLookupError] = React.useState<string>('');
  const [lookupResult, setLookupResult] =
    React.useState<DashboardPlatformBillingLookupResult | null>(null);
  const [activeLookupRequest, setActiveLookupRequest] =
    React.useState<DashboardPlatformBillingLookupRequest | null>(null);
  const [requestedRouteSelection, setRequestedRouteSelection] = React.useState<{
    orgId: string;
    orgName: string;
  }>(() => initialRouteSelection);
  const requestedSearchValue = React.useMemo(
    () => requestedRouteSelection.orgName || requestedRouteSelection.orgId,
    [requestedRouteSelection.orgId, requestedRouteSelection.orgName],
  );
  const [activeTab, setActiveTab] = React.useState<PlatformBillingTab>('activity');
  const [adjustmentDialog, setAdjustmentDialog] =
    React.useState<PlatformAdjustmentDialogRequest | null>(null);
  const [refundTarget, setRefundTarget] = React.useState<PlatformRefundTarget | null>(null);
  const [refundActionId, setRefundActionId] = React.useState<string>('');
  const [payments, setPayments] = React.useState<PlatformPaymentsState | null>(null);
  const searchRequestIdRef = React.useRef<number>(0);
  const paymentsRequestIdRef = React.useRef<number>(0);
  const skipRequestedRouteSelectionEffectRef = React.useRef<boolean>(false);
  const suppressSearchValueRef = React.useRef<string>(
    initialRouteSelection.orgName || initialRouteSelection.orgId,
  );
  const searchListboxId = React.useId();
  const tabsId = React.useId();

  const closeAccountDialogs = React.useCallback(() => {
    setAdjustmentDialog(null);
    setRefundTarget(null);
  }, []);

  const loadLookup = React.useCallback(async (request: DashboardPlatformBillingLookupRequest) => {
    setLoading(true);
    setLookupError('');
    try {
      const result = await getDashboardPlatformBillingAccount(request);
      setLookupResult(result);
      setActiveLookupRequest(request);
      return result;
    } catch (error: unknown) {
      setLookupResult(null);
      setActiveLookupRequest(null);
      setLookupError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPayments = React.useCallback(async (orgId: string) => {
    const requestId = paymentsRequestIdRef.current + 1;
    paymentsRequestIdRef.current = requestId;
    setPayments((current) => ({
      orgId,
      loading: true,
      error: '',
      purchases: current?.orgId === orgId ? current.purchases : [],
    }));
    try {
      const result = await getDashboardPlatformBillingAccount(
        buildLookupRequest({ orgId, periodMonthUtc: '', eventType: 'CREDIT_PURCHASE' }),
      );
      if (paymentsRequestIdRef.current !== requestId) return;
      setPayments({ orgId, loading: false, error: '', purchases: result.activity });
    } catch (error: unknown) {
      if (paymentsRequestIdRef.current !== requestId) return;
      setPayments({
        orgId,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        purchases: [],
      });
    }
  }, []);

  const lookupOrgId = lookupResult?.organization.id || '';
  React.useEffect(() => {
    if (activeTab !== 'payments' || !lookupOrgId) return;
    if (payments?.orgId === lookupOrgId) return;
    void loadPayments(lookupOrgId);
  }, [activeTab, loadPayments, lookupOrgId, payments?.orgId]);

  const fetchSearchResults = React.useCallback(
    async (query: string, limit: number): Promise<DashboardPlatformBillingAccountSummary[]> => {
      const results = await searchDashboardPlatformBillingAccounts({
        query,
        limit,
      });
      return query ? sortPlatformBillingAccounts(results, query) : results;
    },
    [],
  );

  const runSearchRequest = React.useCallback(
    async (query: string, mode: 'recent' | 'search', limit: number): Promise<void> => {
      const requestId = searchRequestIdRef.current + 1;
      searchRequestIdRef.current = requestId;
      setSearchLoading(true);
      setSearchError('');
      setSearchPerformed(false);
      setSearchResultsMode(mode);
      setIsSearchDropdownOpen(true);
      try {
        const results = await fetchSearchResults(query, limit);
        if (searchRequestIdRef.current !== requestId) return;
        React.startTransition(() => {
          setSearchResults(results);
          setSearchPerformed(true);
        });
      } catch (error: unknown) {
        if (searchRequestIdRef.current !== requestId) return;
        setSearchResults([]);
        setSearchPerformed(true);
        setSearchError(error instanceof Error ? error.message : String(error));
      } finally {
        if (searchRequestIdRef.current === requestId) {
          setSearchLoading(false);
        }
      }
    },
    [fetchSearchResults],
  );

  const normalizedSearchInput = React.useMemo(
    () => String(searchInput || '').trim(),
    [searchInput],
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncRequestedRouteSelection = () => {
      setRequestedRouteSelection(readPlatformBillingRouteSelection());
    };
    window.addEventListener('popstate', syncRequestedRouteSelection);
    window.addEventListener('site:navigate', syncRequestedRouteSelection as EventListener);
    return () => {
      window.removeEventListener('popstate', syncRequestedRouteSelection);
      window.removeEventListener('site:navigate', syncRequestedRouteSelection as EventListener);
    };
  }, []);

  React.useEffect(() => {
    if (skipRequestedRouteSelectionEffectRef.current) {
      skipRequestedRouteSelectionEffectRef.current = false;
      return;
    }
    searchRequestIdRef.current += 1;
    suppressSearchValueRef.current = requestedSearchValue;
    setSearchInput(requestedSearchValue);
    setSearchLoading(false);
    setSearchError('');
    setSearchResults([]);
    setSearchPerformed(false);
    setSearchResultsMode('search');
    setLookupError('');
    setPeriodMonthUtcFilter('');
    setEventTypeFilter('all');
    setActiveTab('activity');
    closeAccountDialogs();
    setIsSearchDropdownOpen(false);
    setActiveSearchIndex(-1);

    if (!requestedRouteSelection.orgId) {
      setLookupResult(null);
      setActiveLookupRequest(null);
      return;
    }

    void loadLookup(
      buildLookupRequest({
        orgId: requestedRouteSelection.orgId,
        periodMonthUtc: '',
        eventType: 'all',
      }),
    );
  }, [closeAccountDialogs, loadLookup, requestedRouteSelection.orgId, requestedSearchValue]);

  React.useEffect(() => {
    if (!normalizedSearchInput) {
      searchRequestIdRef.current += 1;
      writePlatformBillingRouteSelection({ orgId: '' });
      setSearchLoading(false);
      setSearchError('');
      setSearchResults([]);
      setSearchPerformed(false);
      setSearchResultsMode('search');
      setLookupResult(null);
      setActiveLookupRequest(null);
      setLookupError('');
      setPeriodMonthUtcFilter('');
      setEventTypeFilter('all');
      setActiveTab('activity');
      closeAccountDialogs();
      setIsSearchDropdownOpen(false);
      setActiveSearchIndex(-1);
      suppressSearchValueRef.current = '';
      return;
    }

    if (suppressSearchValueRef.current === normalizedSearchInput) {
      suppressSearchValueRef.current = '';
      setSearchLoading(false);
      setSearchError('');
      setSearchResults([]);
      setSearchPerformed(false);
      setSearchResultsMode('search');
      setIsSearchDropdownOpen(false);
      setActiveSearchIndex(-1);
      return;
    }

    void runSearchRequest(normalizedSearchInput, 'search', PLATFORM_BILLING_SEARCH_LIMIT);
  }, [closeAccountDialogs, normalizedSearchInput, runSearchRequest]);

  React.useEffect(() => {
    if (!searchResults.length) {
      setActiveSearchIndex(-1);
      return;
    }
    setActiveSearchIndex((current) => {
      if (current < 0) return 0;
      return Math.min(current, searchResults.length - 1);
    });
  }, [searchResults]);

  const onLoadSearchOrganization = React.useCallback(
    async (organization: DashboardPlatformBillingOrganization) => {
      const request = buildLookupRequest({
        orgId: organization.id,
        periodMonthUtc: periodMonthUtcFilter,
        eventType: eventTypeFilter,
      });
      searchRequestIdRef.current += 1;
      suppressSearchValueRef.current = describeOrganizationTitle(organization);
      setSearchInput(describeOrganizationTitle(organization));
      setIsSearchDropdownOpen(false);
      setActiveSearchIndex(-1);
      setSearchLoading(false);
      setSearchError('');
      setSearchResults([]);
      setSearchPerformed(false);
      setLookupError('');
      setActiveTab('activity');
      closeAccountDialogs();
      const result = await loadLookup(request);
      if (result) {
        skipRequestedRouteSelectionEffectRef.current = true;
        setRequestedRouteSelection({
          orgId: organization.id,
          orgName: describeOrganizationTitle(organization),
        });
        writePlatformBillingRouteSelection({
          orgId: organization.id,
          orgName: describeOrganizationTitle(organization),
          historyMode: 'push',
        });
      }
    },
    [closeAccountDialogs, eventTypeFilter, loadLookup, periodMonthUtcFilter],
  );

  const onSearchInputChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setSearchInput(nextValue);
    setSearchError('');
    setLookupError('');
    setIsSearchDropdownOpen(Boolean(String(nextValue || '').trim()));
    setActiveSearchIndex(0);
  }, []);

  const onSearchFieldFocus = React.useCallback(() => {
    if (normalizedSearchInput) {
      setIsSearchDropdownOpen(true);
      return;
    }
    void runSearchRequest('', 'recent', PLATFORM_BILLING_RECENT_ORGANIZATION_LIMIT);
  }, [normalizedSearchInput, runSearchRequest]);

  const onSearchFieldBlur = React.useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setIsSearchDropdownOpen(false);
  }, []);

  const onSearchInputKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        setIsSearchDropdownOpen(false);
        setActiveSearchIndex(-1);
        return;
      }
      if (event.key === 'ArrowDown') {
        if (searchResults.length === 0) return;
        event.preventDefault();
        setIsSearchDropdownOpen(true);
        setActiveSearchIndex((current) => {
          if (searchResults.length === 0) return -1;
          if (current < 0) return 0;
          return Math.min(current + 1, searchResults.length - 1);
        });
        return;
      }
      if (event.key === 'ArrowUp') {
        if (searchResults.length === 0) return;
        event.preventDefault();
        setIsSearchDropdownOpen(true);
        setActiveSearchIndex((current) => {
          if (searchResults.length === 0) return -1;
          if (current < 0) return searchResults.length - 1;
          return Math.max(current - 1, 0);
        });
        return;
      }
      if (event.key === 'Enter') {
        const selectedMatch =
          searchResults[
            activeSearchIndex >= 0 ? Math.min(activeSearchIndex, searchResults.length - 1) : 0
          ];
        if (!selectedMatch) return;
        event.preventDefault();
        const option = document.getElementById(
          `${searchListboxId}-${buildOrganizationKey(selectedMatch.organization)}`,
        );
        if (!option) {
          void onLoadSearchOrganization(selectedMatch.organization);
          return;
        }
        void blinkMenuItem(option)?.then(() =>
          onLoadSearchOrganization(selectedMatch.organization),
        );
      }
    },
    [activeSearchIndex, onLoadSearchOrganization, searchListboxId, searchResults],
  );

  const reloadAccount = React.useCallback(async () => {
    if (activeLookupRequest) await loadLookup(activeLookupRequest);
    if (lookupOrgId && payments?.orgId === lookupOrgId) await loadPayments(lookupOrgId);
  }, [activeLookupRequest, loadLookup, loadPayments, lookupOrgId, payments?.orgId]);

  const onApplyActivityFilters = React.useCallback(async () => {
    if (!activeLookupRequest) return;
    await loadLookup(
      buildLookupRequest({
        orgId: activeLookupRequest.orgId,
        projectId: activeLookupRequest.projectId,
        periodMonthUtc: periodMonthUtcFilter,
        eventType: eventTypeFilter,
      }),
    );
  }, [activeLookupRequest, eventTypeFilter, loadLookup, periodMonthUtcFilter]);

  const onResetActivityFilters = React.useCallback(() => {
    if (!activeLookupRequest) return;
    setPeriodMonthUtcFilter('');
    setEventTypeFilter('all');
    void loadLookup(
      buildLookupRequest({
        orgId: activeLookupRequest.orgId,
        projectId: activeLookupRequest.projectId,
        periodMonthUtc: '',
        eventType: 'all',
      }),
    );
  }, [activeLookupRequest, loadLookup]);

  const onReverseEntry = React.useCallback((entry: DashboardBillingAccountActivityEntry) => {
    if (entry.type !== 'MANUAL_ADJUSTMENT' || entry.amountMinor === 0) return;
    setAdjustmentDialog({
      kind: entry.amountMinor < 0 ? 'support_credit' : 'admin_debit',
      reversal: { ledgerEntryId: entry.id, amountMinor: Math.abs(entry.amountMinor) },
    });
  }, []);

  const onSubmitAdjustment = React.useCallback(
    async (submission: PlatformAdjustmentSubmission): Promise<void> => {
      if (!lookupResult) return;
      const organization = lookupResult.organization;
      const request = {
        orgId: organization.id,
        amountMinor: submission.amountMinor,
        reasonCode: submission.reasonCode,
        note: submission.note,
        idempotencyKey: submission.idempotencyKey,
        ...(submission.relatedInvoiceId ? { relatedInvoiceId: submission.relatedInvoiceId } : {}),
      };
      const result =
        submission.kind === 'support_credit'
          ? await createDashboardPlatformBillingManualSupportCredit(request)
          : await createDashboardPlatformBillingManualAdminDebit(request);
      const amountLabel = formatUsdMinor(submission.amountMinor);
      const balanceLabel = formatBalanceUsdMinor(result.creditBalanceMinor);
      const name = describeOrganizationTitle(organization);
      if (!result.created) {
        toast.message(
          readPlatformBillingReversedEntryId(submission.idempotencyKey)
            ? t('platformBillingToastAlreadyReversed', { name, balance: balanceLabel })
            : t('platformBillingToastAlreadyHeld', { name, balance: balanceLabel }),
        );
      } else if (submission.kind === 'support_credit') {
        toast.success(
          t('platformBillingToastCreditAdded', {
            amount: amountLabel,
            name,
            balance: balanceLabel,
          }),
        );
      } else {
        toast.success(
          t('platformBillingToastDebited', { amount: amountLabel, name, balance: balanceLabel }),
        );
      }
      setAdjustmentDialog(null);
      await reloadAccount();
    },
    [lookupResult, reloadAccount],
  );

  const onSubmitRefund = React.useCallback(
    async (submission: PlatformRefundSubmission): Promise<void> => {
      if (!lookupResult) return;
      setRefundActionId('create');
      try {
        const result = await createDashboardPlatformBillingRefund({
          orgId: lookupResult.organization.id,
          ...submission,
        });
        toast.success(
          t('platformBillingToastRefundCreated', {
            id: result.refund.id,
            status: describePlatformRefundStatus(result.refund.status),
            balance: formatBalanceUsdMinor(result.creditBalanceMinor),
          }),
        );
        setRefundTarget(null);
        await reloadAccount();
      } finally {
        setRefundActionId('');
      }
    },
    [lookupResult, reloadAccount],
  );

  const onRefundReconcile = React.useCallback(
    async (refundId: string) => {
      if (!lookupResult?.organization.id || !refundId || refundActionId) return;
      setRefundActionId(refundId);
      try {
        const result = await reconcileDashboardPlatformBillingRefund({
          orgId: lookupResult.organization.id,
          refundId,
        });
        toast.success(
          t('platformBillingToastRefundStatus', {
            id: refundId,
            status: describePlatformRefundStatus(result.refund.status),
          }),
        );
        await reloadAccount();
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setRefundActionId('');
      }
    },
    [lookupResult?.organization.id, refundActionId, reloadAccount],
  );

  const accountActivityControls = (
    <div
      className="dashboard-billing-filters"
      role="group"
      aria-label={t('platformBillingFiltersAria')}
    >
      <label className="dashboard-form-field">
        <span>{t('platformBillingPeriod')}</span>
        <input
          className="dashboard-input"
          type="month"
          value={periodMonthUtcFilter}
          onChange={(event) => setPeriodMonthUtcFilter(event.target.value)}
        />
      </label>
      <label className="dashboard-form-field">
        <span>{t('platformBillingEventType')}</span>
        <select
          className="dashboard-input"
          value={eventTypeFilter}
          onChange={(event) =>
            setEventTypeFilter(
              event.target.value === 'all'
                ? 'all'
                : (event.target.value as DashboardBillingAccountActivityEventType),
            )
          }
        >
          {PLATFORM_BILLING_EVENT_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="dashboard-form-actions">
        <button
          type="button"
          className="dashboard-pagination-button"
          onClick={() => {
            void onApplyActivityFilters();
          }}
          disabled={loading || !activeLookupRequest}
        >
          {loading ? t('platformBillingApplying') : t('platformBillingApplyFilters')}
        </button>
        <button
          type="button"
          className="dashboard-pagination-button dashboard-pagination-button--secondary"
          onClick={onResetActivityFilters}
          disabled={loading || !activeLookupRequest}
        >
          {t('platformBillingReset')}
        </button>
      </div>
    </div>
  );

  const showSearchResults =
    isSearchDropdownOpen &&
    (searchLoading || searchPerformed || searchResults.length > 0 || Boolean(searchError));

  const accountBalance = lookupResult ? readLookupBalance(lookupResult) : null;
  const accountLiveState = accountBalance ? resolvePlatformLiveAccessState(accountBalance) : null;
  const accountLiveAccess = accountLiveState ? describePlatformLiveAccess(accountLiveState) : null;
  const accountOrganization = lookupResult
    ? {
        id: lookupResult.organization.id,
        name: describeOrganizationTitle(lookupResult.organization),
      }
    : null;
  const pendingMinor = lookupResult
    ? lookupResult.overview.creditBalanceMinor - lookupResult.overview.availableBalanceMinor
    : 0;

  return (
    <>
      <section className="dashboard-view__section dashboard-billing-filters-panel dashboard-platform-billing-search-card">
        <div className="dashboard-billing-table__intro">
          <div
            className="dashboard-platform-billing-search-combobox"
            onFocus={onSearchFieldFocus}
            onBlur={onSearchFieldBlur}
          >
            <label className="dashboard-form-field">
              <span>{t('platformBillingFindAccount')}</span>
              <input
                className="dashboard-input"
                type="search"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showSearchResults}
                aria-controls={showSearchResults ? searchListboxId : undefined}
                aria-activedescendant={
                  showSearchResults && activeSearchIndex >= 0 && searchResults[activeSearchIndex]
                    ? `${searchListboxId}-${buildOrganizationKey(searchResults[activeSearchIndex]!.organization)}`
                    : undefined
                }
                value={searchInput}
                onChange={onSearchInputChange}
                onKeyDown={onSearchInputKeyDown}
                placeholder={t('platformBillingSearchPlaceholder')}
                autoComplete="off"
              />
            </label>
            {showSearchResults ? (
              <div
                className="dashboard-platform-billing-search-dropdown"
                id={searchListboxId}
                role="listbox"
                aria-label={t('platformBillingMatchingAccounts')}
              >
                {searchLoading ? (
                  <p className="dashboard-platform-billing-search-dropdown__state">
                    {t('platformBillingSearching')}
                  </p>
                ) : searchError ? (
                  <p className="dashboard-platform-billing-search-dropdown__state">
                    {t('platformBillingSearchFailed')}
                  </p>
                ) : searchResults.length === 0 ? (
                  <p className="dashboard-platform-billing-search-dropdown__state">
                    {searchResultsMode === 'recent' ? (
                      t('platformBillingNoOrganizations')
                    ) : (
                      <>
                        {t('platformBillingNoMatchBefore')}
                        <code>{normalizedSearchInput || '-'}</code>
                        {t('platformBillingNoMatchAfter')}
                      </>
                    )}
                  </p>
                ) : (
                  <>
                    {searchResultsMode === 'recent' ? (
                      <p className="dashboard-platform-billing-search-dropdown__heading">
                        {t('platformBillingNewestOrganizations')}
                      </p>
                    ) : null}
                    {searchResults.map((account, index) => {
                      const organizationKey = buildOrganizationKey(account.organization);
                      const isActive = index === activeSearchIndex;
                      return (
                        <button
                          key={organizationKey}
                          id={`${searchListboxId}-${organizationKey}`}
                          type="button"
                          className={`dashboard-platform-billing-search-option${isActive ? ' is-active' : ''}`}
                          role="option"
                          aria-selected={isActive}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setActiveSearchIndex(index)}
                          onClick={(event) => {
                            void blinkMenuItem(event.currentTarget)?.then(() =>
                              onLoadSearchOrganization(account.organization),
                            );
                          }}
                          disabled={loading}
                        >
                          <span className="dashboard-platform-billing-search-option__copy">
                            <strong>{describeOrganizationTitle(account.organization)}</strong>
                            <span>
                              {account.organization.id} · {describeOwners(account.ownerEmails)}
                            </span>
                          </span>
                          <span className="dashboard-platform-billing-search-option__balance">
                            <PlatformLiveAccessPill balance={account.balance} />
                            <strong>
                              {formatBalanceUsdMinor(account.balance.creditBalanceMinor)}
                            </strong>
                          </span>
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            ) : null}
          </div>
          {lookupError ? <p className="dashboard-form-alert">{lookupError}</p> : null}
        </div>
      </section>

      {lookupResult && accountBalance && accountLiveAccess && accountOrganization ? (
        <section
          className="dashboard-view-card dashboard-platform-account"
          aria-label={t('platformBillingAccountAria')}
        >
          <header className="dashboard-platform-account__header">
            <div className="dashboard-platform-account__identity">
              <h2>{accountOrganization.name}</h2>
              <p>
                <code>{accountOrganization.id}</code>
                {' · '}
                {describeOwners(lookupResult.ownerEmails)}
                {lookupResult.projects.length > 0
                  ? ` · ${t(
                      lookupResult.projects.length === 1
                        ? 'platformBillingProjectOne'
                        : 'platformBillingProjectMany',
                      { names: lookupResult.projects.map((project) => project.name).join(', ') },
                    )}`
                  : ` · ${t('platformBillingNoProjects')}`}
              </p>
            </div>
            <div className="dashboard-platform-account__actions">
              <button
                type="button"
                className="dashboard-pagination-button dashboard-pagination-button--primary dashboard-pagination-button--with-icon"
                onClick={() => setAdjustmentDialog({ kind: 'support_credit', reversal: null })}
              >
                <span aria-hidden="true">+</span> {t('platformBillingAddCredit')}
              </button>
              <DashboardTableActionMenu
                ariaLabel={t('platformBillingMoreActions')}
                items={[
                  {
                    label: t('platformBillingDebitBalance'),
                    tone: 'danger',
                    onSelect: () => setAdjustmentDialog({ kind: 'admin_debit', reversal: null }),
                  },
                ]}
              />
            </div>
          </header>

          <div className="dashboard-platform-account__metrics">
            <article className="dashboard-platform-account__metric">
              <p className="dashboard-kpi-card__label">{t('platformBillingBalance')}</p>
              <p
                className={`dashboard-platform-account__balance dashboard-kpi-card__value--${accountLiveAccess.tone}`}
              >
                {formatBalanceUsdMinor(accountBalance.creditBalanceMinor)}
              </p>
              <p className="dashboard-kpi-card__hint">
                {pendingMinor > 0
                  ? t('platformBillingAvailableHeld', {
                      available: formatBalanceUsdMinor(lookupResult.overview.availableBalanceMinor),
                      held: formatUsdMinor(pendingMinor),
                    })
                  : t('platformBillingLowBalanceWarning', {
                      threshold: formatUsdMinor(accountBalance.lowBalanceThresholdMinor),
                    })}
              </p>
            </article>
            <article className="dashboard-platform-account__metric">
              <p className="dashboard-kpi-card__label">{t('platformBillingLiveEnvironments')}</p>
              <p
                className={`dashboard-platform-account__state dashboard-kpi-card__value--${accountLiveAccess.tone}`}
              >
                {accountLiveAccess.label}
              </p>
              <p className="dashboard-kpi-card__hint">
                {accountLiveState === 'BLOCKED'
                  ? t('platformBillingNeedsBalance')
                  : t('platformBillingCanCreateEnvironments')}
              </p>
            </article>
            <article className="dashboard-platform-account__metric">
              <p className="dashboard-kpi-card__label">{t('platformBillingThisMonth')}</p>
              <p className="dashboard-platform-account__state">
                {t('platformBillingActiveWallets', {
                  count: lookupResult.overview.monthlyActiveResources,
                })}
              </p>
              <p className="dashboard-kpi-card__hint">
                {t('platformBillingUsedBought', {
                  used: formatUsdMinor(lookupResult.overview.recentUsageDebitMinor),
                  bought: formatUsdMinor(lookupResult.overview.recentCreditPurchasedMinor),
                })}
              </p>
            </article>
          </div>

          <div
            className="dashboard-platform-account__tabs"
            role="tablist"
            aria-label={t('platformBillingRecordsAria')}
          >
            {(
              [
                ['activity', t('platformBillingTabActivity')],
                ['payments', t('platformBillingTabPayments')],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`${tabsId}-${tab}`}
                aria-selected={activeTab === tab}
                aria-controls={`${tabsId}-${tab}-panel`}
                className="dashboard-platform-account__tab"
                onClick={() => setActiveTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${tabsId}-${activeTab}-panel`}
            aria-labelledby={`${tabsId}-${activeTab}`}
          >
            {activeTab === 'activity' ? (
              <PlatformActivityTable
                entries={lookupResult.activity}
                controls={accountActivityControls}
                onReverse={onReverseEntry}
              />
            ) : (
              <PlatformPaymentsPanel
                payments={payments?.orgId === lookupOrgId ? payments : null}
                refunds={lookupResult.refunds}
                refundActionId={refundActionId}
                onRefund={setRefundTarget}
                onReconcile={(refundId) => {
                  void onRefundReconcile(refundId);
                }}
              />
            )}
          </div>

          <PlatformAdjustmentDialog
            request={adjustmentDialog}
            organization={accountOrganization}
            balance={accountBalance}
            onClose={() => setAdjustmentDialog(null)}
            onSubmit={onSubmitAdjustment}
          />
          <PlatformRefundDialog
            target={refundTarget}
            organization={accountOrganization}
            onClose={() => setRefundTarget(null)}
            onSubmit={onSubmitRefund}
          />
        </section>
      ) : null}
    </>
  );
}

export default PlatformBillingView;
