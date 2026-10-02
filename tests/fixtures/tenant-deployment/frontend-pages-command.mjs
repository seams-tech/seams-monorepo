#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.slice(0, 4).join(' ') === 'exec wrangler pages deploy') {
  const project = args[args.indexOf('--project-name') + 1];
  if (!['fixture-testnet', 'fixture-mainnet'].includes(project)) {
    throw new Error('Unexpected Pages project');
  }
  const output = path.resolve(args[4]);
  const destination = path.join(process.env.FRONTEND_PROVIDER_DIRECTORY, project);
  mkdirSync(destination, { recursive: true });
  cpSync(output, destination, { recursive: true });
  appendFileSync(process.env.FRONTEND_DEPLOY_LOG, JSON.stringify({ project, output }) + '\n');
} else if (args.slice(0, 6).join(' ') === '-C apps/wallet-console exec vite build --config') {
  const result = spawnSync(process.env.FRONTEND_REAL_PNPM, args, {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  throw new Error(`Unexpected frontend command: ${args.join(' ')}`);
}
