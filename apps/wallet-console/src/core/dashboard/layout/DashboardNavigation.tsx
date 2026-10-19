import React from 'react';
import type {
  DashboardExternalLink,
  DashboardProduct,
  DashboardProductId,
  SidebarGroup,
  TopbarMenuKey,
  TopbarOption,
} from '../types';
import DashboardSidebar, {
  type DashboardHomeLinkProps,
  type DashboardLinkPropsFactory,
  type DashboardWorkspaceNavigation,
} from './DashboardSidebar';
import DashboardTopbar, {
  type DashboardNetworkSwitch,
  type TopbarSearchItem,
} from './DashboardTopbar';

export type { DashboardWorkspaceNavigation } from './DashboardSidebar';

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
  network?: DashboardNetworkSwitch;
  groups: SidebarGroup<Route, GroupKey>[];
  externalLinks?: readonly DashboardExternalLink[];
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
  network,
  groups,
  externalLinks,
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
        network={network}
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
        externalLinks={externalLinks}
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
