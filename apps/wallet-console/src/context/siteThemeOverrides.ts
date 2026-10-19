import type { SeamsConfigsInput, ThemeProps } from '@seams/wallet/react';
import { PAPER_LIGHT_COLORS, PAPER_THEME_TOKENS } from './app-themes';

// `satisfies` keeps the exact shape, so the landing preview can use it as a resolved appearance.
export const SITE_APPEARANCE = {
  theme: {
    id: 'paper',
    mode: 'light',
    colors: PAPER_LIGHT_COLORS,
  },
  palette: 'default',
} satisfies NonNullable<SeamsConfigsInput['appearance']>;

export const SITE_THEME_TOKEN_OVERRIDES: ThemeProps['tokens'] = PAPER_THEME_TOKENS;
