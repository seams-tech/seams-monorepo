import { AccountSettingsPage } from '@core/dashboard/routes/account-settings/page';
import { t } from '@core/i18n';
import { ApiKeyManagementPage } from '@core/dashboard/routes/api-keys/page';
import { BillingConsoleShell } from '@core/dashboard/routes/billing/BillingConsoleShell';
import { PlanStartPage } from '@core/dashboard/routes/billing/PlanStartPage';
import { TeamMembersPage } from '@core/dashboard/routes/team-members/page';
import { DashboardOnboardingPage } from '@core/dashboard/routes/onboarding/page';
import type { ApiCredentialScopeCatalog } from '@core/dashboard/routes/api-keys/apiKeyScopeCatalog';
import { AuditLogsPage, type AuditApprovalIntegration } from '@core/dashboard/routes/audit/page';
import { GasSponsorshipPage } from '@wallet-product/gas-sponsorship/page';
import { DerivationRootSecurityPage } from '@wallet-product/derivation-root/page';
import { TenantDeploymentPage } from '@wallet-product/tenant-deployment/page';
import { PolicyEnginePage } from '@wallet-product/policy-engine/page';
import {
  OpsCockpitPage,
  type OpsCockpitApprovalActions,
  type OpsCockpitQuickAction,
} from '@core/dashboard/routes/ops-cockpit/page';
import { ObservabilityPage } from '@core/dashboard/routes/observability/page';
import { UserWalletsListPage } from '@wallet-product/wallets-list/page';
import { WalletServiceGate } from '@wallet-product/WalletServiceGate';
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
  | '/dashboard/deployment-status'
  | '/dashboard/gas-sponsorship';
export type ComposedDashboardRoute = DashboardRoute | WalletDashboardRoute;
export type ComposedSidebarGroupKey = SidebarGroupKey | 'operationsSecurity' | 'account';
type ComposedSidebarItem = SidebarItem<ComposedDashboardRoute>;
type ComposedSidebarGroup = SidebarGroup<ComposedDashboardRoute, ComposedSidebarGroupKey>;

// Wallet Console has its own application and domain. Other products own their UI.
export const DASHBOARD_PRODUCTS: DashboardProduct[] = [
  {
    id: 'embedded-wallets',
    name: 'Embedded wallets',
    description: 'Passkey wallets, policies & gas',
    gradient: 'teal-peach',
    available: true,
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
    label: t('webhookWalletLabel'),
    description: t('webhookWalletDescription'),
  },
  policy: {
    label: t('webhookPolicyLabel'),
    description: t('webhookPolicyDescription'),
  },
  auth: {
    label: t('webhookAuthLabel'),
    description: t('webhookAuthDescription'),
  },
  tx: {
    label: t('webhookTxLabel'),
    description: t('webhookTxDescription'),
  },
  billing: {
    label: t('webhookBillingLabel'),
    description: t('webhookBillingDescription'),
  },
  session: {
    label: t('webhookSessionLabel'),
    description: t('webhookSessionDescription'),
  },
};

const walletWebhookEventCategoryOptions: readonly WebhookEventCategoryOption[] =
  CONSOLE_WEBHOOK_EVENT_CATEGORIES.map((value) => ({
    value,
    ...walletWebhookEventCategoryCopy[value],
  }));

function WalletAccountSettingsPage(): React.JSX.Element {
  return <AccountSettingsPage serviceId="wallet" />;
}

function WalletTeamMembersPage(): React.JSX.Element {
  return <TeamMembersPage serviceId="wallet" />;
}

function WalletBillingAccountPage(): React.JSX.Element {
  return <BillingConsoleShell defaultPath="/dashboard/billing/account" serviceId="wallet" />;
}

function WalletInvoicesPage(): React.JSX.Element {
  return <BillingConsoleShell defaultPath="/dashboard/invoices" serviceId="wallet" />;
}

function WalletApiKeyManagementPage(): React.JSX.Element {
  return (
    <WalletServiceGate>
      <ApiKeyManagementPage scopeCatalog={walletApiKeyScopeCatalog} />
    </WalletServiceGate>
  );
}

function WalletWebhooksPage(): React.JSX.Element {
  return (
    <WalletServiceGate>
      <WebhooksPage eventCategoryOptions={walletWebhookEventCategoryOptions} />
    </WalletServiceGate>
  );
}

function WalletGasSponsorshipPage(): React.JSX.Element {
  return (
    <WalletServiceGate>
      <GasSponsorshipPage />
    </WalletServiceGate>
  );
}

function WalletUserWalletsListPage(): React.JSX.Element {
  return (
    <WalletServiceGate>
      <UserWalletsListPage />
    </WalletServiceGate>
  );
}

function WalletDerivationRootSecurityPage(): React.JSX.Element {
  return (
    <WalletServiceGate>
      <DerivationRootSecurityPage />
    </WalletServiceGate>
  );
}

