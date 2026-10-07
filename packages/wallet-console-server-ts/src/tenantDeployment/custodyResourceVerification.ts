import { isPlainObject } from '@seams/wallet-server/cloud-host';
import type { WalletRegion } from '../walletPlacement/home';

export type CustodyRole = 'router' | 'deriverA' | 'deriverB' | 'signingWorker' | 'presignSessions';
export type CustodyNamespace = {
  readonly accountId: string;
  readonly namespaceId: string;
  readonly workerName: string;
  readonly deploymentId: string;
  readonly versionId: string;
  readonly className: string;
};
export type CustodyNamespaces = Readonly<Record<CustodyRole, CustodyNamespace>> & {
  readonly presignSessions: CustodyNamespace & { readonly objectNamePrefix: string };
};
export type RelocationCustodyNamespaces = {
  readonly source: CustodyNamespaces;
  readonly destination: CustodyNamespaces;
};
type ProviderRead = (accountId: string, path: string) => Promise<unknown>;
type ServingWorker = {
  readonly workerName: string;
  readonly deploymentId: string;
  readonly versionId: string;
  readonly bindings: readonly unknown[];
};

export async function verifyCustodyNamespaces(
  read: ProviderRead,
  accountId: string,
  runtimeName: string,
  runtimeVersion: string,
  gatewayName: string,
  region: WalletRegion,
): Promise<CustodyNamespaces> {
  const runtime = await readServingWorker(read, accountId, runtimeName, region);
  if (runtime.versionId !== runtimeVersion)
    throw new Error('Runtime changed during custody verification');
  const gateway = await readServingWorker(read, accountId, gatewayName, region);
  const routerName = service(runtime, 'MPC_ROUTER');
  const signingName = service(runtime, 'SIGNING_WORKER');
  if (
    service(gateway, 'MPC_ROUTER') !== routerName ||
    service(gateway, 'SIGNING_WORKER') !== signingName
  )
    throw new Error('Gateway and Runtime custody bindings differ');
  const router = await readServingWorker(read, accountId, routerName, null);
  const deriverA = await readServingWorker(read, accountId, service(runtime, 'DERIVER_A'), null);
  const deriverB = await readServingWorker(read, accountId, service(runtime, 'DERIVER_B'), null);
  const signing = await readServingWorker(read, accountId, signingName, null);
  if (
    service(router, 'DERIVER_A') !== deriverA.workerName ||
    service(router, 'DERIVER_B') !== deriverB.workerName ||
    service(router, 'SIGNING_WORKER') !== signing.workerName ||
    service(deriverA, 'DERIVER_B') !== deriverB.workerName ||
    service(deriverB, 'DERIVER_A') !== deriverA.workerName
  )
    throw new Error('Custody peer bindings differ from the regional Runtime');
  return {
    router: namespace(accountId, router, 'ROUTER_WALLET_DO', 'RouterAbRouterWalletDurableObject'),
    deriverA: namespace(
      accountId,
      deriverA,
      'DERIVER_A_WALLET_DO',
      'RouterAbDeriverAWalletDurableObject',
    ),
    deriverB: namespace(
      accountId,
      deriverB,
      'DERIVER_B_WALLET_DO',
      'RouterAbDeriverBWalletDurableObject',
    ),
    signingWorker: namespace(
      accountId,
      signing,
      'SIGNING_WORKER_WALLET_DO',
      'RouterAbSigningWorkerWalletDurableObject',
    ),
    presignSessions: {
      ...namespace(
        accountId,
        signing,
        'SIGNING_WORKER_PRESIGN_SESSION_DO',
        'RouterAbSigningWorkerPresignSessionDurableObject',
      ),
      objectNamePrefix: presignPrefix(signing),
    },
  };
}

async function readServingWorker(
  read: ProviderRead,
  accountId: string,
  workerName: string,
  region: WalletRegion | null,
): Promise<ServingWorker> {
  const path = `workers/scripts/${encodeURIComponent(workerName)}`;
  const result = await read(accountId, `${path}/deployments`);
  if (!isPlainObject(result) || !Array.isArray(result.deployments))
    throw new Error('Custody deployment is unavailable');
  const deployment: unknown = result.deployments[0];
  if (
    !isPlainObject(deployment) ||
    typeof deployment.id !== 'string' ||
    deployment.strategy !== 'percentage' ||
    !Array.isArray(deployment.versions) ||
    deployment.versions.length !== 1
  )
    throw new Error('Custody requires one serving deployment');
  const version: unknown = deployment.versions[0];
  if (
    !isPlainObject(version) ||
    typeof version.version_id !== 'string' ||
    version.percentage !== 100
  )
    throw new Error('Custody requires one fully serving version');
  const details = await read(
    accountId,
    `${path}/versions/${encodeURIComponent(version.version_id)}`,
  );
  if (
    !isPlainObject(details) ||
    details.id !== version.version_id ||
    !isPlainObject(details.resources) ||
    !Array.isArray(details.resources.bindings)
  )
    throw new Error('Custody version bindings are unavailable');
  if (region !== null) {
    const script = details.resources.script;
    const placement = isPlainObject(script) ? script.placement : null;
    const target =
      isPlainObject(placement) && Array.isArray(placement.target) ? placement.target : [];
    const entry: unknown = target[0];
    if (
      !isPlainObject(placement) ||
      placement.mode !== 'targeted' ||
      target.length !== 1 ||
      !isPlainObject(entry) ||
      entry.type !== 'region' ||
      typeof entry.region !== 'string' ||
      !placementMatches(region, entry.region)
    )
      throw new Error('Regional writer placement differs from its admitted home');
  }
  return {
    workerName,
    deploymentId: deployment.id,
    versionId: version.version_id,
    bindings: details.resources.bindings,
  };
}

