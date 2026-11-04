import type { WalletLocale } from '@seams/wallet';
import type { AppearanceConfig } from '@wallet-ui/core/types/seams';
import { demoIframeAppearance, demoThemePreset, type DemoThemePreset } from '@/context/app-themes';

/* The canvas frames show the wallet's own cards, so they take the wallet
   frames' colors, the same as the settings drawer and the hosted menu. */
function framePreset(preset: DemoThemePreset): DemoThemePreset {
  return preset.frameColors ? { ...preset, colors: preset.frameColors } : preset;
}

/* The wallet page names its preview theme in the frame's `theme` query
   value, so each showcase component matches the hero's theme switch. */
export const showcasePreset = framePreset(
  demoThemePreset(new URLSearchParams(window.location.search).get('theme')),
);

export function showcaseAppearance(locale: WalletLocale): AppearanceConfig {
  return demoIframeAppearance(showcasePreset, locale);
}
