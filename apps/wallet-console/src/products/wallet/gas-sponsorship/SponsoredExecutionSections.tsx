import React from 'react';
import {
  DashboardTable,
  DashboardTableCell,
  DashboardTableHeader,
  DashboardTableHeaderCell,
  DashboardTableIntro,
  DashboardTableRow,
  DashboardTableState,
  DashboardTableStatus,
  dashboardTableColumns,
  useDashboardTablePagination,
} from '@core/dashboard/components/DashboardTable';
import type {
  DashboardSponsoredExecutionHistoryEntry,
  DashboardSponsoredExecutionReconciliationEntry,
  DashboardSponsoredExecutionReconciliationPage,
} from './consoleSponsoredExecutionApi';
import { formatUsdMinor } from '@core/dashboard/routes/billing/consoleBillingApi';
import { formatTimestampUtcParts } from '@core/dashboard/routes/billing/billingSections';

const BILLING_SPONSORED_HISTORY_TABLE_COLUMNS = dashboardTableColumns(
  '1.05fr',
  '0.95fr',
  '1.25fr',
  '1.05fr',
  '0.95fr',
  '1.4fr',
);
const BILLING_SPONSORED_RECONCILIATION_TABLE_COLUMNS = dashboardTableColumns(
  '0.95fr',
  '1fr',
  '1.2fr',
  '0.95fr',
  '1.1fr',
  '1.5fr',
);

function formatSponsoredChainLabel(input: DashboardSponsoredExecutionHistoryEntry): string {
  return input.chainFamily === 'near' ? 'NEAR delegate' : 'EVM call';
}

function describeSponsoredReceiptStatus(input: DashboardSponsoredExecutionHistoryEntry): string {
  if (input.receiptStatus === 'broadcast_failed') return 'Broadcast failed';
  if (input.receiptStatus === 'rpc_rejected') return 'RPC rejected';
  if (input.receiptStatus === 'reverted') return 'Reverted';
  return 'Succeeded';
}

function getSponsoredReceiptTone(
  input: DashboardSponsoredExecutionHistoryEntry,
): 'success' | 'warning' | 'danger' {
  if (input.receiptStatus === 'success') return 'success';
  if (input.receiptStatus === 'reverted') return 'warning';
  return 'danger';
}

function getSponsoredChargeTone(
  input: DashboardSponsoredExecutionHistoryEntry,
): 'success' | 'neutral' {
  return input.charged ? 'success' : 'neutral';
}

function formatSponsoredChargeAmount(input: DashboardSponsoredExecutionHistoryEntry): string {
  if (!input.charged) return '$0.00';
  return formatUsdMinor(input.settledSpendMinor || 0);
}

function describeSponsoredChargeHint(
  input: DashboardSponsoredExecutionHistoryEntry,
): string | null {
  if (!input.charged) {
    return input.chargedReason ? `Not charged: ${input.chargedReason}` : 'Not charged';
  }
  if (input.billingLedgerEntryId) return `Ledger ${input.billingLedgerEntryId}`;
  return input.pricingVersion ? `Pricing ${input.pricingVersion}` : null;
}

function describeReconciliationStatus(
  input: DashboardSponsoredExecutionReconciliationEntry,
): string {
  switch (input.status) {
    case 'matched':
      return 'Matched';
    case 'missing_billing_debit':
      return 'Missing debit';
    case 'amount_mismatch':
      return 'Amount mismatch';
    case 'unexpected_billing_debit':
      return 'Unexpected debit';
    case 'not_charged':
      return 'Not charged';
    default:
      return input.status;
  }
}

function getReconciliationTone(
  input: DashboardSponsoredExecutionReconciliationEntry,
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (input.status === 'matched') return 'success';
  if (input.status === 'not_charged') return 'neutral';
  if (input.status === 'amount_mismatch') return 'warning';
  return 'danger';
}

