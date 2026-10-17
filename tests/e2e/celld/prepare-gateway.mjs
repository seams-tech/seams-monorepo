import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [packageArgument, directoryArgument, gatewayUrl, appOrigin, walletOrigin] =
  process.argv.slice(2);
if (process.argv.length !== 7) {
  throw new Error(
    'Usage: node prepare-gateway.mjs <wallet-package> <directory> <gateway-url> <app-origin> <wallet-origin>',
  );
}
const packageRoot = path.resolve(packageArgument);
const directory = path.resolve(directoryArgument);
const require = createRequire(path.join(packageRoot, 'package.json'));
const { parse } = require('dotenv');
const { prepareLocalHostedWalletGatewayConfig } = await import(
  pathToFileURL(
    path.join(packageRoot, 'cloudflare-router-ab/scripts/prepare-local-runtime-config.mjs'),
  ).href
);
const tenantRoot = JSON.parse(readFileSync(path.join(directory, 'bootstrap-first.log'), 'utf8'));
const deployment = {
  credential: {
    apiKeyId: 'local-wallet-publishable-key',
    publishableKey: 'pk_local',
    secretKey: `sk_local_${randomBytes(24).toString('base64url')}`,
    allowedOrigins: [appOrigin, walletOrigin],
    scopes: [
      'accounts.create',
      'wallets.read',
      'wallets.auth_methods.create',
      'wallets.signers.create',
    ],
  },
  deployment: {
    orgId: 'org_local_wallet',
    projectId: 'local-smoke-project',
    environmentId: 'local-smoke-project:dev',
    environmentKey: 'dev',
    signingRootVersion: 'default',
  },
  tenantRoot: {
    identityDigestB64u: tenantRoot.identityDigestB64u,
    custodyLineageB64u: tenantRoot.custodyLineageB64u,
    signingRootId: 'local-smoke-project:dev',
  },
};
const runtime = prepareLocalHostedWalletGatewayConfig({
  repoRoot: directory,
  localEnvRoot: directory,
  outputRoot: path.join(directory, 'gateway-prepared'),
  gatewayUrl,
  ceremonyPrivateJwkPath: path.join(directory, '.runtime/wallet-gateway/ceremony-private.jwk.json'),
  appOrigins: [appOrigin, walletOrigin],
  googleOidcClientId: process.env.GOOGLE_OIDC_CLIENT_ID,
  deployment,
});
const result = {
  configPath: runtime.configPath,
  secrets: parse(readFileSync(runtime.secretPath)),
};
writeFileSync(path.join(directory, 'gateway-prepared.json'), JSON.stringify(result), {
  mode: 0o600,
});
