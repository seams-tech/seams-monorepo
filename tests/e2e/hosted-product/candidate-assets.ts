import type { Route, BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const site = process.env.SEAMS_HOSTED_CANDIDATE_SITE;
if (!site) throw new Error('SEAMS_HOSTED_CANDIDATE_SITE is required');

export async function installCandidateAssets(context: BrowserContext): Promise<void> {
  await context.route(`${process.env.SEAMS_INTENDED_APP_URL}/**`, candidateAsset);
  await context.route(`${process.env.SEAMS_INTENDED_WALLET_ORIGIN}/**`, candidateAsset);
}

async function candidateAsset(route: Route): Promise<void> {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === '/__storage-reset') {
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Reset</title>' });
    return;
  }
  let relative = pathname.slice(1);
  if (pathname === '/' || pathname === '/__intended-e2e') {
    relative = 'index.html';
  } else if (pathname === '/wallet-service') {
    relative = 'wallet-service/index.html';
  } else if (pathname.endsWith('/')) {
    relative += 'index.html';
  }
  const file = path.resolve(site, relative);
  if (!file.startsWith(`${path.resolve(site)}/`)) throw new Error('Invalid candidate asset path');
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
  };
  await route.fulfill({
    body: await readFile(file),
    contentType: types[path.extname(file)] || 'application/octet-stream',
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}

