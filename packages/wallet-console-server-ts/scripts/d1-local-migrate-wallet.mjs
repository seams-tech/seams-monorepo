#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const walletServerRoot = path.dirname(require.resolve('@seams/wallet-server/package.json'));
const migrationScript = path.join(walletServerRoot, 'scripts/d1-local-migrate-signer.mjs');
const result = spawnSync(process.execPath, [migrationScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
