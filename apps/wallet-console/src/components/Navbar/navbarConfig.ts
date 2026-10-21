import {
  Bot,
  Building2,
  Fingerprint,
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
  label: 'Products',
  kicker: 'Products',
  rows: [
    {
      title: 'Embedded Wallet',
      description: 'Non-custodial wallets with policy-bound keys and sessions',
      to: '/wallet',
      icon: Wallet,
    },
    {
      title: 'Ecommerce Agents',
      description: 'AI agents with scoped credentials, acting inside policy',
      to: 'https://seams.sh/ecommerce',
      icon: Bot,
    },
    {
      title: 'Biometric Authentication',
      description: 'Passkey authentication. VoiceID is planned.',
      to: '/docs/concepts/auth-methods/passkeys',
      icon: Fingerprint,
    },
  ],
  highlight: {
    title: 'Live demo',
    description: 'Create a passkey wallet on the Embedded Wallet page',
    to: '/wallet',
    field: 'aqua-evergreen',
  },
  footerLinks: [{ label: 'Plan pricing', to: '/pricing/' }],
};

const productsDropdownPane: DropdownPane = {
  id: 'products',
  label: 'Documentation',
  kicker: 'Documentation',
  rows: [
    {
      title: 'Get Started',
      description: 'Install the SDK, create a wallet, and sign with policy',
      to: '/docs/',
      icon: Rocket,
    },
    {
      title: 'Tools and Guides',
      description: 'Auth, sessions, wallet UI, policy, and the SDK reference',
      to: '/docs/guides/',
      icon: Wrench,
    },
    {
      title: 'Use cases',
      description: 'Mandates, delegated agents, and agent-driven commerce',
      to: '/docs/use-cases/',
      icon: ListChecks,
    },
  ],
  highlight: {
    title: 'Architecture',
    description: 'How passkeys, policy, and signing fit together',
    to: '/docs/concepts/architecture',
    field: 'slate-amber',
  },
  footerLinks: [
    { label: 'Read the docs', to: '/docs/' },
    { label: 'Releases', to: '/docs/releases' },
  ],
};

const pricingDropdownPane: DropdownPane = {
  id: 'pricing',
  label: 'Pricing',
  kicker: 'Plans',
  rows: [
    {
      title: 'Starter',
      description: 'Up to 5K monthly active wallets',
      to: '/pricing/#starter',
      icon: Sprout,
      meta: 'Included',
      field: 'sky-sand',
    },
    {
      title: 'Growth',
      description: '5K–100K monthly active wallets',
      to: '/pricing/#growth',
      icon: TrendingUp,
      meta: 'Usage-based',
      field: 'azure-coral',
    },
    {
      title: 'Scale',
      description: '100K+ monthly active wallets, SLA, and advanced controls',
      to: '/pricing/#scale',
      icon: Rocket,
      meta: 'Volume',
      field: 'mauve-ember',
    },
  ],
  footerLinks: [{ label: 'Compare plans', to: '/pricing/' }],
};

const aboutDropdownPane: DropdownPane = {
  id: 'about',
  label: 'About Us',
  kicker: 'Company',
  rows: [
    {
      title: 'Company',
      description: 'Who we are and what we are building',
      to: '/company/',
      icon: Building2,
      field: 'sky-sand',
    },
    {
      title: 'Blog',
      description: 'Writing from the Seams team',
      to: '/company/#blog',
      icon: PenLine,
      field: 'teal-peach',
    },
  ],
  footerLinks: [],
};

export const siteNavbarConfig: SiteNavbarConfig = {
  panes: {
    products: productsDropdownPane,
    documentation: documentationDropdownPane,
    about: aboutDropdownPane,
    pricing: pricingDropdownPane,
  },
  homeHref: 'https://seams.sh/',
  aboutHref: '/company/',
  dashboardHref: '/dashboard',
};
