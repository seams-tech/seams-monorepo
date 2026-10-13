import type { DashboardConsoleSessionClaims } from '../../apps/wallet-console/src/core/dashboard/consoleSession';
import type { DashboardOnboardingState } from '../../apps/wallet-console/src/core/dashboard/routes/onboarding/consoleOnboardingApi';
import type {
  EnableableWalletService,
  WalletServiceStatus,
} from '../../apps/wallet-console/src/products/wallet/consoleWalletServiceApi';

declare const owner: Extract<DashboardConsoleSessionClaims, { role: 'OWNER' }>;
declare const completed: Extract<DashboardOnboardingState, { currentStep: 'complete' }>;
declare const activeWallet: Extract<WalletServiceStatus, { kind: 'active' }>;

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
};
void missingProject;

// @ts-expect-error Project setup cannot retain completed account state through a spread.
const mixedOnboarding: DashboardOnboardingState = { ...completed, currentStep: 'project' };
void mixedOnboarding;

// @ts-expect-error Completed onboarding requires its selected project.
const missingSelectedProject: DashboardOnboardingState = { ...completed, selectedProjectId: null };
void missingSelectedProject;

// @ts-expect-error An active Wallet instance cannot start an enable operation.
const duplicateActivation: EnableableWalletService = activeWallet;
void duplicateActivation;
