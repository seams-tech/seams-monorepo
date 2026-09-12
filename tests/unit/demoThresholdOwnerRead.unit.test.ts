import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('demo threshold owner display reads do not bootstrap ECDSA sessions', () => {
  const source = fs.readFileSync(
    path.resolve(
      process.cwd(),
      '../apps/seams-site/src/flows/demo/hooks/useDemoThresholdAccountState.ts',
    ),
    'utf8',
  );

  expect(source).toContain('ThresholdOwnerAddressReadResult');
  expect(source).toContain('thresholdEcdsaEthereumAddress');
  expect(source).not.toContain('bootstrapEcdsaSession');
  expect(source).not.toContain('reuse_warm_ecdsa_bootstrap');
  expect(source).not.toContain('bootstrapIfMissing');
});
