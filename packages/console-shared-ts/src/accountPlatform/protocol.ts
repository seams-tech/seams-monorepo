import type { PlatformResult } from './boundary';
import type { AcceptedServiceReceiptV1, DurableSourceEvidenceV1 } from './instances';
import type { PlatformScopeV1, PlatformServiceIdV1 } from './scope';
import type { PlatformMeterIdV1 } from './usage';

export type PlatformIdentityLinkV1 = {
  readonly userId: string;
} & (
  | {
      readonly kind: 'verified_provider_subject';
      readonly issuer: string;
      readonly subject: string;
      readonly verificationReceiptId: string;
      readonly accountLinkReceiptId?: never;
    }
  | {
      readonly kind: 'authenticated_account_link';
      readonly accountLinkReceiptId: string;
      readonly issuer?: never;
      readonly subject?: never;
      readonly verificationReceiptId?: never;
    }
);

export type PlatformUserAuthorityV1 =
  | {
      readonly kind: 'authenticated_session';
      readonly nativeSessionId: string;
      readonly acceptedExecutionId?: never;
      readonly disclosureEvidenceId?: never;
      readonly provider?: never;
      readonly nativeEventId?: never;
      readonly nativeIntegrationAccountId?: never;
      readonly nativeWorkspaceId?: never;
      readonly nativeExternalUserId?: never;
    }
  | {
      readonly kind: 'accepted_execution';
      readonly acceptedExecutionId: string;
      readonly nativeSessionId?: never;
      readonly disclosureEvidenceId?: never;
      readonly provider?: never;
      readonly nativeEventId?: never;
      readonly nativeIntegrationAccountId?: never;
      readonly nativeWorkspaceId?: never;
      readonly nativeExternalUserId?: never;
    }
  | {
      readonly kind: 'disclosure_recipient';
      readonly disclosureEvidenceId: string;
      readonly nativeSessionId?: never;
      readonly acceptedExecutionId?: never;
      readonly provider?: never;
      readonly nativeEventId?: never;
      readonly nativeIntegrationAccountId?: never;
      readonly nativeWorkspaceId?: never;
      readonly nativeExternalUserId?: never;
    }
  | {
      readonly kind: 'authenticated_provider_event';
      readonly provider: 'slack';
      readonly nativeEventId: string;
      readonly nativeIntegrationAccountId: string;
      readonly nativeWorkspaceId: string;
      readonly nativeExternalUserId: string;
      readonly nativeSessionId?: never;
      readonly acceptedExecutionId?: never;
      readonly disclosureEvidenceId?: never;
    };

export type PlatformPrincipalV1 =
  | {
      readonly kind: 'user';
      readonly identity: PlatformIdentityLinkV1;
      readonly authority: PlatformUserAuthorityV1;
      readonly sessionId?: never;
      readonly automationId?: never;
      readonly grantId?: never;
    }
  | {
      readonly kind: 'automation';
      readonly automationId: string;
      readonly grantId: string;
      readonly identity?: never;
      readonly sessionId?: never;
      readonly authority?: never;
    };

export type ServiceAdmissionActionV1 = 'execute' | 'disclose' | 'restore' | 'replay';

/** Check for each protected request. This result never replaces a service content grant. */
export type ServiceEligibilityResultV1 = PlatformResult<
  {
    readonly authorityRevision: number;
    readonly accessRevision: number;
    readonly scope: PlatformScopeV1;
    readonly instanceId: string;
    readonly principal: PlatformPrincipalV1;
    readonly action: ServiceAdmissionActionV1;
  },
  | {
      readonly code: 'scope_forbidden' | 'membership_ineligible' | 'instance_ineligible';
      readonly retryable: false;
    }
  | { readonly code: 'authority_unavailable'; readonly retryable: true }
>;

export type ServiceProvisionResultV1 = PlatformResult<
  { readonly operationId: string; readonly instanceId: string; readonly desiredRevision: number },
  {
    readonly code:
      | 'scope_forbidden'
      | 'operation_conflict'
      | 'instance_archived'
      | 'operation_unsupported';
  }
>;

