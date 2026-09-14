#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFrontendSite } from './deployment-targets.mjs';
import { formatFailedCheck, isFailedCheck, runReadinessChecks } from './deployment-smoke.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const COMPANY_ROOT = path.join(REPOSITORY_ROOT, 'apps', 'seams-site');
const COMPANY_OUTPUT = path.join(COMPANY_ROOT, 'dist');
const WALLET_SITE_ROOT = path.join(REPOSITORY_ROOT, 'apps', 'wallet-console');
const WALLET_SITE_OUTPUT = path.join(WALLET_SITE_ROOT, 'dist');
const WALLET_HOST_OUTPUT = path.join(REPOSITORY_ROOT, '.release-artifacts', 'wallet-host');
const PUBLIC_DOCS_ARTIFACT_ROOT = path.join(REPOSITORY_ROOT, '.artifacts', 'wallet-docs');
const SURFACES = Object.freeze(['company', 'wallet-site', 'wallet-host']);
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
  const site = readFrontendSite(options.site);
  if (options.operation !== 'plan') assertDeploymentBranch(site);
  if (options.component === 'all') {
    for (const surface of SURFACES) await runOperation(options.operation, site, surface);
    return;
  }
  await runOperation(options.operation, site, options.component);
}

async function runOperation(operation, site, component) {
  switch (operation) {
    case 'plan':
      printPlan(site, component);
      return;
    case 'build':
      buildFrontend(site, component);
      return;
    case 'deploy':
      await deployFrontend(site, component);
      return;
    case 'smoke':
      await smokeFrontend(site, component);
      return;
    default:
      throw new Error(`Unsupported frontend operation: ${operation}`);
  }
}

function parseArguments(args) {
  const operation = String(args[0] || '').trim();
  let site = '';
  let component = '';
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
    throw new Error(usage());
  }
  if (!['plan', 'build', 'deploy', 'smoke'].includes(operation) || !site) throw new Error(usage());
  if (!COMPONENTS.includes(component)) {
    throw new Error(`--component must be ${COMPONENTS.join(', ')}`);
  }
  return { operation, site, component };
}

function usage() {
  return 'usage: deploy-surface.mjs <plan|build|deploy|smoke> --site <site> --component <all|company|wallet-site|wallet-host>';
}

function requireArgumentValue(args, index, name) {
  const value = String(args[index + 1] || '').trim();
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function printPlan(site, component) {
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
      'Artifact: wallet landing page, dashboard, and exact public Wallet docs',
    ],
    'wallet-host': site.lanes.flatMap((lane) => [
      `Hosted wallet (${lane.network}): ${lane.walletOrigin}`,
      `Pages project environment (${lane.network}): ${lane.walletPagesProjectEnv}`,
    ]),
  }[component];
  process.stdout.write(
    `${[`Frontend deployment plan: ${site.id}/${component}`, `Branch: ${site.branch}`, ...lines].join('\n')}\n`,
  );
}

function buildFrontend(site, component) {
  if (component === 'company') {
    runCommand('pnpm', ['-C', 'apps/seams-site', 'exec', 'vite', 'build'], {
      env: buildFrontendEnvironment(site, site.origin),
    });
    writeCompanyCutoverFiles(site);
    assertFile(path.join(COMPANY_OUTPUT, 'index.html'), 'Company site entry');
    return;
  }
  if (component === 'wallet-site') {
    runCommand('pnpm', ['-C', 'apps/wallet-console', 'run', 'build'], {
      env: buildFrontendEnvironment(site, site.walletSiteOrigin),
    });
    copyPublicDocsArtifact();
    copySdkAssets(WALLET_SITE_OUTPUT);
    assertFile(path.join(WALLET_SITE_OUTPUT, 'index.html'), 'Wallet site entry');
    assertFile(path.join(WALLET_SITE_OUTPUT, 'docs', 'index.html'), 'Wallet docs entry');
    return;
  }
  resetDirectory(WALLET_HOST_OUTPUT);
  copySdkAssets(WALLET_HOST_OUTPUT);
  assertFile(path.join(WALLET_HOST_OUTPUT, 'wallet-service', 'index.html'), 'wallet-service entry');
}

