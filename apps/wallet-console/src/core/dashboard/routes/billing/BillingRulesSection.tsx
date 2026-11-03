import React from 'react';
import { t } from '@core/i18n';
import { textWithNodes } from './billingShared';

/** Public billing terms shared by the account, plan, and invoice pages. */
export function BillingRulesSection(): React.JSX.Element {
  return (
    <section className="dashboard-view__section" aria-labelledby="billing-rules-title">
      <h2 id="billing-rules-title">{t('billingRulesTitle')}</h2>
      <p>{t('billingRulesIntro')}</p>
      <details>
        <summary>{t('billingRulesSummary')}</summary>
        <h3>{t('billingRulesMauTitle')}</h3>
        <p>{t('billingRulesMauBody')}</p>
        <h3>{t('billingRulesPlansTitle')}</h3>
        <p>{t('billingRulesFreeBody')}</p>
        <p>
          {textWithNodes(t('billingRulesPlanPageBody'), {
            planLink: <a href="/dashboard/billing/plan">{t('billingRulesPlanPageLink')}</a>,
          })}
        </p>
        <h3>{t('billingRulesInvoicesTitle')}</h3>
        <p>{t('billingRulesInvoicesBody')}</p>
        <h3>{t('billingRulesCreditTitle')}</h3>
        <p>{t('billingRulesCreditBody')}</p>
        <h3>{t('billingRulesFailedTitle')}</h3>
        <p>{t('billingRulesFailedBody')}</p>
        <h3>{t('billingRulesReturnTitle')}</h3>
        <p>{t('billingRulesReturnBody')}</p>
        <h3>{t('billingRulesPrepaidTitle')}</h3>
        <p>{t('billingRulesPrepaidBody')}</p>
      </details>
    </section>
  );
}
