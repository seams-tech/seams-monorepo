import type { WalletAuthorizationManifest } from '../../packages/wallet-console-server-ts/src/walletPlacement/authorizationManifest';
import { WalletRelocationPreparation } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationPreparation';
import type { WalletPlacementView } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationView';
import {
  WalletRelocation,
  WalletRelocationReceipt,
  WalletRelocationRequest,
  WalletRelocationLocator,
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
declare const preparation: WalletRelocationPreparation;
declare const participants: Parameters<typeof WalletRelocationPreparation.prepare>[1];
declare const clock: () => number;
// @ts-expect-error A complete participant set is required before admission.
void WalletRelocationPreparation.prepare(request, { gateway: participants.gateway }, clock);
// @ts-expect-error Only all-participant preparation can construct admission evidence.
const forgedPreparation: WalletRelocationPreparation = { ...preparation };
// @ts-expect-error Preparation construction is private.
new WalletRelocationPreparation('a'.repeat(64), 2, []);
// @ts-expect-error Resource checks alone cannot authorize admission.
void relocations.admit(request, [resourceProof], 'test', 1);
void forgedPreparation;
// @ts-expect-error Admission requires verified resources and a deployment lane.
void relocations.admit(request, 1);
// @ts-expect-error A spread cannot replace an authenticated resource proof.
void relocations.admit(request, [{ ...resourceProof }], 'test', participants, clock);

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
// @ts-expect-error Activation must bind the locally verified authorization manifest.
const missingActivationManifest: WalletD1RelocationCommand['operation'] = {
  kind: 'activate',
  receipt: destinationVerification,
  physicalResource: 'destination',
};
void missingActivationManifest;
// @ts-expect-error Cleanup must bind the source snapshot as well as destination activation.
const missingCleanupManifest: WalletD1RelocationCommand['operation'] = {
  kind: 'cleanup',
  receipt: activation,
};
void missingCleanupManifest;
// @ts-expect-error Source export requires the sealed source-fence receipt.
const unsealedExport: WalletD1RelocationCommand['operation'] = { kind: 'export' };
declare const authorizationManifest: WalletAuthorizationManifest;
// @ts-expect-error A spread cannot construct a validated source manifest.
const forgedAuthorizationManifest: WalletAuthorizationManifest = { ...authorizationManifest };
// @ts-expect-error Authorization import requires the pinned manifest.
const unpinnedImport: WalletD1RelocationCommand['operation'] = {
  kind: 'import_authorization',
  receipt: sourceFence,
  physicalResource: 'destination',
};
void forgedAuthorizationManifest;
void unpinnedImport;
void unsealedExport;
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

type MovingView = WalletPlacementView & { readonly state: 'moving' };
declare const movingView: MovingView;
// @ts-expect-error A paused phase cannot claim the destination is active.
const prematureActiveView: MovingView['move']['progress'] = {
  state: 'copying',
  availability: 'active',
  execution: { state: 'running' },
};
// @ts-expect-error Cleanup cannot claim the wallet is paused.
const pausedCleanupView: MovingView['move']['progress'] = {
  state: 'cleanup',
  availability: 'paused',
  execution: { state: 'ready' },
};
// @ts-expect-error A retry requires its original retry deadline.
const missingViewDeadline: MovingView['move']['progress']['execution'] = {
  state: 'retry_wait',
  code: 'transport_unavailable',
};
// @ts-expect-error Progress observations carry no participant authority.
const viewAsAuthority: WalletD1RelocationCommand = movingView;
void prematureActiveView;
void pausedCleanupView;
void missingViewDeadline;
void viewAsAuthority;

declare const pausedProgressView: MovingView['move']['progress'] & {
  readonly availability: 'paused';
};
// @ts-expect-error A broad spread cannot carry paused availability into cleanup.
const mixedProgressView: MovingView['move']['progress'] = {
  ...pausedProgressView,
  state: 'cleanup',
};
void mixedProgressView;

declare const locator: WalletRelocationLocator;
// @ts-expect-error A broad spread cannot forge a validated move locator.
const forgedLocator: WalletRelocationLocator = { ...locator };
// @ts-expect-error A move locator grants no command authority.
const locatorAsAuthority: WalletD1RelocationCommand = locator;
// @ts-expect-error A locator cannot admit a new relocation.
void relocations.admit(locator, [resourceProof], 'test', participants, clock);
void forgedLocator;
void locatorAsAuthority;

// @ts-expect-error Destination verification must name its prepared physical resource.
const unpinnedVerification: WalletD1RelocationCommand['operation'] = {
  kind: 'verify',
  receipt: sourceFence,
};
// @ts-expect-error Destination activation must name its prepared physical resource.
const unpinnedActivation: WalletD1RelocationCommand['operation'] = {
  kind: 'activate',
  receipt: destinationVerification,
};
// @ts-expect-error Source freeze cannot select a destination physical resource.
const destinationAsSource: WalletD1RelocationCommand['operation'] = {
  kind: 'freeze',
  physicalResource: 'destination',
};
void unpinnedVerification;
void unpinnedActivation;
void destinationAsSource;

import type { WalletAuthorizationTransfer } from '../../packages/wallet-console-server-ts/src/walletPlacement/authorizationTransfer';
type AuthorizationTransferResult = Awaited<ReturnType<WalletAuthorizationTransfer['advance']>>;
// @ts-expect-error A component verification cannot also request another chunk.
const invalidTransferResult: AuthorizationTransferResult = {
  state: 'verified',
  digestHex: 'a'.repeat(64),
  nextIndex: 1,
};
declare const transferResult: AuthorizationTransferResult;
// @ts-expect-error A spread cannot add failure state to a successful transfer.
const invalidTransferSpread: AuthorizationTransferResult = {
  ...transferResult,
  code: 'transport_unavailable',
};
void invalidTransferResult;
void invalidTransferSpread;

import type { WalletRelocationEffects } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationCoordinator';
type TransferEffect = Awaited<ReturnType<WalletRelocationEffects['transfer']>>;
declare const verifiedTransfer: Extract<TransferEffect, { state: 'verified' }>;
// @ts-expect-error A pending transfer cannot provide activation evidence.
const pendingWithReceipt: TransferEffect = { state: 'pending', receipt: verifiedTransfer.receipt };
// @ts-expect-error Verification requires the complete destination receipt.
const verifiedWithoutReceipt: TransferEffect = { state: 'verified' };
void pendingWithReceipt;
void verifiedWithoutReceipt;

import { WalletExecutionAuthority } from '../../packages/wallet-console-server-ts/src/walletPlacement/executionAuthority';
declare const executionAuthority: WalletExecutionAuthority;
// @ts-expect-error A copied observation cannot forge execution admission.
const forgedExecutionAuthority: WalletExecutionAuthority = { ...executionAuthority };
// @ts-expect-error Construction must use the Console admission boundary.
const directExecutionAuthority = new WalletExecutionAuthority();
void forgedExecutionAuthority;
void directExecutionAuthority;

declare const registrationExecution: WalletExecutionAuthority<'registration'>;
// @ts-expect-error Registration admission cannot authorize ordinary execution.
const registrationAsOrdinary: WalletExecutionAuthority = registrationExecution;
void registrationAsOrdinary;

type FreezeEffect = Awaited<ReturnType<WalletRelocationEffects['freeze']>>;
declare const frozenSource: Extract<FreezeEffect, { state: 'frozen' }>;
// @ts-expect-error A draining source cannot provide a sealed snapshot receipt.
const drainingWithReceipt: FreezeEffect = { state: 'pending', receipt: frozenSource.receipt };
// @ts-expect-error A frozen source requires its complete snapshot receipt.
const frozenWithoutReceipt: FreezeEffect = { state: 'frozen' };
// @ts-expect-error Spreading a frozen result cannot retain its receipt while pending.
const drainingFromFrozen: FreezeEffect = { ...frozenSource, state: 'pending' };
void drainingWithReceipt;
void frozenWithoutReceipt;
void drainingFromFrozen;
