import { locale, t } from '@/marketing/i18n/browser';
import {
  Fingerprint,
  Globe,
  ListChecks,
  Rocket,
  Sprout,
  TrendingUp,
  Wallet,
  Wrench,
} from 'lucide-react';
import { aboutMenu, type DropdownPane, type SiteNavbarConfig } from '@seams-internal/site-navbar';

/* The 'documentation' pane id historically maps to the "Features" trigger and
   vice versa; ids are kept stable so aria wiring and pane ordering don't churn. */
const documentationDropdownPane: DropdownPane = {
  id: 'documentation',
  label: t('features'),
  kicker: t('features'),
  rows: [
    {
      title: t('simpleWallets'),
      description: t('simpleWalletsDescription'),
      to: '/features/',
      icon: Wallet,
      field: 'teal-peach',
    },
    {
      title: t('biometricAuth'),
      description: t('biometricDescription'),
      to: '/features/#biometrics',
      icon: Fingerprint,
      field: 'aqua-evergreen',
    },
    {
      title: t('globalSelfHosted'),
      description: t('globalSelfHostedDescription'),
      to: '/features/#global',
      icon: Globe,
      field: 'azure-coral',
    },
  ],
  // the front page's component showcase, where the built-in screens play
  highlight: {
    title: t('componentsCard'),
    description: t('componentsCardDescription'),
    to: '/wallet#components',
    field: 'teal-peach',
  },
  footerLinks: [
    { label: t('allFeatures'), to: '/features/' },
    // the front page's hero holds the live wallet demo
    { label: t('liveDemo'), to: '/wallet' },
  ],
};

const productsDropdownPane: DropdownPane = {
  id: 'products',
  label: t('documentation'),
  kicker: t('documentation'),
  rows: [
    {
      title: t('getStarted'),
      description: t('getStartedDescription'),
      to: '/docs/',
      icon: Rocket,
      field: 'sky-sand',
    },
    {
      title: t('toolsGuides'),
      description: t('toolsDescription'),
      to: '/docs/guides/',
      icon: Wrench,
      field: 'slate-amber',
    },
    {
      title: t('useCasesNav'),
      description: t('useCasesDescription'),
      to: '/docs/use-cases/',
      icon: ListChecks,
      field: 'mauve-ember',
    },
  ],
  highlight: {
    title: t('architecture'),
    description: t('architectureDescription'),
    to: '/docs/concepts/architecture',
    field: 'slate-amber',
  },
  footerLinks: [
    { label: t('readDocs'), to: '/docs/' },
    { label: t('releases'), to: '/docs/releases' },
  ],
};

const pricingDropdownPane: DropdownPane = {
  id: 'pricing',
  label: t('pricing'),
  kicker: t('plans'),
  rows: [
    {
      title: t('free'),
      description: t('freeDescription'),
      to: '/pricing/#free',
      icon: Sprout,
      meta: '$0',
      field: 'sky-sand',
    },
    {
      title: 'Growth',
      description: t('growthDescription'),
      to: '/pricing/#growth',
      icon: TrendingUp,
      meta: t('monthlyPrice'),
      field: 'azure-coral',
    },
    {
      title: 'Pro',
      description: t('proDescription'),
      to: '/pricing/#pro',
      icon: Rocket,
      meta: t('proMonthlyPrice'),
      field: 'vermilion-sky',
    },
  ],
  // Enterprise takes the large card; the phone menu lists it under the plans.
  highlight: {
    title: 'Enterprise',
    description: t('enterpriseDescription'),
    to: '/pricing/#enterprise',
    field: 'onyx-dusk',
  },
  footerLinks: [
    { label: t('comparePlans'), to: '/pricing/' },
    { label: t('estimatePrice'), to: '/pricing/#calculator' },
  ],
};

// The About Us menu is shared with seams.sh.
const about = aboutMenu(locale);

export const siteNavbarConfig: SiteNavbarConfig = {
  labels: {
    primary: t('primaryNavigation'),
    home: t('walletHome'),
    dashboard: t('dashboard'),
    openMenu: t('openMenu'),
    closeMenu: t('closeMenu'),
    ...about.labels,
  },
  panes: {
    products: productsDropdownPane,
    documentation: documentationDropdownPane,
    about: about.pane,
    pricing: pricingDropdownPane,
  },
  // The logo stays on the Wallet site; only the footer logo leads to seams.sh.
  homeHref: '/wallet',
  aboutHref: about.href,
  dashboardHref: '/dashboard',
  mobilePlanLinks: [
    {
      title: 'Enterprise',
      description: t('enterpriseDescription'),
      to: '/pricing/#enterprise',
    },
  ],
};
