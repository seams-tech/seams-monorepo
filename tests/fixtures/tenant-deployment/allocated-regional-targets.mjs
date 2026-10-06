import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const targetsPath = fileURLToPath(
  new URL('../../../deployment/wallet-system/targets.json', import.meta.url),
);
const nativeReadFileSync = fs.readFileSync;
const targets = JSON.parse(nativeReadFileSync(targetsPath, 'utf8'));
const regions =
  targets.production.lanes.testnet.provisioning.gatewayDeploymentConfig.resources.regions;
const databases = {
  US: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  WEUR: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  APAC: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  OC: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};
for (const [region, resource] of Object.entries(regions)) {
  resource.signerD1 = { kind: 'allocated', name: resource.signerD1.name, id: databases[region] };
}

const counter =
  targets.production.lanes.testnet.provisioning.gatewayDeploymentConfig.resources
    .emailOtpRateLimitD1;
if (process.env.SEAMS_TEST_PENDING_OTP_COUNTER !== '1') {
  counter.kind = 'allocated';
  switch (process.env.SEAMS_TEST_COUNTER_DATABASE_REUSE) {
    case 'console':
      counter.id =
        targets.production.lanes.testnet.provisioning.gatewayDeploymentConfig.resources.consoleD1.id;
      break;
    case 'signer':
      counter.id = databases.US;
      break;
    case 'other-lane':
      counter.id =
        targets.production.lanes.mainnet.provisioning.gatewayDeploymentConfig.resources.consoleD1.id;
      break;
    default:
      counter.id = '99999999-9999-4999-8999-999999999999';
  }
}

function fixtureReadFileSync(filename, options) {
  if (String(filename) !== targetsPath) return nativeReadFileSync(filename, options);
  const serialized = JSON.stringify(targets);
  return options === 'utf8' ? serialized : Buffer.from(serialized);
}

// Only child-process fixtures substitute allocations; the canonical file remains pending.
fs.readFileSync = fixtureReadFileSync;
syncBuiltinESMExports();
