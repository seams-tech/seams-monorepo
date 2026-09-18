import { ApiKeyManagementPage } from '@core/dashboard/routes/api-keys/page';
import type { ApiCredentialScopeCatalog } from '@core/dashboard/routes/api-keys/apiKeyScopeCatalog';
import { BillingAccountPage } from '@core/dashboard/routes/billing/page';
import { AccountSettingsPage } from '@core/dashboard/routes/account-settings/page';
import { AuditLogsPage, type AuditApprovalIntegration } from '@core/dashboard/routes/audit/page';
import { GasSponsorshipPage } from '@wallet-product/gas-sponsorship/page';
import { InvoicesPage } from '@core/dashboard/routes/invoices/page';
import { PlatformBillingPage } from '@core/dashboard/routes/platform-billing/page';
import { DerivationRootSecurityPage } from '@wallet-product/derivation-root/page';
import { TenantDeploymentPage } from '@wallet-product/tenant-deployment/page';
import { PolicyEnginePage } from '@wallet-product/policy-engine/page';
import { TeamMembersPage } from '@core/dashboard/routes/team-members/page';
import { DashboardOnboardingPage } from '@core/dashboard/routes/onboarding/page';
import {
  OpsCockpitPage,
  type OpsCockpitApprovalActions,
  type OpsCockpitQuickAction,
} from '@core/dashboard/routes/ops-cockpit/page';
import { ObservabilityPage } from '@core/dashboard/routes/observability/page';
import { UserWalletsListPage } from '@wallet-product/wallets-list/page';
import { WebhooksPage } from '@core/dashboard/routes/webhooks/page';
import type { WebhookEventCategoryOption } from '@core/dashboard/routes/webhooks/webhookEventCatalog';
import {
  approveDashboardApproval,
  listDashboardApprovals,
  rejectDashboardApproval,
} from '@wallet-product/approvals/consoleApprovalsApi';
import {
  API_CREDENTIAL_SCOPE_OPTIONS,
  isApiCredentialScope,
} from '@seams-internal/wallet-console-shared/apiKeyScopes';
import {
  CONSOLE_WEBHOOK_EVENT_CATEGORIES,
  type ConsoleWebhookEventCategory as WalletWebhookEventCategory,
} from '@seams-internal/wallet-console-shared/webhookEventCategories';
import {
  ActivityIcon,
  CogIcon,
  CreditCardIcon,
  FileTextIcon,
  FuelIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  ScaleIcon,
  ScrollTextIcon,
  ServerIcon,
  UserCogIcon,
  WalletCardsIcon,
  WebhookIcon,
} from '@core/dashboard/icons/SidebarIcons';
import type {
  DashboardProduct,
  DashboardProductId,
  DashboardComposition,
  DashboardRoute,
  ExpandedSidebarGroupsState,
  SidebarGroup,
  SidebarGroupKey,
  SidebarItem,
} from '@core/dashboard/types';

export type WalletDashboardRoute =
  | '/dashboard/wallets-list'
  | '/dashboard/policy-engine'
  | '/dashboard/derivation-root'
  | '/dashboard/tenant-deployment'
  | '/dashboard/gas-sponsorship';
export type ComposedDashboardRoute = DashboardRoute | WalletDashboardRoute;
export type ComposedSidebarGroupKey = SidebarGroupKey | 'operationsSecurity';
type ComposedSidebarItem = SidebarItem<ComposedDashboardRoute>;
type ComposedSidebarGroup = SidebarGroup<ComposedDashboardRoute, ComposedSidebarGroupKey>;

/* Product lines exposed in the sidebar switcher (reference-app style). Only
   the live product is selectable today; the rest advertise the roadmap with a
   "Soon" pill until their surfaces ship. Gradients come from the on-brand
   asset set in src/public/gradients/web. */
export const DASHBOARD_PRODUCTS: DashboardProduct[] = [
  {
    id: 'embedded-wallets',
    name: 'Embedded wallets',
    description: 'Passkey wallets, policies & gas',
    gradient: '/gradients/web/aqua-evergreen.jpg',
    available: true,
  },
  {
    id: 'ecommerce-agents',
    name: 'Ecommerce agents',
    description: 'Agent checkout & payments',
    gradient: '/gradients/web/dusk-blue-mauve.jpg',
    available: false,
  },
  {
    id: 'api',
    name: 'API',
    description: 'Build on the Seams REST API',
    gradient: '/gradients/web/sky-sand.jpg',
    available: false,
  },
];

