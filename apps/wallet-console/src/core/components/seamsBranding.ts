export const SEAMS_BRAND_ASSETS = {
  mark: '/seams-wallet-mark.svg',
  wordmark: '/seams-wallet-wordmark.svg',
} as const;

export type SeamsLogoVariant = 'app-icon' | 'transparent-mark' | 'marketing-mark';

export function resolveSeamsLogoAsset(_variant: SeamsLogoVariant): string {
  return SEAMS_BRAND_ASSETS.mark;
}
