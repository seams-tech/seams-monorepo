import { ServiceOnboardingAssertionV1 } from '../../packages/console-shared-ts/src/accountPlatform/onboarding';
import type { VerifiedAccountUserAssertionV1 } from '../../packages/console-server-ts/src/accountPlatform/serviceIngressAuth';

declare const onboarding: ServiceOnboardingAssertionV1;

// @ts-expect-error An onboarding proof cannot authorize work on a service instance.
const serviceAuthority: VerifiedAccountUserAssertionV1 = onboarding;

// @ts-expect-error Only the boundary parser can construct an onboarding assertion.
const directlyConstructed = new ServiceOnboardingAssertionV1();

// @ts-expect-error Onboarding requires its distinct purpose and complete identity.
const incomplete: ServiceOnboardingAssertionV1 = { version: 1, subject: 'subject' };

// @ts-expect-error A broad spread loses the boundary parser's nominal instance.
const spread: ServiceOnboardingAssertionV1 = { ...onboarding };

void serviceAuthority;
void directlyConstructed;
void incomplete;
void spread;