export const DEFAULT_DASHBOARD_PRODUCT_ID: DashboardProductId = 'embedded-wallets';

const walletsRoutesEnabled =
  String(import.meta.env.VITE_DASHBOARD_WALLETS_ROUTES_ENABLED ?? '').trim() !== 'false';

// Enable per deployment after live signing and hosted passkey verification.
// Rotation/status and full-shell navigation have been exercised locally.
const derivationRootRoutesEnabled =
  String(import.meta.env.VITE_DASHBOARD_DERIVATION_ROOT_ENABLED ?? '').trim() === 'true';

const walletApiKeyScopeCatalog: ApiCredentialScopeCatalog = {
  options: API_CREDENTIAL_SCOPE_OPTIONS,
  defaultScopes: ['accounts.create'],
  isScope: isApiCredentialScope,
};

const walletWebhookEventCategoryCopy: Record<
  WalletWebhookEventCategory,
  Omit<WebhookEventCategoryOption, 'value'>
> = {
  wallet: {
    label: 'Wallet activity',
    description: 'Wallet provisioning, configuration, and state changes.',
  },
  policy: {
    label: 'Policy changes',
    description: 'Policy publish, assignment, and approval events.',
  },
  auth: {
    label: 'Authentication',
    description: 'Authentication and identity lifecycle events.',
  },
  tx: {
    label: 'Transaction lifecycle',
    description: 'Transaction creation, signing, submission, and status transitions.',
  },
  billing: {
    label: 'Billing',
    description: 'Invoices, usage, and payment lifecycle events.',
  },
  session: {
    label: 'Session lifecycle',
    description: 'Session creation, refresh, and teardown events.',
  },
};

const walletWebhookEventCategoryOptions: readonly WebhookEventCategoryOption[] =
  CONSOLE_WEBHOOK_EVENT_CATEGORIES.map((value) => ({
    value,
    ...walletWebhookEventCategoryCopy[value],
  }));

function WalletApiKeyManagementPage(): React.JSX.Element {
  return <ApiKeyManagementPage scopeCatalog={walletApiKeyScopeCatalog} />;
}

function WalletWebhooksPage(): React.JSX.Element {
  return <WebhooksPage eventCategoryOptions={walletWebhookEventCategoryOptions} />;
}

const walletAuditApprovalIntegration: AuditApprovalIntegration = {
  listApprovals: listDashboardApprovals,
  policyPath: ({ policyId, approvalId }) => {
    const params = new URLSearchParams({ policyId });
    if (approvalId) params.set('approvalId', approvalId);
    return `/dashboard/policy-engine?${params.toString()}`;
  },
};

const walletOpsCockpitApprovalActions: OpsCockpitApprovalActions = {
  approve: approveDashboardApproval,
  reject: rejectDashboardApproval,
};

const walletOpsCockpitQuickActions: readonly OpsCockpitQuickAction[] = [
  {
    title: 'Policy engine',
    description: 'Set signing rules and spend caps for your wallets.',
    path: '/dashboard/policy-engine',
    icon: ScaleIcon,
    tone: 'green',
  },
  {
    title: 'Gas sponsorship',
    description: 'Cover transaction fees for your users.',
    path: '/dashboard/gas-sponsorship',
    icon: FuelIcon,
    tone: 'blue',
  },
];

function WalletAuditLogsPage(): React.JSX.Element {
  return <AuditLogsPage approvalIntegration={walletAuditApprovalIntegration} />;
}

function WalletOpsCockpitPage(): React.JSX.Element {
  return (
    <OpsCockpitPage
      approvalActions={walletOpsCockpitApprovalActions}
      productQuickActions={walletOpsCockpitQuickActions}
      heroTitle="Manage your wallets"
      creditsDescription="Prepaid balance for gas sponsorship. Add credits to keep transactions covered."
    />
  );
}