export function SponsoredExecutionHistorySection(props: {
  entries: DashboardSponsoredExecutionHistoryEntry[];
  loading?: boolean;
  error: string;
  scopeDescription?: string;
}): React.JSX.Element {
  const { entries, loading = false, error, scopeDescription } = props;
  const pagination = useDashboardTablePagination(entries, {
    initialRowsPerPage: 10,
    itemLabel: 'execution',
    itemLabelPlural: 'executions',
  });
  return (
    <DashboardTable
      ariaLabel="Sponsored execution history"
      className="dashboard-billing-activity-table dashboard-billing-sponsored-table"
      columns={BILLING_SPONSORED_HISTORY_TABLE_COLUMNS}
      pagination={error || loading ? undefined : pagination.pagination}
    >
      <DashboardTableIntro className="dashboard-billing-table__intro">
        <div className="dashboard-billing-activity-table__heading">
          <h3 className="dashboard-billing-table__title">Sponsored usage history</h3>
          <p className="dashboard-billing-table__description">
            Last 90 days of sponsored executions with receipt outcomes and billed spend.
          </p>
          {scopeDescription ? (
            <p className="dashboard-pagination-note">{scopeDescription}</p>
          ) : null}
        </div>
      </DashboardTableIntro>
      {loading ? (
        <DashboardTableState>Loading sponsored execution history...</DashboardTableState>
      ) : error ? (
        <DashboardTableState>{error}</DashboardTableState>
      ) : entries.length === 0 ? (
        <DashboardTableState>No sponsored executions found for this scope yet.</DashboardTableState>
      ) : (
        <>
          <DashboardTableHeader>
            <DashboardTableHeaderCell>When (UTC)</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>Network</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>Policy</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>Charge</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>Receipt</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>Reference</DashboardTableHeaderCell>
          </DashboardTableHeader>
          {pagination.rows.map((entry) => {
            const createdAt = formatTimestampUtcParts(entry.createdAt);
            const chargeHint = describeSponsoredChargeHint(entry);
            return (
              <DashboardTableRow key={entry.id}>
                <DashboardTableCell title={entry.createdAt}>
                  <div className="dashboard-billing-activity-table__stack">
                    <strong className="dashboard-data-table__summary">{createdAt.primary}</strong>
                    {createdAt.secondary ? (
                      <span className="dashboard-data-table__subline dashboard-data-table__subline--muted dashboard-billing-activity-table__timestamp-detail">
                        {createdAt.secondary}
                      </span>
                    ) : null}
                  </div>
                </DashboardTableCell>
                <DashboardTableCell title={formatSponsoredChainLabel(entry)}>
                  <div className="dashboard-billing-activity-table__stack">
                    <strong className="dashboard-data-table__summary">
                      {formatSponsoredChainLabel(entry)}
                    </strong>
                    <span className="dashboard-data-table__subline dashboard-data-table__subline--muted">
                      {entry.route}
                    </span>
                  </div>
                </DashboardTableCell>
                <DashboardTableCell title={entry.policyNameAtEvent || entry.policyId}>
                  <div className="dashboard-billing-activity-table__stack">
                    <strong className="dashboard-data-table__summary">
                      {entry.policyNameAtEvent || entry.policyId}
                    </strong>
                    <span className="dashboard-data-table__subline dashboard-data-table__subline--muted">
                      {entry.environmentId}
                    </span>
                  </div>
                </DashboardTableCell>
                <DashboardTableCell title={formatSponsoredChargeAmount(entry)} align="end">
                  <div className="dashboard-billing-activity-table__stack">
                    <strong className="dashboard-data-table__summary">
                      {formatSponsoredChargeAmount(entry)}
                    </strong>
                    <DashboardTableStatus tone={getSponsoredChargeTone(entry)}>
                      {entry.charged ? 'Charged' : 'Not charged'}
                    </DashboardTableStatus>
                    {chargeHint ? (
                      <span className="dashboard-data-table__subline dashboard-data-table__subline--muted dashboard-billing-activity-table__detail">
                        {chargeHint}
                      </span>
                    ) : null}
                  </div>
                </DashboardTableCell>
                <DashboardTableCell title={describeSponsoredReceiptStatus(entry)}>
                  <div className="dashboard-billing-activity-table__stack">
                    <DashboardTableStatus tone={getSponsoredReceiptTone(entry)}>
                      {describeSponsoredReceiptStatus(entry)}
                    </DashboardTableStatus>
                    {entry.errorCode ? (
                      <span className="dashboard-data-table__subline dashboard-data-table__subline--muted dashboard-billing-activity-table__detail">
                        {entry.errorCode}
                      </span>
                    ) : null}
                  </div>
                </DashboardTableCell>
                <DashboardTableCell title={entry.targetRef}>
                  <div className="dashboard-billing-activity-table__stack">
                    <code
                      className="dashboard-billing-activity-table__token"
                      title={entry.targetRef}
                    >
                      {entry.targetRef}
                    </code>
                    {entry.txOrExecutionRef || entry.accountRef ? (
                      <span className="dashboard-data-table__subline dashboard-data-table__subline--muted dashboard-billing-activity-table__detail">
                        {entry.txOrExecutionRef || entry.accountRef}
                      </span>
                    ) : null}
                  </div>
                </DashboardTableCell>
              </DashboardTableRow>
            );
          })}
        </>
      )}
    </DashboardTable>
  );
}