function writeCompanyCutoverFiles(site) {
  const walletOrigin = site.walletSiteOrigin;
  const redirects = [
    `/wallet ${walletOrigin}/ 302`,
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
  const requireFromWalletSite = createRequire(path.join(WALLET_SITE_ROOT, 'package.json'));
  const sdkOutput = path.join(
    path.dirname(requireFromWalletSite.resolve('@seams/wallet/package.json')),
    'dist',
  );
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
  };
  for (const lane of site.lanes) {
    const prefix = site.id === 'production' ? `VITE_${lane.network.toUpperCase()}_` : 'VITE_';
    environment[`${prefix}RELAYER_URL`] = lane.gatewayOrigin;
    environment[`${prefix}CONSOLE_BASE_URL`] = lane.console.origin;
    environment[`${prefix}WALLET_ORIGIN`] = lane.walletOrigin;
    environment[`${prefix}RP_ID_BASE`] = new URL(lane.walletOrigin).hostname;
    environment[`${prefix}ROUTER_AB_NORMAL_SIGNING_WORKER_ID`] =
      lane.resources.signingWorker.workerName;
    const projectEnvironmentVariable =
      site.id === 'staging'
        ? 'VITE_SEAMS_PROJECT_ENVIRONMENT_ID'
        : `${prefix}SEAMS_PROJECT_ENVIRONMENT_ID`;
    requireEnvironmentValues(
      [
        projectEnvironmentVariable,
        `${prefix}SEAMS_PUBLISHABLE_KEY`,
        `${prefix}NEAR_NETWORK`,
        `${prefix}NEAR_RPC_URL`,
        `${prefix}NEAR_EXPLORER`,
        `${prefix}CONSOLE_BASE_URL`,
        `${prefix}SIGNING_SESSION_PERSISTENCE_MODE`,
      ],
      environment,
    );
    assertLaneProjectEnvironmentId(lane, projectEnvironmentVariable, environment);
  }
  return environment;
}

function assertLaneProjectEnvironmentId(lane, variableName, environment) {
  if (lane.provisioning.kind !== 'provisioned') {
    throw new Error(`lane ${lane.id} must be provisioned before frontend configuration validation`);
  }
  const expected = lane.provisioning.gatewayDeploymentConfig.tenant.environmentId;
  const received = String(environment[variableName] || '').trim();
  if (received !== expected) {
    throw new Error(`${variableName} must match ${lane.id} tenant environment ${expected}`);
  }
}

async function deployFrontend(site, component) {
  requireEnvironmentValues(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'], process.env);
  if (component === 'company') {
    requireEnvironmentValues([site.pagesProjectEnv], process.env);
    assertDirectory(COMPANY_OUTPUT, 'Company Pages output');
    deployPagesProject(COMPANY_OUTPUT, site, process.env[site.pagesProjectEnv]);
  } else if (component === 'wallet-site') {
    requireEnvironmentValues([site.walletSitePagesProjectEnv], process.env);
    assertDirectory(WALLET_SITE_OUTPUT, 'Wallet site Pages output');
    const project = process.env[site.walletSitePagesProjectEnv];
    deployPagesProject(WALLET_SITE_OUTPUT, site, project);
    await ensurePagesCustomDomain(site.walletSiteOrigin, project);
  } else {
    const projectEnvironments = [...new Set(site.lanes.map((lane) => lane.walletPagesProjectEnv))];
    requireEnvironmentValues(projectEnvironments, process.env);
    assertDirectory(WALLET_HOST_OUTPUT, 'Hosted wallet Pages output');
    for (const lane of site.lanes) {
      deployPagesProject(WALLET_HOST_OUTPUT, site, process.env[lane.walletPagesProjectEnv]);
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

async function smokeFrontend(site, component) {
  const checks = buildSmokeChecks(site, component);
  const results = await runReadinessChecks(checks);
  const failed = results.filter(isFailedCheck);
  process.stdout.write(`${JSON.stringify({ results })}\n`);
  if (failed.length > 0) {
    throw new Error(`frontend smoke failed: ${failed.map(formatFailedCheck).join(', ')}`);
  }
}

function buildSmokeChecks(site, component) {
  if (component === 'company') return smokeChecks('company', site.origin, ['/']);
  if (component === 'wallet-site') {
    return smokeChecks('wallet-site', site.walletSiteOrigin, [
      '/',
      { path: '/dashboard', isReady: consoleApplicationIsReady },
      '/docs/',
      '/docs/concepts/',
      '/sdk/workers/near-signer.worker.js',
    ]);
  }
  return site.lanes.flatMap((lane) =>
    smokeChecks(`wallet-${lane.network}`, lane.walletOrigin, [
      '/wallet-service/index.html',
      { path: '/wallet-assets.manifest.json', isReady: jsonManifestIsReady },
      '/sdk/workers/router_ab_ed25519_yao_client_bg.wasm',
    ]),
  );
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

function jsonManifestIsReady(response) {
  return (
    response.ok && String(response.headers.get('content-type') || '').includes('application/json')
  );
}

async function consoleApplicationIsReady(response) {
  if (!response.ok) return false;
  const html = await response.text();
  if (!html.includes('<title>Seams Wallet</title>')) return false;
  const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(
    (match) => match[1],
  );
  return assetPaths.length > 0 && assetPaths.every((assetPath) => assetPath.startsWith('/assets/'));
}

function resetDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
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

function handleFailure(error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
