import { WalletRouteLocator } from '../../packages/wallet-console-server-ts/src/walletPlacement/walletRouteLocators';

declare const locator: WalletRouteLocator;
// @ts-expect-error Locator objects must cross their boundary parser.
const raw: WalletRouteLocator = { kind: 'operation', value: 'operation' };
// @ts-expect-error Spreading loses the validated identity.
const spread: WalletRouteLocator = { ...locator };
void [raw, spread];
