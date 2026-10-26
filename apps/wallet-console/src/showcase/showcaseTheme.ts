import type { WalletLocale } from '@seams/wallet';
import type { AppearanceConfig } from '@wallet-ui/core/types/seams';
import { demoIframeAppearance, demoThemePreset } from '@/context/app-themes';

/* The wallet page names its preview theme in the frame's `theme` query
   value, so each showcase component matches the hero's theme switch. */
export const showcasePreset = demoThemePreset(
  new URLSearchParams(window.location.search).get('theme'),
);

export function showcaseAppearance(locale: WalletLocale): AppearanceConfig {
  return demoIframeAppearance(showcasePreset, locale);
}
