import { translate, type Translate } from '@/i18n/catalog';
import type { Locale } from '@/i18n/locale';
import { Bot, Store, Wallet } from 'lucide-react';
import {
  aboutMenu,
  CONTACT_LINK_TARGET,
  type DropdownPane,
  type SiteNavbarConfig,
} from '@seams-internal/site-navbar';

/* seams.sh is the landing site for three products: Satyr (ecommerce agents
   and café management), BakeryOS (robotics for bakeries; its thesis is open)
   and Seams Wallet (a standalone stablecoin wallet). Satyr and BakeryOS have
   no docs or pricing pages yet: these placeholder paths are the one place to
   point them at the real pages. Wallet pricing lives on the Wallet site. */
const productLinks = {
  satyr: { landing: '/ecommerce', docs: '/docs/satyr/', pricing: '/pricing/#satyr' },
  bakeryOs: { landing: '/bakeryos', docs: '/docs/bakeryos/', pricing: '/pricing/#bakeryos' },
  wallet: { landing: '/wallet', docs: '/docs/', pricing: '/wallet/pricing/' },
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
      title: t('liveDemo'),
      description: t('liveDemoCopy'),
      to: productLinks.wallet.landing,
      field: 'teal-peach',
    },
    footerLinks: [{ label: t('planPricing'), to: productLinks.wallet.pricing }],
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

function pricingDropdownPane(t: Translate): DropdownPane {
  return {
    id: 'pricing',
    label: t('pricing'),
    kicker: t('plans'),
    rows: [
      {
        title: t('satyrProduct'),
        description: t('satyrPricing'),
        to: productLinks.satyr.pricing,
        icon: Store,
        field: 'azure-coral',
      },
      {
        title: BAKERY_OS,
        description: t('bakeryPricing'),
        to: productLinks.bakeryOs.pricing,
        icon: Bot,
        field: 'apricot-beam',
      },
      {
        title: SEAMS_WALLET,
        description: t('walletPricing'),
        to: productLinks.wallet.pricing,
        icon: Wallet,
        meta: t('freePrice'),
        field: 'teal-peach',
      },
    ],
    // Enterprise takes the large card; the phone menu lists it under the plans.
    highlight: {
      title: 'Enterprise',
      description: t('enterpriseNav'),
      to: '/wallet/pricing/#enterprise',
      field: 'onyx-dusk',
    },
    footerLinks: [
      { label: t('comparePlans'), to: productLinks.wallet.pricing },
      { label: t('estimatePrice'), to: '/wallet/pricing/#calculator' },
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
      pricing: pricingDropdownPane(t),
    },
    homeHref: '/',
    aboutHref: about.href,
    dashboardHref: '/dashboard',
    mobilePlanLinks: [
      {
        title: t('talkUs'),
        description: t('talkCopy'),
        to: CONTACT_LINK_TARGET,
      },
    ],
  };
}