function WalletPolicyEnginePage(): React.JSX.Element {
  return (
    <WalletServiceGate>
      <PolicyEnginePage />
    </WalletServiceGate>
  );
}

function WalletTenantDeploymentPage(): React.JSX.Element {
  return (
    <WalletServiceGate>
      <TenantDeploymentPage />
    </WalletServiceGate>
  );
}

function walletAuditPolicyPath({
  policyId,
  policyKind,
  approvalId,
}: Parameters<AuditApprovalIntegration['policyPath']>[0]): string {
  const params = new URLSearchParams({ policyId });
  switch (policyKind) {
    case 'GAS_SPONSORSHIP':
      return `/dashboard/gas-sponsorship?${params.toString()}`;
    case 'TRANSACTION':
      if (approvalId) params.set('approvalId', approvalId);
      return `/dashboard/policy-engine?${params.toString()}`;
    default:
      return assertNeverPolicyKind(policyKind);
  }
}

function assertNeverPolicyKind(policyKind: never): never {
  throw new Error(`Unsupported audit policy kind: ${String(policyKind)}`);
}

const walletAuditApprovalIntegration: AuditApprovalIntegration = {
  listApprovals: listDashboardApprovals,
  policyPath: walletAuditPolicyPath,
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
    field: 'teal-peach',
  },
  {
    title: 'Gas sponsorship',
    description: 'Cover transaction fees for your users.',
    path: '/dashboard/gas-sponsorship',
    icon: FuelIcon,
    field: 'mauve-ember',
  },
];

function WalletAuditLogsPage(): React.JSX.Element {
  return <AuditLogsPage approvalIntegration={walletAuditApprovalIntegration} />;
}

function WalletOpsCockpitPage(): React.JSX.Element {
  return (
    <WalletServiceGate>
      <OpsCockpitPage
        approvalActions={walletOpsCockpitApprovalActions}
        productQuickActions={walletOpsCockpitQuickActions}
        heroTitle="Manage your wallets"
        creditsDescription="Prepaid balance for gas sponsorship. Add credits to keep transactions covered."
      />
    </WalletServiceGate>
  );
}

const gasSponsorshipItem: ComposedSidebarItem = {
  key: 'gas-sponsorship',
  label: t('navGasSponsorship'),
  path: '/dashboard/gas-sponsorship',
  icon: FuelIcon,
  component: WalletGasSponsorshipPage,
  context: 'wallet',
  createLabel: t('createGasSponsorshipPolicy'),
};

const walletsListItem: ComposedSidebarItem = {
  key: 'wallets-list',
  label: t('navUserWalletsList'),
  path: '/dashboard/wallets-list',
  icon: WalletCardsIcon,
  component: WalletUserWalletsListPage,
  context: 'wallet',
};

const derivationRootItem: ComposedSidebarItem = {
  key: 'derivation-root',
  label: t('navThresholdKeys'),
  path: '/dashboard/derivation-root',
  icon: KeyRoundIcon,
  component: WalletDerivationRootSecurityPage,
  context: 'wallet',
};

const securityControlItems: ComposedSidebarItem[] = [
  {
    key: 'policy-engine',
    label: t('navPolicyEngine'),
    path: '/dashboard/policy-engine',
    icon: ScaleIcon,
    component: WalletPolicyEnginePage,
    context: 'wallet',
    createLabel: t('createPolicy'),
  },
  ...(derivationRootRoutesEnabled ? [derivationRootItem] : []),
];

const auditLogsItem: ComposedSidebarItem = {
  key: 'audit',
  label: t('navAuditLogs'),
  path: '/dashboard/audit',
  icon: ScrollTextIcon,
  component: WalletAuditLogsPage,
  context: 'wallet',
};

const observabilityItem: ComposedSidebarItem = {
  key: 'observability',
  label: t('navObservability'),
  path: '/dashboard/observability',
  icon: ActivityIcon,
  component: ObservabilityPage,
  context: 'wallet',
};

const operationsSecurityItems: ComposedSidebarItem[] = [
  ...(walletsRoutesEnabled ? [walletsListItem] : []),
  gasSponsorshipItem,
  ...securityControlItems,
  auditLogsItem,
  observabilityItem,
];

