import {
  RegistrationSetupAllocation,
  WalletHome,
  WalletOwnershipKey,
  type WalletHomeAssignment,
  type WalletHomeReservation,
  type WalletHomeReservationInput,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/home';

declare const home: WalletHome;
declare const wallet: WalletOwnershipKey;
declare const assignment: WalletHomeAssignment;
declare const registrationAllocation: RegistrationSetupAllocation;

// @ts-expect-error Resource identity must cross its parser.
const rawHome: WalletHome = { region: 'US', accountId: 'account', databaseId: 'database' };
// @ts-expect-error A spread cannot carry nominal validation into a different resource.
const changedHome: WalletHome = { ...home, region: 'APAC' };
// @ts-expect-error Wallet ownership identity cannot be changed through a broad spread.
const changedWallet: WalletOwnershipKey = { ...wallet, walletId: 'another-wallet' };
// @ts-expect-error A raw allocation cannot bypass validation.
const rawAllocation: RegistrationSetupAllocation = { ...registrationAllocation };
// @ts-expect-error Construction cannot bypass parsing.
const uncheckedWallet = new WalletOwnershipKey('ns', 'org', 'project', 'env', 'wallet');
// @ts-expect-error A pending reservation cannot have a completion timestamp.
const pendingWithCompletion: WalletHomeAssignment = {
  state: 'reserved',
  wallet,
  home,
  registrationId: 'registration',
  requestDigest: 'a'.repeat(64),
  allocation: 'provided',
  registrationAllocation,
  reservedAtMs: 1,
  completedAtMs: 2,
};
// @ts-expect-error An established wallet requires its completion timestamp.
const incompleteEstablished: WalletHomeAssignment = {
  state: 'established',
  wallet,
  home,
  registrationId: 'registration',
  requestDigest: 'a'.repeat(64),
  allocation: 'provided',
  registrationAllocation,
  reservedAtMs: 1,
};
const mixedOutcome: WalletHomeReservation = {
  ok: false,
  code: 'wallet_conflict',
  // @ts-expect-error A conflict cannot carry a success disposition.
  disposition: 'reserved',
  assignment,
};

void rawHome;
void changedHome;
void changedWallet;
void rawAllocation;
void uncheckedWallet;
void pendingWithCompletion;
void incompleteEstablished;
void mixedOutcome;

declare const reservationInput: WalletHomeReservationInput;
// @ts-expect-error Allocation branches cannot contain both provided and candidate identities.
const ambiguousAllocation: WalletHomeReservationInput = {
  allocation: 'provided',
  wallet,
  candidate: wallet,
  proposedHome: home,
  proposedRegistrationAllocation: registrationAllocation,
  registrationId: 'registration',
  requestDigest: 'a'.repeat(64),
  nowMs: 1,
};
declare const missingDigest: Omit<WalletHomeReservationInput, 'requestDigest'>;
// @ts-expect-error An operation identity alone cannot bind a registration request.
const unboundRequest: WalletHomeReservationInput = missingDigest;
declare const missingAllocation: Omit<WalletHomeReservationInput, 'proposedRegistrationAllocation'>;
// @ts-expect-error Initial registration cannot proceed without a durable setup allocation.
const unallocatedRequest: WalletHomeReservationInput = missingAllocation;
void reservationInput;
void ambiguousAllocation;
void unboundRequest;
void unallocatedRequest;
