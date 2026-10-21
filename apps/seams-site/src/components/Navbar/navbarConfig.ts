import {
  Bot,
  Building2,
  Fingerprint,
  LifeBuoy,
  ListChecks,
  PenLine,
  Rocket,
  Sprout,
  TrendingUp,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { DropdownPane, SiteNavbarConfig } from '@seams-internal/site-navbar';
import { CONTACT_LINK_TARGET } from '@/components/contact/contactLink';

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
      field: 'teal-peach',
    },
    {
      title: 'Ecommerce Agents',
      description: 'AI agents with scoped credentials, acting inside policy',
      to: '/ecommerce',
      icon: Bot,
      field: 'azure-coral',
    },
    {
      title: 'Biometric Authentication',
      description: 'Passkey authentication. VoiceID is planned.',
      to: '/docs/concepts/auth-methods/passkeys',
      icon: Fingerprint,
      field: 'aqua-evergreen',
    },
  ],
  highlight: {
    title: 'Live demo',
    description: 'Create a passkey wallet on the Embedded Wallet page',
    to: '/wallet',
    field: 'teal-peach',
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
      field: 'sky-sand',
    },
    {
      title: 'Tools and Guides',
      description: 'Auth, sessions, wallet UI, policy, and the SDK reference',
      to: '/docs/guides/',
      icon: Wrench,
      field: 'slate-amber',
    },
    {
      title: 'Use cases',
      description: 'Mandates, delegated agents, and agent-driven commerce',
      to: '/docs/use-cases/',
      icon: ListChecks,
      field: 'mauve-ember',
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
      title: 'Free',
      description: 'Up to 300 monthly active users',
      to: '/pricing/#free',
      icon: Sprout,
      meta: '$0',
      field: 'sky-sand',
    },
    {
      title: 'Growth',
      description: '5,000 users included, then $0.004 per user',
      to: '/pricing/#growth',
      icon: TrendingUp,
      meta: '$99 / mo',
      field: 'azure-coral',
    },
    {
      title: 'Enterprise',
      description: 'From $0.003 per user on committed volume',
      to: '/pricing/#enterprise',
      icon: Rocket,
      meta: 'Custom',
      field: 'mauve-ember',
    },
  ],
  highlight: {
    title: 'Estimate your price',
    description: 'Set your users and see the monthly total',
    to: '/pricing/#calculator',
    field: 'coral-tide',
  },
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
    {
      title: 'Support',
      description: 'Get help from the team',
      to: CONTACT_LINK_TARGET,
      icon: LifeBuoy,
      field: 'coral-tide',
    },
  ],
  footerLinks: [{ label: 'Contact sales', to: CONTACT_LINK_TARGET }],
};

export const siteNavbarConfig: SiteNavbarConfig = {
  panes: {
    products: productsDropdownPane,
    documentation: documentationDropdownPane,
    about: aboutDropdownPane,
    pricing: pricingDropdownPane,
  },
  homeHref: '/',
  aboutHref: '/company/',
  dashboardHref: '/dashboard',
  mobilePlanLinks: [
    {
      title: 'Talk to us',
      description: 'Plan pricing and deployment options with the Seams team',
      to: CONTACT_LINK_TARGET,
    },
  ],
};
