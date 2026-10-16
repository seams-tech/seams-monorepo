import type {
  ConfiguredRegionalWallet,
  RegionalWalletConfiguration,
} from '../../packages/wallet-console-server-ts/src/router/cloudflare/regionalWalletConfiguration';

declare const configured: ConfiguredRegionalWallet;

// Configuration cannot advertise regional service bindings without the catalog.
// @ts-expect-error All configured regional resources are required.
const missingCatalog: RegionalWalletConfiguration = {
  kind: 'configured',
  runtimes: configured.runtimes,
  gateways: configured.gateways,
};

// @ts-expect-error A broad spread cannot retain resources in the unconfigured branch.
const unconfiguredWithResources: RegionalWalletConfiguration = {
  ...configured,
  kind: 'unconfigured',
};

// @ts-expect-error Runtime and Gateway bindings must each include all four regions.
const incompleteBindings: ConfiguredRegionalWallet['runtimes'] = {
  APAC: configured.runtimes.APAC,
};

const unconfigured: RegionalWalletConfiguration = { kind: 'unconfigured' };

void missingCatalog;
void unconfiguredWithResources;
void incompleteBindings;
void unconfigured;
