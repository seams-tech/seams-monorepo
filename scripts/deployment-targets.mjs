import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseBrowserOrigins,
  parseGatewayDeploymentConfig,
} from '../packages/wallet-console-server-ts/scripts/gateway-deployment-config.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WALLET_TARGETS_PATH = path.join(
  SCRIPT_DIRECTORY,
  '..',
  'deployment',
  'wallet-system',
  'targets.json',
);
const DEFAULT_CONSOLE_TARGETS_PATH = path.join(
  SCRIPT_DIRECTORY,
  '..',
  'deployment',
  'console',
  'targets.json',
);

const RELEASE_IDS = Object.freeze(['staging', 'production']);
const RELEASE_NETWORKS = Object.freeze({
  staging: Object.freeze(['testnet']),
  production: Object.freeze(['testnet', 'mainnet']),
});
const BACKEND_LANE_IDS = Object.freeze([
  'staging-testnet',
  'production-testnet',
  'production-mainnet',
  'getsignal-testnet',
]);
const CONSOLE_LANE_IDS = Object.freeze([
  'staging-testnet',
  'production-testnet',
  'production-mainnet',
]);
const FRONTEND_SITE_IDS = Object.freeze(['staging', 'production']);
const CONSOLE_FRONTEND_SITE_IDS = Object.freeze(['staging', 'production']);

export const BACKEND_COMPONENTS = Object.freeze([
  'signing-worker',
  'deriver-a',
  'deriver-b',
  'router',
  'tenant-root-control-plane',
  'wallet-runtime',
  'gateway',
  'console',
]);

const CAPABILITY_NAMES = Object.freeze(['billing', 'sponsoredExecution', 'signingSessionSeal']);
const CAPABILITY_OWNER_NAMES = new Set(['console', 'gateway']);
const DEPLOYMENT_RESOURCE_NAMES = Object.freeze([
  'gateway',
  'router',
  'deriverA',
  'deriverB',
  'signingWorker',
  'tenantRootControlPlane',
]);
const GATEWAY_BASE_SECRET_NAMES = Object.freeze([
  'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET',
  'ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET',
  'ROUTER_AB_GATEWAY_TO_SIGNING_WORKER_PRESIGN_AUTH_SECRET',
  'LINKED_DEVICE_TARGET_DESCRIPTOR_HMAC_SECRET',
  'ROUTER_AB_CEREMONY_JWT_PRIVATE_JWK',
]);
const AMAZON_SES_SECRET_NAMES = Object.freeze([
  'EMAIL_OTP_SES_ACCESS_KEY_ID',
  'EMAIL_OTP_SES_SECRET_ACCESS_KEY',
]);

export const CONSOLE_SERVICE_ENVIRONMENT_NAMES = Object.freeze([
  'SATYR_DEPLOYMENT_ID',
  'SATYR_ACCOUNT_ASSERTION_ISSUER',
  'SATYR_ACCOUNT_ASSERTION_AUDIENCE',
  'SATYR_ACCOUNT_USER_ASSERTION_KEY_ID',
  'SATYR_ACCOUNT_USER_ASSERTION_PUBLIC_JWK_JSON',
  'SATYR_GOOGLE_OIDC_CLIENT_ID',
  'SATYR_SERVICE_ORIGIN',
  'SATYR_PROVISION_PLACEMENT_CELL_ID',
  'SATYR_PROVISION_ENVIRONMENT',
  'SATYR_PROVISION_TOKEN',
  'ACCOUNT_PROVISION_ASSERTION_ISSUER',
  'ACCOUNT_PROVISION_ASSERTION_AUDIENCE',
  'ACCOUNT_PROVISION_ASSERTION_KEY_ID',
  'ACCOUNT_PROVISION_ASSERTION_PRIVATE_JWK_JSON',
]);

export function readConsoleServiceEnvironment(environment) {
  const values = {};
  for (const name of CONSOLE_SERVICE_ENVIRONMENT_NAMES) {
    const value = String(environment[name] || '').trim();
    if (value) values[name] = value;
  }
  if (Object.keys(values).length === 0) return values;
  for (const name of CONSOLE_SERVICE_ENVIRONMENT_NAMES) {
    if (!values[name]) throw new Error(`The Satyr connection requires ${name}`);
  }
  return values;
}

export function backendLaneIds() {
  return BACKEND_LANE_IDS;
}

export function frontendSiteIds() {
  return FRONTEND_SITE_IDS;
}

export function readDeploymentTargets() {
  const walletSource = readJsonDocument(DEFAULT_WALLET_TARGETS_PATH);
  const walletRoot = requireObject(walletSource, DEFAULT_WALLET_TARGETS_PATH);
  requireExactKeys(
    walletRoot,
    ['schemaVersion', ...RELEASE_IDS, 'customers'],
    DEFAULT_WALLET_TARGETS_PATH,
  );
  if (walletRoot.schemaVersion !== 1) {
    throw new Error(DEFAULT_WALLET_TARGETS_PATH + '.schemaVersion must be 1');
  }
  const consoleTargets = parseConsoleTargets(readJsonDocument(DEFAULT_CONSOLE_TARGETS_PATH));
  const composedSource = composeDeploymentTargets(walletRoot, consoleTargets);
  return parseDeploymentTargets(composedSource, DEFAULT_WALLET_TARGETS_PATH, consoleTargets);
}

export function readBackendLane(laneId) {
  if (!BACKEND_LANE_IDS.includes(laneId)) {
    throw new Error('backend lane must be ' + BACKEND_LANE_IDS.join(' or '));
  }
  return readDeploymentTargets().backendLanes[laneId];
}

export function readConsoleTarget(laneId) {
  return readBackendLane(laneId).console;
}

export function readFrontendSite(siteId) {
  if (!FRONTEND_SITE_IDS.includes(siteId)) {
    throw new Error('frontend site must be ' + FRONTEND_SITE_IDS.join(' or '));
  }
  return readDeploymentTargets().frontendSites[siteId];
}

