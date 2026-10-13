import type {
  DelegatedPlatformAssertionV1,
  FundsTerminalDeliveryV1,
  FundsTerminalRequestV1,
  PlatformIdentityLinkV1,
  PlatformPrincipalV1,
  PlatformUserAuthorityV1,
  ReleaseFundsRequestV1,
  SatyrFeePolicyV1,
  SatyrServiceFeePolicyV1,
  ServiceEligibilityRequestV1,
  ServiceIdentityLinkRequestV1,
  ServiceIdentityResolutionV1,
  ServiceProvisionOwnerAssertionV1,
} from '../../packages/console-shared-ts/src/accountPlatform';

declare const assertion: DelegatedPlatformAssertionV1;
declare const eligibility: ServiceEligibilityRequestV1;
declare const identityLink: ServiceIdentityLinkRequestV1;
declare const resolution: ServiceIdentityResolutionV1;
declare const feePolicy: SatyrServiceFeePolicyV1;
declare const terminal: FundsTerminalDeliveryV1;
declare const provisionOwner: ServiceProvisionOwnerAssertionV1;
declare const release: ReleaseFundsRequestV1;
declare const identity: PlatformIdentityLinkV1;
declare const sessionAuthority: Extract<
  PlatformUserAuthorityV1,
  { readonly kind: 'authenticated_session' }
>;
declare const isolatedFee: Extract<
  SatyrFeePolicyV1,
  { readonly kind: 'isolated_e2e_completed_turn' }
>;

// @ts-expect-error A signed assertion requires boundary validation before verification.
const spreadAssertion: DelegatedPlatformAssertionV1 = { ...assertion };
// @ts-expect-error Eligibility must enter through its exact request parser.
const spreadEligibility: ServiceEligibilityRequestV1 = { ...eligibility };
// @ts-expect-error Identity linking requires a parsed transient provider proof.
const spreadIdentityLink: ServiceIdentityLinkRequestV1 = { ...identityLink };
// @ts-expect-error A current revision response requires boundary validation.
const spreadResolution: ServiceIdentityResolutionV1 = { ...resolution };
// @ts-expect-error An unvalidated fee response cannot select a charging policy.
const spreadFeePolicy: SatyrServiceFeePolicyV1 = { ...feePolicy };
// @ts-expect-error Terminal delivery requires validated evidence and an accepted time.
const spreadTerminal: FundsTerminalDeliveryV1 = { ...terminal };
// @ts-expect-error Provisioning owner proof requires a parsed command-bound assertion.
const spreadProvisionOwner: ServiceProvisionOwnerAssertionV1 = { ...provisionOwner };

// @ts-expect-error Plain identity fields cannot construct a validated resolution.
const literalResolution: ServiceIdentityResolutionV1 = {
  version: 1,
  scope: resolution.scope,
  instanceId: resolution.instanceId,
  nativePrincipalId: resolution.nativePrincipalId,
  principal: resolution.principal,
  authorityRevision: resolution.authorityRevision,
};

// @ts-expect-error A user requires an explicit session, accepted execution, or recipient origin.
const missingAuthority: PlatformPrincipalV1 = { kind: 'user', identity };

// @ts-expect-error The retired sessionId branch cannot bypass the authority union.
const retiredSession: PlatformPrincipalV1 = { kind: 'user', identity, sessionId: 'session' };

// @ts-expect-error A disclosure recipient cannot also supply session authority.
const mixedAuthority: PlatformUserAuthorityV1 = {
  kind: 'disclosure_recipient',
  disclosureEvidenceId: 'disclosure',
  nativeSessionId: 'session',
};

// @ts-expect-error A verified Slack event cannot acquire a fabricated session origin.
const eventSession: PlatformUserAuthorityV1 = {
  kind: 'authenticated_provider_event',
  provider: 'slack',
  nativeEventId: 'slack-event',
  nativeIntegrationAccountId: 'slack-integration',
  nativeWorkspaceId: 'slack-workspace',
  nativeExternalUserId: 'slack-user',
  nativeSessionId: 'session',
};

// @ts-expect-error An automation cannot impersonate a native user session.
const automationSession: PlatformPrincipalV1 = {
  kind: 'automation',
  automationId: 'automation',
  grantId: 'grant',
  authority: sessionAuthority,
};

// @ts-expect-error Customer unpriced policy cannot carry the isolated test price.
const customerTestPrice: SatyrFeePolicyV1 = {
  ...isolatedFee,
  kind: 'customer_unpriced',
};

// @ts-expect-error A test fee requires its complete fixed meter, price, currency, and amount.
const incompleteFee: SatyrFeePolicyV1 = { kind: 'isolated_e2e_completed_turn', unitMinor: 1 };

// @ts-expect-error A settlement branch cannot contain a release proof.
const mismatchedTerminal: FundsTerminalRequestV1 = { kind: 'settle', request: release };

void spreadAssertion;
void spreadEligibility;
void spreadIdentityLink;
void spreadResolution;
void spreadFeePolicy;
void spreadTerminal;
void spreadProvisionOwner;
void literalResolution;
void missingAuthority;
void retiredSession;
void mixedAuthority;
void eventSession;
void automationSession;
void customerTestPrice;
void incompleteFee;
void mismatchedTerminal;
