import { accountTeamMessages } from './messages/accountTeam';
import { apiKeysWebhooksMessages } from './messages/apiKeysWebhooks';
import { auditObservabilityMessages } from './messages/auditObservability';
import { billingMessages } from './messages/billing';
import { commonMessages } from './messages/common';
import { derivationRootMessages } from './messages/derivationRoot';
import { gasSponsorshipMessages } from './messages/gasSponsorship';
import { platformBillingMessages } from './messages/platformBilling';
import { policyEngineMessages } from './messages/policyEngine';
import { shellMessages } from './messages/shell';
import { walletProductMessages } from './messages/walletProduct';

/* One file per product area. Each file prefixes its keys with its area name, so the
   spreads below can never overwrite one another. */
export const messages = {
  ...shellMessages,
  ...commonMessages,
  ...accountTeamMessages,
  ...apiKeysWebhooksMessages,
  ...auditObservabilityMessages,
  ...billingMessages,
  ...derivationRootMessages,
  ...gasSponsorshipMessages,
  ...platformBillingMessages,
  ...policyEngineMessages,
  ...walletProductMessages,
};

export type MessageKey = keyof typeof messages;