export function readConsoleFrontendSite(siteId) {
  if (!CONSOLE_FRONTEND_SITE_IDS.includes(siteId))
    throw new Error('frontend site must be staging or production');
  const document = readJsonDocument(DEFAULT_CONSOLE_TARGETS_PATH);
  const lanes = parseConsoleTargets(document);
  const frontends = requireObject(document.frontends, 'Console frontends');
  requireExactKeys(frontends, CONSOLE_FRONTEND_SITE_IDS, 'Console frontends');
  const site = requireObject(frontends[siteId], `Console frontends.${siteId}`);
  requireExactKeys(
    site,
    [
      'branch',
      'platformOrigin',
      'walletConsoleOrigin',
      'platformPagesProjectEnv',
      'walletConsolePagesProjectEnv',
    ],
    'Console frontend',
  );
  return Object.freeze({
    id: siteId,
    accountOrigins:
      siteId === 'staging'
        ? [{ network: 'testnet', origin: lanes['staging-testnet'].origin }]
        : [
            { network: 'testnet', origin: lanes['production-testnet'].origin },
            { network: 'mainnet', origin: lanes['production-mainnet'].origin },
          ],
    branch: requireString(site.branch, 'Console frontend branch'),
    platformOrigin: requireHttpsOrigin(site.platformOrigin, 'Platform Console origin'),
    walletConsoleOrigin: requireHttpsOrigin(site.walletConsoleOrigin, 'Wallet Console origin'),
    platformPagesProjectEnv: requireEnvironmentName(
      site.platformPagesProjectEnv,
      'Platform Pages project',
    ),
    walletConsolePagesProjectEnv: requireEnvironmentName(
      site.walletConsolePagesProjectEnv,
      'Wallet Pages project',
    ),
  });
}

function readJsonDocument(documentPath) {
  const absolutePath = path.resolve(documentPath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(
      'Unable to read deployment targets ' + absolutePath + ': ' + formatError(error),
    );
  }
}

function parseConsoleTargets(value) {
  const root = requireObject(value, DEFAULT_CONSOLE_TARGETS_PATH);
  requireExactKeys(root, ['schemaVersion', 'lanes', 'frontends'], DEFAULT_CONSOLE_TARGETS_PATH);
  if (root.schemaVersion !== 1) {
    throw new Error(DEFAULT_CONSOLE_TARGETS_PATH + '.schemaVersion must be 1');
  }
  const lanes = requireObject(root.lanes, DEFAULT_CONSOLE_TARGETS_PATH + '.lanes');
  requireExactKeys(lanes, CONSOLE_LANE_IDS, DEFAULT_CONSOLE_TARGETS_PATH + '.lanes');
  return Object.freeze(
    Object.fromEntries(
      CONSOLE_LANE_IDS.map((laneId) => [laneId, parseConsoleTarget(lanes[laneId], laneId)]),
    ),
  );
}

function parseConsoleTarget(value, laneId) {
  const targetPath = DEFAULT_CONSOLE_TARGETS_PATH + '.lanes.' + laneId;
  const target = requireObject(value, targetPath);
  const keys = [
    'environment',
    'origin',
    'siteOrigin',
    'workerName',
    'database',
    'emailDelivery',
    'billing',
  ];
  if (Object.hasOwn(target, 'placementRegion')) keys.push('placementRegion');
  if (Object.hasOwn(target, 'platformSupportEmails')) keys.push('platformSupportEmails');
  requireExactKeys(target, keys, targetPath);
  const database = requireObject(target.database, targetPath + '.database');
  requireExactKeys(database, ['name', 'id'], targetPath + '.database');
  const billing = requireObject(target.billing, targetPath + '.billing');
  requireExactKeys(billing, ['enabled', 'secrets'], targetPath + '.billing');
  if (billing.enabled !== true) {
    throw new Error(targetPath + '.billing.enabled must be true');
  }
  return Object.freeze({
    laneId,
    environment: requireResourceName(target.environment, targetPath + '.environment'),
    origin: requireHttpsOrigin(target.origin, targetPath + '.origin'),
    siteOrigin: requireHttpsOrigin(target.siteOrigin, targetPath + '.siteOrigin'),
    workerName: requireResourceName(target.workerName, targetPath + '.workerName'),
    ...(Object.hasOwn(target, 'placementRegion')
      ? {
          placementRegion: requirePattern(
            target.placementRegion,
            /^(?:aws|gcp|azure):[a-z0-9-]+$/u,
            targetPath + '.placementRegion',
          ),
        }
      : {}),
    database: Object.freeze({
      name: requireResourceName(database.name, targetPath + '.database.name'),
      id: requirePattern(
        database.id,
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u,
        targetPath + '.database.id',
      ),
    }),
    emailDelivery: parseConsoleEmailDelivery(target.emailDelivery, targetPath + '.emailDelivery'),
    ...(Object.hasOwn(target, 'platformSupportEmails')
      ? {
          platformSupportEmails: parsePlatformSupportEmails(
            target.platformSupportEmails,
            targetPath + '.platformSupportEmails',
          ),
        }
      : {}),
    billing: Object.freeze({
      enabled: true,
      owner: 'console',
      secrets: parseSecretNames(billing.secrets, targetPath + '.billing.secrets'),
    }),
  });
}

// Platform support accounts reach the audited Platform billing tools (support
// credits, debits, refunds) for every organisation of the lane.
function parsePlatformSupportEmails(value, pathName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(pathName + ' must be a non-empty list of email addresses');
  }
  const emails = value.map((email, index) =>
    requireEmailAddress(email, pathName + '[' + index + ']').toLowerCase(),
  );
  if (new Set(emails).size !== emails.length) throw new Error(pathName + ' repeats an address');
  return Object.freeze(emails);
}

function parseConsoleEmailDelivery(value, pathName) {
  const delivery = requireObject(value, pathName);
  const kind = requireString(delivery.kind, pathName + '.kind');
  if (kind === 'capture') {
    requireExactKeys(delivery, ['kind'], pathName);
    return Object.freeze({ kind });
  }
  if (kind === 'resend') {
    requireExactKeys(delivery, ['kind', 'fromAddress'], pathName);
    return Object.freeze({
      kind,
      fromAddress: requireEmailAddress(delivery.fromAddress, pathName + '.fromAddress'),
    });
  }
  throw new Error(pathName + '.kind must be capture or resend');
}

