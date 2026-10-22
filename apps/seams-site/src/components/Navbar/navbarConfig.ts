import { translate, type Translate } from '@/i18n/catalog';
import type { Locale } from '@/i18n/locale';
import {
  Bot,
  Building2,
  Fingerprint,
  Gauge,
  LifeBuoy,
  ListChecks,
  PenLine,
  Rocket,
  Sprout,
  TrendingUp,
  Wallet,
  Wrench,
} from 'lucide-react';
import { type DropdownPane, type SiteNavbarConfig } from '@seams-internal/site-navbar';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';

/* The 'documentation' pane id historically maps to the "Products" trigger and
   vice versa; ids are kept stable so aria wiring and pane ordering don't churn. */
function documentationDropdownPane(t: Translate): DropdownPane {
  return {
    id: 'documentation',
    label: t('products'),
    kicker: t('products'),
    rows: [
      {
        title: t('embeddedWallet'),
        description: t('embeddedNav'),
        to: '/wallet',
        icon: Wallet,
        field: 'teal-peach',
      },
      {
        title: t('ecommerceAgents'),
        description: t('agentsNav'),
        to: '/ecommerce',
        icon: Bot,
        field: 'azure-coral',
      },
      {
        title: t('biometricAuth'),
        description: t('biometricCopy'),
        to: '/docs/concepts/auth-methods/passkeys',
        icon: Fingerprint,
        field: 'aqua-evergreen',
      },
    ],
    highlight: {
      title: t('liveDemo'),
      description: t('liveDemoCopy'),
      to: '/wallet',
      field: 'teal-peach',
    },
    footerLinks: [{ label: t('planPricing'), to: '/pricing/' }],
  };
}

function productsDropdownPane(t: Translate): DropdownPane {
  return {
    id: 'products',
    label: t('documentation'),
    kicker: t('documentation'),
    rows: [
      {
        title: t('getStarted'),
        description: t('getStartedCopy'),
        to: '/docs/',
        icon: Rocket,
        field: 'sky-sand',
      },
      {
        title: t('toolsGuides'),
        description: t('toolsCopy'),
        to: '/docs/guides/',
        icon: Wrench,
        field: 'slate-amber',
      },
      {
        title: t('useCasesNav'),
        description: t('useCasesCopy'),
        to: '/docs/use-cases/',
        icon: ListChecks,
        field: 'mauve-ember',
      },
    ],
    highlight: {
      title: t('architecture'),
      description: t('architectureCopy'),
      to: '/docs/concepts/architecture',
      field: 'slate-amber',
    },
    footerLinks: [
      { label: t('readDocs'), to: '/docs/' },
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
        title: t('free'),
        description: t('freeUsers'),
        to: '/pricing/#free',
        icon: Sprout,
        meta: t('freePrice'),
        field: 'sky-sand',
      },
      {
        title: 'Growth',
        description: t('growthNav'),
        to: '/pricing/#growth',
        icon: TrendingUp,
        meta: t('growthMonthlyPrice'),
        field: 'azure-coral',
      },
      {
        title: 'Pro',
        description: t('proNav'),
        to: '/pricing/#pro',
        icon: Gauge,
        meta: t('proMonthlyPrice'),
        field: 'vermilion-sky',
      },
      {
        title: 'Enterprise',
        description: t('enterpriseNav'),
        to: '/pricing/#enterprise',
        icon: Rocket,
        meta: t('custom'),
        field: 'mauve-ember',
      },
    ],
    highlight: {
      title: t('estimatePrice'),
      description: t('estimateNav'),
      to: '/pricing/#calculator',
      field: 'coral-tide',
    },
    footerLinks: [{ label: t('comparePlans'), to: '/pricing/' }],
  };
}

function aboutDropdownPane(t: Translate): DropdownPane {
  return {
    id: 'about',
    label: t('aboutUs'),
    kicker: t('company'),
    rows: [
      {
        title: t('company'),
        description: t('companyNav'),
        to: '/company/#company',
        icon: Building2,
        field: 'sky-sand',
      },
      {
        title: t('blog'),
        description: t('blogCopy'),
        to: '/company/#blog',
        icon: PenLine,
        field: 'teal-peach',
      },
      {
        title: t('support'),
        description: t('supportCopy'),
        to: CONTACT_LINK_TARGET,
        icon: LifeBuoy,
        field: 'coral-tide',
      },
    ],
    footerLinks: [{ label: t('contactSales'), to: CONTACT_LINK_TARGET }],
  };
}

export function getSiteNavbarConfig(locale: Locale): SiteNavbarConfig {
  const t = translate.bind(null, locale);
  return {
    labels: {
      primary: t('primary'),
      home: t('seamsHome'),
      dashboard: t('dashboard'),
      openMenu: t('openMenu'),
      closeMenu: t('closeMenu'),
      companyOverview: t('companyOverview'),
      companyMission: t('companyMission'),
    },
    panes: {
      products: productsDropdownPane(t),
      documentation: documentationDropdownPane(t),
      about: aboutDropdownPane(t),
      pricing: pricingDropdownPane(t),
    },
    homeHref: '/',
    aboutHref: '/company/#company',
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
