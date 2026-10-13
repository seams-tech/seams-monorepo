import type {
  SponsoredPrepaidReservationHandle,
  SponsoredPrepaidReservationSettlement,
  SponsoredPrepaidSettlementQuote,
} from '../../packages/wallet-console-server-ts/src/sponsorship/prepaidBalance';
import { SponsoredEvmExecutionError } from '../../packages/wallet-console-server-ts/src/sponsorship/executionFailure';
import type { SponsorshipReplayOrMatchResolution } from '../../packages/wallet-console-server-ts/src/router/sponsorshipRuntime';
import type { RouteResponse } from '@seams/wallet-server/cloud-host';

declare const handle: SponsoredPrepaidReservationHandle;
declare const replayResponse: RouteResponse<Record<string, unknown>>;

// @ts-expect-error A spread cannot retain the authoritative reservation handle.
const copiedHandle: SponsoredPrepaidReservationHandle = { ...handle };

// @ts-expect-error Reservation handles come from the shared funds authority.
const constructedHandle: SponsoredPrepaidReservationHandle = {
  reservationId: 'reservation',
  instanceId: 'instance',
  authority: { serviceId: 'wallet', deploymentId: 'deployment' },
  sourceEventId: 'execution',
  estimatedSpendMinor: 1,
  estimatedPricingVersion: 'price',
  quotedAt: '2026-10-13T03:00:00.000Z',
};

// @ts-expect-error Released executions cannot retain a charge amount.
const chargedRelease: SponsoredPrepaidReservationSettlement = {
  kind: 'released',
  reservationId: 'reservation',
  pricingVersion: 'price',
  usedEstimatedFallback: false,
  settledAt: '2026-10-13T03:00:00.000Z',
  settledSpendMinor: 5,
  released: true,
};

// @ts-expect-error An uncertain outcome cannot claim a settled price or amount.
const uncertainCharge: SponsoredPrepaidSettlementQuote = {
  kind: 'indeterminate',
  settledSpendMinor: 5,
  pricingVersion: 'price',
  usedEstimatedFallback: false,
  released: false,
};

const rejectedWithTransaction = new SponsoredEvmExecutionError(
  // @ts-expect-error A pre-broadcast rejection cannot claim a broadcast transaction hash.
  { kind: 'rejected', txHash: '0x1' } as const,
  new Error('Rejected before broadcasting'),
);

// @ts-expect-error A conflicting native environment cannot also expose a replay receipt.
const conflictingReplay: SponsorshipReplayOrMatchResolution<string, Record<string, unknown>> = {
  kind: 'conflict',
  reason: 'environment_mismatch',
  response: replayResponse,
};

void [
  copiedHandle,
  constructedHandle,
  chargedRelease,
  uncertainCharge,
  rejectedWithTransaction,
  conflictingReplay,
];
