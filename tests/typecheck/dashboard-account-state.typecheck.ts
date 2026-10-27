import type { DashboardConsoleSessionClaims } from '../../apps/wallet-console/src/core/dashboard/consoleSession';
import type { DashboardOnboardingState } from '../../apps/wallet-console/src/core/dashboard/routes/onboarding/consoleOnboardingApi';
import type {
  EnableableService,
  ServiceStatus,
} from '../../apps/wallet-console/src/core/dashboard/routes/services/consoleServicesApi';
import type {
  DashboardBillingCostsState,
  DashboardBillingUsageCharge,
  DashboardBillingUsageCharges,
} from '../../apps/wallet-console/src/core/dashboard/routes/billing/consoleBillingApi';
import type { DashboardWorkspaceNavigation } from '../../apps/wallet-console/src/core/dashboard/layout/DashboardNavigation';

declare const owner: Extract<DashboardConsoleSessionClaims, { role: 'OWNER' }>;
declare const sessionWithoutProvider: Omit<typeof owner, 'provider'>;
declare const rawProvider: string;
declare const completed: Extract<DashboardOnboardingState, { currentStep: 'complete' }>;
declare const activeWallet: Extract<ServiceStatus, { kind: 'active' }>;

// @ts-expect-error The session requires an explicit provider or null.
const missingSessionProvider: DashboardConsoleSessionClaims = sessionWithoutProvider;
void missingSessionProvider;

// @ts-expect-error Raw provider strings must pass through the session response parser.
const unparsedSessionProvider: DashboardConsoleSessionClaims = { ...owner, provider: rawProvider };
void unparsedSessionProvider;

// @ts-expect-error Email domains do not identify a sign-in provider.
const emailDomainProvider: DashboardConsoleSessionClaims['provider'] = 'gmail';
void emailDomainProvider;

// @ts-expect-error A member requires assigned project access.
const memberWithAllProjects: DashboardConsoleSessionClaims = {
  ...owner,
  role: 'MEMBER',
  adminPermissions: [],
};
void memberWithAllProjects;

// @ts-expect-error A session requires an explicit project selection or null.
const missingProject: DashboardConsoleSessionClaims = {
  userId: 'user',
  orgId: 'organization',
  membershipId: 'membership',
  authorizationVersion: 1,
  role: 'OWNER',
  adminPermissions: [],
  projectAccess: { kind: 'all' },
  platformSupport: false,
  provider: null,
};
void missingProject;

// @ts-expect-error Project setup cannot retain completed account state through a spread.
const mixedOnboarding: DashboardOnboardingState = { ...completed, currentStep: 'project' };
void mixedOnboarding;

// @ts-expect-error Completed onboarding requires its selected project.
const missingSelectedProject: DashboardOnboardingState = { ...completed, selectedProjectId: null };
void missingSelectedProject;

// @ts-expect-error An active Wallet instance cannot start an enable operation.
const duplicateActivation: EnableableService = activeWallet;
void duplicateActivation;

declare const historicalCharge: Extract<
  DashboardBillingUsageCharge,
  { kind: 'historical_organization' }
>;
declare const walletExecutionCharge: Extract<
  DashboardBillingUsageCharge,
  { meterId: 'wallet.execution' }
>;
declare const costsLoading: Extract<DashboardBillingCostsState, { kind: 'loading' }>;
declare const usageCharges: DashboardBillingUsageCharges;

// @ts-expect-error Historical organization charges cannot acquire a meter through a spread.
const attributedHistoricalCharge: DashboardBillingUsageCharge = {
  ...historicalCharge,
  meterId: 'wallet.execution',
};
void attributedHistoricalCharge;

const wrongServiceCharge: DashboardBillingUsageCharge = {
  ...walletExecutionCharge,
  // @ts-expect-error Wallet execution charges require Wallet service attribution.
  attribution: { ...walletExecutionCharge.attribution, serviceId: 'satyr' },
};
void wrongServiceCharge;

// @ts-expect-error Wallet execution charges require the execution unit.
const wrongUnitCharge: DashboardBillingUsageCharge = { ...walletExecutionCharge, unit: 'turn' };
void wrongUnitCharge;

// @ts-expect-error Loading costs cannot retain a successful response through a spread.
const loadingWithData: DashboardBillingCostsState = { ...costsLoading, data: usageCharges };
void loadingWithData;

declare const accountWorkspace: Extract<DashboardWorkspaceNavigation, { kind: 'account' }>;

// @ts-expect-error Account navigation cannot retain a Wallet environment through a spread.
const mixedWorkspace: DashboardWorkspaceNavigation = {
  ...accountWorkspace,
  environmentValue: 'wallet:dev',
};
void mixedWorkspace;

// @ts-expect-error Active instances cannot retain shutdown state through a spread.
const activeWithShutdown: ServiceStatus = { ...activeWallet, shutdown: 'pending' };
void activeWithShutdown;

// @ts-expect-error Absent instances cannot carry an operation identity.
const absentWithOperation: ServiceStatus = { kind: 'absent', operationId: 'operation' };
void absentWithOperation;
