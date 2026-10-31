import type { HostedConsoleAccountSession } from '../../packages/wallet-console-server-ts/src/router/hostedConsoleAuth';
import type { ConsoleFunnelActor } from '../../packages/console-server-ts/src/onboarding/funnel';

declare const identity: Extract<HostedConsoleAccountSession, { kind: 'console_identity_v1' }>;
declare const scoped: Extract<HostedConsoleAccountSession, { kind: 'console_session_v1' }>;

// @ts-expect-error An identity session cannot claim an organization session lifecycle.
const invalidIdentity: HostedConsoleAccountSession = {
  kind: 'console_session_v1',
  account: identity.account,
};
// @ts-expect-error A broad spread cannot hide the scoped account in an identity session.
const invalidSpread: HostedConsoleAccountSession = { ...scoped, kind: 'console_identity_v1' };
// @ts-expect-error Anonymous measurement cannot carry an account identity.
const invalidVisitor: ConsoleFunnelActor = { kind: 'visitor', userId: 'someone' };
// @ts-expect-error Signed-in measurement requires an explicit organization state.
const missingScope: ConsoleFunnelActor = { kind: 'account', userId: 'someone' };
// @ts-expect-error A direct cast cannot convert an identity session to a scoped session.
const unsafeScope = identity as Extract<
  HostedConsoleAccountSession,
  { kind: 'console_session_v1' }
>;

void [invalidIdentity, invalidSpread, invalidVisitor, missingScope, unsafeScope];
