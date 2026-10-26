import type { AppearanceConfig } from '@wallet-ui/core/types/seams';
import { locale } from '@/marketing/i18n/browser';
import { showcaseAppearance } from './showcaseTheme';

/* The homepage's preview theme with the sample merchant's maroon accent,
   shared by the checkout dialog's shell and the wallet approval inside it.
   Light button text keeps the maroon readable on every theme. */
export function checkoutAppearance(): AppearanceConfig {
  const appearance = showcaseAppearance(locale);
  return {
    ...appearance,
    theme: {
      ...appearance.theme,
      colors: {
        ...appearance.theme.colors,
        buttonBackground: '#852f43',
        buttonHoverBackground: '#6e2537',
        textButton: '#fdfcfc',
        focus: '#852f43',
      },
    },
  };
}