function composeDeploymentTargets(walletRoot, consoleTargets) {
  const composed = structuredClone({
    staging: walletRoot.staging,
    production: walletRoot.production,
    customers: walletRoot.customers,
  });
  for (const laneId of CONSOLE_LANE_IDS) {
    const consoleTarget = consoleTargets[laneId];
    const [releaseId, network] = splitLaneId(laneId);
    const release = composed[releaseId];
    const lane = release.lanes[network];
    lane.resources.gateway.consoleD1Name = consoleTarget.database.name;
    lane.capabilities.billing = consoleTarget.billing;
    if (lane.provisioning.kind === 'provisioned') {
      lane.provisioning.gatewayDeploymentConfig.resources.consoleD1 = consoleTarget.database;
    }
  }
  return composed;
}

function splitLaneId(laneId) {
  if (laneId === 'staging-testnet') return ['staging', 'testnet'];
  if (laneId === 'production-testnet') return ['production', 'testnet'];
  if (laneId === 'production-mainnet') return ['production', 'mainnet'];
  throw new Error('Unsupported backend lane: ' + laneId);
}

export function parseDeploymentTargets(
  value,
  sourceName = 'deployment targets',
  consoleTargets = undefined,
) {
  let source = value;
  const document = requireObject(value, sourceName);
  if (Object.hasOwn(document, 'schemaVersion')) {
    requireExactKeys(document, ['schemaVersion', ...RELEASE_IDS, 'customers'], sourceName);
    if (document.schemaVersion !== 1) throw new Error(sourceName + '.schemaVersion must be 1');
    consoleTargets ??= parseConsoleTargets(readJsonDocument(DEFAULT_CONSOLE_TARGETS_PATH));
    source = composeDeploymentTargets(document, consoleTargets);
  }
  const root = requireObject(source, sourceName);
  requireExactKeys(root, [...RELEASE_IDS, 'customers'], sourceName);
  const releases = {};
  const backendLanes = {};
  const frontendSites = {};
  for (const releaseId of RELEASE_IDS) {
    const release = parseRelease(root[releaseId], releaseId, consoleTargets);
    releases[releaseId] = release;
    frontendSites[releaseId] = release.site;
    for (const lane of Object.values(release.lanes)) backendLanes[lane.id] = lane;
  }
  const customers = requireObject(root.customers, sourceName + '.customers');
  requireExactKeys(customers, ['getsignal'], sourceName + '.customers');
  const customer = parseCustomerDeployment(
    customers.getsignal,
    backendLanes,
    frontendSites.production,
  );
  backendLanes[customer.lane.id] = customer.lane;
  const platformSites = [];
  const applicationOrigins = [];
  for (const site of Object.values(frontendSites)) {
    if (site.kind === 'platform') platformSites.push(site);
    applicationOrigins.push(site.origin);
  }
  assertUniqueSiteOrigins(platformSites);
  assertUnique(applicationOrigins, 'frontend application origins');
  assertUniqueLaneOrigins(Object.values(backendLanes));
  assertUniqueResourceNames(Object.values(backendLanes));
  assertUniqueProvisionedIdentities(Object.values(backendLanes));
  return Object.freeze({
    releases: Object.freeze(releases),
    backendLanes: Object.freeze(backendLanes),
    frontendSites: Object.freeze(frontendSites),
  });
}

export function gatewaySecretNames(lane) {
  const names = [...GATEWAY_BASE_SECRET_NAMES];
  if (
    lane.release === 'production' &&
    (lane.emailOtpDelivery.kind === 'demo_code_response' ||
      lane.emailOtpDelivery.provider.kind !== 'resend')
  ) {
    names.push('RESEND_API_KEY');
  }
  if (lane.emailOtpDelivery.kind !== 'demo_code_response') {
    names.push(...emailOtpProviderSecretNames(lane.emailOtpDelivery.provider));
  }
  for (const capabilityName of CAPABILITY_NAMES) {
    const capability = lane.capabilities[capabilityName];
    if (capability.enabled && capability.owner === 'gateway') names.push(...capability.secrets);
  }
  return unique(names, 'gateway secret requirements');
}

export function consoleSecretNames(lane) {
  const names = [
    'CONSOLE_SESSION_HMAC_SECRET',
    'CONSOLE_EMAIL_INVITATION_SECRET_KEY_B64U',
    'CONSOLE_WEBHOOK_SECRET_KEY_B64U',
    'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID',
    'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED',
    'STRIPE_API_SK',
    'STRIPE_WEBHOOK_SECRET',
  ];
  if (lane.release === 'production') names.push('RESEND_API_KEY');
  return unique(names, 'console secret requirements');
}

export function tenantRootManagedBackupConfig(lane, role) {
  const prefix = {
    a: 'DERIVER_A',
    b: 'DERIVER_B',
  }[role];
  if (!prefix) throw new Error('tenant-root deriver role must be a or b');

  const stem = `${prefix}_TENANT_ROOT_MANAGED_BACKUP`;
  const common = {
    providerIdEnvironmentName: `${stem}_PROVIDER_ID`,
    keyVersionEnvironmentName: `${stem}_KEY_VERSION`,
  };
  if (lane.network === 'mainnet') {
    return Object.freeze({
      ...common,
      kind: 'google_cloud_kms',
      expectedProviderId: `google-cloud-kms-deriver-${role}-v1`,
      credentialsSecretName: `${stem}_GOOGLE_CREDENTIALS_JSON`,
      credentialsBindingEnvironmentName: `${stem}_GOOGLE_CREDENTIALS_JSON_BINDING`,
    });
  }
  return Object.freeze({
    ...common,
    kind: 'hpke',
    privateSecretName: `${stem}_HPKE_PRIVATE_KEY`,
    publicEnvironmentName: `${stem}_HPKE_PUBLIC_KEY`,
    privateBindingEnvironmentName: `${stem}_HPKE_PRIVATE_KEY_BINDING`,
  });
}

export function tenantRootManagedBackupSecretNames(lane, role) {
  const config = tenantRootManagedBackupConfig(lane, role);
  return config.kind === 'google_cloud_kms'
    ? [config.credentialsSecretName]
    : [config.privateSecretName];
}

function emailOtpProviderSecretNames(provider) {
  switch (provider.kind) {
    case 'resend':
      return ['RESEND_API_KEY'];
    case 'amazon_ses':
      return AMAZON_SES_SECRET_NAMES;
    default:
      throw new Error('Unsupported Email OTP provider: ' + provider.kind);
  }
}

