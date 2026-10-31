import {
  parseWalletRoute,
  type WalletRoute,
} from '../../apps/wallet-console/src/marketing/i18n/locale';

const known: WalletRoute = { kind: 'page', page: 'pricing', locale: 'ja' };
const missing: WalletRoute = { kind: 'not-found' };
// @ts-expect-error A known page requires a language.
const noLanguage: WalletRoute = { kind: 'page', page: 'pricing' };
// @ts-expect-error An unknown URL cannot carry a page identity.
const mixed: WalletRoute = { kind: 'not-found', page: 'home' };
// @ts-expect-error A spread cannot turn a known page into an unknown route.
const spread: WalletRoute = { ...known, kind: 'not-found' };
const parsed = parseWalletRoute(new URL('https://wallet.seams.sh/ja/pricing/'), '/');
if (parsed.kind === 'page') {
  const language: 'en' | 'ja' = parsed.locale;
  void language;
}
void [known, missing, noLanguage, mixed, spread];
