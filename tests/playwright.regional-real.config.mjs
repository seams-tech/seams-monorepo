import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const walletRoot = path.resolve(candidate, '../..');
const environment = dotenv.parse(readFileSync(path.join(walletRoot, '.env.local')));
for (const [name, value] of Object.entries(environment)) process.env[name] ??= value;
process.env.SEAMS_INTENDED_APP_URL = 'http://localhost:4201';
process.env.SEAMS_INTENDED_WALLET_ORIGIN = 'http://localhost:4202';
process.env.SEAMS_INTENDED_ROUTER_URL = 'http://127.0.0.1:4100';
if (!process.env.SEAMS_INTENDED_ROUTER_AB_ROOT) {
  throw new Error('Use tests/scripts/run-regional-real.mjs to allocate and clean isolated state');
}
process.env.SEAMS_INTENDED_WALLET_HOST = 'workers';
delete process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY;
process.env.SEAMS_INTENDED_TEST_APP_VITE_CACHE_DIR = path.join(
  process.env.SEAMS_INTENDED_ROUTER_AB_ROOT,
  'vite',
);

export default {
  tsconfig: path.join(walletRoot, 'tests/tsconfig.wallet-intended.json'),
  testDir: path.join(root, 'tests/e2e/regional-real'),
  testMatch: '**/*.contract.test.ts',
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: 'line',
  use: { browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: 'node tests/scripts/start-wallet-intended-services.mjs',
    cwd: walletRoot,
    url: 'http://localhost:4201/__intended-e2e',
    reuseExistingServer: false,
    timeout: 1_800_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
  },
};
