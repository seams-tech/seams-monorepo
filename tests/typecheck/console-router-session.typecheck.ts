import {
  composeConsoleOnlyRouterOptions,
  type ConsoleOnlyRouterComposition,
} from '../../packages/wallet-console-server-ts/src/router/consoleComposition';
import {
  ConsoleSessionService,
  type ConsoleSessionServiceConfig,
  type RevocableConsoleSessionAdapter,
  type SessionAdapter,
} from '../../packages/console-server-ts/src/boundary';

declare const services: Omit<ConsoleOnlyRouterComposition, 'session'>;
declare const session: SessionAdapter;

composeConsoleOnlyRouterOptions({ ...services, session });

// @ts-expect-error A service spread cannot omit session signing for organization switching.
composeConsoleOnlyRouterOptions({ ...services });

// @ts-expect-error A literal cannot replace the required session adapter with undefined.
composeConsoleOnlyRouterOptions({ ...services, session: undefined });

declare const untrusted: unknown;
// @ts-expect-error Untrusted input must pass through a composition builder.
const uncheckedComposition: ConsoleOnlyRouterComposition = untrusted;
void uncheckedComposition;

declare const sessionHooks: Omit<ConsoleSessionServiceConfig, 'revocations'>;
// @ts-expect-error Console sessions require a revocation store at construction.
new ConsoleSessionService(sessionHooks);

// @ts-expect-error A plain session adapter cannot serve hosted sign-out.
const nonRevocableSession: RevocableConsoleSessionAdapter = session;
void nonRevocableSession;
