import {
  WalletHome,
  WalletOwnershipKey,
  type WalletHomeAssignment,
  type WalletHomeReservation,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/home';

declare const home: WalletHome;
declare const wallet: WalletOwnershipKey;
declare const assignment: WalletHomeAssignment;

// @ts-expect-error Resource identity must cross its parser.
const rawHome: WalletHome = { region: 'US', accountId: 'account', databaseId: 'database' };
// @ts-expect-error A spread cannot carry nominal validation into a different resource.
const changedHome: WalletHome = { ...home, region: 'APAC' };
// @ts-expect-error Wallet ownership identity cannot be changed through a broad spread.
const changedWallet: WalletOwnershipKey = { ...wallet, walletId: 'another-wallet' };
// @ts-expect-error Construction cannot bypass parsing.
const uncheckedWallet = new WalletOwnershipKey('ns', 'org', 'project', 'env', 'wallet');
// @ts-expect-error A pending reservation cannot have a completion timestamp.
const pendingWithCompletion: WalletHomeAssignment = {
  state: 'reserved',
  wallet,
  home,
  registrationId: 'registration',
  reservedAtMs: 1,
  completedAtMs: 2,
};
// @ts-expect-error An established wallet requires its completion timestamp.
const incompleteEstablished: WalletHomeAssignment = {
  state: 'established',
  wallet,
  home,
  registrationId: 'registration',
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
void uncheckedWallet;
void pendingWithCompletion;
void incompleteEstablished;
void mixedOutcome;
