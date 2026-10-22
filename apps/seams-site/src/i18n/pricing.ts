import type { Locale } from './locale';

export const PRICING_USD = {
  growthBase: 99,
  growthPerUser: 0.004,
  growthPer1000Signatures: 0.05,
  enterprisePerUser: 0.003,
  enterprisePer1000Signatures: 0.03,
} as const;

// Japanese display prices use the approved Growth price as a fixed conversion ratio.
const GROWTH_BASE_JPY = 15_500;

export function formatPrice(locale: Locale, priceUsd: number, maximumFractionDigits = 0): string {
  const amount = locale === 'ja' ? (priceUsd * GROWTH_BASE_JPY) / PRICING_USD.growthBase : priceUsd;
  return new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    style: 'currency',
    currency: locale === 'ja' ? 'JPY' : 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(amount);
}

function priceLabels(locale: Locale): Record<keyof typeof PRICING_USD | 'zero', string> {
  const rateDigits = locale === 'ja' ? 2 : 3;
  return {
    zero: formatPrice(locale, 0),
    growthBase: formatPrice(locale, PRICING_USD.growthBase),
    growthPerUser: formatPrice(locale, PRICING_USD.growthPerUser, rateDigits),
    growthPer1000Signatures: formatPrice(locale, PRICING_USD.growthPer1000Signatures, rateDigits),
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
    .replaceAll('{enterprisePerUser}', prices.enterprisePerUser)
    .replaceAll('{enterprisePer1000Signatures}', prices.enterprisePer1000Signatures);
}
