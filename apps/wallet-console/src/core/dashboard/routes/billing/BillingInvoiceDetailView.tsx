import React from 'react';
import { t } from '@core/i18n';
import {
  DashboardTable,
  DashboardTableCell,
  DashboardTableHeader,
  DashboardTableHeaderCell,
  DashboardTableIntro,
  DashboardTableRow,
  DashboardTableState,
  dashboardTableColumns,
  useDashboardTablePagination,
} from '../../components/DashboardTable';
import {
  formatUsdMinor,
  type DashboardBillingInvoiceActivity,
  type DashboardBillingInvoice,
  type DashboardBillingInvoiceLineItem,
} from './consoleBillingApi';
import {
  BillingMetricsGrid,
  billingDocumentTypeLabel,
  formatInvoiceStatusLabel,
  formatTimestamp,
  getInvoiceStatusBadgeClassName,
  textWithNodes,
  type BillingMetric,
} from './billingShared';
import {
  DashboardPageSkeleton,
  DashboardTableSkeletonRows,
} from '../../components/DashboardSkeleton';

const BILLING_INVOICE_LINE_ITEMS_TABLE_COLUMNS = dashboardTableColumns(
  1,
  0.7,
  1.45,
  0.7,
  0.55,
  0.7,
  0.7,
  0.95,
);

export interface BillingInvoiceDetailViewProps {
  invoiceId: string;
  invoice: DashboardBillingInvoice | null;
  invoiceDetailLoading: boolean;
  invoiceDetailError: string;
  invoiceActivityLoading: boolean;
  invoiceActivityError: string;
  invoiceActivity: DashboardBillingInvoiceActivity | null;
  lineItemsLoading: boolean;
  lineItemsError: string;
  lineItems: DashboardBillingInvoiceLineItem[];
  downloadingInvoicePdfId: string;
  invoiceDownloadError: string;
  onBackToInvoices: () => void;
  onDownloadInvoicePdf: (invoiceId: string) => Promise<void>;
}

