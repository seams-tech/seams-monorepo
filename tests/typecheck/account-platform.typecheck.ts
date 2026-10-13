import type {
  ActiveServiceStateV1,
  BillingChargeAttributionV1,
  BoundServiceInstanceV1,
  FundsReservationV1,
  PlatformPrincipalV1,
  PlatformIdentityLinkV1,
  PlatformScopeV1,
  PlatformUsageEventV1,
  SatyrFundingSelectionV1,
  SatyrTenantScopeV1,
  ServiceTenantBindingV1,
  ServiceProvisionCommandV1,
  SettleableFundsReservationV1,
  WalletTenantScopeV1,
} from '../../packages/console-shared-ts/src/accountPlatform';
import type { AccountMigrationCohortV1 } from '../../packages/console-server-ts/src/accountPlatform/migration';
import type { AccountServiceInstanceV1 } from '../../packages/console-server-ts/src/accountPlatform/types';

declare const scope: PlatformScopeV1;
declare const binding: ServiceTenantBindingV1;
declare const active: BoundServiceInstanceV1<ActiveServiceStateV1>;
declare const usage: PlatformUsageEventV1;
declare const cohort: AccountMigrationCohortV1;
declare const provisionCommand: ServiceProvisionCommandV1;
declare const storedInstance: AccountServiceInstanceV1;
declare const unsettled: Extract<FundsReservationV1, { readonly kind: 'indeterminate' }>;
declare const linkedIdentity: PlatformIdentityLinkV1;

// @ts-expect-error Plain fields do not construct a validated platform scope.
const literalScope: PlatformScopeV1 = {
  namespace: 'fixture',
  organizationId: 'org_fixture',
  projectId: 'project_fixture',
  billingAccountId: 'billing_fixture',
};

// @ts-expect-error A spread loses the private proof of boundary validation.
const spreadScope: PlatformScopeV1 = { ...scope };
// @ts-expect-error A binding must enter through its parser.
const spreadBinding: ServiceTenantBindingV1 = { ...binding };
// @ts-expect-error A finalized instance must enter through its branch builder.
const spreadInstance: BoundServiceInstanceV1<ActiveServiceStateV1> = { ...active };
// @ts-expect-error A parsed usage event cannot be replaced with a broad spread.
const spreadUsage: PlatformUsageEventV1 = { ...usage };
// @ts-expect-error Migration input must enter through its parser.
const spreadCohort: AccountMigrationCohortV1 = { ...cohort };
// @ts-expect-error A command requires boundary validation.
const spreadCommand: ServiceProvisionCommandV1 = { ...provisionCommand };
// @ts-expect-error A stored instance requires its authoritative storage parser.
const spreadStoredInstance: AccountServiceInstanceV1 = { ...storedInstance };

// @ts-expect-error An active instance requires its accepted receipt.
const incompleteActive: ActiveServiceStateV1 = { kind: 'active', desiredRevision: 1, binding };

// @ts-expect-error Wallet uniqueness requires the native project identity.
const incompleteWallet: WalletTenantScopeV1 = {
  serviceId: 'wallet',
  deploymentId: 'wallet-deployment',
  namespace: 'fixture',
  nativeOrganizationId: 'native-org',
};

const invalidSatyrScope: SatyrTenantScopeV1 = {
  serviceId: 'satyr',
  deploymentId: 'satyr-deployment',
  nativeOrganizationId: 'native-org',
  // @ts-expect-error Satyr binds its complete tenant without a Wallet project field.
  nativeProjectId: 'wallet-project',
};

// @ts-expect-error Unreconciled holds cannot settle or release.
const prematureSettlement: SettleableFundsReservationV1 = unsettled;

// @ts-expect-error Unattributed history cannot acquire an arbitrary instance.
const historical: BillingChargeAttributionV1 = {
  kind: 'historical_organization',
  namespace: 'fixture',
  organizationId: 'org_fixture',
  billingAccountId: 'billing_fixture',
  instanceId: 'instance_fixture',
};

// @ts-expect-error The pinned customer route cannot become platform-funded.
const mixedFunding: SatyrFundingSelectionV1 = {
  kind: 'platform',
  selection: 'codex_subscription',
  modelRouteDigest: 'a'.repeat(64),
};

// @ts-expect-error Automation cannot carry an arbitrary user's identity.
const impersonatingService: PlatformPrincipalV1 = {
  kind: 'automation',
  automationId: 'automation_fixture',
  grantId: 'grant_fixture',
  identity: linkedIdentity,
};

void literalScope;
void spreadScope;
void spreadBinding;
void spreadInstance;
void spreadUsage;
void spreadCohort;
void spreadCommand;
void spreadStoredInstance;
void incompleteActive;
void incompleteWallet;
void invalidSatyrScope;
void prematureSettlement;
void historical;
void mixedFunding;
void impersonatingService;