export function componentSecretNames(lane, component) {
  switch (component) {
    case 'gateway':
    case 'wallet-runtime':
      return gatewaySecretNames(lane);
    case 'console':
      return consoleSecretNames(lane);
    case 'signing-worker':
      return [
        'ROUTER_AB_ROUTER_TO_SIGNING_WORKER_ECDSA_AUTH_SECRET',
        'ROUTER_AB_GATEWAY_TO_SIGNING_WORKER_PRESIGN_AUTH_SECRET',
        'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET',
        'SIGNING_WORKER_SERVER_OUTPUT_HPKE_PRIVATE_KEY',
        'SIGNING_WORKER_PRIVATE_D1_KEK',
      ];
    case 'deriver-a':
      return [
        'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET',
        'DERIVER_A_ENVELOPE_HPKE_PRIVATE_KEY',
        'DERIVER_A_ROLE_PRIVATE_D1_KEK',
        'DERIVER_A_TENANT_ROOT_ONLINE_HPKE_PRIVATE_KEY',
        ...tenantRootManagedBackupSecretNames(lane, 'a'),
        'DERIVER_A_TENANT_ROOT_CREATION_SIGNING_KEY',
      ];
    case 'deriver-b':
      return [
        'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET',
        'DERIVER_B_ENVELOPE_HPKE_PRIVATE_KEY',
        'DERIVER_B_ROLE_PRIVATE_D1_KEK',
        'DERIVER_B_TENANT_ROOT_ONLINE_HPKE_PRIVATE_KEY',
        ...tenantRootManagedBackupSecretNames(lane, 'b'),
        'DERIVER_B_TENANT_ROOT_CREATION_SIGNING_KEY',
      ];
    case 'router':
      return [
        'ROUTER_AB_ROUTER_TO_SIGNING_WORKER_ECDSA_AUTH_SECRET',
        'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET',
        'ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET',
      ];
    case 'tenant-root-control-plane':
      return [
        'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET',
        'TENANT_ROOT_CONTROL_PLANE_ISSUER_SIGNING_KEY',
      ];
    default:
      throw new Error('Unsupported backend component: ' + component);
  }
}

function parseRelease(value, releaseId, consoleTargets) {
  const releasePath = releaseId;
  const release = requireObject(value, releasePath);
  requireExactKeys(release, ['branch', 'site', 'lanes'], releasePath);
  const branch = requirePattern(release.branch, /^[a-z0-9._/-]+$/u, releasePath + '.branch');
  const expectedBranch = releaseId === 'staging' ? 'dev' : 'main';
  if (branch !== expectedBranch) {
    throw new Error(releasePath + '.branch must be ' + expectedBranch);
  }
  const site = parseSite(release.site, releaseId, branch);
  const laneRoot = requireObject(release.lanes, releasePath + '.lanes');
  const networks = RELEASE_NETWORKS[releaseId];
  requireExactKeys(laneRoot, networks, releasePath + '.lanes');
  const lanes = {};
  for (const network of networks) {
    const laneId = releaseId + '-' + network;
    lanes[network] = parseBackendLane(
      laneRoot[network],
      laneId,
      releaseId,
      network,
      branch,
      site,
      consoleTargets?.[laneId],
    );
  }
  const frontendSite = Object.freeze({
    ...site,
    lanes: Object.freeze(Object.values(lanes)),
  });
  return Object.freeze({
    id: releaseId,
    branch,
    site: frontendSite,
    lanes: Object.freeze(lanes),
  });
}

