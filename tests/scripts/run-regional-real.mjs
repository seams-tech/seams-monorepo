import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const walletRoot = path.resolve(candidate, '../..');
const localRoot = mkdtempSync(path.join(tmpdir(), 'seams-regional-real-'));
try {
  const result = spawnSync(
    process.execPath,
    [
      path.join(walletRoot, 'node_modules/@playwright/test/cli.js'),
      'test',
      '-c',
      path.join(root, 'tests/playwright.regional-real.config.mjs'),
      ...process.argv.slice(2),
    ],
    {
      cwd: root,
      env: { ...process.env, SEAMS_INTENDED_ROUTER_AB_ROOT: localRoot },
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(localRoot, { recursive: true, force: true });
}
