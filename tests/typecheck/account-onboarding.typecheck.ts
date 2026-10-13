import type { ConsoleAccountIdentityContext } from '../../packages/console-server-ts/src/account/service';
import type { ConsoleOnboardingContext } from '../../packages/console-server-ts/src/onboarding/service';
import type {
  ConsoleOnboardingState,
  CreateConsoleOnboardingProjectRequest,
} from '../../packages/console-server-ts/src/onboarding/types';

declare const account: ConsoleAccountIdentityContext;
declare const onboarding: ConsoleOnboardingContext;
declare const complete: Extract<ConsoleOnboardingState, { currentStep: 'complete' }>;

const accountWithWalletEnvironment: ConsoleAccountIdentityContext = {
  ...account,
  // @ts-expect-error Account context cannot acquire a Wallet environment through a spread.
  environmentId: 'wallet-environment',
};
const onboardingWithWalletEnvironment: ConsoleOnboardingContext = {
  ...onboarding,
  // @ts-expect-error Onboarding context cannot acquire a Wallet environment through a spread.
  environmentId: 'wallet-environment',
};
const projectWithWalletEnvironment: CreateConsoleOnboardingProjectRequest = {
  project: { name: 'Platform project' },
  // @ts-expect-error Account project creation cannot provision a Wallet environment.
  environment: { name: 'Development' },
};
// @ts-expect-error A completed state requires the selected platform project.
const completeWithoutProject: ConsoleOnboardingState = { ...complete, selectedProjectId: null };
// @ts-expect-error A completed state cannot claim that project readiness failed.
const inconsistentReadiness: ConsoleOnboardingState = { ...complete, projectReady: false };
// @ts-expect-error A completed state cannot omit its organisation.
const completeWithoutOrganization: ConsoleOnboardingState = { ...complete, organization: null };
// @ts-expect-error An organisation step cannot claim completed account onboarding.
const invalidLiteral: ConsoleOnboardingState = {
  orgId: 'org_fixture',
  accountReady: true,
  currentStep: 'organization',
  organization: null,
  activeProjectCount: 0,
  hasOrganization: false,
  hasProject: false,
  organizationReady: false,
  projectReady: false,
  onboardingComplete: true,
  complete: true,
  selectedProjectId: null,
};

void accountWithWalletEnvironment;
void onboardingWithWalletEnvironment;
void projectWithWalletEnvironment;
void completeWithoutProject;
void inconsistentReadiness;
void completeWithoutOrganization;
void invalidLiteral;
