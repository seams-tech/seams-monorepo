import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [packageArgument, directoryArgument, gatewayUrl, appOrigin, walletOrigin] =
  process.argv.slice(2);
if (process.argv.length !== 7) {
  throw new Error(
    'Usage: node prepare-wallet.mjs <wallet-package> <directory> <gateway-url> <app-origin> <wallet-origin>',
  );
}
const packageRoot = path.resolve(packageArgument);
const directory = path.resolve(directoryArgument);
const scripts = path.join(packageRoot, 'cloudflare-router-ab/scripts');
const require = createRequire(path.join(packageRoot, 'package.json'));
const { parse } = require('dotenv');
const { prepareRouterAbStrictLocalRuntimeConfigs } = await import(
  pathToFileURL(path.join(scripts, 'prepare-local-runtime-config.mjs')).href
);
mkdirSync(directory, { recursive: true, mode: 0o700 });
execFileSync(
  process.execPath,
  [path.join(scripts, 'initialize-local-wallet.mjs'), '--root', directory],
  { cwd: directory },
);
const ceremony = generateKeyPairSync('ed25519');
const ceremonyRoot = path.join(directory, '.runtime/wallet-gateway');
mkdirSync(ceremonyRoot, { recursive: true, mode: 0o700 });
writeFileSync(
  path.join(ceremonyRoot, 'ceremony-private.jwk.json'),
  JSON.stringify(ceremony.privateKey.export({ format: 'jwk' })),
  { mode: 0o600 },
);
const publicJwk = ceremony.publicKey.export({ format: 'jwk' });
const ceremonyJwksJson = JSON.stringify({
  keys: [{ ...publicJwk, kid: 'local-router-ab-r1', alg: 'EdDSA', use: 'sig' }],
});
const issuerPath = path.join(directory, 'issuer.env');
writeFileSync(
  issuerPath,
  `TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY_ID=celld-local-issuer\nTENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY=${randomBytes(32).toString('hex')}\n`,
  { mode: 0o600 },
);
process.env.SEAMS_INTENDED_ROUTER_URL = gatewayUrl;
const runtime = prepareRouterAbStrictLocalRuntimeConfigs({
  repoRoot: directory,
  localEnvRoot: directory,
  outputRoot: path.join(directory, 'prepared'),
  tenantRootIssuerEnvPath: issuerPath,
  ceremonyJwksJson,
});
const configs = [];
for (const config of runtime.configs) {
  configs.push({
    role: config.role,
    configPath: config.configPath,
    secrets: parse(readFileSync(config.secretPath)),
  });
}
const result = { configs, issuerPath, gatewayUrl, appOrigin, walletOrigin };
writeFileSync(path.join(directory, 'prepared.json'), JSON.stringify(result), { mode: 0o600 });
