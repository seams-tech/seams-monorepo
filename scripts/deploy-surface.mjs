#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  readFrontendSite,
  readConsoleFrontendSite,
} from './deployment-targets.mjs';
import { formatFailedCheck, isFailedCheck, runReadinessChecks } from './deployment-smoke.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const COMPANY_ROOT = path.join(REPOSITORY_ROOT, 'apps', 'seams-site');
const COMPANY_OUTPUT = path.join(COMPANY_ROOT, 'dist');
const WALLET_SITE_ROOT = path.join(REPOSITORY_ROOT, 'apps', 'wallet-console');
const WALLET_SITE_OUTPUT = path.join(WALLET_SITE_ROOT, 'dist');
const WALLET_HOST_OUTPUT = path.join(REPOSITORY_ROOT, '.release-artifacts', 'wallet-host');
const PUBLIC_DOCS_ARTIFACT_ROOT = path.join(REPOSITORY_ROOT, '.artifacts', 'wallet-docs');
const SURFACES = Object.freeze([
  'platform-console',
  'wallet-console',
  'company',
  'wallet-site',
  'wallet-host',
]);
const COMPONENTS = Object.freeze(['all', ...SURFACES]);

if (isDirectInvocation()) {
  main(process.argv.slice(2)).catch(handleFailure);
}

function isDirectInvocation() {
  return (
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  );
}

async function main(args) {
  const options = parseArguments(args);
  if (options.component === 'platform-console' || options.component === 'wallet-console') {
    await runConsoleOperation(
      options.operation,
      readConsoleFrontendSite(options.site),
      options.component,
    );
    return;
  }
  const site = readFrontendSite(options.site);
  const walletLanes = selectWalletLanes(site, options);
  if (options.operation !== 'plan') assertDeploymentBranch(site);
  if (options.component === 'all') {
    if (options.operation === 'deploy') {
      const consoles = readConsoleFrontendSite(options.site);
      requireEnvironmentValues(
        [
          'CLOUDFLARE_API_TOKEN',
          'CLOUDFLARE_ACCOUNT_ID',
          consoles.platformPagesProjectEnv,
          consoles.walletConsolePagesProjectEnv,
          site.pagesProjectEnv,
          site.walletSitePagesProjectEnv,
          ...walletLanes.map(walletPagesProjectEnvironment),
        ],
        process.env,
      );
    }
    for (const surface of SURFACES) {
      if (surface === 'platform-console' || surface === 'wallet-console') {
        await runConsoleOperation(
          options.operation,
          readConsoleFrontendSite(options.site),
          surface,
        );
      } else {
        await runOperation(options.operation, site, surface, walletLanes);
      }
    }
    return;
  }
  await runOperation(options.operation, site, options.component, walletLanes);
}

function walletPagesProjectEnvironment(lane) {
  return lane.walletPagesProjectEnv;
}