function parseCustomerDeployment(value, backendLanes, branding) {
  const sourcePath = 'customers.getsignal';
  const source = requireObject(value, sourcePath);
  requireExactKeys(
    source,
    [
      'branch',
      'controlPlaneLane',
      'identity',
      'applicationOrigin',
      'allowedOrigins',
      'gatewayOrigin',
      'walletOrigin',
      'consoleOrigin',
      'resources',
      'capabilities',
      'provisioning',
    ],
    sourcePath,
  );
  if (source.branch !== 'main' || source.controlPlaneLane !== 'production-mainnet') {
    throw new Error(sourcePath + ' requires main and the existing production-mainnet control plane');
  }
  const control = backendLanes[source.controlPlaneLane];
  if (control.provisioning.kind !== 'provisioned') {
    throw new Error(sourcePath + ' requires a provisioned account control plane');
  }
  // Project records and browser keys retain their original Console authority.
  const identity = requireObject(source.identity, sourcePath + '.identity');
  requireExactKeys(
    identity,
    ['organizationId', 'projectId', 'environmentId'],
    sourcePath + '.identity',
  );
  const organizationId = requirePattern(
    identity.organizationId,
    /^org_[A-Za-z0-9_-]+$/u,
    sourcePath + '.identity.organizationId',
  );
  const projectId = requirePattern(
    identity.projectId,
    /^proj_[A-Za-z0-9_-]+$/u,
    sourcePath + '.identity.projectId',
  );
  if (identity.environmentId !== `${projectId}:dev`) {
    throw new Error(
      sourcePath + '.identity.environmentId must identify this project Development environment',
    );
  }
  const applicationOrigin = requireHttpsOrigin(
    source.applicationOrigin,
    sourcePath + '.applicationOrigin',
  );
  const walletOrigin = requireHttpsOrigin(source.walletOrigin, sourcePath + '.walletOrigin');
  if (walletOrigin !== control.walletOrigin) {
    throw new Error(sourcePath + '.walletOrigin must use the existing Seams signing host');
  }
  const allowedOrigins = parseBrowserOrigins(source.allowedOrigins, sourcePath + '.allowedOrigins');
  if (!allowedOrigins.includes(applicationOrigin) || !allowedOrigins.includes(walletOrigin)) {
    throw new Error(sourcePath + '.allowedOrigins must include the application and hosted wallet');
  }
  const rawResources = structuredClone(requireObject(source.resources, sourcePath + '.resources'));
  const gateway = requireObject(rawResources.gateway, sourcePath + '.resources.gateway');
  requireExactKeys(gateway, ['workerName'], sourcePath + '.resources.gateway');
  gateway.consoleD1Name = control.console.database.name;
  const resources = parseResources(rawResources, sourcePath + '.resources');
  const capabilities = parseCapabilities(source.capabilities, sourcePath + '.capabilities');
  if (capabilities.billing.enabled) {
    throw new Error(sourcePath + ' uses the existing account billing authority');
  }
  const consoleTarget = Object.freeze({
    laneId: 'getsignal-testnet',
    environment: 'getsignal-testnet-console',
    origin: requireHttpsOrigin(source.consoleOrigin, sourcePath + '.consoleOrigin'),
    siteOrigin: control.console.siteOrigin,
    workerName: resources.gateway.workerName.replace('gateway', 'console'),
    database: control.console.database,
    emailDelivery: control.console.emailDelivery,
    platformSupportEmails: control.console.platformSupportEmails,
    placementRegion: 'aws:ap-southeast-1',
    billing: capabilities.billing,
  });
  const site = Object.freeze({
    kind: 'customer',
    id: 'getsignal',
    release: 'getsignal',
    branch: 'main',
    origin: applicationOrigin,
    walletSiteOrigin: branding.walletSiteOrigin,
    docsOrigin: branding.docsOrigin,
    googleOidcClientId: branding.googleOidcClientId,
    defaultNetwork: 'testnet',
    availableNetworks: Object.freeze(['testnet']),
  });
  const provisioning = parseProvisioning(
    source.provisioning,
    'getsignal-testnet',
    'testnet',
    sourcePath + '.provisioning',
  );
  const lane = Object.freeze({
    kind: 'customer',
    id: 'getsignal-testnet',
    release: 'getsignal',
    network: 'testnet',
    branch: 'main',
    controlPlaneLane: control.id,
    identity: Object.freeze({ organizationId, projectId, environmentId: identity.environmentId }),
    site,
    applicationOrigin,
    allowedOrigins,
    console: consoleTarget,
    gatewayOrigin: requireHttpsOrigin(source.gatewayOrigin, sourcePath + '.gatewayOrigin'),
    walletOrigin,
    emailOtpDelivery: Object.freeze({
      kind: 'email_provider',
      provider: Object.freeze({ kind: 'resend', fromAddress: 'confirm@seams.sh' }),
    }),
    resources,
    capabilities,
    provisioning,
  });
  if (provisioning.kind === 'provisioned') {
    const config = provisioning.gatewayDeploymentConfig;
    const expectedTenant = control.provisioning.gatewayDeploymentConfig.tenant;
    if (
      config.resources.consoleD1.id !== control.console.database.id ||
      config.tenant.namespace !== expectedTenant.namespace ||
      config.tenant.orgId !== organizationId ||
      config.tenant.projectId !== projectId ||
      config.tenant.environmentId !== identity.environmentId
    ) {
      throw new Error(
        sourcePath + ' must preserve the recorded account authority and exact project environment',
      );
    }
    assertLaneOrigins(lane);
    assertGatewayDeploymentConfigMatchesLane(lane);
  }
  return { lane };
}

function parseSite(value, releaseId, branch) {
  const sitePath = releaseId + '.site';
  const site = requireObject(value, sitePath);
  requireExactKeys(
    site,
    [
      'origin',
      'walletSiteOrigin',
      'googleOidcClientId',
      'defaultNetwork',
      'availableNetworks',
      'pagesProjectEnv',
      'walletSitePagesProjectEnv',
    ],
    sitePath,
  );
  const availableNetworks = parseNetworkNames(
    site.availableNetworks,
    sitePath + '.availableNetworks',
  );
  const expectedNetworks = RELEASE_NETWORKS[releaseId];
  requireExactArrayValues(availableNetworks, expectedNetworks, sitePath + '.availableNetworks');
  const defaultNetwork = requireString(site.defaultNetwork, sitePath + '.defaultNetwork');
  if (!availableNetworks.includes(defaultNetwork)) {
    throw new Error(sitePath + '.defaultNetwork must be one of ' + availableNetworks.join(', '));
  }
  const walletSiteOrigin = requireHttpsOrigin(
    site.walletSiteOrigin,
    sitePath + '.walletSiteOrigin',
  );
  return Object.freeze({
    kind: 'platform',
    id: releaseId,
    release: releaseId,
    branch,
    origin: requireHttpsOrigin(site.origin, sitePath + '.origin'),
    walletSiteOrigin,
    docsOrigin: `${walletSiteOrigin}/docs`,
    googleOidcClientId: requirePattern(
      site.googleOidcClientId,
      /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/u,
      sitePath + '.googleOidcClientId',
    ),
    defaultNetwork,
    availableNetworks: Object.freeze(availableNetworks),
    pagesProjectEnv: requireEnvironmentName(site.pagesProjectEnv, sitePath + '.pagesProjectEnv'),
    walletSitePagesProjectEnv: requireEnvironmentName(
      site.walletSitePagesProjectEnv,
      sitePath + '.walletSitePagesProjectEnv',
    ),
  });
}

function parseBackendLane(value, laneId, releaseId, network, branch, site, consoleTarget) {
  const lanePath = releaseId + '.lanes.' + network;
  const lane = requireObject(value, lanePath);
  requireExactKeys(
    lane,
    [
      'gatewayOrigin',
      'walletOrigin',
      'walletPagesProjectEnv',
      'emailOtpDelivery',
      'resources',
      'capabilities',
      'provisioning',
    ],
    lanePath,
  );
  const walletOrigin = requireHttpsOrigin(lane.walletOrigin, lanePath + '.walletOrigin');
  const parsed = Object.freeze({
    kind: 'platform',
    id: laneId,
    release: releaseId,
    network,
    branch,
    site,
    applicationOrigin: site.walletSiteOrigin,
    allowedOrigins: Object.freeze([site.origin, site.walletSiteOrigin, walletOrigin]),
    console: consoleTarget,
    gatewayOrigin: requireHttpsOrigin(lane.gatewayOrigin, lanePath + '.gatewayOrigin'),
    walletOrigin,
    walletPagesProjectEnv: requireEnvironmentName(
      lane.walletPagesProjectEnv,
      lanePath + '.walletPagesProjectEnv',
    ),
    emailOtpDelivery: parseEmailOtpDelivery(lane.emailOtpDelivery, lanePath + '.emailOtpDelivery'),
    resources: parseResources(lane.resources, lanePath + '.resources'),
    capabilities: parseCapabilities(lane.capabilities, lanePath + '.capabilities'),
    provisioning: parseProvisioning(lane.provisioning, laneId, network, lanePath + '.provisioning'),
  });
  assertLaneOrigins(parsed);
  if (parsed.provisioning.kind === 'provisioned') {
    assertGatewayDeploymentConfigMatchesLane(parsed);
  }
  if (consoleTarget) assertConsoleTargetMatchesLane(parsed, consoleTarget);
  return parsed;
}

