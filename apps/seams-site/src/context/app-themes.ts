import { SHAPE_PRESETS } from '@seams/wallet/react';
import type { SeamsConfigsInput, ThemeProps, WalletShapeId } from '@seams/wallet/react';

type SdkAppearance = NonNullable<SeamsConfigsInput['appearance']>;

/* Contained drop shadows — the SDK default shadows.lg overflows the demo cell
   and clips; these keep the card lift within bounds. */
const CONTAINED_SHADOW_LIGHT =
  '0 2px 6px -2px rgba(15, 23, 42, 0.12), 0 12px 28px -16px rgba(15, 23, 42, 0.28)';
const CONTAINED_SHADOW_DARK =
  '0 2px 6px -2px rgba(0, 0, 0, 0.5), 0 14px 30px -16px rgba(0, 0, 0, 0.7)';

// ============================================================================
// Live-demo theme presets (fed to the hosted auth menu via the SDK Theme provider)
// ============================================================================

// "Paper" — the ElevenLabs style: eggshell paper, ink buttons, warm
// taupe/stone neutrals, and soft blue accents for focused details.
export const PAPER_LIGHT_COLORS: Record<string, string> = {
  primary: '#2f9a76',
  primaryHover: '#157f5f',
  secondary: '#44403b',
  secondaryHover: '#000000',
  accent: '#2f9a76',

  textPrimary: '#000000',
  textSecondary: '#777169',
  textMuted: '#a59f97',
  textButton: '#fdfcfc',

  buttonBackground: '#000000',
  buttonHoverBackground: '#262626',
  // quiet bordered-white secondary (Google SSO): one black CTA per card,
  // like the ElevenLabs button hierarchy
  secondaryButtonBackground: '#ffffff',
  secondaryButtonHoverBackground: '#f5f3f1',
  secondaryButtonBorder: '#dcd6cd',
  secondaryButtonText: '#000000',

  // white menu card; the reference's eggshell #fdfcfc read too warm here
  colorBackground: '#ffffff',
  surface: '#ffffff',
  // chip behind the passkey halo icon: same subtle grey as the tx-details
  // box so the two read as one family
  passkeyHaloBackground: '#f8f8f7',
  surface2: '#f5f3f1',
  surface3: '#ebe8e4',
  surface4: '#e1ddd7',
  txDetailsBackground: '#f8f8f7',

  hover: '#f5f3f1',
  active: '#ebe8e4',
  focus: '#000000',

  success: '#157f5f',
  warning: '#b45309',
  error: '#ff4704',
  info: '#2f9a76',

  borderPrimary: '#ebe8e4',
  borderSecondary: '#e5e5e5',
  borderHover: '#d6d1cb',

  highlightPrimary: '#2f9a76',
  highlightRow: 'rgba(47, 154, 118, 0.12)',
  highlightHalo: '#c3e5d7',
  // one accent in the tx tree: the receiver/contract address. Method names
  // and amounts read in ink (ElevenLabs accent discipline).
  highlightReceiver: '#157f5f',
  highlightMethodName: '#000000',
  highlightAmount: '#000000',
};

