import { RecoveryLocator } from '../../packages/wallet-console-server-ts/src/walletPlacement/recoveryLocators';

declare const locator: RecoveryLocator;
// @ts-expect-error Locator objects must cross their boundary parser.
const raw: RecoveryLocator = { kind: 'operation', value: 'operation' };
// @ts-expect-error Spreading loses the validated identity.
const spread: RecoveryLocator = { ...locator };
void [raw, spread];