function assertConsoleTargetMatchesLane(lane, consoleTarget) {
  const config = lane.provisioning.gatewayDeploymentConfig;
  const expectedEnvironment = {
    'staging-testnet': 'staging-console',
    'production-testnet': 'production-testnet-console',
    'production-mainnet': 'production-console',
  }[lane.id];
  if (
    consoleTarget.environment !== expectedEnvironment ||
    consoleTarget.origin !== expectedConsoleOrigin(lane) ||
    consoleTarget.siteOrigin !== lane.site.walletSiteOrigin ||
    consoleTarget.workerName !== lane.resources.gateway.workerName.replace('gateway', 'console') ||
    consoleTarget.database.name !== lane.resources.gateway.consoleD1Name ||
    consoleTarget.database.id !== config.resources.consoleD1.id ||
    consoleTarget.billing.enabled !== lane.capabilities.billing.enabled ||
    consoleTarget.billing.owner !== lane.capabilities.billing.owner ||
    consoleTarget.billing.secrets.join(',') !== lane.capabilities.billing.secrets.join(',')
  ) {
    throw new Error('Console target does not match backend lane ' + lane.id);
  }
}

function expectedConsoleOrigin(lane) {
  return lane.id === 'production-testnet'
    ? 'https://test.console.seams.sh'
    : lane.site.walletSiteOrigin;
}

function parseProvisioning(value, laneId, network, provisioningPath) {
  const provisioning = requireObject(value, provisioningPath);
  const expectedRuntimeProfile = runtimeProfileForLane(laneId, network);
  const kind = requireString(provisioning.kind, provisioningPath + '.kind');
  if (kind === 'provisioned') {
    requireExactKeys(provisioning, ['kind', 'gatewayDeploymentConfig'], provisioningPath);
    const gatewayDeploymentConfig = parseGatewayDeploymentConfig(
      JSON.stringify(provisioning.gatewayDeploymentConfig),
      laneId,
    );
    if (gatewayDeploymentConfig.runtimeProfile.kind !== expectedRuntimeProfile) {
      throw new Error(
        provisioningPath +
          '.gatewayDeploymentConfig runtime profile must be ' +
          expectedRuntimeProfile,
      );
    }
    return Object.freeze({ kind, gatewayDeploymentConfig });
  }
  if (kind === 'pending') {
    requireExactKeys(
      provisioning,
      ['kind', 'runtimeProfileKind', 'requiredValues'],
      provisioningPath,
    );
    const runtimeProfileKind = requireString(
      provisioning.runtimeProfileKind,
      provisioningPath + '.runtimeProfileKind',
    );
    if (runtimeProfileKind !== expectedRuntimeProfile) {
      throw new Error(provisioningPath + '.runtimeProfileKind must be ' + expectedRuntimeProfile);
    }
    return Object.freeze({
      kind,
      runtimeProfileKind,
      requiredValues: parseRequiredValues(
        provisioning.requiredValues,
        provisioningPath + '.requiredValues',
      ),
    });
  }
  throw new Error(provisioningPath + '.kind must be provisioned or pending');
}

function runtimeProfileForLane(laneId, network) {
  if (laneId === 'getsignal-testnet') return 'testnet_service';
  if (network === 'mainnet') return 'mainnet_service';
  return 'testnet_live_demo';
}

function assertLaneOrigins(lane) {
  if (lane.provisioning.kind !== 'provisioned') return;
  const configOrigins = lane.provisioning.gatewayDeploymentConfig.origins;
  const expectedCors = [...lane.allowedOrigins].sort();
  const actualCors = [...configOrigins.allowedCors].sort();
  if (
    configOrigins.gateway !== lane.gatewayOrigin ||
    actualCors.length !== expectedCors.length ||
    actualCors.some((origin, index) => origin !== expectedCors[index])
  ) {
    throw new Error('Gateway origins do not match backend lane ' + lane.id);
  }
}

function assertGatewayDeploymentConfigMatchesLane(lane) {
  const config = lane.provisioning.gatewayDeploymentConfig;
  const resources = lane.resources;
  if (config.runtimeProfile.emailOtpDelivery.kind !== lane.emailOtpDelivery.kind) {
    throw new Error('Gateway email OTP delivery does not match backend lane ' + lane.id);
  }
  if (config.optional.googleOidcClientId !== lane.site.googleOidcClientId) {
    throw new Error('Gateway Google OIDC client does not match frontend site ' + lane.site.id);
  }
  if (
    config.resources.workerName !== resources.gateway.workerName ||
    config.resources.consoleD1.name !== resources.gateway.consoleD1Name ||
    config.serviceNames.mpcRouter !== resources.router.workerName ||
    config.serviceNames.deriverA !== resources.deriverA.workerName ||
    config.serviceNames.deriverB !== resources.deriverB.workerName ||
    config.serviceNames.signingWorker !== resources.signingWorker.workerName
  ) {
    throw new Error('gatewayDeploymentConfig does not match backend lane ' + lane.id);
  }
}

function parseEmailOtpDelivery(value, pathName) {
  const delivery = requireObject(value, pathName);
  const kind = requireString(delivery.kind, pathName + '.kind');
  if (kind === 'demo_code_response') {
    requireExactKeys(delivery, ['kind'], pathName);
    return Object.freeze({ kind });
  }
  if (kind === 'email_provider' || kind === 'provider_and_demo_code') {
    requireExactKeys(delivery, ['kind', 'provider'], pathName);
    return Object.freeze({
      kind,
      provider: parseEmailOtpProvider(delivery.provider, pathName + '.provider'),
    });
  }
  throw new Error(
    pathName + '.kind must be demo_code_response, email_provider, or provider_and_demo_code',
  );
}

