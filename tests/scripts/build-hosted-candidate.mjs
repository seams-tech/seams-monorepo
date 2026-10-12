import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readBackendLane } from '../../scripts/deployment-targets.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
const projectionFile = process.env.SEAMS_HOSTED_PROJECTION;
const site = process.env.SEAMS_HOSTED_CANDIDATE_SITE;
if (!candidate || !projectionFile || !site) {
  throw new Error(
    'SEAMS_WALLET_SERVER_CANDIDATE, SEAMS_HOSTED_PROJECTION and SEAMS_HOSTED_CANDIDATE_SITE are required',
  );
}
const publicRoot = path.resolve(candidate, '../..');
const projection = JSON.parse(fs.readFileSync(projectionFile, 'utf8'));
const lane = readBackendLane('staging-testnet');
if (projection.gatewayOrigin !== lane.gatewayOrigin) {
  throw new Error('Hosted acceptance requires the staging tenant projection');
}
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'vite',
    'build',
    '--config',
    'tests/intended-app/vite.config.ts',
    '--outDir',
    path.resolve(site),
  ],
  {
    cwd: publicRoot,
    env: {
      ...process.env,
      VITE_WALLET_ORIGIN: projection.hostedWalletOrigin,
      VITE_RELAYER_URL: projection.gatewayOrigin,
      VITE_SEAMS_PROJECT_ENVIRONMENT_ID: projection.environmentId,
      VITE_SEAMS_PUBLISHABLE_KEY: projection.publishableKey,
      VITE_ROUTER_AB_NORMAL_SIGNING_WORKER_ID: lane.resources.signingWorker.workerName,
      VITE_SEAMS_WALLET_DIST_ROOT: path.join(publicRoot, 'packages/wallet/dist'),
      VITE_SEAMS_WALLET_ASSET_HOST: '1',
      VITE_SIGNING_SESSION_PERSISTENCE_MODE: 'sealed_refresh_v1',
    },
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