export function SponsoredExecutionReconciliationSection(props: {
  sectionId?: string;
  page: DashboardSponsoredExecutionReconciliationPage | null;
  loading?: boolean;
  error: string;
  scopeDescription?: string;
}): React.JSX.Element {
  const { sectionId, page, loading = false, error } = props;
  const items = page?.items || [];
  const summary = page?.summary || null;
  const pagination = useDashboardTablePagination(items, {
    initialRowsPerPage: 10,
    itemLabel: 'reconciliation row',
    itemLabelPlural: 'reconciliation rows',
  });
  /* Reconciliation is an operations-grade audit view; collapse it by default
     so the billing page leads with balance and top-up. The scope note is
     already shown once on the usage-history section above. */
  return (
    <details
      id={sectionId}
      className="dashboard-view__section dashboard-billing-execution-card"
      aria-label="Sponsored execution reconciliation"
    >
      <summary>Reconciliation</summary>
      <div className="dashboard-billing-table__intro">
        <p className="dashboard-billing-table__description">
          Compare sponsored execution records against linked billing debits.
        </p>
      </div>
      {summary ? (
        <div className="dashboard-kpi-grid dashboard-kpi-grid--content dashboard-billing-reconciliation-summary">
          <article className="dashboard-kpi-card">
            <p className="dashboard-kpi-card__label">Matched</p>
            <p className="dashboard-kpi-card__value">{summary.matchedCount}</p>
            <p className="dashboard-kpi-card__hint">Records aligned with billing</p>
          </article>
          <article className="dashboard-kpi-card">
            <p className="dashboard-kpi-card__label">Mismatches</p>
            <p className="dashboard-kpi-card__value">{summary.mismatchCount}</p>
            <p className="dashboard-kpi-card__hint">
              Missing, unexpected, or amount-mismatched debits
            </p>
          </article>
          <article className="dashboard-kpi-card">
            <p className="dashboard-kpi-card__label">Not charged</p>
            <p className="dashboard-kpi-card__value">{summary.notChargedCount}</p>
            <p className="dashboard-kpi-card__hint">
              Execution records intentionally left unbilled
            </p>
          </article>
        </div>
      ) : null}
      <DashboardTable
        ariaLabel="Sponsored execution reconciliation rows"
        className="dashboard-billing-activity-table dashboard-billing-sponsored-table"
        columns={BILLING_SPONSORED_RECONCILIATION_TABLE_COLUMNS}
        pagination={error || loading ? undefined : pagination.pagination}
      >
        {loading ? (
          <DashboardTableState>Loading reconciliation data...</DashboardTableState>
        ) : error ? (
          <DashboardTableState>{error}</DashboardTableState>
        ) : items.length === 0 ? (
          <DashboardTableState>
            No reconciliation records found for this scope yet.
          </DashboardTableState>
        ) : (
          <>
            <DashboardTableHeader>
              <DashboardTableHeaderCell>Status</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>When (UTC)</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>Policy</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>Settled spend</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>Billing debit</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>Notes</DashboardTableHeaderCell>
            </DashboardTableHeader>
            {pagination.rows.map((entry) => {
              const createdAt = formatTimestampUtcParts(entry.record.createdAt);
              const settledSpend = entry.record.settledSpendMinor || 0;
              return (
                <DashboardTableRow key={entry.record.id}>
                  <DashboardTableCell title={describeReconciliationStatus(entry)}>
                    <DashboardTableStatus tone={getReconciliationTone(entry)}>
                      {describeReconciliationStatus(entry)}
                    </DashboardTableStatus>
                  </DashboardTableCell>
                  <DashboardTableCell title={entry.record.createdAt}>
                    <div className="dashboard-billing-activity-table__stack">
                      <strong className="dashboard-data-table__summary">{createdAt.primary}</strong>
                      {createdAt.secondary ? (
                        <span className="dashboard-data-table__subline dashboard-data-table__subline--muted dashboard-billing-activity-table__timestamp-detail">
                          {createdAt.secondary}
                        </span>
                      ) : null}
                    </div>
                  </DashboardTableCell>
                  <DashboardTableCell
                    title={entry.record.policyNameAtEvent || entry.record.policyId}
                  >
                    <div className="dashboard-billing-activity-table__stack">
                      <strong className="dashboard-data-table__summary">
                        {entry.record.policyNameAtEvent || entry.record.policyId}
                      </strong>
                      <span className="dashboard-data-table__subline dashboard-data-table__subline--muted">
                        {formatSponsoredChainLabel(entry.record)}
                      </span>
                    </div>
                  </DashboardTableCell>
                  <DashboardTableCell title={formatUsdMinor(settledSpend)} align="end">
                    <div className="dashboard-billing-activity-table__stack">
                      <strong className="dashboard-data-table__summary">
                        {formatUsdMinor(settledSpend)}
                      </strong>
                      <span className="dashboard-data-table__subline dashboard-data-table__subline--muted">
                        {entry.record.charged ? 'Charged execution' : 'Not charged'}
                      </span>
                    </div>
                  </DashboardTableCell>
                  <DashboardTableCell
                    title={entry.billingDebit?.id || entry.record.billingLedgerEntryId || '-'}
                  >
                    {entry.billingDebit || entry.record.billingLedgerEntryId ? (
                      <div className="dashboard-billing-activity-table__stack">
                        <code className="dashboard-billing-activity-table__token">
                          {entry.billingDebit?.id || entry.record.billingLedgerEntryId}
                        </code>
                        {entry.billingDebit ? (
                          <span className="dashboard-data-table__subline dashboard-data-table__subline--muted">
                            {formatUsdMinor(entry.billingDebit.amountMinor)}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      '-'
                    )}
                  </DashboardTableCell>
                  <DashboardTableCell title={entry.mismatchReasons.join(', ') || undefined}>
                    <div className="dashboard-billing-activity-table__stack">
                      <strong className="dashboard-data-table__summary">
                        {entry.mismatchReasons[0] || 'Billing debit linked'}
                      </strong>
                      {entry.mismatchReasons.length > 1 ? (
                        <span className="dashboard-data-table__subline dashboard-data-table__subline--muted dashboard-billing-activity-table__detail">
                          {entry.mismatchReasons.slice(1).join(', ')}
                        </span>
                      ) : null}
                    </div>
                  </DashboardTableCell>
                </DashboardTableRow>
              );
            })}
          </>
        )}
      </DashboardTable>
    </details>
  );
}
