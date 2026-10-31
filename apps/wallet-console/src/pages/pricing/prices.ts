import type { Locale } from '@/marketing/i18n/locale';

export const PRICING_USD = {
  growthBase: 99,
  growthPerUser: 0.004,
  growthPer1000Signatures: 0.05,
  // Placeholder Pro prices: not approved and not in docs/wallet-saas/pricing.md yet.
  proBase: 399,
  proPerUser: 0.0035,
  proPer1000Signatures: 0.04,
  enterprisePerUser: 0.003,
  enterprisePer1000Signatures: 0.03,
} as const;

// Billing uses USD on every locale. Display the currency that Stripe collects.
export function formatPrice(locale: Locale, priceUsd: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'code',
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(priceUsd);
}

function priceLabels(locale: Locale): Record<keyof typeof PRICING_USD | 'zero', string> {
  // Four US-dollar digits keep the Pro rate, $0.0035, apart from Growth's $0.004.
  const rateDigits = 4;
  return {
    zero: formatPrice(locale, 0),
    growthBase: formatPrice(locale, PRICING_USD.growthBase),
    growthPerUser: formatPrice(locale, PRICING_USD.growthPerUser, rateDigits),
    growthPer1000Signatures: formatPrice(locale, PRICING_USD.growthPer1000Signatures, rateDigits),
    proBase: formatPrice(locale, PRICING_USD.proBase),
    proPerUser: formatPrice(locale, PRICING_USD.proPerUser, rateDigits),
    proPer1000Signatures: formatPrice(locale, PRICING_USD.proPer1000Signatures, rateDigits),
    enterprisePerUser: formatPrice(locale, PRICING_USD.enterprisePerUser, rateDigits),
    enterprisePer1000Signatures: formatPrice(
      locale,
      PRICING_USD.enterprisePer1000Signatures,
      rateDigits,
    ),
  };
}

const labels = { en: priceLabels('en'), ja: priceLabels('ja') };

export function formatPricingMessage(locale: Locale, message: string): string {
  const prices = labels[locale];
  return message
    .replaceAll('{zero}', prices.zero)
    .replaceAll('{growthBase}', prices.growthBase)
    .replaceAll('{growthPerUser}', prices.growthPerUser)
    .replaceAll('{growthPer1000Signatures}', prices.growthPer1000Signatures)
    .replaceAll('{proBase}', prices.proBase)
    .replaceAll('{proPerUser}', prices.proPerUser)
    .replaceAll('{proPer1000Signatures}', prices.proPer1000Signatures)
    .replaceAll('{enterprisePerUser}', prices.enterprisePerUser)
    .replaceAll('{enterprisePer1000Signatures}', prices.enterprisePer1000Signatures);
}
