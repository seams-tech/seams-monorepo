import type { IdentityCommand } from '../../packages/wallet-console-server-ts/src/walletPlacement/identityService';

declare const link: Extract<IdentityCommand, { operation: 'link' }>;
// @ts-expect-error Link must explicitly decide whether a sole identity can move.
const incomplete: IdentityCommand = { operation: 'link', userId: 'wallet', subject: 'subject' };
// @ts-expect-error A lookup cannot retain mutation fields through a spread.
const mixed: IdentityCommand = { ...link, operation: 'find' };
// @ts-expect-error Lookup requires its subject identity.
const missing: IdentityCommand = { operation: 'find' };
void [incomplete, mixed, missing];
