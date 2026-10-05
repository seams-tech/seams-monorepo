import {
  WalletRelocation,
  WalletRelocationReceipt,
  WalletRelocationRequest,
  type WalletRelocationProgress,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import type { WalletRelocationAdmission } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationStore';
import type { WalletHomeAssignment } from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import type { WalletPlacementStatus } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationStatus';
import type { WalletD1RelocationCommand } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationCommands';
import type { D1WalletRelocations } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationStore';
import type { TenantResourceVerificationV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import type {
  WalletRelocationAttempt,
  WalletRelocationExecution,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationExecution';

declare const request: WalletRelocationRequest;
declare const move: WalletRelocation;
declare const sourceFence: WalletRelocationReceipt<'source_fence'>;
declare const destinationVerification: WalletRelocationReceipt<'destination_verification'>;
declare const assignment: WalletHomeAssignment & { readonly state: 'established' };
declare const attempt: WalletRelocationAttempt;
declare const activation: WalletRelocationReceipt<'destination_activation'>;
declare const relocations: D1WalletRelocations;
declare const resourceProof: TenantResourceVerificationV1;
// @ts-expect-error Admission requires verified resources and a deployment lane.
void relocations.admit(request, 1);
// @ts-expect-error A spread cannot replace an authenticated resource proof.
void relocations.admit(request, [{ ...resourceProof }], 'test', 1);

declare const command: WalletD1RelocationCommand;
// @ts-expect-error A spread cannot forge command authorization from a journal read.
const forgedCommand: WalletD1RelocationCommand = { ...command };
// @ts-expect-error Cleanup requires destination activation evidence.
const prematureCleanupCommand: WalletD1RelocationCommand['operation'] = {
  kind: 'cleanup',
  receipt: sourceFence,
};
// @ts-expect-error Destination activation requires verification evidence.
const missingCommandEvidence: WalletD1RelocationCommand['operation'] = { kind: 'activate' };
void forgedCommand;
void prematureCleanupCommand;
void missingCommandEvidence;

// @ts-expect-error A moving wallet requires its journal, including activation and retry state.
const missingMoveStatus: WalletPlacementStatus = { state: 'moving' };
declare const settledStatus: WalletPlacementStatus & { readonly state: 'settled' };
// @ts-expect-error A broad spread cannot combine settled placement and pending relocation.
const mixedPlacementStatus: WalletPlacementStatus = { ...settledStatus, state: 'moving', move };
// @ts-expect-error An unavailable wallet cannot present an active home.
const unavailableHome: WalletPlacementStatus = {
  state: 'unavailable',
  code: 'not_found',
  home: assignment.home,
};
void missingMoveStatus;
void mixedPlacementStatus;
void unavailableHome;

type CutoverActivation = (WalletRelocationProgress & { readonly state: 'cutover' })['activation'];

// @ts-expect-error Activation requires its durable receipt.
const missingActivationReceipt: CutoverActivation = { state: 'activated' };
// @ts-expect-error Awaiting activation cannot carry an activation receipt.
const prematureActivationReceipt: CutoverActivation = {
  state: 'awaiting_activation',
  receipt: activation,
};
const wrongActivationReceipt: CutoverActivation = {
  state: 'activated',
  // @ts-expect-error Verification cannot authorize destination execution.
  receipt: destinationVerification,
};
declare const cutover: WalletRelocationProgress & { readonly state: 'cutover' };
// @ts-expect-error A broad spread cannot mix cutover activation with an earlier phase.
const mixedActivationPhase: WalletRelocationProgress = { ...cutover, state: 'verified' };
void missingActivationReceipt;
void prematureActivationReceipt;
void wrongActivationReceipt;
void mixedActivationPhase;

// @ts-expect-error A spread cannot forge a validated execution attempt.
const forgedAttempt: WalletRelocationAttempt = { ...attempt, number: 1 };
// @ts-expect-error A blocked attempt cannot carry an automatic retry deadline.
const blockedRetry: WalletRelocationExecution = {
  state: 'blocked',
  attempt,
  code: 'content_conflict',
  retryAtMs: 1,
};
// @ts-expect-error Only transient failures permit automatic retry.
const retryConflict: WalletRelocationExecution = {
  state: 'retry_wait',
  attempt,
  code: 'content_conflict',
  retryAtMs: 1,
};
// @ts-expect-error Cleanup evidence cannot be replaced by activation evidence.
const swappedCleanup: WalletRelocationReceipt<'source_cleanup'> = activation;
// @ts-expect-error Completion requires activation and cleanup evidence.
const missingCompletion: WalletRelocationProgress = {
  state: 'completed',
  sourceFence,
  destinationVerification,
  cutoverAtMs: 1,
  completedAtMs: 2,
};

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
void forgedAttempt;
void blockedRetry;
void retryConflict;
void swappedCleanup;
void missingCompletion;
