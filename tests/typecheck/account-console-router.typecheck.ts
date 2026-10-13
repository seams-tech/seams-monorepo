import {
  createAccountConsoleRouter,
  type AccountConsoleRouterServices,
} from '../../packages/console-server-ts/src/router/cloudflare/createAccountConsoleRouter';
import type { ConsoleAuthAdapter } from '../../packages/console-server-ts/src/router/consoleAuth';
import type { SessionAdapter } from '../../packages/console-server-ts/src/boundary/session';

declare const services: AccountConsoleRouterServices;
declare const auth: ConsoleAuthAdapter;
declare const session: SessionAdapter;

function readyCheck(): void {}

createAccountConsoleRouter({
  services,
  auth,
  session,
  readyCheck,
  walletProvisioning: null,
  satyrProvisioning: null,
  billingStripeWebhookSigningSecret: null,
});

// @ts-expect-error Account composition requires its authentication authority.
createAccountConsoleRouter({
  services,
  session,
  readyCheck,
  walletProvisioning: null,
  satyrProvisioning: null,
  billingStripeWebhookSigningSecret: null,
});

// @ts-expect-error Account composition requires a session issuer for context rotation.
createAccountConsoleRouter({
  services,
  auth,
  readyCheck,
  walletProvisioning: null,
  satyrProvisioning: null,
  billingStripeWebhookSigningSecret: null,
});

createAccountConsoleRouter({
  services,
  auth,
  session,
  readyCheck,
  walletProvisioning: null,
  satyrProvisioning: null,
  billingStripeWebhookSigningSecret: null,
  // @ts-expect-error Wallet selection belongs to Wallet request context.
  environmentId: 'wallet-only-environment',
});

const invalidServices: AccountConsoleRouterServices = {
  ...services,
  // @ts-expect-error Account composition has no Wallet environment dependency.
  walletEnvironments: null,
};
void invalidServices;
