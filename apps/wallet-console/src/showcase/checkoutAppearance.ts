import type { AppearanceConfig } from '@wallet-ui/core/types/seams';
import { paperIframeAppearance } from '@/context/app-themes';

/* The homepage's Paper wallet theme with the sample merchant's maroon accent,
   shared by the checkout dialog's shell and the wallet approval inside it. */
export function checkoutAppearance(): AppearanceConfig {
  const appearance = paperIframeAppearance();
  return {
    ...appearance,
    theme: {
      ...appearance.theme,
      colors: {
        ...appearance.theme.colors,
        buttonBackground: '#852f43',
        buttonHoverBackground: '#6e2537',
        focus: '#852f43',
      },
    },
  };
}
