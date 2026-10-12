import { operatorResourceCheckpoint } from '../../helpers/tenantDeploymentFixtures';
import { TenantDeploymentD1ResourceIdentityV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/deploymentResource';
import { TenantResourceVerificationV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import type { WalletHome } from '../../../packages/wallet-console-server-ts/src/walletPlacement/home';

export function relocationWriterVersion(databaseId: string, role: string): string {
  switch (role) {
    case 'gateway':
      return databaseId;
    // Use a different first UUID segment for the second role's test deployment.
    case 'walletRuntime':
      return databaseId.replace(/^[^-]+/u, 'eeeeeeee');
    default:
      throw new Error('Unknown fixture writer role');
  }
}

export function relocationResourceVerification(home: WalletHome, namespace: string, nowMs: number) {
  const resource = TenantDeploymentD1ResourceIdentityV1.parse({
    namespace,
    accountId: home.accountId,
    databaseId: home.databaseId,
  });
  const checkpoint = operatorResourceCheckpoint(resource, 'test', nowMs);
  const gatewayVersion = relocationWriterVersion(home.databaseId, 'gateway');
  const runtimeVersion = relocationWriterVersion(home.databaseId, 'walletRuntime');
  checkpoint.writerVersions = { gateway: gatewayVersion, walletRuntime: runtimeVersion };
  const [gateway, runtime] = checkpoint.workers;
  gateway.workerName = `gateway-${home.databaseId}`;
  gateway.versions = [{ versionId: gatewayVersion, percentage: 100, databaseId: home.databaseId }];
  runtime.workerName = `runtime-${home.databaseId}`;
  runtime.versions = [{ versionId: runtimeVersion, percentage: 100, databaseId: home.databaseId }];
  return TenantResourceVerificationV1.fromOperatorCheckpoint(checkpoint, nowMs);
}

export function relocationCustodyNamespaces(source: WalletHome, destination: WalletHome) {
  return { source: custodyNamespaces(source), destination: custodyNamespaces(destination) };
}

function custodyNamespace(home: WalletHome, role: string, className: string, namespaceId: string) {
  return { accountId: home.accountId, namespaceId, workerName: `custody-${role}`,
    deploymentId: home.databaseId, versionId: home.databaseId, className };
}

function custodyNamespaces(home: WalletHome) {
  return {
    router: custodyNamespace(home, 'router', 'RouterAbRouterWalletDurableObject', '1'.repeat(32)),
    deriverA: custodyNamespace(home, 'deriver-a', 'RouterAbDeriverAWalletDurableObject', '2'.repeat(32)),
    deriverB: custodyNamespace(home, 'deriver-b', 'RouterAbDeriverBWalletDurableObject', '3'.repeat(32)),
    signingWorker: custodyNamespace(home, 'signing-worker', 'RouterAbSigningWorkerWalletDurableObject', '4'.repeat(32)),
    presignSessions: { ...custodyNamespace(home, 'signing-worker', 'RouterAbSigningWorkerPresignSessionDurableObject', '5'.repeat(32)),
      objectNamePrefix: 'presign-session' },
  };
}

export function custodyServiceBindings() {
  return [
    { name: 'MPC_ROUTER', type: 'service', service: 'custody-router', environment: 'production' },
    { name: 'DERIVER_A', type: 'service', service: 'custody-deriver-a', environment: 'production' },
    { name: 'DERIVER_B', type: 'service', service: 'custody-deriver-b', environment: 'production' },
    { name: 'SIGNING_WORKER', type: 'service', service: 'custody-signing-worker', environment: 'production' },
  ];
}

export function custodyProviderResponse(url: string, versionId: string, deploymentId: string): unknown | null {
  const match = url.match(/\/workers\/scripts\/custody-(router|deriver-a|deriver-b|signing-worker)\/(deployments|versions\/[a-f0-9-]+)$/u);
  if (!match) return null;
  if (match[2] === 'deployments') return { deployments: [{ id: deploymentId,
    strategy: 'percentage', versions: [{ version_id: versionId, percentage: 100 }] }] };
  const bindings: unknown[] = custodyServiceBindings();
  switch (match[1]) {
    case 'router': bindings.push(custodyNamespaceBinding('ROUTER_WALLET_DO', 'RouterAbRouterWalletDurableObject', '1')); break;
    case 'deriver-a': bindings.push(custodyNamespaceBinding('DERIVER_A_WALLET_DO', 'RouterAbDeriverAWalletDurableObject', '2')); break;
    case 'deriver-b': bindings.push(custodyNamespaceBinding('DERIVER_B_WALLET_DO', 'RouterAbDeriverBWalletDurableObject', '3')); break;
    case 'signing-worker':
      bindings.push(custodyNamespaceBinding('SIGNING_WORKER_WALLET_DO', 'RouterAbSigningWorkerWalletDurableObject', '4'),
        custodyNamespaceBinding('SIGNING_WORKER_PRESIGN_SESSION_DO', 'RouterAbSigningWorkerPresignSessionDurableObject', '5'),
        { name: 'SIGNING_WORKER_PRESIGN_SESSION_DO_OBJECT', type: 'plain_text', text: 'presign-session' });
      break;
  }
  return { id: versionId, resources: { bindings } };
}

function custodyNamespaceBinding(name: string, className: string, id: string) {
  return { name, type: 'durable_object_namespace', class_name: className, namespace_id: id.repeat(32) };
}
