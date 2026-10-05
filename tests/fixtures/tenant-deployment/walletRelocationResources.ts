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
