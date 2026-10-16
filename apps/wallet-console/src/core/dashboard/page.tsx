import {
  sharedAccountHref,
  linksWithConsoleContext,
  consoleSessionHref,
  rememberConsoleContext,
  platformConsoleHref,
} from './consoleNavigation';
import { DashboardOnboardingPage } from './routes/onboarding/page';
import { readUnscopedConsoleSession } from './routes/onboarding/initialOrganizationApi';
import { requireConsoleBaseUrl } from './consoleHttp';
import React from 'react';
import { assertNever } from '@seams-internal/console-shared/accountPlatform/boundary';
import type { SidebarProjectGroup } from './layout/DashboardSidebar';
import DashboardNavigation from './layout/DashboardNavigation';
import { DASHBOARD_PAGE_ACTIONS_SLOT_ID } from './components/DashboardPageActions';
import { DashboardLoadingState } from './components/DashboardLoadingState';
import type {
  DashboardComposition,
  DashboardProductId,
  DashboardRoute,
  SidebarGroupKey,
  TopbarContextState,
  TopbarMenuKey,
  TopbarOption,
} from './types';
import {
  DashboardConsoleSessionProvider,
  markDashboardConsoleSignOut,
  revokeDashboardConsoleSession,
  useDashboardConsoleSession,
  type DashboardConsoleSessionClaims,
} from './consoleSession';
import { DashboardSelectedContextProvider } from './selectedContext';
import {
  listDashboardEnvironments,
  listDashboardProjects,
  DASHBOARD_ENVIRONMENTS_UPDATED_EVENT,
  type DashboardConsoleEnvironment,
} from './consoleContextApi';
import {
  getDashboardOnboardingState,
  buildDashboardOrganizationOnboardingState,
  isDashboardConsoleApiErrorCode,
  type DashboardOnboardingState,
} from './routes/onboarding/consoleOnboardingApi';
import {
  clearDashboardUiState,
  readPersistedDashboardSelectedContext,
  replaceDashboardSelectedContext,
  useDashboardUiPreferences,
} from './useDashboardUiPreferences';
import { useSiteRouter } from '@core/router/useSiteRouter';
import {
  getActiveFrontendDeployment,
  selectNetwork,
  useFrontendRuntime,
  type ConsoleNetwork,
  type ConsoleRuntimeState,
} from '@core/runtime';
import {
  listDashboardAccountOrganizations,
  switchDashboardAccountOrganizationContext,
  type DashboardAccountOrganization,
} from './routes/account-settings/consoleAccountApi';
import './styles.css';

type DashboardPageProps<ProductRoute extends string, ProductGroupKey extends string> = {
  composition: DashboardComposition<
    DashboardRoute | ProductRoute,
    SidebarGroupKey | ProductGroupKey
  >;
  pathname?: string;
};

const DASHBOARD_ONBOARDING_ROUTE = '/dashboard/onboarding';
const DASHBOARD_ACCOUNT_SETTINGS_ROUTE: DashboardRoute = '/dashboard/account-settings';
const PLATFORM_BILLING_ROUTE: DashboardRoute = '/platform/billing';
const DASHBOARD_LOGIN_ROUTE = '/dashboard/login';
const DASHBOARD_ONBOARDING_STATE_UPDATED_EVENT = 'dashboard:onboarding-state-updated';
const EMPTY_DASHBOARD_PROJECT_OPTIONS: TopbarOption[] = [];
type DashboardProjectFailure = 'load_failed' | 'selection_unavailable';
type DashboardProjects =
  | {
      readonly kind: 'loading';
      readonly orgId?: never;
      readonly options?: never;
      readonly reason?: never;
    }
  | {
      readonly kind: 'loaded';
      readonly orgId: string;
      readonly options: TopbarOption[];
      readonly reason?: never;
    }
  | {
      readonly kind: 'unavailable';
      readonly orgId: string;
      readonly reason: DashboardProjectFailure;
      readonly options?: never;
    };

function loadingDashboardProjects(): Extract<DashboardProjects, { kind: 'loading' }> {
  return { kind: 'loading' };
}

function loadedDashboardProjects(
  claims: DashboardConsoleSessionClaims,
  options: TopbarOption[],
): Extract<DashboardProjects, { kind: 'loaded' }> {
  return { kind: 'loaded', orgId: claims.orgId, options };
}

function unavailableDashboardProjects(
  claims: DashboardConsoleSessionClaims,
  reason: DashboardProjectFailure,
): Extract<DashboardProjects, { kind: 'unavailable' }> {
  return { kind: 'unavailable', orgId: claims.orgId, reason };
}

function projectOptionsForScope(projects: DashboardProjects, orgId: string): TopbarOption[] {
  switch (projects.kind) {
    case 'loaded':
      return projects.orgId === orgId ? projects.options : EMPTY_DASHBOARD_PROJECT_OPTIONS;
    case 'loading':
    case 'unavailable':
      return EMPTY_DASHBOARD_PROJECT_OPTIONS;
    default:
      return assertNever(projects);
  }
}

function isSelectableOption(option: TopbarOption): boolean {
  return option.disabled !== true;
}

function dedupeOptions(options: TopbarOption[]): TopbarOption[] {
  const seen = new Map<string, number>();
  const deduped: TopbarOption[] = [];
  for (const option of options) {
    const value = String(option.value || '').trim();
    if (!value) continue;
    const normalized: TopbarOption = {
      value,
      label: String(option.label || value).trim() || value,
      ...(option.disabled === true ? { disabled: true } : {}),
    };
    const existingIndex = seen.get(value);
    if (existingIndex === undefined) {
      seen.set(value, deduped.length);
      deduped.push(normalized);
      continue;
    }
    const existing = deduped[existingIndex];
    if (existing.disabled === true && normalized.disabled !== true) {
      deduped[existingIndex] = normalized;
      continue;
    }
    if ((existing.label === value || !existing.label) && normalized.label !== value) {
      deduped[existingIndex] = { ...existing, label: normalized.label };
    }
  }
  return deduped;
}

const SWITCH_TO_MAINNET = 'console-network-mainnet';
const SWITCH_TO_TESTNET = 'console-network-testnet';

function withConsoleNetworkOptions(
  options: TopbarOption[],
  runtime: Pick<ConsoleRuntimeState, 'selectedNetwork' | 'availableNetworks'>,
): TopbarOption[] {
  if (import.meta.env.MODE !== 'wallet' || runtime.availableNetworks.length < 2) return options;
  const mainnet = runtime.selectedNetwork === 'mainnet';
  return [
    ...options,
    {
      value: 'console-current-network',
      label: mainnet ? 'Network: Mainnet' : 'Network: Testnet',
      disabled: true,
    },
    {
      value: mainnet ? SWITCH_TO_TESTNET : SWITCH_TO_MAINNET,
      label: mainnet ? 'Switch to Testnet' : 'Switch to Mainnet',
    },
  ];
}

