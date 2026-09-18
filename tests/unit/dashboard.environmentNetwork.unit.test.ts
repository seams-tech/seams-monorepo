import { expect, test } from '@playwright/test';
import { networkForConsoleEnvironmentId } from '../../apps/wallet-console/src/core/dashboard/environmentNetwork';

test('console environments determine their chain network', () => {
  expect(networkForConsoleEnvironmentId('project:dev')).toBe('testnet');
  expect(networkForConsoleEnvironmentId('project:staging')).toBe('testnet');
  expect(networkForConsoleEnvironmentId('project:prod')).toBe('mainnet');
});

test('unknown environment kinds do not select a network', () => {
  expect(networkForConsoleEnvironmentId('project:preview')).toBeNull();
});