const gasSponsorshipItem: ComposedSidebarItem = {
  key: 'gas-sponsorship',
  label: 'Gas sponsorship',
  path: '/dashboard/gas-sponsorship',
  icon: FuelIcon,
  component: GasSponsorshipPage,
  createLabel: 'New gas sponsorship policy',
};

const walletsListItem: ComposedSidebarItem = {
  key: 'wallets-list',
  label: 'User wallets list',
  path: '/dashboard/wallets-list',
  icon: WalletCardsIcon,
  component: UserWalletsListPage,
};

const derivationRootItem: ComposedSidebarItem = {
  key: 'derivation-root',
  label: 'Threshold Keys',
  path: '/dashboard/derivation-root',
  icon: KeyRoundIcon,
  component: DerivationRootSecurityPage,
};

const securityControlItems: ComposedSidebarItem[] = [
  {
    key: 'policy-engine',
    label: 'Policy engine',
    path: '/dashboard/policy-engine',
    icon: ScaleIcon,
    component: PolicyEnginePage,
    createLabel: 'New policy',
  },
  ...(derivationRootRoutesEnabled ? [derivationRootItem] : []),
];

const auditLogsItem: ComposedSidebarItem = {
  key: 'audit',
  label: 'Audit logs',
  path: '/dashboard/audit',
  icon: ScrollTextIcon,
  component: WalletAuditLogsPage,
};

const observabilityItem: ComposedSidebarItem = {
  key: 'observability',
  label: 'Observability',
  path: '/dashboard/observability',
  icon: ActivityIcon,
  component: ObservabilityPage,
};

const operationsSecurityItems: ComposedSidebarItem[] = [
  ...(walletsRoutesEnabled ? [walletsListItem] : []),
  gasSponsorshipItem,
  ...securityControlItems,
  auditLogsItem,
];

const sidebarGroups: ComposedSidebarGroup[] = [
  {
    key: 'overview',
    label: 'Overview',
    items: [
      {
        key: 'overview',
        label: 'Overview',
        path: '/dashboard/overview',
        icon: LayoutDashboardIcon,
        component: WalletOpsCockpitPage,
      },
      observabilityItem,
    ],
  },
  {
    key: 'administration',
    label: 'Administration',
    items: [
      {
        key: 'account-settings',
        label: 'Account settings',
        path: '/dashboard/account-settings',
        icon: CogIcon,
        component: AccountSettingsPage,
      },
      {
        key: 'team-members',
        label: 'Team members',
        path: '/dashboard/team-members',
        icon: UserCogIcon,
        component: TeamMembersPage,
      },
      {
        key: 'api-keys',
        label: 'API Keys',
        path: '/dashboard/api-keys',
        icon: KeyRoundIcon,
        component: WalletApiKeyManagementPage,
      },
      {
        key: 'tenant-deployment',
        label: 'Tenant deployment',
        path: '/dashboard/tenant-deployment',
        icon: ServerIcon,
        component: TenantDeploymentPage,
      },
      {
        key: 'webhooks',
        label: 'Webhooks',
        path: '/dashboard/webhooks',
        icon: WebhookIcon,
        component: WalletWebhooksPage,
        createLabel: 'New webhook endpoint',
      },
    ],
  },
  {
    key: 'operationsSecurity',
    label: 'Wallet operations',
    items: operationsSecurityItems,
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
      },
      {
        key: 'invoices',
        label: 'Invoices',
        path: '/dashboard/invoices',
        icon: FileTextIcon,
        component: InvoicesPage,
      },
    ],
  },
  {
    key: 'platform',
    label: 'Platform',
    items: [
      {
        key: 'platform-billing',
        label: 'Customer Accounts',
        path: '/platform/billing',
        icon: CreditCardIcon,
        component: PlatformBillingPage,
      },
    ],
  },
];

export const SIDEBAR_GROUPS: ComposedSidebarGroup[] = sidebarGroups.filter(
  (group) => group.items.length > 0,
);

export const DASHBOARD_ACCOUNT_SETTINGS_ACCOUNT_OPTION = 'Account Settings';
export const DASHBOARD_ACCOUNT_SETTINGS_SIGN_OUT_OPTION = 'Sign out';
export const DASHBOARD_ACCOUNT_SETTINGS_OPTIONS = [
  DASHBOARD_ACCOUNT_SETTINGS_ACCOUNT_OPTION,
  DASHBOARD_ACCOUNT_SETTINGS_SIGN_OUT_OPTION,
];

