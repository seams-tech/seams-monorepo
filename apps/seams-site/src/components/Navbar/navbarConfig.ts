import { translate, type Translate } from '@/i18n/catalog';
import type { Locale } from '@/i18n/locale';
import { Bot, Store, Wallet } from 'lucide-react';
import {
  aboutMenu,
  CONTACT_LINK_TARGET,
  type DropdownPane,
  type SiteNavbarConfig,
} from '@seams-internal/site-navbar';

/* seams.sh is the landing site for three products: Satyr (the ecommerce
   suite for cafés and pâtisseries), BakeryOS (its production workspace, with
   robotics to come) and Seams Wallet (a standalone stablecoin wallet). BakeryOS
   has its section on the Satyr page. Satyr and BakeryOS have no docs yet: these
   placeholder paths are the one place to point them at the real pages. The site
   shows no pricing for now; Wallet pricing lives on the Wallet site. */
const productLinks = {
  satyr: { landing: '/ecommerce', docs: '/docs/satyr/' },
  bakeryOs: { landing: '/ecommerce#bakeryos', docs: '/docs/bakeryos/' },
  wallet: { landing: '/wallet', docs: '/docs/' },
} as const;

const BAKERY_OS = 'BakeryOS';
const SEAMS_WALLET = 'Seams Wallet';

/* The 'documentation' pane id historically maps to the "Products" trigger and
   vice versa; ids are kept stable so aria wiring and pane ordering don't churn. */
function documentationDropdownPane(t: Translate): DropdownPane {
  return {
    id: 'documentation',
    label: t('products'),
    kicker: t('products'),
    rows: [
      {
        title: t('satyrProduct'),
        description: t('satyrNav'),
        to: productLinks.satyr.landing,
        icon: Store,
        field: 'azure-coral',
      },
      {
        title: BAKERY_OS,
        description: t('bakeryNav'),
        to: productLinks.bakeryOs.landing,
        icon: Bot,
        field: 'apricot-beam',
      },
      {
        title: SEAMS_WALLET,
        description: t('walletNav'),
        to: productLinks.wallet.landing,
        icon: Wallet,
        field: 'teal-peach',
      },
    ],
    highlight: {
      title: t('satyrTour'),
      description: t('satyrTourCopy'),
      to: productLinks.satyr.landing,
      field: 'azure-coral',
    },
    footerLinks: [{ label: t('talkUs'), to: CONTACT_LINK_TARGET }],
  };
}

function productsDropdownPane(t: Translate): DropdownPane {
  return {
    id: 'products',
    label: t('documentation'),
    kicker: t('documentation'),
    rows: [
      {
        title: t('satyrProduct'),
        description: t('satyrDocs'),
        to: productLinks.satyr.docs,
        icon: Store,
        field: 'azure-coral',
      },
      {
        title: BAKERY_OS,
        description: t('bakeryDocs'),
        to: productLinks.bakeryOs.docs,
        icon: Bot,
        field: 'apricot-beam',
      },
      {
        title: SEAMS_WALLET,
        description: t('getStartedCopy'),
        to: productLinks.wallet.docs,
        icon: Wallet,
        field: 'teal-peach',
      },
    ],
    highlight: {
      title: t('architecture'),
      description: t('architectureCopy'),
      to: '/docs/concepts/architecture',
      field: 'slate-amber',
    },
    footerLinks: [
      { label: t('readDocs'), to: productLinks.wallet.docs },
      { label: t('releases'), to: '/docs/releases' },
    ],
  };
}

export function getSiteNavbarConfig(locale: Locale): SiteNavbarConfig {
  const t = translate.bind(null, locale);
  const about = aboutMenu(locale);
  return {
    labels: {
      primary: t('primary'),
      home: t('seamsHome'),
      dashboard: t('dashboard'),
      openMenu: t('openMenu'),
      closeMenu: t('closeMenu'),
      ...about.labels,
    },
    panes: {
      products: productsDropdownPane(t),
      documentation: documentationDropdownPane(t),
      about: about.pane,
    },
    homeHref: '/',
    aboutHref: about.href,
    dashboardHref: '/dashboard',
  };
}