async function runConsoleOperation(operation, site, component) {
  const platform = component === 'platform-console';
  const mode = platform ? 'platform' : 'wallet';
  const origin = platform ? site.platformOrigin : site.walletConsoleOrigin;
  const projectEnv = platform ? site.platformPagesProjectEnv : site.walletConsolePagesProjectEnv;
  const output = path.join(WALLET_SITE_ROOT, `dist-${mode}`);
  if (operation === 'plan') {
    process.stdout.write(
      `${JSON.stringify({ component, origin, output, pagesProjectEnvironment: projectEnv, branch: site.branch })}\n`,
    );
    return;
  }
  assertDeploymentBranch(site);
  if (operation === 'build') {
    const environment = {
      ...process.env,
      VITE_SITE_ORIGIN: origin,
      VITE_ASSET_BASE_PATH: '/',
      VITE_CONSOLE_BASE_URL: origin,
      VITE_MAINNET_CONSOLE_BASE_URL: '',
      VITE_MAINNET_RELAYER_URL: '',
      VITE_PLATFORM_CONSOLE_ORIGIN: site.platformOrigin,
      VITE_WALLET_CONSOLE_ORIGIN: site.walletConsoleOrigin,
      // The login page runs in a dialog on the Wallet site's pricing page.
      VITE_WALLET_SITE_ORIGIN: readFrontendSite(site.id).walletSiteOrigin,
    };
    // Preserve the existing account stores. Production testnet retains its own
    // backend; the mainnet and staging account authorities also serve the new hosts.
    for (const account of site.accountOrigins) {
      environment[`VITE_${account.network.toUpperCase()}_CONSOLE_BASE_URL`] =
        site.id === 'production' && account.network === 'testnet' ? account.origin : origin;
    }
    if (!platform) {
      for (const lane of readFrontendSite(site.id).lanes) {
        environment[`VITE_${lane.network.toUpperCase()}_RELAYER_URL`] = lane.gatewayOrigin;
        environment[`VITE_${lane.network.toUpperCase()}_WALLET_ORIGIN`] = lane.walletOrigin;
      }
    }
    runCommand('pnpm', ['-C', 'apps/wallet-console', 'run', `build:${mode}`], { env: environment });
    assertFile(path.join(output, 'index.html'), 'Console entry');
    fs.writeFileSync(path.join(output, '_redirects'), '/* /index.html 200\n');
    fs.appendFileSync(path.join(output, '_headers'), '\n/*\n  X-Robots-Tag: noindex\n');
    return;
  }
  if (operation === 'deploy') {
    requireEnvironmentValues(
      ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', projectEnv],
      process.env,
    );
    assertDirectory(output, 'Console output');
    deployPagesProject(output, site, process.env[projectEnv]);
    await ensurePagesCustomDomain(origin, process.env[projectEnv]);
    return;
  }
  if (operation === 'smoke') {
    const checks = smokeChecks(component, origin, [
      { path: '/dashboard/login', isReady: consoleApplicationIsReady },
      { path: '/console/auth/session', isReady: consoleSessionEndpointIsReady },
    ]);
    const results = await runReadinessChecks(checks);
    process.stdout.write(`${JSON.stringify({ results })}\n`);
    if (results.some(isFailedCheck)) throw new Error('Console frontend smoke failed');
    return;
  }
  throw new Error(`Unsupported Console operation: ${operation}`);
}

async function runOperation(operation, site, component, walletLanes) {
  switch (operation) {
    case 'plan':
      printPlan(site, component, walletLanes);
      return;
    case 'build':
      buildFrontend(site, component, walletLanes);
      return;
    case 'deploy':
      await deployFrontend(site, component, walletLanes);
      return;
    case 'smoke':
      await smokeFrontend(site, component, walletLanes);
      return;
    default:
      throw new Error(`Unsupported frontend operation: ${operation}`);
  }
}

function parseArguments(args) {
  const operation = String(args[0] || '').trim();
  let site = '';
  let component = '';
  let lane = '';
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--site') {
      site = requireArgumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === '--component') {
      component = requireArgumentValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === '--lane') {
      if (lane) throw new Error('--lane may only be provided once');
      lane = requireArgumentValue(args, index, argument);
      index += 1;
      continue;
    }
    throw new Error(usage());
  }
  if (!['plan', 'build', 'deploy', 'smoke'].includes(operation) || !site) throw new Error(usage());
  if (!COMPONENTS.includes(component)) {
    throw new Error(`--component must be ${COMPONENTS.join(', ')}`);
  }
  if (lane && component !== 'wallet-host') {
    throw new Error('--lane requires --component wallet-host');
  }
  return { operation, site, component, lane };
}

function usage() {
  return 'usage: deploy-surface.mjs <plan|build|deploy|smoke> --site <site> --component <all|company|wallet-site|wallet-host|platform-console|wallet-console> [--lane <lane>]';
}

function selectWalletLanes(site, options) {
  if (!options.lane) return site.lanes;
  for (const lane of site.lanes) {
    if (lane.id === options.lane) return [lane];
  }
  throw new Error(`Lane ${options.lane} does not belong to site ${site.id}`);
}

function walletHostOutput(lane) {
  return path.join(WALLET_HOST_OUTPUT, lane.id);
}