function selectConsoleNetworkOption(value: string): boolean {
  switch (value) {
    case SWITCH_TO_MAINNET:
      navigateToConsoleNetwork('mainnet');
      return true;
    case SWITCH_TO_TESTNET:
      navigateToConsoleNetwork('testnet');
      return true;
    default:
      return false;
  }
}

function navigateToConsoleNetwork(network: ConsoleNetwork): void {
  if (getActiveFrontendDeployment().network === network) return;
  selectNetwork(network);
  if (getActiveFrontendDeployment().network !== network) return;
  clearDashboardUiState();
  const destination = new URL('/dashboard/account-settings', window.location.origin);
  destination.searchParams.set('db_network', network);
  window.location.assign(destination.href);
}

function buildProjectEnvironmentOptions(input: {
  environments: DashboardConsoleEnvironment[];
  projectId: string;
}): TopbarOption[] {
  const visibleEnvironments = input.environments
    .filter((environment) => {
      if (environment.projectId !== input.projectId) return false;
      const status = environment.status.trim().toUpperCase();
      if (status === 'ARCHIVED') return false;
      return status === 'ACTIVE' || environment.key.trim().toLowerCase() === 'prod';
    })
    .sort((left, right) => {
      const leftDisabled = left.status.trim().toUpperCase() !== 'ACTIVE';
      const rightDisabled = right.status.trim().toUpperCase() !== 'ACTIVE';
      if (leftDisabled === rightDisabled) return left.name.localeCompare(right.name);
      return leftDisabled ? 1 : -1;
    });
  return dedupeOptions(
    visibleEnvironments.map((environment) => ({
      value: environment.id,
      label: environment.name || environment.id,
      disabled: environment.status.trim().toUpperCase() !== 'ACTIVE',
    })),
  );
}

function findPreferredOrganizationSummary(input: {
  organizations: DashboardAccountOrganization[];
  currentOrgId: string;
  preferredOrganizationId: string;
}): DashboardAccountOrganization | null {
  const { organizations, currentOrgId, preferredOrganizationId } = input;
  if (!organizations.length) return null;
  const currentMatch =
    (currentOrgId && organizations.find((entry) => entry.id === currentOrgId)) || null;
  if (currentMatch) return currentMatch;
  const preferredMatch =
    (preferredOrganizationId &&
      organizations.find((entry) => entry.id === preferredOrganizationId)) ||
    null;
  if (preferredMatch) return preferredMatch;
  return organizations.find((entry) => entry.isCurrentOrg) || organizations[0] || null;
}

