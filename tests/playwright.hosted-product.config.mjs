import fs from 'node:fs';
import path from 'node:path';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = path.resolve(candidate, '../..');
const projectionFile = process.env.SEAMS_HOSTED_PROJECTION;
if (!projectionFile) throw new Error('SEAMS_HOSTED_PROJECTION is required');
const projection = JSON.parse(fs.readFileSync(projectionFile, 'utf8'));
process.env.SEAMS_REPO_ROOT = publicRoot;
process.env.SEAMS_INTENDED_APP_URL = projection.applicationOrigin;
process.env.SEAMS_INTENDED_WALLET_ORIGIN = projection.hostedWalletOrigin;
process.env.SEAMS_INTENDED_ROUTER_URL = projection.gatewayOrigin;
process.env.SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID = projection.environmentId;
process.env.SEAMS_INTENDED_PUBLISHABLE_KEY = projection.publishableKey;
process.env.SEAMS_INTENDED_PASSKEY_ECDSA_TARGET_PROFILE = 'tempo';

export default {
  tsconfig: path.join(publicRoot, 'tests/tsconfig.wallet-intended.json'),
  testDir: './e2e/hosted-product',
  testMatch: '**/*.test.ts',
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: 'line',
  use: { browserName: 'chromium', trace: 'off' },
};
