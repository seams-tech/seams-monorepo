import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageRoot = path.join(repositoryRoot, 'packages/wallet-console-server-ts');

test('every database-heavy gateway enables Smart Placement without moving other workers', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'seams-gateway-placement-'));
  try {
    for (const lane of ['staging-testnet', 'production-testnet', 'production-mainnet']) {
      for (const worker of ['gateway', 'console', 'wallet-runtime']) {
        const output = path.join(directory, `${lane}.${worker}.json`);
        execFileSync(process.execPath, [
          'scripts/render-d1-gateway-config.mjs',
          '--lane', lane,
          '--worker', worker,
          '--output', output,
        ], { cwd: packageRoot });
        const config = JSON.parse(readFileSync(output, 'utf8'));
        if (worker === 'gateway') {
          expect(config.placement).toEqual({ mode: 'smart' });
        } else {
          expect(config.placement).toBeUndefined();
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});