const sidebarGroups: ComposedSidebarGroup[] = [
  {
    key: 'overview',
    label: t('navOverview'),
    items: [
      {
        key: 'overview',
        label: t('navOverview'),
        path: '/dashboard/overview',
        icon: LayoutDashboardIcon,
        component: WalletOpsCockpitPage,
        context: 'wallet',
      },
    ],
  },
  {
    key: 'administration',
    label: t('navAdministration'),
    items: [
      {
        key: 'api-keys',
        label: t('navApiKeys'),
        path: '/dashboard/api-keys',
        icon: KeyRoundIcon,
        component: WalletApiKeyManagementPage,
        context: 'wallet',
      },
      {
        key: 'deployment-status',
        label: t('navDeploymentStatus'),
        path: '/dashboard/deployment-status',
        icon: ServerIcon,
        component: WalletTenantDeploymentPage,
        context: 'wallet',
        access: 'owner',
      },
      {
        key: 'webhooks',
        label: t('navWebhooks'),
        path: '/dashboard/webhooks',
        icon: WebhookIcon,
        component: WalletWebhooksPage,
        context: 'wallet',
        access: 'owner',
        createLabel: t('createWebhookEndpoint'),
      },
    ],
  },
  {
    key: 'operationsSecurity',
    label: t('navWalletOperations'),
    items: operationsSecurityItems,
  },
  {
    // 'platform' is the platform-admin group, which only support accounts see.
    key: 'account',
    label: t('navPlatform'),
    items: [
      {
        key: 'account-settings',
        label: t('navAccountSettings'),
        path: '/dashboard/account-settings',
        icon: CogIcon,
        component: WalletAccountSettingsPage,
        context: 'account',
      },
      {
        key: 'team-members',
        label: t('navTeamMembers'),
        path: '/dashboard/team-members',
        icon: UserCogIcon,
        component: WalletTeamMembersPage,
        context: 'account',
      },
      {
        key: 'billing-account',
        label: t('navBillingAccount'),
        path: '/dashboard/billing/account',
        icon: CreditCardIcon,
        component: WalletBillingAccountPage,
        context: 'account',
      },
      {
        key: 'billing-plan',
        label: t('navPlan'),
        path: '/dashboard/billing/plan',
        icon: CreditCardIcon,
        component: PlanStartPage,
        context: 'account',
      },
      {
        key: 'invoices',
        label: t('navInvoices'),
        path: '/dashboard/invoices',
        icon: FileTextIcon,
        component: WalletInvoicesPage,
        context: 'account',
      },
    ],
  },
];

export const SIDEBAR_GROUPS: ComposedSidebarGroup[] = sidebarGroups.filter(
  (group) => group.items.length > 0,
);

export const DASHBOARD_ACCOUNT_SETTINGS_ACCOUNT_OPTION = t('menuAccountSettings');
export const DASHBOARD_ACCOUNT_SETTINGS_SIGN_OUT_OPTION = t('menuSignOut');
export const DASHBOARD_ACCOUNT_SETTINGS_OPTIONS = [
  DASHBOARD_ACCOUNT_SETTINGS_ACCOUNT_OPTION,
  DASHBOARD_ACCOUNT_SETTINGS_SIGN_OUT_OPTION,
];

export const DEFAULT_EXPANDED_SIDEBAR_GROUPS: ExpandedSidebarGroupsState<ComposedSidebarGroupKey> =
  {
    overview: true,
    administration: true,
    operationsSecurity: true,
    account: true,
    billing: true,
    platform: true,
  };

export const SIDEBAR_GROUP_KEYS = Object.keys(
  DEFAULT_EXPANDED_SIDEBAR_GROUPS,
) as Array<ComposedSidebarGroupKey>;

function resolveDefaultDashboardRoute(groups: ComposedSidebarGroup[]): ComposedDashboardRoute {
  for (const group of groups) {
    if (group.items[0]) return group.items[0].path;
  }
  return '/dashboard/overview';
}

export const DEFAULT_DASHBOARD_ROUTE: ComposedDashboardRoute =
  resolveDefaultDashboardRoute(SIDEBAR_GROUPS);

const onboarding: ComposedSidebarItem = {
  key: 'onboarding',
  label: t('navOnboarding'),
  path: '/dashboard/onboarding',
  icon: LayoutDashboardIcon,
  component: DashboardOnboardingPage,
  context: 'account',
};

export function getRouteFromPathname(pathname: string): ComposedDashboardRoute | null {
  const normalizedPathname =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (normalizedPathname === onboarding.path) return onboarding.path;
  if (normalizedPathname === '/dashboard/billing') return '/dashboard/billing/account';
  if (/^\/dashboard\/(?:billing\/)?invoices(?:\/[^/]+)?$/.test(normalizedPathname)) {
    return '/dashboard/invoices';
  }

  for (const group of SIDEBAR_GROUPS) {
    for (const item of group.items) {
      if (item.path === normalizedPathname) return item.path;
    }
  }
  return null;
}

export function getViewForRoute(route: ComposedDashboardRoute): ComposedSidebarItem {
  if (route === onboarding.path) return onboarding;
  for (const group of SIDEBAR_GROUPS) {
    for (const item of group.items) {
      if (item.path === route) return item;
    }
  }
  for (const group of SIDEBAR_GROUPS) {
    for (const item of group.items) {
      if (item.path === DEFAULT_DASHBOARD_ROUTE) return item;
    }
  }
  return {
    key: 'overview',
    label: t('navOverview'),
    path: '/dashboard/overview',
    icon: LayoutDashboardIcon,
    component: WalletOpsCockpitPage,
    context: 'wallet',
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
