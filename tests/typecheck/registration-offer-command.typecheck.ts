import type { RegistrationOfferCommand } from '../../packages/wallet-console-server-ts/src/walletPlacement/registrationOfferService';

declare const create: Extract<RegistrationOfferCommand, { operation: 'create' }>;
// @ts-expect-error Creating an offer requires its complete candidate and scope input.
const incomplete: RegistrationOfferCommand = { operation: 'create', input: 'attempt-id' };
// @ts-expect-error A read cannot retain a create payload through a spread.
const mixed: RegistrationOfferCommand = { ...create, operation: 'read' };
// @ts-expect-error Mutation requires its validated record.
const missing: RegistrationOfferCommand = { operation: 'put' };
void [incomplete, mixed, missing];
type ClaimInput = Extract<RegistrationOfferCommand, { operation: 'claimCandidate' }>['input'];
// @ts-expect-error Candidate selection requires the verified intent digest.
const unboundClaim: ClaimInput = {
  attemptId: 'attempt',
  candidateId: 'candidate',
  walletId: 'wallet',
};
type CompletionInput = Extract<RegistrationOfferCommand, { operation: 'complete' }>['input'];
// @ts-expect-error Completion must identify the claimed wallet as well as its offer.
const incompleteCompletion: CompletionInput = { attemptId: 'attempt' };
void [unboundClaim, incompleteCompletion];
