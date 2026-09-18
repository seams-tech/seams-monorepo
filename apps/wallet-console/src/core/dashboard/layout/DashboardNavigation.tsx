import React from 'react';
import type {
  DashboardProduct,
  DashboardProductId,
  SidebarGroup,
  TopbarMenuKey,
  TopbarOption,
} from '../types';
import DashboardSidebar, {
  type DashboardHomeLinkProps,
  type DashboardLinkPropsFactory,
  type SidebarProjectGroup,
} from './DashboardSidebar';
import DashboardTopbar, { type TopbarSearchItem } from './DashboardTopbar';

export type DashboardWorkspaceNavigation = {
  projectGroups: SidebarProjectGroup[];
  projectValue: string;
  environmentValue: string;
  onSelectEnvironment: (projectValue: string, environmentValue: string) => void;
  organizationOptions: TopbarOption[];
  organizationValue: string;
};

export type DashboardProductNavigation = {
  products: DashboardProduct[];
  currentId: DashboardProductId;
  onSelect: (id: DashboardProductId) => void;
};

export type DashboardNavigationProps<Route extends string, GroupKey extends string> = {
  accountLabel: string;
  onSelectContext: (menu: TopbarMenuKey, value: string) => void;
  dropdownOptions: Record<TopbarMenuKey, TopbarOption[]>;
  pageTitle: string;
  groups: SidebarGroup<Route, GroupKey>[];
  activeRoute: Route;
  isSidebarExpanded: boolean;
  onToggleSidebar: () => void;
  linkProps: DashboardLinkPropsFactory;
  homeProps: DashboardHomeLinkProps;
  disableNavigationItems?: boolean;
  enabledWhenLockedPaths?: ReadonlySet<Route>;
  workspace?: DashboardWorkspaceNavigation;
  product?: DashboardProductNavigation;
  searchItems?: TopbarSearchItem[];
  onNavigate?: (path: string) => void;
};

function selectContextOption(
  onSelectContext: (menu: TopbarMenuKey, value: string) => void,
  menu: TopbarMenuKey,
  value: string,
): void {
  onSelectContext(menu, value);
}

export function DashboardNavigation<Route extends string, GroupKey extends string>({
  accountLabel,
  onSelectContext,
  dropdownOptions,
  pageTitle,
  groups,
  activeRoute,
  isSidebarExpanded,
  onToggleSidebar,
  linkProps,
  homeProps,
  disableNavigationItems = false,
  enabledWhenLockedPaths,
  workspace,
  product,
  searchItems,
  onNavigate,
}: DashboardNavigationProps<Route, GroupKey>): React.JSX.Element {
  const workspaceProps = workspace
    ? {
        ...workspace,
        onSelectOrganization: selectContextOption.bind(null, onSelectContext, 'organization'),
      }
    : undefined;

  return (
    <>
      <DashboardTopbar
        workspace={workspaceProps}
        isSidebarExpanded={isSidebarExpanded}
        onToggleSidebar={onToggleSidebar}
        homeProps={homeProps}
        pageTitle={pageTitle}
        onSelectContext={onSelectContext}
        dropdownOptions={dropdownOptions}
        accountLabel={accountLabel}
        searchItems={searchItems}
        onNavigate={onNavigate}
      />
      <DashboardSidebar
        accountLabel={accountLabel}
        accountOptions={dropdownOptions.accountSettings}
        onSelectAccount={selectContextOption.bind(null, onSelectContext, 'accountSettings')}
        groups={groups}
        isSidebarExpanded={isSidebarExpanded}
        activeRoute={activeRoute}
        disableNavigationItems={disableNavigationItems}
        enabledWhenLockedPaths={enabledWhenLockedPaths}
        onToggleSidebar={onToggleSidebar}
        linkProps={linkProps}
        product={product}
        workspace={workspaceProps}
        homeProps={homeProps}
      />
    </>
  );
}

export default DashboardNavigation;
