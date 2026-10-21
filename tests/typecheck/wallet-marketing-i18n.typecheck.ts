import { translate } from '../../apps/wallet-console/src/marketing/i18n/catalog';
import type { Locale } from '../../apps/wallet-console/src/marketing/i18n/locale';

translate('ja', 'heroTitle');

// @ts-expect-error A message must exist in the shared catalog.
translate('ja', 'missingMessage');

// @ts-expect-error Core translation functions require a supported locale.
translate('fr', 'heroTitle');

// @ts-expect-error Each message requires a Japanese translation.
const incompleteMessage: Record<Locale, string> = { en: 'Hello' };
void incompleteMessage;
