import type { ConsoleStepUpRegistrationAuthorizationV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpCeremony';
import type {
  VerifiedConsoleStepUpPasskeyEnrollmentProofV1,
  VerifiedConsoleStepUpProviderEnrollmentProofV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpEnrollmentProof';

declare const verifiedSignIn: VerifiedConsoleStepUpProviderEnrollmentProofV1;
declare const existingPasskey: VerifiedConsoleStepUpPasskeyEnrollmentProofV1;

const firstEnrollment: ConsoleStepUpRegistrationAuthorizationV1 = {
  kind: 'fresh_sign_in',
  providerProof: verifiedSignIn,
};

const laterEnrollment: ConsoleStepUpRegistrationAuthorizationV1 = {
  kind: 'existing_passkey',
  passkeyProof: existingPasskey,
};

const forgedSignIn: ConsoleStepUpRegistrationAuthorizationV1 = {
  kind: 'fresh_sign_in',
  // @ts-expect-error Raw account data cannot become verified sign-in evidence.
  providerProof: { userId: 'owner' },
};

const spreadSignIn: ConsoleStepUpRegistrationAuthorizationV1 = {
  kind: 'fresh_sign_in',
  // @ts-expect-error A broad spread cannot supply the proof's private brand.
  providerProof: { ...{ userId: 'owner' } },
};

// @ts-expect-error An existing passkey branch cannot carry first-enrollment proof.
const mixedEnrollment: ConsoleStepUpRegistrationAuthorizationV1 = {
  kind: 'existing_passkey',
  passkeyProof: existingPasskey,
  providerProof: verifiedSignIn,
};

void firstEnrollment;
void laterEnrollment;
void forgedSignIn;
void spreadSignIn;
void mixedEnrollment;
