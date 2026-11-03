import React from 'react';
import { t } from '@core/i18n';
import type {
  DashboardBillingRefund,
  DashboardBillingCreditPackId,
  DashboardStripeCheckoutSessionRequest,
} from './consoleBillingApi';
import { formatUsdMinor } from './consoleBillingApi';

const PRESET_CREDIT_PACK_OPTIONS = [
  { id: 'usd_10', label: '$10', detail: t('billingTopUpOption10') },
  { id: 'usd_25', label: '$25', detail: t('billingTopUpOption25') },
  { id: 'usd_50', label: '$50', detail: t('billingTopUpOption50') },
] as const;

function formatRefundStatus(status: DashboardBillingRefund['status']): string {
  switch (status) {
    case 'requested':
      return t('billingRefundRequested');
    case 'provider_pending':
      return t('billingRefundProcessing');
    case 'succeeded':
      return t('billingRefundRefunded');
    case 'failed':
      return t('billingRefundFailed');
    case 'canceled':
      return t('billingRefundCanceled');
  }
}

function refundStatusBadgeClassName(status: DashboardBillingRefund['status']): string {
  const tone =
    status === 'succeeded'
      ? 'success'
      : status === 'failed' || status === 'canceled'
        ? 'danger'
        : 'warning';
  return `dashboard-data-table__badge dashboard-data-table__badge--${tone}`;
}

export interface BillingAccountViewProps {
  canManageBilling: boolean;
  checkoutActionError: string;
  startingCheckoutPackId: DashboardBillingCreditPackId | '';
  refunds: DashboardBillingRefund[];
  refundsLoading: boolean;
  refundsError: string;
  onStartStripeCheckout: (
    request: Pick<DashboardStripeCheckoutSessionRequest, 'creditPackId'>,
  ) => void;
}

export function BillingAccountView(props: BillingAccountViewProps): React.JSX.Element {
  const {
    canManageBilling,
    checkoutActionError,
    startingCheckoutPackId,
    refunds,
    refundsLoading,
    refundsError,
    onStartStripeCheckout,
  } = props;
  const [selectedPackId, setSelectedPackId] = React.useState<DashboardBillingCreditPackId>(
    PRESET_CREDIT_PACK_OPTIONS[0].id,
  );
  const selectedPreset = PRESET_CREDIT_PACK_OPTIONS.find((pack) => pack.id === selectedPackId);
  const buyDisabled = !canManageBilling || Boolean(startingCheckoutPackId);
  const buyLabel = startingCheckoutPackId
    ? t('billingStartingCheckout')
    : t('billingBuyAmount', { amount: selectedPreset?.label || '' });

  return (
    <>
      <section className="dashboard-view__section" aria-label={t('billingTopUpActionsLabel')}>
        <h2>{t('billingTopUpTitle')}</h2>
        <p className="dashboard-pagination-note">{t('billingTopUpIntro')}</p>
        {!canManageBilling ? (
          <p className="dashboard-pagination-note">{t('billingTopUpNeedsAccess')}</p>
        ) : null}
        {checkoutActionError ? (
          <p className="dashboard-pagination-note">{checkoutActionError}</p>
        ) : null}
        <div
          className="dashboard-policy-toggle-grid dashboard-billing-top-up-options"
          role="group"
          aria-label={t('billingTopUpAmountLabel')}
        >
          {PRESET_CREDIT_PACK_OPTIONS.map((pack) => (
            <button
              key={pack.id}
              type="button"
              aria-pressed={selectedPackId === pack.id}
              className={[
                'dashboard-policy-segment',
                selectedPackId === pack.id ? 'dashboard-policy-segment--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSelectedPackId(pack.id)}
            >
              {pack.label}
            </button>
          ))}
        </div>
        <p className="dashboard-pagination-note">{selectedPreset?.detail}</p>
        <div className="dashboard-form-actions">
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--primary"
            onClick={() => onStartStripeCheckout({ creditPackId: selectedPackId })}
            disabled={buyDisabled}
          >
            {buyLabel}
          </button>
        </div>
      </section>

      <section className="dashboard-table-wrapper" aria-label={t('billingRefundHistory')}>
        <div className="dashboard-table-limit dashboard-billing-table__intro">
          <h2 className="dashboard-billing-table__title">{t('billingRefundHistory')}</h2>
          <p className="dashboard-billing-table__description">{t('billingRefundHistoryIntro')}</p>
          {refundsError ? <p className="dashboard-pagination-note">{refundsError}</p> : null}
        </div>
        {refundsLoading ? (
          <p className="dashboard-table-limit">{t('billingRefundHistoryLoading')}</p>
        ) : refunds.length === 0 ? (
          <p className="dashboard-table-limit">{t('billingRefundHistoryEmpty')}</p>
        ) : (
          <div className="dashboard-billing-timeline">
            {refunds.map((refund) => (
              <article className="dashboard-billing-timeline__item" key={refund.id}>
                <div className="dashboard-billing-timeline__header">
                  <p className="dashboard-billing-timeline__title">
                    {t('billingRefundTitle', { amount: formatUsdMinor(refund.amountMinor) })}
                  </p>
                  <span className={refundStatusBadgeClassName(refund.status)}>
                    {formatRefundStatus(refund.status)}
                  </span>
                </div>
                <p className="dashboard-billing-timeline__meta">
                  {new Date(refund.createdAt).toLocaleString()} •{' '}
                  {t('billingRefundPurchase', { id: refund.purchaseId })}
                </p>
                <p className="dashboard-pagination-note">{refund.reason}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export default BillingAccountView;