function requireArgumentValue(args, index, name) {
  const value = String(args[index + 1] || '').trim();
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function printPlan(site, component, walletLanes) {
  const lines = {
    company: [
      `Origin: ${site.origin}`,
      `Pages project environment: ${site.pagesProjectEnv}`,
      'Artifact: company site only',
    ],
    'wallet-site': [
      `Origin: ${site.walletSiteOrigin}`,
      `Docs: ${site.docsOrigin}/`,
      `Console API: ${site.walletSiteOrigin}/console/*`,
      `Pages project environment: ${site.walletSitePagesProjectEnv}`,
      'Artifact: wallet marketing, showcases, and exact public Wallet docs',
    ],
    'wallet-host': walletLanes.flatMap((lane) => [
      `Hosted wallet (${lane.network}): ${lane.walletOrigin}`,
      `Pages project environment (${lane.network}): ${lane.walletPagesProjectEnv}`,
    ]),
  }[component];
  process.stdout.write(
    `${[`Frontend deployment plan: ${site.id}/${component}`, `Branch: ${site.branch}`, ...lines].join('\n')}\n`,
  );
}

function buildFrontend(site, component, walletLanes) {
  if (component === 'company') {
    runCommand('pnpm', ['-C', 'apps/seams-site', 'exec', 'vite', 'build'], {
      env: buildFrontendEnvironment(site, site.origin),
    });
    writeCompanyCutoverFiles(site);
    assertFile(path.join(COMPANY_OUTPUT, 'index.html'), 'Company site entry');
    assertFile(path.join(COMPANY_OUTPUT, 'ja', 'company', 'index.html'), 'Japanese company entry');
    assertFile(path.join(COMPANY_OUTPUT, 'sitemap.xml'), 'Company site sitemap');
    return;
  }
  if (component === 'wallet-site') {
    runCommand('pnpm', ['-C', 'apps/wallet-console', 'run', 'build:marketing'], {
      env: buildFrontendEnvironment(site, site.walletSiteOrigin),
    });
    writeWalletConsoleRedirects(site);
    copyPublicDocsArtifact();
    copySdkAssets(WALLET_SITE_OUTPUT);
    const docsSitemap = path.join(WALLET_SITE_OUTPUT, 'docs', 'sitemap.xml');
    if (fs.existsSync(docsSitemap)) {
      fs.appendFileSync(
        path.join(WALLET_SITE_OUTPUT, 'robots.txt'),
        `Sitemap: ${new URL('/docs/sitemap.xml', site.walletSiteOrigin).href}\n`,
      );
    }
    if (site.id === 'staging') {
      fs.appendFileSync(
        path.join(WALLET_SITE_OUTPUT, '_headers'),
        '\n/*\n  X-Robots-Tag: noindex\n',
      );
    }
    fs.appendFileSync(
      path.join(WALLET_SITE_OUTPUT, '_headers'),
      '\n/showcase/*\n  X-Robots-Tag: noindex\n/wallet-service/*\n  X-Robots-Tag: noindex\n',
    );
    assertFile(path.join(WALLET_SITE_OUTPUT, 'index.html'), 'Wallet site entry');
    assertFile(path.join(WALLET_SITE_OUTPUT, 'ja', 'index.html'), 'Japanese Wallet site entry');
    assertFile(path.join(WALLET_SITE_OUTPUT, 'pricing', 'index.html'), 'Wallet pricing entry');
    assertFile(
      path.join(WALLET_SITE_OUTPUT, 'ja', 'pricing', 'index.html'),
      'Japanese Wallet pricing entry',
    );
    assertFile(path.join(WALLET_SITE_OUTPUT, 'features', 'index.html'), 'Wallet features entry');
    assertFile(
      path.join(WALLET_SITE_OUTPUT, 'ja', 'features', 'index.html'),
      'Japanese Wallet features entry',
    );
    assertFile(path.join(WALLET_SITE_OUTPUT, 'sitemap.xml'), 'Wallet site sitemap');
    assertFile(path.join(WALLET_SITE_OUTPUT, 'docs', 'index.html'), 'Wallet docs entry');
    return;
  }
  assertWalletSettingsExport();
  for (const lane of walletLanes) {
    const output = walletHostOutput(lane);
    runCommand(
      'pnpm',
      [
        '-C',
        'apps/wallet-console',
        'exec',
        'vite',
        'build',
        '--config',
        'wallet-host/vite.config.ts',
        '--outDir',
        output,
      ],
      {
        env: buildFrontendEnvironment(site, site.walletSiteOrigin),
      },
    );
    copySdkAssets(output);
    assertFile(path.join(output, 'index.html'), 'Wallet settings entry');
    fs.writeFileSync(path.join(output, '_redirects'), '/wallet-settings /index.html 200\n');
    assertFile(path.join(output, 'wallet-service', 'index.html'), 'wallet-service entry');
  }
}

function writeWalletConsoleRedirects(site) {
  const consoleSite = readConsoleFrontendSite(site.id);
  const shared = [
    '/dashboard/account-settings',
    '/dashboard/team-members',
    '/dashboard/onboarding',
    '/dashboard/billing',
    '/dashboard/billing/*',
    '/dashboard/invoices',
    '/dashboard/invoices/*',
    '/platform/*',
  ];
  const lines = [
    '/docs /docs/ 301',
    '/ja /ja/ 301',
    '/pricing /pricing/ 301',
    '/ja/pricing /ja/pricing/ 301',
    '/features /features/ 301',
    '/ja/features /ja/features/ 301',
    `/company ${site.origin}/company 302`,
    `/company/* ${site.origin}/company/:splat 302`,
    `/ja/company ${site.origin}/ja/company/ 302`,
    `/ja/company/* ${site.origin}/ja/company/:splat 302`,
  ];
  for (const route of shared) {
    lines.push(`${route} ${consoleSite.platformOrigin}${route.replace('*', ':splat')} 302`);
  }
  lines.push(`/dashboard ${consoleSite.walletConsoleOrigin}/dashboard 302`);
  lines.push(`/dashboard/* ${consoleSite.walletConsoleOrigin}/dashboard/:splat 302`);
  fs.writeFileSync(path.join(WALLET_SITE_OUTPUT, '_redirects'), `${lines.join('\n')}\n`);
}

function writeCompanyCutoverFiles(site) {
  const walletOrigin = site.walletSiteOrigin;
  const redirects = [
    `/wallet ${walletOrigin}/ 301`,
    `/wallet/ ${walletOrigin}/ 301`,
    `/wallet/ja ${walletOrigin}/ja/ 301`,
    `/wallet/ja/ ${walletOrigin}/ja/ 301`,
    // Wallet pricing moved to the Wallet site; the company site has no pricing page yet.
    `/pricing ${walletOrigin}/pricing/ 301`,
    `/pricing/* ${walletOrigin}/pricing/ 301`,
    `/ja/pricing ${walletOrigin}/ja/pricing/ 301`,
    `/ja/pricing/* ${walletOrigin}/ja/pricing/ 301`,
    '/dashboard/login /wallet-login-restart.html 200',
    `/dashboard ${walletOrigin}/dashboard 302`,
    `/dashboard/* ${walletOrigin}/dashboard/:splat 302`,
    `/platform/* ${walletOrigin}/platform/:splat 302`,
  ];
  fs.writeFileSync(path.join(COMPANY_OUTPUT, '_redirects'), `${redirects.join('\n')}\n`);
  fs.writeFileSync(
    path.join(COMPANY_OUTPUT, 'wallet-login-restart.html'),
    '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Sign in again</title><p>This sign-in request used the former Console address.</p><p><a href="' +
      walletOrigin +
      '/dashboard/login">Start a new sign-in</a></p>\n',
  );
}

function copyPublicDocsArtifact() {
  assertDirectory(PUBLIC_DOCS_ARTIFACT_ROOT, 'Public Wallet docs artifact');
  assertFile(
    path.join(PUBLIC_DOCS_ARTIFACT_ROOT, 'seams-wallet-docs-artifact.json'),
    'Public Wallet docs artifact receipt',
  );
  copyDirectory(PUBLIC_DOCS_ARTIFACT_ROOT, path.join(WALLET_SITE_OUTPUT, 'docs'));
}

function copySdkAssets(destination) {
  const sdkOutput = path.join(resolveInstalledWalletRoot(), 'dist');
  const sdkEsm = path.join(sdkOutput, 'esm', 'sdk');
  const sdkWorkers = path.join(sdkOutput, 'workers');
  const walletAssetsManifest = path.join(sdkOutput, 'public', 'wallet-assets.manifest.json');
  const walletHeadersManifest = path.join(sdkOutput, 'public', 'headers.manifest.json');
  const pagesHeaders = path.join(sdkOutput, 'public', '_headers');
  const walletService = path.join(sdkOutput, 'public', 'wallet-service');
  assertDirectory(sdkEsm, 'SDK ESM output');
  assertDirectory(sdkWorkers, 'SDK Workers output');
  assertFile(walletAssetsManifest, 'SDK wallet assets manifest');
  assertFile(walletHeadersManifest, 'SDK wallet headers manifest');
  assertFile(pagesHeaders, 'SDK Cloudflare Pages headers');
  assertFile(path.join(walletService, 'index.html'), 'SDK wallet-service output');
  fs.mkdirSync(destination, { recursive: true });
  copyDirectory(sdkEsm, path.join(destination, 'sdk'));
  copyDirectory(sdkWorkers, path.join(destination, 'sdk', 'workers'));
  fs.copyFileSync(walletAssetsManifest, path.join(destination, 'wallet-assets.manifest.json'));
  fs.copyFileSync(walletHeadersManifest, path.join(destination, 'headers.manifest.json'));
  fs.copyFileSync(pagesHeaders, path.join(destination, '_headers'));
  copyDirectory(walletService, path.join(destination, 'wallet-service'));
}

export function buildFrontendEnvironment(site, frontendOrigin, sourceEnvironment = process.env) {
  const environment = {
    ...sourceEnvironment,
    VITE_SITE_ID: site.id,
    VITE_SITE_ORIGIN: frontendOrigin,
    VITE_COMPANY_SITE_ORIGIN: site.origin,
    VITE_WALLET_SITE_ORIGIN: site.walletSiteOrigin,
    VITE_DOCS_ORIGIN: `${site.docsOrigin}/`,
    VITE_PLATFORM_CONSOLE_ORIGIN: readConsoleFrontendSite(site.id).platformOrigin,
    // The pricing page's plan cards open the Wallet Console sign-in in a dialog.
    VITE_WALLET_CONSOLE_ORIGIN: readConsoleFrontendSite(site.id).walletConsoleOrigin,
  };
  for (const lane of site.lanes) {
    const prefix = site.id === 'production' ? `VITE_${lane.network.toUpperCase()}_` : 'VITE_';
    environment[`${prefix}RELAYER_URL`] = lane.gatewayOrigin;
    environment[`${prefix}CONSOLE_BASE_URL`] = lane.console.origin;
    environment[`${prefix}WALLET_ORIGIN`] = lane.walletOrigin;
    environment[`${prefix}RP_ID_BASE`] = new URL(lane.walletOrigin).hostname;
    environment[`${prefix}ROUTER_AB_NORMAL_SIGNING_WORKER_ID`] =
      lane.resources.signingWorker.workerName;
    requireEnvironmentValues(
      [
        `${prefix}NEAR_NETWORK`,
        `${prefix}NEAR_RPC_URL`,
        `${prefix}NEAR_EXPLORER`,
        `${prefix}CONSOLE_BASE_URL`,
        `${prefix}SIGNING_SESSION_PERSISTENCE_MODE`,
      ],
      environment,
    );
  }
  return environment;
}

async function deployFrontend(site, component, walletLanes) {
  requireEnvironmentValues(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'], process.env);
  if (component === 'company') {
    requireEnvironmentValues([site.pagesProjectEnv], process.env);
    assertDirectory(COMPANY_OUTPUT, 'Company Pages output');
    deployPagesProject(COMPANY_OUTPUT, site, process.env[site.pagesProjectEnv]);
  } else if (component === 'wallet-site') {
    const consoles = readConsoleFrontendSite(site.id);
    await runConsoleOperation('smoke', consoles, 'platform-console');
    await runConsoleOperation('smoke', consoles, 'wallet-console');
    requireEnvironmentValues([site.walletSitePagesProjectEnv], process.env);
    assertDirectory(WALLET_SITE_OUTPUT, 'Wallet site Pages output');
    const project = process.env[site.walletSitePagesProjectEnv];
    deployPagesProject(WALLET_SITE_OUTPUT, site, project);
    await ensurePagesCustomDomain(site.walletSiteOrigin, project);
  } else {
    const projectEnvironments = [...new Set(walletLanes.map((lane) => lane.walletPagesProjectEnv))];
    requireEnvironmentValues(projectEnvironments, process.env);
    for (const lane of walletLanes) {
      const output = walletHostOutput(lane);
      assertDirectory(output, 'Hosted wallet Pages output');
      deployPagesProject(output, site, process.env[lane.walletPagesProjectEnv]);
    }
  }
  process.stdout.write(`Frontend deploy completed: ${site.id}/${component}\n`);
}

function deployPagesProject(outputDirectory, site, projectName) {
  const args = [
    'exec',
    'wrangler',
    'pages',
    'deploy',
    path.relative(REPOSITORY_ROOT, outputDirectory),
    '--branch',
    site.branch,
    '--commit-dirty=false',
    '--project-name',
    projectName,
  ];
  const sourceSha = String(process.env.DEPLOY_SHA || '').trim();
  if (sourceSha) args.push('--commit-hash', sourceSha);
  runCommand('pnpm', args);
}

async function ensurePagesCustomDomain(origin, projectName) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const hostname = new URL(origin).hostname;
  const projectPath = `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`;
  const domainPath = `${projectPath}/domains/${encodeURIComponent(hostname)}`;
  const existing = await requestCloudflareApi(domainPath, apiToken, 'GET', [200, 404]);
  if (existing.status === 200) return;
  await requestCloudflareApi(`${projectPath}/domains`, apiToken, 'POST', [200], { name: hostname });
  process.stdout.write(`Bound Pages custom domain: ${hostname}\n`);
}

async function requestCloudflareApi(apiPath, apiToken, method, expectedStatuses, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (expectedStatuses.includes(response.status)) return response;
  throw new Error(
    `Cloudflare Pages custom-domain request failed (${method} ${apiPath}): ${response.status} ${await response.text()}`,
  );
}

async function smokeFrontend(site, component, walletLanes) {
  const checks = buildSmokeChecks(site, component, walletLanes);
  const results = await runReadinessChecks(checks);
  const failed = results.filter(isFailedCheck);
  process.stdout.write(`${JSON.stringify({ results })}\n`);
  if (failed.length > 0) {
    throw new Error(`frontend smoke failed: ${failed.map(formatFailedCheck).join(', ')}`);
  }
}

function buildSmokeChecks(site, component, walletLanes) {
  if (component === 'company')
    return smokeChecks('company', site.origin, ['/', '/company/', '/ja/company/', '/sitemap.xml']);
  if (component === 'wallet-site') {
    return smokeChecks('wallet-site', site.walletSiteOrigin, [
      '/',
      '/ja/',
      '/pricing/',
      '/ja/pricing/',
      '/features/',
      '/ja/features/',
      '/sitemap.xml',
      { path: '/robots.txt', isReady: walletRobotsIsReady },
      '/docs/',
      '/docs/concepts/',
      '/docs/releases',
      '/docs/reference/server',
      '/docs/seams-wallet-docs-artifact.json',
      '/sdk/workers/near-signer.worker.js',
    ]);
  }
  return walletLanes.flatMap((lane) =>
    smokeChecks(`wallet-${lane.network}`, lane.walletOrigin, [
      { path: '/', isReady: walletSettingsApplicationIsReady },
      { path: '/wallet-settings', isReady: walletSettingsApplicationIsReady },
      '/wallet-service/index.html',
      { path: '/wallet-assets.manifest.json', isReady: walletManifestMatchesInstalledVersion },
      '/sdk/workers/router_ab_ed25519_yao_client_bg.wasm',
    ]),
  );
}

async function walletRobotsIsReady(response) {
  if (!response.headers.get('content-type')?.includes('text/plain')) return false;
  const body = await response.text();
  const sitemap = new URL('/sitemap.xml', response.url).href;
  return body.includes('User-agent: *') && body.includes(`Sitemap: ${sitemap}`);
}

function smokeChecks(surface, origin, requests) {
  return requests.map((request) => {
    const requestPath = typeof request === 'string' ? request : request.path;
    return {
      name: `${surface}${requestPath}`,
      url: new URL(requestPath, origin).toString(),
      ...(typeof request === 'string' ? {} : { isReady: request.isReady }),
    };
  });
}

async function walletManifestMatchesInstalledVersion(response) {
  const installedWalletRoot = resolveInstalledWalletRoot();
  const installedWalletVersion = readPackageVersion(path.join(installedWalletRoot, 'package.json'));
  return walletManifestMatchesPackageVersion(response, installedWalletVersion);
}

export async function walletManifestMatchesPackageVersion(response, expectedVersion) {
  if (!response.ok) return false;
  if (!String(response.headers.get('content-type') || '').includes('application/json')) {
    return false;
  }
  try {
    const manifest = await response.json();
    if (!isRecord(manifest) || !isRecord(manifest.versionSkewContract)) return false;
    return (
      manifest.packageName === '@seams/wallet' &&
      manifest.packageVersion === expectedVersion &&
      manifest.versionSkewContract.packageVersion === expectedVersion
    );
  } catch {
    return false;
  }
}

async function consoleApplicationIsReady(response) {
  if (!response.ok) return false;
  const html = await response.text();
  if (
    !html.includes('<title>Seams Wallet Console</title>') &&
    !html.includes('<title>Seams Platform</title>')
  )
    return false;
  const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(
    (match) => match[1],
  );
  return assetPaths.length > 0 && assetPaths.every((assetPath) => assetPath.startsWith('/assets/'));
}

async function consoleSessionEndpointIsReady(response) {
  if (response.status !== 200 && response.status !== 401) return false;
  if (!response.headers.get('content-type')?.includes('application/json')) return false;
  const body = await response.json();
  return isRecord(body) && typeof body.ok === 'boolean';
}

export async function walletSettingsApplicationIsReady(response) {
  if (!response.ok) return false;
  const html = await response.text();
  return (
    html.includes('<title>Seams Wallet Settings</title>') &&
    /<script[^>]+src="\/assets\/[^"\s]+\.js"/.test(html)
  );
}