function service(worker: ServingWorker, name: string): string {
  const binding = uniqueBinding(worker, name);
  if (
    binding.type !== 'service' ||
    typeof binding.service !== 'string' ||
    !binding.service ||
    binding.environment !== 'production'
  )
    throw new Error(`Invalid custody service binding: ${name}`);
  return binding.service;
}

function namespace(
  accountId: string,
  worker: ServingWorker,
  name: string,
  className: string,
): CustodyNamespace {
  const binding = uniqueBinding(worker, name);
  if (
    binding.type !== 'durable_object_namespace' ||
    binding.class_name !== className ||
    (binding.script_name !== undefined && binding.script_name !== worker.workerName) ||
    typeof binding.namespace_id !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(binding.namespace_id)
  )
    throw new Error(`Invalid custody namespace binding: ${name}`);
  return {
    accountId,
    namespaceId: binding.namespace_id,
    workerName: worker.workerName,
    deploymentId: worker.deploymentId,
    versionId: worker.versionId,
    className,
  };
}

function uniqueBinding(worker: ServingWorker, name: string): Record<string, unknown> {
  let found: Record<string, unknown> | null = null;
  for (const raw of worker.bindings) {
    if (!isPlainObject(raw) || raw.name !== name) continue;
    if (found) throw new Error(`Duplicate custody binding: ${name}`);
    found = raw;
  }
  if (!found) throw new Error(`Missing custody binding: ${name}`);
  return found;
}

function placementMatches(region: WalletRegion, target: string): boolean {
  switch (region) {
    case 'US':
      return /^aws:us-(east|west)-[12]$/u.test(target);
    case 'WEUR':
      return /^aws:eu-(west-[123]|central-[12])$/u.test(target);
    case 'APAC':
      return /^aws:ap-(east-[12]|northeast-[123]|southeast-[1357]|south-[12])$/u.test(target);
    case 'OC':
      return /^aws:ap-southeast-[246]$/u.test(target);
  }
}

function presignPrefix(worker: ServingWorker): string {
  const binding = uniqueBinding(worker, 'SIGNING_WORKER_PRESIGN_SESSION_DO_OBJECT');
  if (binding.type !== 'plain_text' || typeof binding.text !== 'string' || !binding.text)
    throw new Error('Presign object prefix is unavailable');
  return binding.text;
}

// Normalize the journal boundary once. Older admitted moves have no verified
// custody graph and cannot silently acquire one during a retry.
export function readStoredCustodyNamespaces(rawJson: unknown): RelocationCustodyNamespaces | null {
  if (typeof rawJson !== 'string') return null;
  const raw: unknown = JSON.parse(rawJson);
  if (!isPlainObject(raw) || !isPlainObject(raw.custodyNamespaces)) return null;
  return {
    source: parseNamespaces(raw.custodyNamespaces.source),
    destination: parseNamespaces(raw.custodyNamespaces.destination),
  };
}

function parseNamespaces(raw: unknown): CustodyNamespaces {
  if (!isPlainObject(raw)) throw new Error('Stored custody namespaces are invalid');
  const presign = raw.presignSessions;
  if (
    !isPlainObject(presign) ||
    typeof presign.objectNamePrefix !== 'string' ||
    !presign.objectNamePrefix
  )
    throw new Error('Stored presign object prefix is invalid');
  return {
    router: parseNamespace(raw.router, 'RouterAbRouterWalletDurableObject'),
    deriverA: parseNamespace(raw.deriverA, 'RouterAbDeriverAWalletDurableObject'),
    deriverB: parseNamespace(raw.deriverB, 'RouterAbDeriverBWalletDurableObject'),
    signingWorker: parseNamespace(raw.signingWorker, 'RouterAbSigningWorkerWalletDurableObject'),
    presignSessions: {
      ...parseNamespace(presign, 'RouterAbSigningWorkerPresignSessionDurableObject'),
      objectNamePrefix: presign.objectNamePrefix,
    },
  };
}

function parseNamespace(raw: unknown, className: string): CustodyNamespace {
  if (
    !isPlainObject(raw) ||
    raw.className !== className ||
    typeof raw.accountId !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(raw.accountId) ||
    typeof raw.namespaceId !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(raw.namespaceId) ||
    typeof raw.workerName !== 'string' ||
    !raw.workerName ||
    typeof raw.deploymentId !== 'string' ||
    !raw.deploymentId ||
    typeof raw.versionId !== 'string' ||
    !raw.versionId
  )
    throw new Error('Stored custody namespace is invalid');
  return {
    accountId: raw.accountId,
    namespaceId: raw.namespaceId,
    workerName: raw.workerName,
    deploymentId: raw.deploymentId,
    versionId: raw.versionId,
    className,
  };
}