export type ServiceProvisionObservationV1 = PlatformResult<
  | { readonly kind: 'applied'; readonly receipt: AcceptedServiceReceiptV1 }
  | { readonly kind: 'stale'; readonly receipt: AcceptedServiceReceiptV1 },
  { readonly code: 'operation_conflict' | 'scope_forbidden' }
>;

interface ReservationIdentityV1 {
  readonly reservationId: string;
  readonly scope: PlatformScopeV1;
  readonly instanceId: string;
  readonly executionId: string;
  readonly requestedMinor: number;
  readonly priceVersion: string;
  readonly createdAt: string;
}

export type FundsReservationV1 = ReservationIdentityV1 &
  (
    | {
        readonly kind: 'reserved';
        readonly chargeId?: never;
        readonly settledMinor?: never;
        readonly reconciliation?: never;
        readonly noChargeEvidence?: never;
      }
    | {
        readonly kind: 'indeterminate';
        readonly reconciliation: { readonly kind: 'pending'; readonly evidence?: never };
        readonly chargeId?: never;
        readonly settledMinor?: never;
        readonly noChargeEvidence?: never;
      }
    | {
        readonly kind: 'settled';
        readonly chargeId: string;
        readonly settledMinor: number;
        readonly reconciliation?: never;
        readonly noChargeEvidence?: never;
      }
    | {
        readonly kind: 'released';
        readonly noChargeEvidence: DurableSourceEvidenceV1;
        readonly chargeId?: never;
        readonly settledMinor?: never;
        readonly reconciliation?: never;
      }
  );

export type SettleableFundsReservationV1 = Extract<
  FundsReservationV1,
  { readonly kind: 'reserved' }
>;

export type ReservationResultV1 = PlatformResult<
  FundsReservationV1,
  {
    readonly code:
      | 'scope_forbidden'
      | 'insufficient_funds'
      | 'price_unavailable'
      | 'operation_conflict'
      | 'execution_unreconciled';
  }
>;

export type PlatformPriceV1 =
  | {
      readonly kind: 'fixed_measured';
      readonly meterId: 'wallet.monthly_active_resource';
      readonly version: 'wallet-monthly-active-resource-v1';
      readonly currency: 'USD';
      readonly unitMinor: 300;
      readonly timeRule: 'occurred_at_utc_month';
      readonly availability: 'customer_accounts';
    }
  | {
      readonly kind: 'fixed_measured';
      readonly meterId: 'satyr.completed_turn.test';
      readonly version: 'satyr-completed-turn-test-v1';
      readonly currency: 'USD';
      readonly unitMinor: 1;
      readonly timeRule: 'terminal_accepted_at';
      readonly availability: 'isolated_test_accounts';
    }
  | {
      readonly kind: 'quoted_execution';
      readonly meterId: 'wallet.execution';
      readonly version: string;
      readonly currency: 'USD';
      readonly timeRule: 'accepted_quote_at';
      readonly availability: 'customer_accounts';
      readonly unitMinor?: never;
    };

export interface PlatformServiceCatalogueEntryV1 {
  readonly serviceId: PlatformServiceIdV1;
  readonly displayName: string;
  readonly contractVersion: 1;
  readonly meters: readonly PlatformMeterIdV1[];
  readonly integrationEndpoints: {
    readonly provision: '/account-platform/v1/provision';
    readonly status: '/account-platform/v1/status';
  };
}

export const PLATFORM_SERVICE_CATALOGUE_V1: readonly PlatformServiceCatalogueEntryV1[] =
  Object.freeze([
    Object.freeze({
      serviceId: 'wallet',
      displayName: 'Seams Wallet',
      contractVersion: 1,
      meters: Object.freeze(['wallet.monthly_active_resource', 'wallet.execution'] as const),
      integrationEndpoints: Object.freeze({
        provision: '/account-platform/v1/provision',
        status: '/account-platform/v1/status',
      }),
    }),
    Object.freeze({
      serviceId: 'satyr',
      displayName: 'Satyr',
      contractVersion: 1,
      meters: Object.freeze(['satyr.completed_turn.test'] as const),
      integrationEndpoints: Object.freeze({
        provision: '/account-platform/v1/provision',
        status: '/account-platform/v1/status',
      }),
    }),
  ]);