function parseEmailOtpProvider(value, pathName) {
  const provider = requireObject(value, pathName);
  const kind = requireString(provider.kind, pathName + '.kind');
  if (kind === 'resend') {
    requireExactKeys(provider, ['kind', 'fromAddress'], pathName);
    return Object.freeze({
      kind,
      fromAddress: requireEmailAddress(provider.fromAddress, pathName + '.fromAddress'),
    });
  }
  if (kind === 'amazon_ses') {
    requireExactKeys(provider, ['kind', 'region', 'fromAddress'], pathName);
    return Object.freeze({
      kind,
      region: requirePattern(
        provider.region,
        /^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/u,
        pathName + '.region',
      ),
      fromAddress: requireEmailAddress(provider.fromAddress, pathName + '.fromAddress'),
    });
  }
  throw new Error(pathName + '.kind must be resend or amazon_ses');
}

function requireEmailAddress(value, pathName) {
  return requirePattern(value, /^[^\s@]+@[^\s@]+\.[^\s@]+$/u, pathName);
}

function parseResources(value, pathName) {
  const resources = requireObject(value, pathName);
  requireExactKeys(resources, DEPLOYMENT_RESOURCE_NAMES, pathName);
  return Object.freeze({
    gateway: parseGatewayResource(resources.gateway, pathName + '.gateway'),
    router: parseWorkerResource(resources.router, pathName + '.router'),
    deriverA: parseWorkerResource(resources.deriverA, pathName + '.deriverA'),
    deriverB: parseWorkerResource(resources.deriverB, pathName + '.deriverB'),
    signingWorker: parseWorkerResource(resources.signingWorker, pathName + '.signingWorker'),
    tenantRootControlPlane: parseWorkerResource(
      resources.tenantRootControlPlane,
      pathName + '.tenantRootControlPlane',
    ),
  });
}

function parseGatewayResource(value, pathName) {
  const resource = requireObject(value, pathName);
  requireExactKeys(resource, ['workerName', 'consoleD1Name'], pathName);
  return Object.freeze({
    workerName: requireResourceName(resource.workerName, pathName + '.workerName'),
    consoleD1Name: requireResourceName(resource.consoleD1Name, pathName + '.consoleD1Name'),
  });
}

function parseWorkerResource(value, pathName) {
  const resource = requireObject(value, pathName);
  const keys = ['workerName', 'configPath', 'deploymentEnvironment'];
  if (Object.hasOwn(resource, 'placementRegion')) keys.push('placementRegion');
  if (Object.hasOwn(resource, 'd1PrimaryColo')) keys.push('d1PrimaryColo');
  requireExactKeys(resource, keys, pathName);
  return Object.freeze({
    workerName: requireResourceName(resource.workerName, pathName + '.workerName'),
    configPath: requireRelativePath(resource.configPath, pathName + '.configPath'),
    deploymentEnvironment: parseDeploymentEnvironment(
      resource.deploymentEnvironment,
      pathName + '.deploymentEnvironment',
    ),
    ...(Object.hasOwn(resource, 'placementRegion')
      ? {
          placementRegion: requirePattern(
            resource.placementRegion,
            /^(aws|gcp|azure):[a-z0-9-]+$/u,
            pathName + '.placementRegion',
          ),
        }
      : {}),
    ...(Object.hasOwn(resource, 'd1PrimaryColo')
      ? {
          d1PrimaryColo: requirePattern(
            resource.d1PrimaryColo,
            /^[A-Z0-9]{3}$/u,
            pathName + '.d1PrimaryColo',
          ),
        }
      : {}),
  });
}

function parseDeploymentEnvironment(value, pathName) {
  const environment = requireObject(value, pathName);
  const kind = requireString(environment.kind, pathName + '.kind');
  if (kind === 'default') {
    requireExactKeys(environment, ['kind'], pathName);
    return Object.freeze({ kind });
  }
  if (kind === 'named') {
    requireExactKeys(environment, ['kind', 'name'], pathName);
    return Object.freeze({
      kind,
      name: requirePattern(environment.name, /^[a-z0-9._/-]+$/u, pathName + '.name'),
    });
  }
  throw new Error(pathName + '.kind must be default or named');
}

function parseCapabilities(value, pathName) {
  const capabilities = requireObject(value, pathName);
  requireExactKeys(capabilities, CAPABILITY_NAMES, pathName);
  const parsed = {};
  const ownedSecrets = new Map();
  for (const capabilityName of CAPABILITY_NAMES) {
    const capabilityPath = pathName + '.' + capabilityName;
    const capability = requireObject(capabilities[capabilityName], capabilityPath);
    requireExactKeys(capability, ['enabled', 'owner', 'secrets'], capabilityPath);
    if (typeof capability.enabled !== 'boolean') {
      throw new Error(capabilityPath + '.enabled must be a boolean');
    }
    const owner = requireString(capability.owner, capabilityPath + '.owner');
    if (!CAPABILITY_OWNER_NAMES.has(owner)) {
      throw new Error(capabilityPath + '.owner must be console or gateway');
    }
    const secrets = parseSecretNames(capability.secrets, capabilityPath + '.secrets');
    for (const secret of secrets) {
      const previousOwner = ownedSecrets.get(secret);
      if (previousOwner !== undefined) {
        throw new Error(
          'secret ' + secret + ' has duplicate ownership: ' + previousOwner + ' and ' + owner,
        );
      }
      ownedSecrets.set(secret, owner);
    }
    parsed[capabilityName] = Object.freeze({ enabled: capability.enabled, owner, secrets });
  }
  return Object.freeze(parsed);
}

function parseSecretNames(value, pathName) {
  if (!Array.isArray(value)) throw new Error(pathName + ' must be an array');
  return Object.freeze(
    unique(
      value.map((item, index) => requireSecretName(item, pathName + '[' + index + ']')),
      pathName,
    ),
  );
}

function parseRequiredValues(value, pathName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(pathName + ' must be a non-empty array');
  }
  return Object.freeze(
    unique(
      value.map((item, index) => requireEnvironmentName(item, pathName + '[' + index + ']')),
      pathName,
    ),
  );
}

function assertUniqueSiteOrigins(sites) {
  assertUnique(
    sites.flatMap((site) => [site.origin, site.docsOrigin]),
    'frontend site and docs origins',
  );
}