export const DEFAULT_EXPANDED_SIDEBAR_GROUPS: ExpandedSidebarGroupsState<ComposedSidebarGroupKey> =
  {
    overview: true,
    administration: true,
    operationsSecurity: true,
    billing: true,
    platform: true,
  };

export const SIDEBAR_GROUP_KEYS = Object.keys(
  DEFAULT_EXPANDED_SIDEBAR_GROUPS,
) as Array<ComposedSidebarGroupKey>;

const HIDDEN_DASHBOARD_ROUTES: ComposedSidebarItem[] = [
  {
    key: 'onboarding',
    label: 'Onboarding wizard',
    path: '/dashboard/onboarding',
    icon: LayoutDashboardIcon,
    component: DashboardOnboardingPage,
  },
];

function resolveDefaultDashboardRoute(groups: ComposedSidebarGroup[]): ComposedDashboardRoute {
  for (const group of groups) {
    if (group.items[0]) return group.items[0].path;
  }
  return '/dashboard/overview';
}

export const DEFAULT_DASHBOARD_ROUTE: ComposedDashboardRoute =
  resolveDefaultDashboardRoute(SIDEBAR_GROUPS);

export function getRouteFromPathname(pathname: string): ComposedDashboardRoute | null {
  const normalizedPathname =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  if (
    normalizedPathname === '/dashboard/billing' ||
    normalizedPathname === '/dashboard/billing/account'
  ) {
    return '/dashboard/billing/account';
  }
  if (
    normalizedPathname === '/dashboard/invoices' ||
    /^\/dashboard\/invoices\/[^/]+$/.test(normalizedPathname) ||
    normalizedPathname === '/dashboard/billing/invoices' ||
    /^\/dashboard\/billing\/invoices\/[^/]+$/.test(normalizedPathname)
  ) {
    return '/dashboard/invoices';
  }
  if (normalizedPathname === '/platform/billing') {
    return '/platform/billing';
  }
  for (const group of SIDEBAR_GROUPS) {
    for (const item of group.items) {
      if (item.path === normalizedPathname) return item.path;
    }
  }
  for (const item of HIDDEN_DASHBOARD_ROUTES) {
    if (item.path === normalizedPathname) return item.path;
  }
  return null;
}

export function getViewForRoute(route: ComposedDashboardRoute): ComposedSidebarItem {
  for (const group of SIDEBAR_GROUPS) {
    for (const item of group.items) {
      if (item.path === route) return item;
    }
  }
  for (const item of HIDDEN_DASHBOARD_ROUTES) {
    if (item.path === route) return item;
  }
  for (const group of SIDEBAR_GROUPS) {
    for (const item of group.items) {
      if (item.path === DEFAULT_DASHBOARD_ROUTE) return item;
    }
  }
  return {
    key: 'overview',
    label: 'Overview',
    path: '/dashboard/overview',
    icon: LayoutDashboardIcon,
    component: WalletOpsCockpitPage,
  };
}

export const DASHBOARD_COMPOSITION: DashboardComposition<
  ComposedDashboardRoute,
  ComposedSidebarGroupKey
> = {
  accountSettingsAccountOption: DASHBOARD_ACCOUNT_SETTINGS_ACCOUNT_OPTION,
  accountSettingsSignOutOption: DASHBOARD_ACCOUNT_SETTINGS_SIGN_OUT_OPTION,
  accountSettingsOptions: DASHBOARD_ACCOUNT_SETTINGS_OPTIONS,
  products: DASHBOARD_PRODUCTS,
  defaultProductId: DEFAULT_DASHBOARD_PRODUCT_ID,
  defaultRoute: DEFAULT_DASHBOARD_ROUTE,
  sidebarGroups: SIDEBAR_GROUPS,
  defaultExpandedSidebarGroups: DEFAULT_EXPANDED_SIDEBAR_GROUPS,
  sidebarGroupKeys: SIDEBAR_GROUP_KEYS,
  getRouteFromPathname,
  getViewForRoute,
};