function assertWalletSettingsExport() {
  const entry = path.join(resolveInstalledWalletRoot(), 'dist', 'esm', 'react', 'index.js');
  if (!fs.readFileSync(entry, 'utf8').includes('WalletSettingsPage')) {
    throw new Error(
      'The pinned @seams/wallet release does not export WalletSettingsPage. Publish the settings SDK release and update the exact package pins and lockfile before deploying wallet-host.',
    );
  }
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  runCommand('rsync', ['-a', '--delete', `${source}${path.sep}`, `${destination}${path.sep}`]);
}

function assertDeploymentBranch(site) {
  const ref = String(process.env.GITHUB_REF || '').trim();
  const branch = String(process.env.GITHUB_REF_NAME || '').trim();
  const received = ref || (branch ? `refs/heads/${branch}` : '');
  if (received && received !== `refs/heads/${site.branch}`) {
    throw new Error(`site ${site.id} requires branch ${site.branch}; received ${received}`);
  }
}

function requireEnvironmentValues(names, environment) {
  for (const name of names) {
    if (!String(environment[name] || '').trim()) throw new Error(`${name} is required`);
  }
}

function runCommand(command, args, options = {}) {
  const child = spawnSync(command, args, {
    cwd: options.cwd || REPOSITORY_ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed with status ${child.status}`);
}

function assertDirectory(directory, label) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`${label} is missing: ${directory}`);
  }
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

function readPackageVersion(packagePath) {
  const packageDocument = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (!isRecord(packageDocument)) throw new Error(`Invalid package manifest: ${packagePath}`);
  const version = String(packageDocument.version || '').trim();
  if (!version) throw new Error(`Package version is missing: ${packagePath}`);
  return version;
}

function resolveInstalledWalletRoot() {
  const requireFromWalletSite = createRequire(path.join(WALLET_SITE_ROOT, 'package.json'));
  return path.dirname(requireFromWalletSite.resolve('@seams/wallet/package.json'));
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function handleFailure(error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