function assertUniqueLaneOrigins(lanes) {
  const gatewayOrigins = lanes.map((lane) => lane.gatewayOrigin);
  const platformWalletOrigins = lanes
    .filter((lane) => lane.kind === 'platform')
    .map((lane) => lane.walletOrigin);
  assertUnique([...gatewayOrigins, ...platformWalletOrigins], 'backend lane origins');
  const walletOrigins = new Set(lanes.map((lane) => lane.walletOrigin));
  for (const origin of gatewayOrigins) {
    if (walletOrigins.has(origin)) {
      throw new Error('gateway origin ' + origin + ' must not equal a hosted wallet origin');
    }
  }
  const siteOrigins = new Set(lanes.flatMap((lane) => [lane.site.origin, lane.site.docsOrigin]));
  for (const origin of [...gatewayOrigins, ...walletOrigins]) {
    if (siteOrigins.has(origin)) {
      throw new Error('backend origin ' + origin + ' must not equal a frontend site origin');
    }
  }
}

function assertUniqueResourceNames(lanes) {
  const names = [];
  for (const lane of lanes) {
    names.push(
      lane.resources.gateway.workerName,
      lane.resources.router.workerName,
      lane.resources.deriverA.workerName,
      lane.resources.deriverB.workerName,
      lane.resources.signingWorker.workerName,
      lane.resources.tenantRootControlPlane.workerName,
    );
    if (lane.kind === 'platform') names.push(lane.resources.gateway.consoleD1Name);
  }
  for (const lane of lanes) {
    if (lane.provisioning.kind !== 'provisioned') continue;
    for (const resource of Object.values(
      lane.provisioning.gatewayDeploymentConfig.resources.regions,
    )) {
      if (resource.workerName !== lane.resources.gateway.workerName)
        names.push(resource.workerName);
      names.push(resource.workerName.replace('gateway', 'wallet-runtime'), resource.signerD1.name);
    }
  }
  assertUnique(names, 'backend resource names');
}

function regionalDatabaseIds(lane) {
  const ids = [];
  for (const resource of Object.values(
    lane.provisioning.gatewayDeploymentConfig.resources.regions,
  )) {
    if (resource.signerD1.kind === 'allocated') ids.push(resource.signerD1.id);
  }
  return ids;
}

function assertUniqueProvisionedIdentities(lanes) {
  const provisioned = lanes.filter((lane) => lane.provisioning.kind === 'provisioned');
  const accountDatabases = [];
  const accountNamespaces = [];
  for (const lane of provisioned) {
    if (lane.kind !== 'platform') continue;
    accountDatabases.push(lane.provisioning.gatewayDeploymentConfig.resources.consoleD1.id);
    accountNamespaces.push(lane.provisioning.gatewayDeploymentConfig.tenant.namespace);
  }
  assertUnique(
    [...accountDatabases, ...provisioned.flatMap(regionalDatabaseIds)],
    'backend D1 identities',
  );
  assertUnique(accountNamespaces, 'account namespaces');
  assertUnique(
    provisioned.map((lane) => lane.provisioning.gatewayDeploymentConfig.tenant.orgId),
    'tenant organizations',
  );
  assertUnique(
    provisioned.map((lane) => lane.provisioning.gatewayDeploymentConfig.tenant.projectId),
    'tenant projects',
  );
  assertUnique(
    provisioned.map((lane) => lane.provisioning.gatewayDeploymentConfig.tenant.environmentId),
    'tenant environments',
  );
  assertUnique(
    provisioned.map((lane) => lane.provisioning.gatewayDeploymentConfig.session.issuer),
    'session issuers',
  );
  assertUnique(
    provisioned.map(
      (lane) => lane.provisioning.gatewayDeploymentConfig.signingSessionSeal.currentKeyVersion,
    ),
    'signing session seal identities',
  );
  assertUnique(
    provisioned.map((lane) => lane.provisioning.gatewayDeploymentConfig.routerAb.ceremonyJwtKeyId),
    'Router ceremony identities',
  );
  assertUnique(
    provisioned.map(
      (lane) =>
        lane.provisioning.gatewayDeploymentConfig.routerAb.registrationTopology.signerSet
          .signer_set_id,
    ),
    'Router signer-set identities',
  );
}

function assertUnique(values, pathName) {
  if (new Set(values).size !== values.length) {
    throw new Error(pathName + ' must be unique across deployment lanes');
  }
}

function parseNetworkNames(value, pathName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(pathName + ' must be a non-empty array');
  }
  return value.map((item, index) => {
    const network = requireString(item, pathName + '[' + index + ']');
    if (!['testnet', 'mainnet'].includes(network)) {
      throw new Error(pathName + ' must contain only testnet or mainnet');
    }
    return network;
  });
}

function requireExactArrayValues(actual, expected, pathName) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(pathName + ' must contain exactly: ' + expected.join(', '));
  }
}

function requireExactKeys(value, keys, pathName) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(pathName + ' must contain exactly: ' + keys.join(', '));
  }
}

function requireObject(value, pathName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(pathName + ' must be an object');
  }
  return value;
}

function requireString(value, pathName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(pathName + ' must be a non-empty string');
  }
  return value.trim();
}

function requirePattern(value, pattern, pathName) {
  const string = requireString(value, pathName);
  if (!pattern.test(string)) throw new Error(pathName + ' has an invalid value');
  return string;
}

function requireHttpsOrigin(value, pathName) {
  const string = requireString(value, pathName);
  let url;
  try {
    url = new URL(string);
  } catch {
    throw new Error(pathName + ' must be an HTTPS origin');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(pathName + ' must be an HTTPS origin');
  }
  return url.origin;
}

function requireResourceName(value, pathName) {
  return requirePattern(value, /^[a-z0-9][a-z0-9-]{0,62}$/u, pathName);
}

function requireRelativePath(value, pathName) {
  const string = requireString(value, pathName);
  if (path.isAbsolute(string) || string.includes('..')) {
    throw new Error(pathName + ' must be a repository-relative path');
  }
  return string;
}

function requireEnvironmentName(value, pathName) {
  return requirePattern(value, /^[A-Z][A-Z0-9_]*$/u, pathName);
}

function requireSecretName(value, pathName) {
  return requirePattern(value, /^[A-Z][A-Z0-9_]*$/u, pathName);
}

function unique(values, pathName) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(pathName + ' must not contain duplicate values');
    seen.add(value);
    result.push(value);
  }
  return result;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