function DashboardPageInner<ProductRoute extends string, ProductGroupKey extends string>({
  composition,
  pathname = '/dashboard',
}: DashboardPageProps<ProductRoute, ProductGroupKey>): React.JSX.Element {
  const {
    accountSettingsAccountOption: DASHBOARD_ACCOUNT_SETTINGS_ACCOUNT_OPTION,
    accountSettingsSignOutOption: DASHBOARD_ACCOUNT_SETTINGS_SIGN_OUT_OPTION,
    accountSettingsOptions: DASHBOARD_ACCOUNT_SETTINGS_OPTIONS,
    products: DASHBOARD_PRODUCTS,
    defaultProductId: DEFAULT_DASHBOARD_PRODUCT_ID,
    defaultRoute: DEFAULT_DASHBOARD_ROUTE,
    sidebarGroups: SIDEBAR_GROUPS,
    defaultExpandedSidebarGroups,
    sidebarGroupKeys,
    getRouteFromPathname,
    getViewForRoute,
  } = composition;
  const requestedRoute = getRouteFromPathname(pathname);
  const usesWalletContext =
    requestedRoute !== null && getViewForRoute(requestedRoute).context === 'wallet';
  const frontendRuntime = useFrontendRuntime();
  const { go, linkProps } = useSiteRouter();
  const homeProps = linkProps('https://seams.sh/');
  const consoleSession = useDashboardConsoleSession();
  const persistedSelectedContext = React.useMemo(() => readPersistedDashboardSelectedContext(), []);
  const persistedOrganizationId = String(persistedSelectedContext.organization || '').trim();
  const persistedProjectId = String(persistedSelectedContext.project || '').trim();
  const persistedEnvironmentId = String(persistedSelectedContext.environment || '').trim();
  const [onboardingLoading, setOnboardingLoading] = React.useState<boolean>(false);
  const [onboardingState, setOnboardingState] = React.useState<DashboardOnboardingState | null>(
    null,
  );
  const [onboardingGateEnabled, setOnboardingGateEnabled] = React.useState<boolean>(true);
  const [selectedProductId, setSelectedProductId] = React.useState<DashboardProductId>(
    DEFAULT_DASHBOARD_PRODUCT_ID,
  );
  const [logoutPending, setLogoutPending] = React.useState<boolean>(false);
  const [logoutErrorMessage, setLogoutErrorMessage] = React.useState<string>('');
  const [contextActionErrorMessage, setContextActionErrorMessage] = React.useState<string>('');
  const [accountOrganizations, setAccountOrganizations] = React.useState<
    DashboardAccountOrganization[]
  >([]);
  const [accountOrganizationsResolved, setAccountOrganizationsResolved] =
    React.useState<boolean>(false);
  const [pendingOrganizationContextOrgId, setPendingOrganizationContextOrgId] =
    React.useState<string>('');
  const [organizationOptions, setOrganizationOptions] = React.useState<TopbarOption[]>([]);
  const [projectResolution, setProjectResolution] =
    React.useState<DashboardProjects>(loadingDashboardProjects);
  const initialContextResolution = React.useRef<'pending' | 'applied'>('pending');
  const [selectedProjectId, setSelectedProjectId] = React.useState<string>(persistedProjectId);
  const [environmentRows, setEnvironmentRows] = React.useState<DashboardConsoleEnvironment[]>([]);
  const [environmentRefreshRevision, setEnvironmentRefreshRevision] = React.useState(0);
  const organizationRecoveryAttemptRef = React.useRef<string>('');
  const sessionForbidden =
    !consoleSession.loading &&
    !consoleSession.claims &&
    (consoleSession.errorCode === 'forbidden' || consoleSession.errorStatus === 403);
  const currentOrgId = String(consoleSession.claims?.orgId || '').trim();
  const projectOptions = projectOptionsForScope(projectResolution, currentOrgId);
  const onboardingStateOrgId = String(onboardingState?.orgId || '').trim();
  const onboardingSelectedProjectId = String(onboardingState?.selectedProjectId || '').trim();
  const onboardingSelectionMatchesCurrentOrg = Boolean(
    currentOrgId && onboardingStateOrgId === currentOrgId,
  );
  const scopedOnboardingSelectedProjectId = onboardingSelectionMatchesCurrentOrg
    ? onboardingSelectedProjectId
    : '';
  const persistedSelectionMatchesCurrentOrg = Boolean(
    currentOrgId && persistedOrganizationId === currentOrgId,
  );
  const scopedPersistedProjectId = persistedSelectionMatchesCurrentOrg ? persistedProjectId : '';
  const scopedPersistedEnvironmentId = persistedSelectionMatchesCurrentOrg
    ? persistedEnvironmentId
    : '';
  const currentOrganizationSummary = React.useMemo(
    () =>
      findPreferredOrganizationSummary({
        organizations: accountOrganizations,
        currentOrgId,
        preferredOrganizationId: persistedOrganizationId,
      }),
    [accountOrganizations, currentOrgId, persistedOrganizationId],
  );
  const currentOrganizationProjectId = String(
    currentOrganizationSummary?.selectedProjectId || '',
  ).trim();
  const isPlatformRoute = pathname === PLATFORM_BILLING_ROUTE || pathname.startsWith('/platform/');
  const isPlatformAdmin = consoleSession.claims?.platformSupport === true;
  const isSidebarNavigationLocked =
    !isPlatformRoute &&
    onboardingGateEnabled &&
    (onboardingLoading || !onboardingState || onboardingState.currentStep !== 'complete');
  /* Only claim setup is incomplete once the onboarding status has actually
     loaded; while loading the lock is provisional and the banner would flash
     at fully-onboarded users on every page load. */
  const showNavigationLockBanner =
    isSidebarNavigationLocked && !onboardingLoading && Boolean(onboardingState);
  const recoveryTargetOrgId = !currentOrgId
    ? String(currentOrganizationSummary?.id || '').trim()
    : '';
  const recoveryAttemptKey =
    recoveryTargetOrgId && consoleSession.claims?.userId
      ? `${consoleSession.claims.userId}:${recoveryTargetOrgId}`
      : '';
  const isRecoveringOrganizationContext =
    Boolean(consoleSession.claims) &&
    !currentOrgId &&
    (!accountOrganizationsResolved ||
      Boolean(pendingOrganizationContextOrgId) ||
      (Boolean(recoveryTargetOrgId) &&
        organizationRecoveryAttemptRef.current !== recoveryAttemptKey));
  const isSelectingRequestedOrganization = Boolean(
    pendingOrganizationContextOrgId ||
    (initialContextResolution.current === 'pending' &&
      persistedOrganizationId &&
      persistedOrganizationId !== currentOrgId),
  );
  const isWaitingForCurrentOrgOnboardingState = Boolean(
    currentOrgId && onboardingGateEnabled && onboardingStateOrgId !== currentOrgId,
  );
  const isDashboardEntryRoutePending = Boolean(
    pathname === '/dashboard' &&
    consoleSession.claims &&
    (isRecoveringOrganizationContext ||
      isSelectingRequestedOrganization ||
      (onboardingGateEnabled && (!onboardingState || isWaitingForCurrentOrgOnboardingState))),
  );

  React.useEffect(() => {
    const claims = consoleSession.claims;
    if (!claims) {
      setOnboardingLoading(false);
      setOnboardingState(null);
      setOnboardingGateEnabled(true);
      setAccountOrganizations([]);
      setAccountOrganizationsResolved(false);
      setPendingOrganizationContextOrgId('');
      setOrganizationOptions([]);
      setProjectResolution(loadingDashboardProjects());
      setSelectedProjectId(persistedProjectId);
      setEnvironmentRows([]);
      return;
    }
    if (!currentOrgId) {
      setOnboardingLoading(false);
      setOnboardingState(buildDashboardOrganizationOnboardingState(''));
      setOnboardingGateEnabled(true);
      setSelectedProjectId('');
      setProjectResolution(loadingDashboardProjects());
      setEnvironmentRows([]);
      return;
    }

    let cancelled = false;
    setOnboardingLoading(true);
    setOnboardingGateEnabled(true);
    getDashboardOnboardingState()
      .then((state) => {
        if (cancelled) return;
        setOnboardingState(state);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isDashboardConsoleApiErrorCode(error, 'onboarding_not_configured')) {
          setOnboardingState(null);
          setOnboardingGateEnabled(false);
          return;
        }
        setOnboardingState(null);
        setOnboardingGateEnabled(false);
      })
      .finally(() => {
        if (cancelled) return;
        setOnboardingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [consoleSession.claims, currentOrgId, persistedProjectId]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const expectedOrgId = String(consoleSession.claims?.orgId || '').trim();
    if (!expectedOrgId) return;

    const onOnboardingStateUpdated = (event: Event) => {
      const custom = event as CustomEvent<DashboardOnboardingState | null>;
      const detail = custom.detail;
      if (!detail || typeof detail !== 'object') return;
      const nextOrgId = String(detail.orgId || '').trim();
      if (!nextOrgId || nextOrgId !== expectedOrgId) return;
      setOnboardingState(detail);
      setOnboardingGateEnabled(true);
      setOnboardingLoading(false);
    };

    window.addEventListener(
      DASHBOARD_ONBOARDING_STATE_UPDATED_EVENT,
      onOnboardingStateUpdated as EventListener,
    );
    return () => {
      window.removeEventListener(
        DASHBOARD_ONBOARDING_STATE_UPDATED_EVENT,
        onOnboardingStateUpdated as EventListener,
      );
    };
  }, [consoleSession.claims?.orgId]);

  React.useEffect(() => {
    const claims = consoleSession.claims;
    if (!claims) return;
    if (consoleSession.loading || onboardingLoading) return;
    if (isRecoveringOrganizationContext || isSelectingRequestedOrganization) return;
    if (isWaitingForCurrentOrgOnboardingState) return;
    if (!onboardingGateEnabled || !onboardingState) return;
    const isOnboardingRoute = pathname === DASHBOARD_ONBOARDING_ROUTE;
    const isPlatformBillingRoute = pathname === PLATFORM_BILLING_ROUTE;
    if (
      onboardingState.currentStep !== 'complete' &&
      !isOnboardingRoute &&
      !isPlatformBillingRoute
    ) {
      go(sharedAccountHref(DASHBOARD_ONBOARDING_ROUTE));
    }
  }, [
    consoleSession.claims,
    consoleSession.loading,
    go,
    isRecoveringOrganizationContext,
    isSelectingRequestedOrganization,
    isWaitingForCurrentOrgOnboardingState,
    onboardingGateEnabled,
    onboardingLoading,
    onboardingState,
    pathname,
  ]);

  const dashboardEntryRoute = React.useMemo<DashboardRoute | ProductRoute>(() => {
    if (onboardingGateEnabled && onboardingState && onboardingState.currentStep === 'complete')
      return DEFAULT_DASHBOARD_ROUTE;
    return DASHBOARD_ONBOARDING_ROUTE;
  }, [DEFAULT_DASHBOARD_ROUTE, onboardingGateEnabled, onboardingState]);

  React.useEffect(() => {
    const claims = consoleSession.claims;
    if (!claims) {
      setAccountOrganizationsResolved(false);
      setProjectResolution(loadingDashboardProjects());
      return;
    }
    let cancelled = false;
    setAccountOrganizationsResolved(false);
    setProjectResolution(loadingDashboardProjects());
    Promise.allSettled([
      listDashboardAccountOrganizations(),
      currentOrgId ? listDashboardProjects({ status: 'ACTIVE' }) : Promise.resolve([]),
    ])
      .then(([organizationsResult, projectsResult]) => {
        if (cancelled) return;
        const organizations =
          organizationsResult.status === 'fulfilled' ? organizationsResult.value : [];
        const projects = projectsResult.status === 'fulfilled' ? projectsResult.value : [];
        const preferredOrganization = findPreferredOrganizationSummary({
          organizations,
          currentOrgId,
          preferredOrganizationId: persistedOrganizationId,
        });
        const preferredOrganizationProjectId = String(
          preferredOrganization?.selectedProjectId || '',
        ).trim();
        setAccountOrganizations(organizations);
        const nextOrganizationOptions = dedupeOptions(
          organizations
            .filter((entry) => {
              const status = String(entry.status || '')
                .trim()
                .toUpperCase();
              return status === 'ACTIVE' || entry.isCurrentOrg;
            })
            .sort((left, right) => {
              if (left.isCurrentOrg !== right.isCurrentOrg) {
                return left.isCurrentOrg ? -1 : 1;
              }
              const nameDiff = (left.name || left.id).localeCompare(right.name || right.id);
              if (nameDiff !== 0) return nameDiff;
              return left.id.localeCompare(right.id);
            })
            .map((entry) => ({
              value: entry.id,
              label: entry.name || entry.id,
            })),
        );
        setOrganizationOptions(nextOrganizationOptions);
        setAccountOrganizationsResolved(true);
        if (!currentOrgId) return;
        if (
          initialContextResolution.current === 'pending' &&
          persistedOrganizationId &&
          persistedOrganizationId !== currentOrgId
        ) {
          if (organizationsResult.status === 'rejected') {
            setProjectResolution(unavailableDashboardProjects(claims, 'load_failed'));
          }
          return;
        }
        if (projectsResult.status === 'rejected') {
          setProjectResolution(unavailableDashboardProjects(claims, 'load_failed'));
          return;
        }
        const nextProjectOptions = dedupeOptions(
          projects.map((entry) => ({
            value: entry.id,
            label: entry.name || entry.id,
          })),
        );
        let requestedProjectId = scopedPersistedProjectId;
        if (initialContextResolution.current === 'applied') {
          const selected = readPersistedDashboardSelectedContext();
          requestedProjectId =
            selected.organization === currentOrgId ? (selected.project ?? '') : '';
        }
        if (requestedProjectId && !projects.some((project) => project.id === requestedProjectId)) {
          setProjectResolution(unavailableDashboardProjects(claims, 'selection_unavailable'));
          return;
        }
        const nextSelectedProjectId =
          requestedProjectId ||
          (scopedOnboardingSelectedProjectId &&
            nextProjectOptions.find((entry) => entry.value === scopedOnboardingSelectedProjectId)
              ?.value) ||
          (preferredOrganizationProjectId &&
            nextProjectOptions.find((entry) => entry.value === preferredOrganizationProjectId)
              ?.value) ||
          nextProjectOptions[0]?.value ||
          '';
        if (initialContextResolution.current === 'pending') {
          replaceDashboardSelectedContext({
            organization: currentOrgId,
            project: nextSelectedProjectId,
            environment:
              nextSelectedProjectId === scopedPersistedProjectId
                ? scopedPersistedEnvironmentId
                : '',
          });
          initialContextResolution.current = 'applied';
        }
        setSelectedProjectId(nextSelectedProjectId);
        setProjectResolution(loadedDashboardProjects(claims, nextProjectOptions));
      })
      .catch(() => {
        if (cancelled) return;
        setAccountOrganizationsResolved(true);
        setProjectResolution(unavailableDashboardProjects(claims, 'load_failed'));
      });
    return () => {
      cancelled = true;
    };
  }, [
    consoleSession.claims,
    currentOrgId,
    scopedOnboardingSelectedProjectId,
    pathname,
    persistedOrganizationId,
    scopedPersistedProjectId,
    scopedPersistedEnvironmentId,
  ]);

  const switchOrganizationContext = React.useCallback(
    (nextOrgId: string, failurePrefix: string) => {
      const normalizedOrgId = String(nextOrgId || '').trim();
      const claims = consoleSession.claims;
      if (!normalizedOrgId || !claims) return;
      setContextActionErrorMessage('');
      setPendingOrganizationContextOrgId(normalizedOrgId);
      void switchDashboardAccountOrganizationContext(normalizedOrgId)
        .then((nextContext) => {
          clearDashboardUiState();
          replaceDashboardSelectedContext({
            organization: nextContext.orgId,
            project: nextContext.projectId || '',
            environment: '',
          });
          setSelectedProjectId(nextContext.projectId || '');
          consoleSession.refresh();
        })
        .catch((error: unknown) => {
          setPendingOrganizationContextOrgId('');
          setProjectResolution(unavailableDashboardProjects(claims, 'load_failed'));
          setContextActionErrorMessage(
            `${failurePrefix}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    },
    [consoleSession],
  );

  React.useEffect(() => {
    const claims = consoleSession.claims;
    if (
      !claims ||
      !currentOrgId ||
      !accountOrganizationsResolved ||
      pendingOrganizationContextOrgId
    )
      return;
    if (
      initialContextResolution.current === 'applied' ||
      !persistedOrganizationId ||
      persistedOrganizationId === currentOrgId
    )
      return;
    if (projectResolution.kind === 'unavailable') return;
    const organization = organizationOptions.find(
      (entry) => entry.value === persistedOrganizationId,
    );
    if (!organization) {
      setProjectResolution(unavailableDashboardProjects(claims, 'selection_unavailable'));
      return;
    }
    switchOrganizationContext(organization.value, 'Unable to open the selected organization');
  }, [
    accountOrganizationsResolved,
    consoleSession.claims,
    currentOrgId,
    organizationOptions,
    pendingOrganizationContextOrgId,
    persistedOrganizationId,
    projectResolution,
    switchOrganizationContext,
  ]);

  React.useEffect(() => {
    if (!consoleSession.claims) {
      organizationRecoveryAttemptRef.current = '';
      return;
    }
    if (currentOrgId) {
      organizationRecoveryAttemptRef.current = '';
      return;
    }
    if (!accountOrganizationsResolved) return;
    const preferredOrganizationId = recoveryTargetOrgId;
    if (!preferredOrganizationId) return;
    const recoveryKey = recoveryAttemptKey;
    if (organizationRecoveryAttemptRef.current === recoveryKey) return;
    organizationRecoveryAttemptRef.current = recoveryKey;
    switchOrganizationContext(preferredOrganizationId, 'Organization context recovery failed');
  }, [
    accountOrganizationsResolved,
    consoleSession.claims,
    currentOrgId,
    recoveryAttemptKey,
    recoveryTargetOrgId,
    switchOrganizationContext,
  ]);

  React.useEffect(() => {
    if (!consoleSession.claims) {
      setPendingOrganizationContextOrgId('');
      return;
    }
    if (!pendingOrganizationContextOrgId) return;
    if (currentOrgId === pendingOrganizationContextOrgId) {
      setPendingOrganizationContextOrgId('');
    }
  }, [consoleSession.claims, currentOrgId, pendingOrganizationContextOrgId]);

  React.useEffect(() => {
    const onEnvironmentsUpdated = () => setEnvironmentRefreshRevision((revision) => revision + 1);
    window.addEventListener(DASHBOARD_ENVIRONMENTS_UPDATED_EVENT, onEnvironmentsUpdated);
    return () =>
      window.removeEventListener(DASHBOARD_ENVIRONMENTS_UPDATED_EVENT, onEnvironmentsUpdated);
  }, []);

  React.useEffect(() => {
    const claims = consoleSession.claims;
    if (!claims || !currentOrgId || !usesWalletContext) {
      setEnvironmentRows([]);
      return;
    }
    let cancelled = false;
    listDashboardEnvironments()
      .then((environments) => {
        if (cancelled) return;
        setEnvironmentRows(environments);
      })
      .catch(() => {
        if (cancelled) return;
        setEnvironmentRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [consoleSession.claims, currentOrgId, environmentRefreshRevision, usesWalletContext]);

  const environmentOptions = React.useMemo(
    () =>
      buildProjectEnvironmentOptions({
        environments: environmentRows,
        projectId: selectedProjectId,
      }),
    [environmentRows, selectedProjectId],
  );

  const dropdownOptions = React.useMemo<Record<TopbarMenuKey, TopbarOption[]>>(
    () => ({
      organization: dedupeOptions(organizationOptions),
      project: projectOptions,
      environment: environmentOptions,
      accountSettings: withConsoleNetworkOptions(
        DASHBOARD_ACCOUNT_SETTINGS_OPTIONS.map(
          (entry): TopbarOption => ({
            value: entry,
            label: entry,
          }),
        ),
        frontendRuntime,
      ),
    }),
    [
      DASHBOARD_ACCOUNT_SETTINGS_OPTIONS,
      environmentOptions,
      organizationOptions,
      projectOptions,
      frontendRuntime.selectedNetwork,
      frontendRuntime.availableNetworks.length,
    ],
  );

  const workspaceProjectGroups = React.useMemo<SidebarProjectGroup[]>(
    () =>
      dropdownOptions.project.map((project) => ({
        project,
        environments: buildProjectEnvironmentOptions({
          environments: environmentRows,
          projectId: project.value,
        }),
      })),
    [dropdownOptions.project, environmentRows],
  );

  const defaultTopbarContext = React.useMemo<TopbarContextState>(() => {
    const preferredProjectId = String(
      selectedProjectId || currentOrganizationProjectId || scopedOnboardingSelectedProjectId || '',
    ).trim();
    const projectValue =
      dropdownOptions.project.find((entry) => entry.value === preferredProjectId)?.value ||
      dropdownOptions.project[0]?.value ||
      preferredProjectId;
    const preferredEnvironmentId =
      projectValue === scopedPersistedProjectId ? scopedPersistedEnvironmentId : '';
    const preferredEnvironmentOption = dropdownOptions.environment.find(
      (entry) => entry.value === preferredEnvironmentId && isSelectableOption(entry),
    );
    const firstSelectableEnvironmentOption = dropdownOptions.environment.find((entry) =>
      isSelectableOption(entry),
    );
    return {
      organization: dropdownOptions.organization[0]?.value || consoleSession.claims?.orgId || '',
      project: projectValue,
      environment: usesWalletContext
        ? preferredEnvironmentOption?.value || firstSelectableEnvironmentOption?.value || ''
        : '',
      accountSettings: dropdownOptions.accountSettings[0]?.value || '',
    };
  }, [
    consoleSession.claims,
    currentOrganizationProjectId,
    dropdownOptions,
    scopedOnboardingSelectedProjectId,
    scopedPersistedEnvironmentId,
    scopedPersistedProjectId,
    selectedProjectId,
    usesWalletContext,
  ]);

  const {
    isSidebarExpanded,
    selectedContext,
    toggleSidebar,
    onSelectContext: onSelectContextRaw,
  } = useDashboardUiPreferences(pathname, {
    dropdownOptions,
    defaultContext: defaultTopbarContext,
    groupKeys: sidebarGroupKeys,
    defaultExpandedGroups: defaultExpandedSidebarGroups,
  });

  const selectedContextDisplay = React.useMemo<TopbarContextState>(
    () => ({
      organization:
        dropdownOptions.organization.find((entry) => entry.value === selectedContext.organization)
          ?.label || '',
      project:
        dropdownOptions.project.find((entry) => entry.value === selectedContext.project)?.label ||
        selectedContext.project ||
        '',
      environment:
        dropdownOptions.environment.find((entry) => entry.value === selectedContext.environment)
          ?.label ||
        selectedContext.environment ||
        '',
      accountSettings:
        dropdownOptions.accountSettings.find(
          (entry) => entry.value === selectedContext.accountSettings,
        )?.label ||
        selectedContext.accountSettings ||
        '',
    }),
    [dropdownOptions, selectedContext],
  );

  React.useEffect(() => {
    if (!currentOrgId) return;
    if (selectedContext.organization === currentOrgId) return;
    onSelectContextRaw('organization', currentOrgId);
  }, [currentOrgId, onSelectContextRaw, selectedContext.organization]);

  React.useEffect(() => {
    if (!consoleSession.claims) return;
    if (currentOrgId) return;
    if (accountOrganizations.length > 0) return;
    const hasStaleScope =
      String(selectedContext.organization || '').trim().length > 0 ||
      String(selectedContext.project || '').trim().length > 0 ||
      String(selectedContext.environment || '').trim().length > 0;
    if (!hasStaleScope) return;
    replaceDashboardSelectedContext({
      organization: '',
      project: '',
      environment: '',
    });
  }, [
    accountOrganizations.length,
    consoleSession.claims,
    currentOrgId,
    selectedContext.environment,
    selectedContext.organization,
    selectedContext.project,
  ]);

  React.useEffect(() => {
    const project = String(selectedContext.project || '').trim();
    if (!project || project === selectedProjectId) return;
    setSelectedProjectId(project);
  }, [selectedContext.project, selectedProjectId]);

  const onSelectContext = React.useCallback(
    (menu: TopbarMenuKey, value: string) => {
      if (menu === 'accountSettings' && selectConsoleNetworkOption(value)) return;
      if (menu === 'organization') {
        const nextOrgId = String(value || '').trim();
        if (!nextOrgId) return;
        setContextActionErrorMessage('');
        if (!currentOrgId || nextOrgId === currentOrgId) {
          onSelectContextRaw(menu, nextOrgId);
          return;
        }
        switchOrganizationContext(nextOrgId, 'Organization switch failed');
        return;
      }
      if (menu === 'accountSettings' && value === DASHBOARD_ACCOUNT_SETTINGS_ACCOUNT_OPTION) {
        go(sharedAccountHref(DASHBOARD_ACCOUNT_SETTINGS_ROUTE));
        return;
      }
      if (menu === 'accountSettings' && value === DASHBOARD_ACCOUNT_SETTINGS_SIGN_OUT_OPTION) {
        if (logoutPending) return;
        setLogoutPending(true);
        setLogoutErrorMessage('');
        /* Sign-out is fail-safe: a revoke that errors must still drop the user
           out of the console. Leaving them on the dashboard with only an inline
           error reads as "sign out did nothing". */
        void revokeDashboardConsoleSession()
          .catch((error: unknown) => {
            setLogoutErrorMessage(error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            markDashboardConsoleSignOut();
            clearDashboardUiState();
            consoleSession.refresh();
            go(DASHBOARD_LOGIN_ROUTE);
            setLogoutPending(false);
          });
        return;
      }
      if (
        menu === 'environment' &&
        dropdownOptions.environment.find((entry) => entry.value === value)?.disabled === true
      ) {
        go(sharedAccountHref('/dashboard/billing/account?billing=production_required'));
        return;
      }
      onSelectContextRaw(menu, value);
      if (menu === 'project') {
        setSelectedProjectId(value);
      }
    },
    [
      DASHBOARD_ACCOUNT_SETTINGS_ACCOUNT_OPTION,
      DASHBOARD_ACCOUNT_SETTINGS_SIGN_OUT_OPTION,
      currentOrgId,
      consoleSession,
      dropdownOptions.environment,
      go,
      logoutPending,
      onSelectContextRaw,
      frontendRuntime,
      switchOrganizationContext,
    ],
  );

  const onSelectWorkspaceEnvironment = React.useCallback(
    (projectId: string, environmentId: string) => {
      const group = workspaceProjectGroups.find((entry) => entry.project.value === projectId);
      const environment = group?.environments.find((entry) => entry.value === environmentId);
      if (!group || group.project.disabled || !environment || environment.disabled) return;
      // Persist the complete selection before option changes rehydrate preferences.
      replaceDashboardSelectedContext({
        organization: currentOrgId,
        project: projectId,
        environment: environmentId,
      });
      setSelectedProjectId(projectId);
    },
    [currentOrgId, frontendRuntime, workspaceProjectGroups],
  );

  React.useEffect(() => {
    if (!consoleSession.claims) return;
    if (onboardingGateEnabled && onboardingLoading) return;
    if (isWaitingForCurrentOrgOnboardingState) return;
    if (onboardingGateEnabled && !onboardingState) return;
    if (isRecoveringOrganizationContext || isSelectingRequestedOrganization) return;
    if (pathname === '/dashboard') {
      go(sharedAccountHref(dashboardEntryRoute));
    }
  }, [
    consoleSession.claims,
    dashboardEntryRoute,
    getRouteFromPathname,
    go,
    isRecoveringOrganizationContext,
    isSelectingRequestedOrganization,
    isWaitingForCurrentOrgOnboardingState,
    onboardingGateEnabled,
    onboardingLoading,
    onboardingState,
    pathname,
  ]);

  React.useEffect(() => {
    if (!consoleSession.claims) return;
    if (onboardingGateEnabled && onboardingLoading) return;
    if (isWaitingForCurrentOrgOnboardingState) return;
    if (onboardingGateEnabled && !onboardingState) return;
    if (isRecoveringOrganizationContext || isSelectingRequestedOrganization) return;
    if (
      pathname !== '/dashboard' &&
      (pathname.startsWith('/dashboard/') || pathname.startsWith('/platform/')) &&
      !getRouteFromPathname(pathname)
    ) {
      go(sharedAccountHref(dashboardEntryRoute));
    }
  }, [
    consoleSession.claims,
    dashboardEntryRoute,
    getRouteFromPathname,
    go,
    isRecoveringOrganizationContext,
    isSelectingRequestedOrganization,
    isWaitingForCurrentOrgOnboardingState,
    onboardingGateEnabled,
    onboardingLoading,
    onboardingState,
    pathname,
  ]);

  React.useEffect(() => {
    if (consoleSession.loading || consoleSession.claims) return;
    if (sessionForbidden) return;
    if (
      pathname === '/dashboard' ||
      pathname.startsWith('/dashboard/') ||
      pathname.startsWith('/platform/')
    ) {
      rememberConsoleContext();
      go(consoleSessionHref(DASHBOARD_LOGIN_ROUTE));
    }
  }, [consoleSession.claims, consoleSession.loading, go, pathname, sessionForbidden]);

  const activeRoute = React.useMemo<DashboardRoute | ProductRoute>(() => {
    const resolved = getRouteFromPathname(pathname);
    if (resolved) return resolved;
    if (pathname === '/dashboard') return dashboardEntryRoute;
    return DEFAULT_DASHBOARD_ROUTE;
  }, [DEFAULT_DASHBOARD_ROUTE, dashboardEntryRoute, getRouteFromPathname, pathname]);

  const activeView = React.useMemo(
    () => getViewForRoute(activeRoute),
    [activeRoute, getViewForRoute],
  );
  const ActiveViewComponent = activeView.component;
  const onboardingRouteActive = activeRoute === DASHBOARD_ONBOARDING_ROUTE;
  const focusedOnboardingMode = onboardingRouteActive;
  const isSidebarCollapsed = !isSidebarExpanded;
  const shellClassName = `dashboard-shell dashboard-shell--route-${activeView.key}${focusedOnboardingMode ? ' dashboard-shell--onboarding-focus' : ''}${isSidebarCollapsed ? ' dashboard-shell--sidebar-collapsed' : ''}`;
  const navigationLockExemptPaths = React.useMemo<ReadonlySet<DashboardRoute | ProductRoute>>(
    () =>
      new Set<DashboardRoute | ProductRoute>(
        isPlatformAdmin
          ? [DASHBOARD_ACCOUNT_SETTINGS_ROUTE, PLATFORM_BILLING_ROUTE]
          : [DASHBOARD_ACCOUNT_SETTINGS_ROUTE],
      ),
    [isPlatformAdmin],
  );
  const visibleSidebarGroups = React.useMemo(
    () =>
      SIDEBAR_GROUPS.filter((group) => group.key !== 'platform' || isPlatformAdmin)
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) => item.access !== 'owner' || consoleSession.claims?.role === 'OWNER',
          ),
        }))
        .filter((group) => group.items.length > 0),
    [SIDEBAR_GROUPS, consoleSession.claims?.role, isPlatformAdmin],
  );

  const topbarSearchItems = React.useMemo(
    () =>
      visibleSidebarGroups.flatMap((group) =>
        group.items.map((item) => ({
          label: item.label,
          path: item.path,
          group: group.label,
          icon: item.icon,
        })),
      ),
    [visibleSidebarGroups],
  );

  if (sessionForbidden) {
    return (
      <main className="dashboard-session-gate" aria-label="Dashboard access">
        <h1>Unable to open your workspace</h1>
        <p role="alert">Your current session does not have access to this organization.</p>
        <a {...linkProps(DASHBOARD_LOGIN_ROUTE)}>Sign in again</a>
      </main>
    );
  }

  if (
    import.meta.env.MODE === 'wallet' &&
    projectResolution.kind === 'unavailable' &&
    projectResolution.orgId === currentOrgId &&
    !pendingOrganizationContextOrgId
  ) {
    return (
      <main className="dashboard-session-gate" aria-label="Dashboard access">
        <h1>Unable to open this project</h1>
        <p role="alert">
          {projectResolution.reason === 'selection_unavailable'
            ? 'The selected account or project is unavailable. Choose a project in Platform Console.'
            : 'Projects could not be loaded. Try again.'}
        </p>
        <a href={platformConsoleHref('/dashboard/account-settings')}>Open Platform Console</a>
        <button type="button" onClick={consoleSession.refresh}>
          Retry
        </button>
      </main>
    );
  }

  const walletProjectContextPending =
    usesWalletContext &&
    (projectResolution.kind !== 'loaded' ||
      projectResolution.orgId !== currentOrgId ||
      Boolean(pendingOrganizationContextOrgId) ||
      selectedContext.organization !== currentOrgId ||
      selectedContext.project !== selectedProjectId ||
      (Boolean(selectedContext.project) &&
        !projectOptions.some((project) => project.value === selectedContext.project)));

  /* Keep the shell hidden until session and dashboard-entry routing decisions
     resolve. The provisional entry route points at onboarding, so mounting it
     here would expose the wizard before an existing workspace loads. */
  if (!consoleSession.claims || isDashboardEntryRoutePending || walletProjectContextPending) {
    return (
      <main className="dashboard-session-gate" aria-label="Dashboard workspace" aria-busy>
        <DashboardLoadingState
          title={
            consoleSession.claims
              ? 'Opening dashboard...'
              : consoleSession.loading
                ? 'Checking your session...'
                : 'Redirecting to sign in...'
          }
        />
      </main>
    );
  }

  return (
    <main className={shellClassName} aria-label="Dashboard workspace">
      <DashboardNavigation
        accountLabel={consoleSession.claims?.name || consoleSession.claims?.email || 'Account'}
        onSelectContext={onSelectContext}
        dropdownOptions={dropdownOptions}
        pageTitle={activeView.label}
        groups={visibleSidebarGroups}
        externalLinks={linksWithConsoleContext(composition.externalLinks ?? [], selectedContext)}
        activeRoute={activeRoute}
        isSidebarExpanded={isSidebarExpanded}
        onToggleSidebar={toggleSidebar}
        linkProps={linkProps}
        homeProps={homeProps}
        disableNavigationItems={isSidebarNavigationLocked}
        enabledWhenLockedPaths={onboardingRouteActive ? undefined : navigationLockExemptPaths}
        workspace={
          usesWalletContext
            ? {
                kind: 'wallet',
                projectGroups: workspaceProjectGroups,
                projectValue: selectedContext.project,
                environmentValue: selectedContext.environment,
                onSelectEnvironment: onSelectWorkspaceEnvironment,
                organizationOptions: dropdownOptions.organization,
                organizationValue: selectedContext.organization,
              }
            : {
                kind: 'account',
                projectGroups: workspaceProjectGroups,
                projectValue: selectedContext.project,
                onSelectProject: onSelectContext.bind(null, 'project'),
                organizationOptions: dropdownOptions.organization,
                organizationValue: selectedContext.organization,
              }
        }
        product={{
          products: DASHBOARD_PRODUCTS,
          currentId: selectedProductId,
          onSelect: setSelectedProductId,
        }}
        searchItems={topbarSearchItems}
        onNavigate={go}
      />

      <section className="dashboard-main" aria-labelledby="dashboard-main-title">
        <div className="dashboard-main__header">
          <h1 id="dashboard-main-title" className="dashboard-main__title">
            {activeView.label}
          </h1>
          <div className="dashboard-main__actions" id={DASHBOARD_PAGE_ACTIONS_SLOT_ID} />
        </div>
        {showNavigationLockBanner ? (
          <p className="dashboard-lock-banner" role="status">
            Finish organization + project setup to unlock navigation.
          </p>
        ) : null}
        {logoutErrorMessage ? (
          <p className="dashboard-table-limit" role="alert">
            Sign out failed: {logoutErrorMessage}
          </p>
        ) : null}
        {contextActionErrorMessage ? (
          <p className="dashboard-table-limit" role="alert">
            {contextActionErrorMessage}
          </p>
        ) : null}

        <DashboardSelectedContextProvider
          value={selectedContext}
          displayValue={selectedContextDisplay}
        >
          <ActiveViewComponent
            key={`${currentOrgId}:${selectedContext.project}:${selectedContext.environment}`}
          />
        </DashboardSelectedContextProvider>
      </section>
      <div className="dashboard-overlay-layer" aria-hidden="true" />
    </main>
  );
}

function DashboardEntry<ProductRoute extends string, ProductGroupKey extends string>(
  props: DashboardPageProps<ProductRoute, ProductGroupKey>,
): React.JSX.Element {
  const { go } = useSiteRouter();
  const [entry, setEntry] = React.useState<'loading' | 'onboarding' | 'workspace'>('loading');
  React.useEffect(() => {
    let cancelled = false;
    rememberConsoleContext();
    readUnscopedConsoleSession(requireConsoleBaseUrl())
      .then((onboarding) => {
        if (cancelled) return;
        if (onboarding && import.meta.env.MODE === 'wallet') {
          go(consoleSessionHref(DASHBOARD_LOGIN_ROUTE));
          return;
        }
        setEntry(onboarding ? 'onboarding' : 'workspace');
        if (onboarding) go(consoleSessionHref(DASHBOARD_ONBOARDING_ROUTE));
      })
      .catch(() => {
        if (!cancelled) setEntry('workspace');
      });
    return () => {
      cancelled = true;
    };
  }, [go]);
  switch (entry) {
    case 'loading':
      return (
        <main className="dashboard-session-gate" aria-busy>
          <DashboardLoadingState title="Opening dashboard..." />
        </main>
      );
    case 'onboarding':
      return (
        <InitialOnboardingShell
          composition={props.composition}
          onOrganizationCreated={setEntry.bind(null, 'workspace')}
        />
      );
    case 'workspace':
      return (
        <DashboardConsoleSessionProvider>
          <DashboardPageInner {...props} />
        </DashboardConsoleSessionProvider>
      );
  }
}

function InitialOnboardingShell<ProductRoute extends string, ProductGroupKey extends string>({
  composition,
  onOrganizationCreated,
}: DashboardPageProps<ProductRoute, ProductGroupKey> & {
  onOrganizationCreated: () => void;
}): React.JSX.Element {
  const { go, linkProps } = useSiteRouter();
  const frontendRuntime = useFrontendRuntime();
  const [isSidebarExpanded, setIsSidebarExpanded] = React.useState(true);
  const [selectedProductId, setSelectedProductId] = React.useState<DashboardProductId>(
    composition.defaultProductId,
  );
  const [logoutPending, setLogoutPending] = React.useState(false);
  const homeProps = linkProps('https://seams.sh/');
  const accountOptions = React.useMemo<TopbarOption[]>(
    () =>
      withConsoleNetworkOptions(
        [
          {
            value: composition.accountSettingsSignOutOption,
            label: logoutPending ? 'Signing out...' : composition.accountSettingsSignOutOption,
            disabled: logoutPending,
          },
        ],
        frontendRuntime,
      ),
    [
      composition.accountSettingsSignOutOption,
      logoutPending,
      frontendRuntime.selectedNetwork,
      frontendRuntime.availableNetworks.length,
    ],
  );
  const dropdownOptions = React.useMemo<Record<TopbarMenuKey, TopbarOption[]>>(
    () => ({
      organization: [],
      project: [],
      environment: [],
      accountSettings: accountOptions,
    }),
    [accountOptions],
  );

  const toggleSidebar = React.useCallback(() => {
    setIsSidebarExpanded((current) => !current);
  }, []);
  const selectAccountOption = React.useCallback(
    (value: string) => {
      if (selectConsoleNetworkOption(value)) return;
      if (value !== composition.accountSettingsSignOutOption || logoutPending) return;
      setLogoutPending(true);
      void revokeDashboardConsoleSession().finally(() => {
        markDashboardConsoleSignOut();
        clearDashboardUiState();
        go(DASHBOARD_LOGIN_ROUTE);
        setLogoutPending(false);
      });
    },
    [composition.accountSettingsSignOutOption, go, logoutPending],
  );
  const selectTopbarContext = React.useCallback(
    (menu: TopbarMenuKey, value: string) => {
      if (menu === 'accountSettings') selectAccountOption(value);
    },
    [selectAccountOption],
  );

  const shellClassName = `dashboard-shell dashboard-shell--route-onboarding dashboard-shell--onboarding-focus${isSidebarExpanded ? '' : ' dashboard-shell--sidebar-collapsed'}`;

  return (
    <main className={shellClassName} aria-label="Dashboard workspace">
      <DashboardNavigation
        accountLabel="Account"
        onSelectContext={selectTopbarContext}
        dropdownOptions={dropdownOptions}
        pageTitle="Onboarding"
        groups={composition.sidebarGroups}
        activeRoute={DASHBOARD_ONBOARDING_ROUTE}
        isSidebarExpanded={isSidebarExpanded}
        onToggleSidebar={toggleSidebar}
        linkProps={linkProps}
        homeProps={homeProps}
        disableNavigationItems
        product={{
          products: composition.products,
          currentId: selectedProductId,
          onSelect: setSelectedProductId,
        }}
      />

      <section className="dashboard-main" aria-labelledby="dashboard-main-title">
        <div className="dashboard-main__header">
          <h1 id="dashboard-main-title" className="dashboard-main__title">
            Onboarding
          </h1>
        </div>
        <DashboardOnboardingPage onOrganizationCreated={onOrganizationCreated} />
      </section>
      <div className="dashboard-overlay-layer" aria-hidden="true" />
    </main>
  );
}

export function DashboardPage<ProductRoute extends string, ProductGroupKey extends string>(
  props: DashboardPageProps<ProductRoute, ProductGroupKey>,
): React.JSX.Element {
  const { selectedNetwork } = useFrontendRuntime();
  return <DashboardEntry key={selectedNetwork} {...props} />;
}

export default DashboardPage;
