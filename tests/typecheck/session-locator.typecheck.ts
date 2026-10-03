import { SessionLocator } from '../../packages/wallet-console-server-ts/src/walletPlacement/sessionLocators';

declare const credential: SessionLocator<'credential'>;
// @ts-expect-error Raw objects have not crossed the locator boundary.
const raw: SessionLocator = { kind: 'credential', digest: 'x'.repeat(43) };
// @ts-expect-error A spread loses the validated locator identity.
const spread: SessionLocator = { ...credential };
// @ts-expect-error An operation credential cannot be used as an exchange locator.
const exchange: SessionLocator<'exchange'> = credential;
void [raw, spread, exchange];
