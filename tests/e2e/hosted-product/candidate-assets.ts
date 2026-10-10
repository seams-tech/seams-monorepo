import type { Route, BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

const configuredSite = process.env.SEAMS_HOSTED_CANDIDATE_SITE;
if (!configuredSite) throw new Error('SEAMS_HOSTED_CANDIDATE_SITE is required');
const site = path.resolve(configuredSite);
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export async function installCandidateAssets(context: BrowserContext): Promise<void> {
  await context.route(`${process.env.SEAMS_INTENDED_APP_URL}/**`, candidateAsset);
  await context.route(`${process.env.SEAMS_INTENDED_WALLET_ORIGIN}/**`, candidateAsset);
}

async function candidateAsset(route: Route): Promise<void> {
  const asset = await readCandidateAsset(new URL(route.request().url()).pathname);
  await route.fulfill({ ...asset, headers: isolationHeaders });
}

async function readCandidateAsset(
  pathname: string,
): Promise<{ readonly body: Buffer | string; readonly contentType: string }> {
  if (pathname === '/__storage-reset') {
    return { contentType: 'text/html', body: '<!doctype html><title>Reset</title>' };
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
  if (!file.startsWith(`${site}/`)) throw new Error('Invalid candidate asset path');
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
  };
  return {
    body: await readFile(file),
    contentType: types[path.extname(file)] || 'application/octet-stream',
  };
}

/**
 * Serves the candidate site from a local HTTPS server, and maps the hosted
 * application and wallet origins to it inside the browser.
 *
 * A routed context cannot measure latency: Playwright answers every CORS
 * preflight itself and turns the HTTP cache off. With this server no request
 * is intercepted, so Gateway requests pay their real preflights.
 */
export class CandidateAssetServer {
  private readonly port = Number(process.env.SEAMS_HOSTED_CANDIDATE_PORT ?? 8443);
  private server: https.Server | null = null;

  /** Launch arguments for the browser that loads the hosted origins. */
  get browserArguments(): string[] {
    const rules = [process.env.SEAMS_INTENDED_APP_URL, process.env.SEAMS_INTENDED_WALLET_ORIGIN]
      .map((origin) => `MAP ${new URL(String(origin)).host}:443 127.0.0.1:${this.port}`)
      .join(', ');
    // The local certificate is self-signed.
    return [`--host-resolver-rules=${rules}`, '--ignore-certificate-errors'];
  }

  async start(): Promise<void> {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'seams-candidate-site-'));
    try {
      const key = path.join(directory, 'key.pem');
      const certificate = path.join(directory, 'certificate.pem');
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '2',
          '-subj',
          '/CN=seams-candidate-site',
          '-keyout',
          key,
          '-out',
          certificate,
        ],
        { stdio: 'ignore' },
      );
      this.server = https.createServer(
        { key: readFileSync(key), cert: readFileSync(certificate) },
        (request, response) => {
          readCandidateAsset(
            new URL(request.url ?? '/', 'https://candidate.invalid').pathname,
          ).then(
            (asset) => {
              response.writeHead(200, { ...isolationHeaders, 'Content-Type': asset.contentType });
              response.end(asset.body);
            },
            () => {
              response.writeHead(404, isolationHeaders);
              response.end();
            },
          );
        },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    const server = this.server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', resolve);
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