// "Carbon" — the SDK's stock dark slate ramp (hue-240 oklch tokens from
// theme/palette.json, resolved to sRGB). Every control is a slate slab; the
// primary CTA leads by sitting one step lighter on the ramp rather than by
// inverting to white.
export const CARBON_DARK_COLORS: Record<string, string> = {
  primary: '#5cacff',
  primaryHover: '#499fff',
  secondary: '#876cca',
  secondaryHover: '#9b78de',
  accent: '#00cb9b',

  textPrimary: '#f4f5f6',
  textSecondary: '#8b959d',
  textMuted: '#626e76',
  textButton: '#f4f5f6',

  // slate600 — the lit step the reference card uses for its active segment;
  // one rung above the slabs, so the CTA leads without leaving the ramp
  buttonBackground: '#3c4a54',
  buttonHoverBackground: '#4c5c68',
  // secondary (Google SSO) rides the same slate slab as the other
  // non-primary actions, so only the CTA sits lifted
  secondaryButtonBackground: '#252f37',
  secondaryButtonHoverBackground: '#303c45',
  secondaryButtonBorder: '#3e4952',
  secondaryButtonText: '#f4f5f6',

  colorBackground: '#12171a',
  // surface backs the slate slabs: secondary buttons, Scan-and-Link, and
  // the square-shape input field
  surface: '#252f37',
  // chip behind the passkey halo icon: one step down from the slabs
  passkeyHaloBackground: '#1a2329',
  // surface2 is the shared hover step: the Scan-and-Link button takes it
  // directly, the SSO button via secondaryButtonHoverBackground. Both must
  // resolve to the same value or the two slabs light up differently.
  surface2: '#303c45',
  surface3: '#10171c',
  surface4: '#0a1116',
  txDetailsBackground: '#1a2329',

  hover: '#303c45',
  active: '#323c43',
  focus: '#5cacff',

  success: '#00cb9b',
  warning: '#cea700',
  error: '#ff7a80',
  info: '#5cacff',

  borderPrimary: '#323c43',
  borderSecondary: '#303c45',
  borderHover: '#3e4952',

  highlightPrimary: '#5cacff',
  highlightRow: 'rgba(92, 172, 255, 0.12)',
  highlightHalo: '#9ecdff',
  // one accent in the tx tree, mirroring Paper: receiver in blue, method
  // names and amounts in off-white ink
  highlightReceiver: '#5cacff',
  highlightMethodName: '#f4f5f6',
  highlightAmount: '#f4f5f6',
};

// "Pastel Dark" — cool midnight surfaces with seafoam, lavender, and peach.
// Deeper lavender icon highlights keep the light glyphs readable.
const PASTEL_DARK_COLORS: Record<string, string> = {
  primary: '#9dddcb',
  primaryHover: '#85cfbb',
  secondary: '#d1c2ef',
  secondaryHover: '#c2b0e4',
  accent: '#d1c2ef',

  textPrimary: '#e8ebf4',
  textSecondary: '#adb4c8',
  textMuted: '#949baf',
  textButton: '#1a1d26',

  buttonBackground: '#9dddcb',
  buttonHoverBackground: '#85cfbb',
  // lavender pastel secondary (Google SSO) button
  secondaryButtonBackground: '#d1c2ef',
  secondaryButtonHoverBackground: '#c2b0e4',
  secondaryButtonBorder: 'transparent',
  secondaryButtonText: '#1a1d26',

  colorBackground: '#1a1d26',
  surface: '#222633',
  surface2: '#2c3243',
  surface3: '#645383',
  surface4: '#766496',
  txDetailsBackground: '#2c3243',

  hover: '#2c3243',
  active: '#3c4253',
  focus: '#d1c2ef',

  success: '#a9d5aa',
  lastUsedBadgeBackground: '#d1c2ef',
  lastUsedBadgeText: '#1a1d26',
  warning: '#e9c89b',
  error: '#f2a6ab',
  info: '#a1c6e6',

  borderPrimary: '#3c4253',
  borderSecondary: '#303544',
  borderHover: '#576078',

  highlightPrimary: '#9dddcb',
  highlightRow: 'rgba(157, 221, 203, 0.12)',
  highlightHalo: '#d1c2ef',
  highlightReceiver: '#9dddcb',
  highlightMethodName: '#e8ebf4',
  highlightAmount: '#e9c89b',
};

