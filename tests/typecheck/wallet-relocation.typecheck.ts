import {
  WalletRelocation,
  WalletRelocationReceipt,
  WalletRelocationRequest,
  type WalletRelocationProgress,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import type { WalletRelocationAdmission } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationStore';
import type { WalletHomeAssignment } from '../../packages/wallet-console-server-ts/src/walletPlacement/home';

declare const request: WalletRelocationRequest;
declare const move: WalletRelocation;
declare const sourceFence: WalletRelocationReceipt<'source_fence'>;
declare const destinationVerification: WalletRelocationReceipt<'destination_verification'>;
declare const assignment: WalletHomeAssignment & { readonly state: 'established' };

// @ts-expect-error A spread loses the validated request identity.
const changedRequest: WalletRelocationRequest = { ...request, expectedGeneration: 2 };
// @ts-expect-error A caller cannot forge a persisted move through a broad spread.
const changedMove: WalletRelocation = { ...move, destinationGeneration: 4 };
// @ts-expect-error A raw receipt cannot carry validated participant bindings.
const rawFence: WalletRelocationReceipt<'source_fence'> = { ...sourceFence };
// @ts-expect-error Verification of a destination cannot substitute for a source fence.
const reversedReceipt: WalletRelocationReceipt<'source_fence'> = destinationVerification;
// @ts-expect-error Copying requires a durable source fence.
const unfencedCopy: WalletRelocationProgress = { state: 'copying' };
// @ts-expect-error A pending freeze cannot contain a destination verification.
const mixedProgress: WalletRelocationProgress = { state: 'freezing', destinationVerification };
// @ts-expect-error Cutover requires both receipts and its commit time.
const prematureCutover: WalletRelocationProgress = { state: 'cutover', sourceFence };
const mixedAdmission: WalletRelocationAdmission = {
  ok: true,
  disposition: 'unchanged',
  assignment,
  // @ts-expect-error An unchanged home cannot also contain a transfer.
  move,
};
// @ts-expect-error Ownership generations are required even for founding registration.
const missingGeneration: WalletHomeAssignment = {
  state: 'reserved',
  wallet: assignment.wallet,
  home: assignment.home,
  registrationId: assignment.registrationId,
  requestDigest: assignment.requestDigest,
  allocation: assignment.allocation,
  registrationAllocation: assignment.registrationAllocation,
  reservedAtMs: assignment.reservedAtMs,
};

void changedRequest;
void changedMove;
void rawFence;
void reversedReceipt;
void unfencedCopy;
void mixedProgress;
void prematureCutover;
void mixedAdmission;
void missingGeneration;
