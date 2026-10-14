import type {
  AuthenticatedAccountServiceProducerV1,
  VerifiedAccountUserAssertionV1,
} from '../../packages/console-server-ts/src/accountPlatform/serviceIngressAuth';
import type { DelegatedPlatformAssertionV1 } from '../../packages/console-shared-ts/src/accountPlatform';

declare const producer: AuthenticatedAccountServiceProducerV1;
declare const assertion: VerifiedAccountUserAssertionV1;
declare const candidate: DelegatedPlatformAssertionV1;

// @ts-expect-error Producer authority requires a private service binding.
const spreadProducer: AuthenticatedAccountServiceProducerV1 = { ...producer };

// @ts-expect-error Public fields cannot construct verified producer authority.
const literalProducer: AuthenticatedAccountServiceProducerV1 = {
  authority: producer.authority,
  googleClientId: producer.googleClientId,
  verifyUserAssertion: producer.verifyUserAssertion,
};

void spreadProducer;
void literalProducer;

// @ts-expect-error A parsed candidate is not verified user authority.
const unverifiedAssertion: VerifiedAccountUserAssertionV1 = candidate;

// @ts-expect-error A broad spread cannot retain the verified signature proof.
const spreadAssertion: VerifiedAccountUserAssertionV1 = { ...assertion };

// @ts-expect-error Public assertion fields cannot construct signature proof.
const literalAssertion: VerifiedAccountUserAssertionV1 = {
  version: 1,
  issuer: candidate.issuer,
  audience: candidate.audience,
  principal: candidate.principal,
  nativePrincipalId: candidate.nativePrincipalId,
  scope: candidate.scope,
  instanceId: candidate.instanceId,
  action: candidate.action,
  expiresAt: candidate.expiresAt,
  authorityRevision: candidate.authorityRevision,
  toJSON: candidate.toJSON,
};

void unverifiedAssertion;
void spreadAssertion;
void literalAssertion;
