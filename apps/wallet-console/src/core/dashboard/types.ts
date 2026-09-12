import React from 'react';

export type SidebarGroupKey = 'overview' | 'administration' | 'billing' | 'platform';

export type DashboardRoute =
  | '/dashboard/account-settings'
  | '/dashboard/onboarding'
  | '/dashboard/overview'
  | '/dashboard/observability'
  | '/dashboard/billing/account'
  | '/dashboard/invoices'
  | '/platform/billing'
  | '/dashboard/team-members'
  | '/dashboard/audit'
  | '/dashboard/api-keys'
  | '/dashboard/webhooks';

export type DashboardProductId = 'embedded-wallets' | 'ecommerce-agents' | 'api';

export type DashboardProduct = {
  id: DashboardProductId;
  name: string;
  description: string;
  /** Public path to a brand gradient asset used for the product avatar. */
  gradient: string;
  /** Live products are selectable; not-yet-shipped ones render as "Soon". */
  available: boolean;
};

export type TopbarMenuKey = 'organization' | 'project' | 'environment' | 'accountSettings';
export type TopbarOption = {
  value: string;
  label: string;
  disabled?: boolean;
  keepMenuOpen?: boolean;
  icon?: 'sun' | 'moon';
};

export type DashboardViewComponent = () => React.JSX.Element;

export type SidebarIconProps = React.SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number;
};

export type SidebarIconComponent = React.ComponentType<SidebarIconProps>;

export type SidebarItem<Route extends string = DashboardRoute> = {
  key: string;
  label: string;
  path: Route;
  icon: SidebarIconComponent;
  component: DashboardViewComponent;
  /** Renders a trailing "+" in the rail that opens this route's create dialog. */
  createLabel?: string;
};

export type SidebarGroup<
  Route extends string = DashboardRoute,
  GroupKey extends string = SidebarGroupKey,
> = {
  key: GroupKey;
  label: string;
  items: SidebarItem<Route>[];
};

export type TopbarContextState = Record<TopbarMenuKey, string>;

export type ExpandedSidebarGroupsState<GroupKey extends string = SidebarGroupKey> = Record<
  GroupKey,
  boolean
>;

export type DashboardComposition<Route extends string, GroupKey extends string> = {
  accountSettingsAccountOption: string;
  accountSettingsSignOutOption: string;
  accountSettingsOptions: readonly string[];
  products: DashboardProduct[];
  defaultProductId: DashboardProductId;
  defaultRoute: Route;
  sidebarGroups: SidebarGroup<Route, GroupKey>[];
  defaultExpandedSidebarGroups: ExpandedSidebarGroupsState<GroupKey>;
  sidebarGroupKeys: GroupKey[];
  getRouteFromPathname: (pathname: string) => Route | null;
  getViewForRoute: (route: Route) => SidebarItem<Route>;
};