export function BillingInvoiceDetailView(props: BillingInvoiceDetailViewProps): React.JSX.Element {
  const {
    invoiceId,
    invoice,
    invoiceDetailLoading,
    invoiceDetailError,
    invoiceActivityLoading,
    invoiceActivityError,
    invoiceActivity,
    lineItemsLoading,
    lineItemsError,
    lineItems,
    downloadingInvoicePdfId,
    invoiceDownloadError,
    onBackToInvoices,
    onDownloadInvoicePdf,
  } = props;

  const detailMetrics: BillingMetric[] = [
    {
      label: t('billingDocumentType'),
      value: invoice
        ? billingDocumentTypeLabel(invoice.documentType)
        : t('billingMetricDocumentFallback'),
      hint: invoice?.id || invoiceId,
    },
    {
      label: t('billingMetricStatus'),
      value: invoice ? formatInvoiceStatusLabel(invoice.status) : '-',
      hint:
        invoice?.documentType === 'PURCHASE_RECEIPT'
          ? t('billingStatusHintReceipt')
          : t('billingStatusHintStatement'),
    },
    {
      label: t('billingMetricAmount'),
      value: formatUsdMinor(Number(invoice?.amountDueMinor || 0)),
      hint: t('billingPaidAmount', {
        amount: formatUsdMinor(Number(invoice?.amountPaidMinor || 0)),
      }),
    },
    {
      label: t('billingMetricPeriod'),
      value: invoice?.periodMonthUtc || '-',
      hint: t('billingCreatedAt', { time: formatTimestamp(invoice?.createdAt || null) }),
    },
  ];
  const lineItemsPagination = useDashboardTablePagination(lineItems, {
    disabled: lineItemsLoading,
    itemLabel: t('billingItemLineItem'),
    itemLabelPlural: t('billingItemLineItems'),
  });
  const hasInternalActivityEntries = Boolean(
    invoiceActivity?.entries.some((entry) => entry.visibility === 'INTERNAL'),
  );

  return (
    <>
      <section
        className="dashboard-view__section dashboard-billing-invoice-hero"
        aria-label={t('billingDocumentDetailHeader')}
      >
        <div className="dashboard-billing-invoice-hero__actions">
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--secondary"
            onClick={onBackToInvoices}
          >
            {t('billingBackToInvoices')}
          </button>
          <button
            type="button"
            className="dashboard-pagination-button"
            onClick={() => {
              void onDownloadInvoicePdf(invoiceId);
            }}
            disabled={downloadingInvoicePdfId === invoiceId}
          >
            {downloadingInvoicePdfId === invoiceId
              ? t('billingDownloadingPdfEllipsis')
              : t('billingDownloadPdf')}
          </button>
        </div>
        <div className="dashboard-billing-invoice-hero__copy">
          <p className="dashboard-billing-invoice-hero__eyebrow">{t('billingDocumentEyebrow')}</p>
          <h2>{invoice?.id || invoiceId}</h2>
          <p>{t('billingDocumentIntro')}</p>
        </div>
        {invoiceDownloadError ? (
          <p className="dashboard-pagination-note">{invoiceDownloadError}</p>
        ) : null}
      </section>

      {invoiceDetailLoading ? (
        <section className="dashboard-view__section">
          <DashboardPageSkeleton
            label={t('billingLoadingDocument')}
            metrics={3}
            rows={4}
            columns={5}
          />
        </section>
      ) : invoiceDetailError ? (
        <section className="dashboard-view__section">
          <p>{t('billingDocumentUnavailable', { error: invoiceDetailError })}</p>
        </section>
      ) : !invoice ? (
        <section className="dashboard-view__section">
          <p>{t('billingDocumentNotFound', { id: invoiceId })}</p>
        </section>
      ) : (
        <>
          <BillingMetricsGrid
            metrics={detailMetrics}
            ariaLabel={t('billingDocumentSummaryMetricsLabel')}
          />

          {invoice.documentType === 'USAGE_STATEMENT' ? (
            <section
              className="dashboard-view__section"
              aria-label={t('billingDocumentAccountActivityLabel')}
            >
              <p className="dashboard-info-banner">
                {textWithNodes(t('billingUsageStatementNote'), {
                  usageLink: (
                    <a
                      href={`/dashboard/billing/account?periodMonthUtc=${encodeURIComponent(invoice.periodMonthUtc)}#billing-usage-costs`}
                    >
                      {t('billingUsageCostsLink')}
                    </a>
                  ),
                  activityLink: (
                    <a href="/dashboard/billing/account#billing-account-activity">
                      {t('billingAccountActivityLink')}
                    </a>
                  ),
                })}
              </p>
            </section>
          ) : null}

          <section
            className="dashboard-table-wrapper"
            aria-label={t('billingActivityTimelineLabel')}
          >
            <div className="dashboard-table-limit dashboard-billing-table__intro">
              <h3 className="dashboard-billing-table__title">{t('billingDocumentActivity')}</h3>
              <p className="dashboard-billing-table__description">
                {t('billingDocumentActivityIntro')}
              </p>
              {hasInternalActivityEntries ? (
                <p className="dashboard-pagination-note">{t('billingInternalNote')}</p>
              ) : null}
              {invoiceActivityError ? (
                <p className="dashboard-pagination-note">{invoiceActivityError}</p>
              ) : null}
            </div>
            {invoiceActivityLoading ? (
              <p className="dashboard-table-limit">{t('billingLoadingDocumentActivity')}</p>
            ) : invoiceActivity?.entries.length ? (
              <div className="dashboard-billing-timeline">
                {invoiceActivity.entries.map((entry) => (
                  <article className="dashboard-billing-timeline__item" key={entry.id}>
                    <div className="dashboard-billing-timeline__header">
                      <p className="dashboard-billing-timeline__title">{entry.summary}</p>
                      <span className={getInvoiceStatusBadgeClassName(entry.toState)}>
                        {formatInvoiceStatusLabel(entry.toState)}
                      </span>
                    </div>
                    <p className="dashboard-billing-timeline__meta">
                      {formatTimestamp(entry.occurredAt)}
                      {entry.actorUserId ? ` • ${entry.actorUserId}` : ''}
                      {entry.visibility === 'INTERNAL' ? ` • ${t('billingInternalOnly')}` : ''}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="dashboard-table-limit">{t('billingNoDocumentActivity')}</p>
            )}
          </section>

          <DashboardTable
            ariaLabel={t('billingLineItemsTableLabel')}
            columns={BILLING_INVOICE_LINE_ITEMS_TABLE_COLUMNS}
            pagination={lineItemsPagination.pagination}
          >
            <DashboardTableIntro className="dashboard-billing-table__intro">
              <h3 className="dashboard-billing-table__title">{t('billingLineItems')}</h3>
              <p className="dashboard-billing-table__description">{t('billingLineItemsIntro')}</p>
            </DashboardTableIntro>
            <DashboardTableHeader>
              <DashboardTableHeaderCell>{t('billingColLineItemId')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('billingColType')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('billingColDescription')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('billingColPeriod')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('billingColQuantity')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('billingColUnitAmount')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('billingColAmount')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('billingColDocument')}</DashboardTableHeaderCell>
            </DashboardTableHeader>
            {lineItemsLoading ? (
              <DashboardTableSkeletonRows label={t('billingLoadingLineItems')} columns={8} />
            ) : lineItemsError ? (
              <DashboardTableState>
                {t('billingLineItemsUnavailable', { error: lineItemsError })}
              </DashboardTableState>
            ) : lineItems.length === 0 ? (
              <DashboardTableState>{t('billingNoLineItems')}</DashboardTableState>
            ) : (
              <>
                {lineItemsPagination.rows.map((lineItem) => (
                  <DashboardTableRow key={lineItem.id}>
                    <DashboardTableCell title={lineItem.id}>{lineItem.id}</DashboardTableCell>
                    <DashboardTableCell>{invoiceItemLabel(lineItem.itemType)}</DashboardTableCell>
                    <DashboardTableCell title={lineItem.description}>
                      {lineItem.description || '-'}
                    </DashboardTableCell>
                    <DashboardTableCell>{lineItem.periodMonthUtc || '-'}</DashboardTableCell>
                    <DashboardTableCell>{String(lineItem.quantity)}</DashboardTableCell>
                    <DashboardTableCell>
                      {formatUsdMinor(lineItem.unitAmountMinor)}
                    </DashboardTableCell>
                    <DashboardTableCell>{formatUsdMinor(lineItem.amountMinor)}</DashboardTableCell>
                    <DashboardTableCell title={lineItem.invoiceId} truncate>
                      {lineItem.invoiceId}
                    </DashboardTableCell>
                  </DashboardTableRow>
                ))}
              </>
            )}
          </DashboardTable>
        </>
      )}
    </>
  );
}

export default BillingInvoiceDetailView;

function invoiceItemLabel(type: string): string {
  switch (type) {
    case 'PLAN_BASE_FEE':
      return t('billingItemPlanBaseFee');
    case 'PLAN_SIGNING_USAGE':
      return t('billingItemSigningUsage');
    case 'PRODUCT_EXECUTION_DEBIT':
      return t('billingItemExecutionUsage');
    case 'CREDIT_TOP_UP':
      return t('billingItemCreditPurchase');
    case 'ACTIVE_RESOURCE_USAGE_DEBIT':
      return t('billingItemActiveResourceUsage');
    default:
      return t('billingItemAdjustment');
  }
}
