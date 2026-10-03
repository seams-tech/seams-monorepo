import type { RegistrationOfferCommand } from '../../packages/wallet-console-server-ts/src/walletPlacement/registrationOfferService';

declare const create: Extract<RegistrationOfferCommand, { operation: 'create' }>;
// @ts-expect-error Creating an offer requires its complete candidate and scope input.
const incomplete: RegistrationOfferCommand = { operation: 'create', input: 'attempt-id' };
// @ts-expect-error A read cannot retain a create payload through a spread.
const mixed: RegistrationOfferCommand = { ...create, operation: 'read' };
// @ts-expect-error Mutation requires its validated record.
const missing: RegistrationOfferCommand = { operation: 'put' };
void [incomplete, mixed, missing];
const unboundClaim: RegistrationOfferCommand = {
  operation: 'claimCandidate',
  // @ts-expect-error Candidate selection requires the verified intent digest.
  input: { attemptId: 'attempt', candidateId: 'candidate', walletId: 'wallet' },
};
void unboundClaim;