// "Pastel" — the Pastel Rainbow palette (kdesign.co #09): paper cream,
// mint #C9E4DE, baby blue #C6DEF1, lavender #DBCDF0, and pink #F2C6DE.
// Pastels can't carry white text, so the primary button is baby blue with plum
// ink, and the semantic tones are deepened from their pastel.
const PASTEL_LIGHT_COLORS: Record<string, string> = {
  // deepened from the baby blue: primary also colors text (active seg label,
  // links), where #C6DEF1 fails contrast; the button itself stays pastel via
  // buttonBackground
  primary: '#6f9fd8',
  primaryHover: '#5a8cc7',
  secondary: '#55505e',
  secondaryHover: '#2f2a38',
  accent: '#DBCDF0',

  textPrimary: '#2f2a38',
  textSecondary: '#6f6a7a',
  textMuted: '#a8a2b3',
  textButton: '#2f2a38',

  buttonBackground: '#C6DEF1',
  buttonHoverBackground: '#aed0ec',
  // lavender secondary (Google SSO) button, the palette's second accent
  secondaryButtonBackground: '#DBCDF0',
  secondaryButtonHoverBackground: '#cfbfe9',
  secondaryButtonBorder: 'transparent',

  // subtle near-white cream menu card with lightly warmer controls and chrome
  colorBackground: '#fffefd',
  surface: '#fffdf9',
  // light-grey chip behind the passkey halo icon (surface ≈ modal bg here);
  // kept a touch warmer/darker than the modal bg so the chip stays visible
  passkeyHaloBackground: '#efeadf',
  surface2: '#fffaf3',
  surface3: '#F2C6DE',
  surface4: '#DBCDF0',
  txDetailsBackground: '#fffaf3',

  hover: '#fffbf6',
  active: '#fff8ee',
  focus: '#8fb9de',

  success: '#4f9e83',
  lastUsedBadgeBackground: '#F2C6DE',
  lastUsedBadgeText: '#2f2a38',
  warning: '#e6c891',
  error: '#d4547a',
  info: '#6f9fd8',

  borderPrimary: '#f4eedf',
  borderSecondary: '#faf4e9',
  borderHover: '#eadfcb',

  highlightPrimary: '#8fb9de',
  highlightRow: 'rgba(198, 222, 241, 0.28)',
  highlightHalo: '#C6DEF1',
  highlightReceiver: '#6f9fd8',
  highlightMethodName: '#2f2a38',
  highlightAmount: '#d4547a',
};

export type DemoThemeId = 'paper' | 'carbon' | 'pastel' | 'pastel-dark';

export interface DemoThemePreset {
  id: DemoThemeId;
  label: string;
  /** Theme mode the SDK resolves against (picks light/dark tokens + data attr). */
  mode: 'light' | 'dark';
  /** Swatch shown in the theme switcher (the card background). */
  swatch: string;
  /** The active mode's color token map (source of truth for both consumers below). */
  colors: Record<string, string>;
  /** Component geometry for this preset. */
  shape: WalletShapeId;
}

export const DEMO_THEME_PRESETS: DemoThemePreset[] = [
  {
    id: 'paper',
    label: 'Paper',
    mode: 'light',
    swatch: '#fdfcfc',
    colors: PAPER_LIGHT_COLORS,
    shape: 'square',
  },
  {
    id: 'carbon',
    label: 'Carbon',
    mode: 'dark',
    swatch: '#12171a',
    colors: CARBON_DARK_COLORS,
    shape: 'square',
  },
  {
    id: 'pastel',
    label: 'Pastel',
    mode: 'light',
    // lavender reads most distinctly "pastel" next to the other swatches
    swatch: '#DBCDF0',
    colors: PASTEL_LIGHT_COLORS,
    shape: 'square',
  },
  {
    id: 'pastel-dark',
    label: 'Pastel Dark',
    mode: 'dark',
    swatch: '#1a1d26',
    colors: PASTEL_DARK_COLORS,
    shape: 'square',
  },
];

/** Build the React `<Theme tokens={...}>` value for a preset (includes a contained shadow). */
export function demoReactTokens(preset: DemoThemePreset): ThemeProps['tokens'] {
  const shadows = { lg: preset.mode === 'dark' ? CONTAINED_SHADOW_DARK : CONTAINED_SHADOW_LIGHT };
  const shape = SHAPE_PRESETS[preset.shape];
  return preset.mode === 'dark'
    ? { dark: { colors: preset.colors, shadows, shape } }
    : { light: { colors: preset.colors, shadows, shape } };
}

/** Build the wallet-iframe appearance (colors + shape) for a preset — fed to seams.config.setAppearance. */
export function demoIframeAppearance(preset: DemoThemePreset): SdkAppearance {
  return {
    theme: {
      id: preset.id,
      mode: preset.mode,
      colors: preset.colors,
      /* Send the full shape record because the host merges appearance updates. */
      shape: { ...SHAPE_PRESETS[preset.shape] },
    },
    palette: 'default',
  };
}

export const PAPER_THEME_TOKENS: ThemeProps['tokens'] = {
  light: {
    colors: PAPER_LIGHT_COLORS,
  },
};
