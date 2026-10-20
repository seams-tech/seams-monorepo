import { AccountSettingsPage } from '@core/dashboard/routes/account-settings/page';
import { TeamMembersPage } from '@core/dashboard/routes/team-members/page';
import { BillingAccountPage } from '@core/dashboard/routes/billing/page';
import { InvoicesPage } from '@core/dashboard/routes/invoices/page';
import { PlatformBillingPage } from '@core/dashboard/routes/platform-billing/page';
import { DashboardOnboardingPage } from '@core/dashboard/routes/onboarding/page';
import {
  CogIcon,
  UserCogIcon,
  CreditCardIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  WalletCardsIcon,
} from '@core/dashboard/icons/SidebarIcons';
import type {
  DashboardComposition,
  DashboardRoute,
  SidebarGroup,
  SidebarGroupKey,
  SidebarItem,
} from '@core/dashboard/types';
import { walletConsoleHref } from '@core/dashboard/consoleNavigation';

const groups: SidebarGroup[] = [
  {
    key: 'administration',
    label: 'Account',
    items: [
      {
        key: 'account-settings',
        label: 'Account settings',
        path: '/dashboard/account-settings',
        icon: CogIcon,
        component: AccountSettingsPage,
        context: 'account',
      },
      {
        key: 'team-members',
        label: 'Team members',
        path: '/dashboard/team-members',
        icon: UserCogIcon,
        component: TeamMembersPage,
        context: 'account',
      },
    ],
  },
  {
    key: 'billing',
    label: 'Billing',
    items: [
      {
        key: 'billing-account',
        label: 'Billing account',
        path: '/dashboard/billing/account',
        icon: CreditCardIcon,
        component: BillingAccountPage,
        context: 'account',
      },
      {
        key: 'invoices',
        label: 'Invoices',
        path: '/dashboard/invoices',
        icon: FileTextIcon,
        component: InvoicesPage,
        context: 'account',
      },
    ],
  },
  {
    key: 'platform',
    label: 'Admin',
    items: [
      {
        key: 'platform-billing',
        label: 'Admin support',
        path: '/platform/billing',
        icon: CreditCardIcon,
        component: PlatformBillingPage,
        context: 'account',
      },
    ],
  },
];
const onboarding: SidebarItem = {
  key: 'onboarding',
  label: 'Onboarding wizard',
  path: '/dashboard/onboarding',
  icon: LayoutDashboardIcon,
  component: DashboardOnboardingPage,
  context: 'account',
};

function getRouteFromPathname(pathname: string): DashboardRoute | null {
  const path = pathname.replace(/\/$/, '');
  if (path === onboarding.path) return onboarding.path;
  if (path === '/dashboard/billing') return '/dashboard/billing/account';
  if (/^\/dashboard\/(?:billing\/)?invoices(?:\/[^/]+)?$/.test(path)) return '/dashboard/invoices';
  for (const group of groups)
    for (const item of group.items) if (item.path === path) return item.path;
  return null;
}

function getViewForRoute(route: DashboardRoute): SidebarItem {
  if (route === onboarding.path) return onboarding;
  for (const group of groups) for (const item of group.items) if (item.path === route) return item;
  throw new Error(`Unknown Platform route: ${route}`);
}

export const DASHBOARD_COMPOSITION: DashboardComposition<DashboardRoute, SidebarGroupKey> = {
  accountSettingsAccountOption: 'Account Settings',
  accountSettingsSignOutOption: 'Sign out',
  accountSettingsOptions: ['Account Settings', 'Sign out'],
  products: [
    {
      id: 'platform',
      name: 'Platform',
      description: 'Developer accounts and billing',
      gradient: 'sky-sand',
      available: true,
    },
  ],
  defaultProductId: 'platform',
  defaultRoute: '/dashboard/account-settings',
  sidebarGroups: groups,
  defaultExpandedSidebarGroups: {
    overview: true,
    administration: true,
    billing: true,
    platform: true,
  },
  sidebarGroupKeys: ['administration', 'billing', 'platform'],
  externalLinks: [
    {
      label: 'Wallet Console',
      href: walletConsoleHref('/dashboard/overview'),
      icon: WalletCardsIcon,
    },
  ],
  getRouteFromPathname,
  getViewForRoute,
};
