import { t } from '@/marketing/i18n/browser';
import {
  Building2,
  Fingerprint,
  Globe,
  ListChecks,
  PenLine,
  Rocket,
  Sprout,
  TrendingUp,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { DropdownPane, SiteNavbarConfig } from '@seams-internal/site-navbar';

/* The 'documentation' pane id historically maps to the "Products" trigger and
   vice versa; ids are kept stable so aria wiring and pane ordering don't churn. */
const documentationDropdownPane: DropdownPane = {
  id: 'documentation',
  label: t('products'),
  kicker: t('products'),
  rows: [
    {
      title: t('simpleWallets'),
      description: t('simpleWalletsDescription'),
      to: '/features/#recovery',
      icon: Wallet,
      field: 'teal-peach',
    },
    {
      title: t('globalSelfHosted'),
      description: t('globalSelfHostedDescription'),
      to: '/features/#global',
      icon: Globe,
      field: 'azure-coral',
    },
    {
      title: t('biometricAuth'),
      description: t('biometricDescription'),
      to: '/features/#biometrics',
      icon: Fingerprint,
      field: 'aqua-evergreen',
    },
  ],
  highlight: {
    title: t('liveDemo'),
    description: t('liveDemoDescription'),
    to: '/wallet',
    field: 'teal-peach',
  },
  footerLinks: [
    { label: t('allFeatures'), to: '/features/' },
    { label: t('planPricing'), to: '/pricing/' },
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

const aboutDropdownPane: DropdownPane = {
  id: 'about',
  label: t('aboutUs'),
  kicker: t('company'),
  rows: [
    {
      title: t('companyLink'),
      description: t('companyDescription'),
      to: '/company/#company',
      icon: Building2,
      field: 'sky-sand',
    },
    {
      title: t('blog'),
      description: t('blogDescription'),
      to: '/company/#blog',
      icon: PenLine,
      field: 'teal-peach',
    },
  ],
  footerLinks: [],
};

export const siteNavbarConfig: SiteNavbarConfig = {
  labels: {
    primary: t('primaryNavigation'),
    home: t('seamsHome'),
    dashboard: t('dashboard'),
    openMenu: t('openMenu'),
    closeMenu: t('closeMenu'),
    companyOverview: t('companyOverview'),
    companyMission: t('companyMission'),
  },
  panes: {
    products: productsDropdownPane,
    documentation: documentationDropdownPane,
    about: aboutDropdownPane,
    pricing: pricingDropdownPane,
  },
  homeHref: '/',
  aboutHref: '/company/#company',
  dashboardHref: '/dashboard',
  mobilePlanLinks: [
    {
      title: 'Enterprise',
      description: t('enterpriseDescription'),
      to: '/pricing/#enterprise',
    },
  ],
};
