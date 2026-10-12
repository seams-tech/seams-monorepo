import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  D1RegionalDeploymentAdmission,
  type RegionalDeploymentAdmission,
  type RegionalDeploymentInstaller,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/regionalAdmission';
import { TenantDeploymentD1ResourceIdentityV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/deploymentResource';

type TestRegion = 'US' | 'WEUR' | 'APAC';

export class RegionalDeploymentTestInstaller implements RegionalDeploymentInstaller {
  failActivationRegion: TestRegion | null = null;
  readonly stores: Readonly<Record<TestRegion, D1RegionalDeploymentAdmission>>;

  constructor(databases: Readonly<Record<TestRegion, D1DatabaseLike>>) {
    this.stores = {
      US: regionalStore(databases.US, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      WEUR: regionalStore(databases.WEUR, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      APAC: regionalStore(databases.APAC, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    };
  }

  async prepare(admission: RegionalDeploymentAdmission): Promise<void> {
    for (const region of ['US', 'WEUR', 'APAC'] as const) {
      await this.stores[region].prepare(admission);
    }
  }

  async activate(admission: RegionalDeploymentAdmission): Promise<void> {
    for (const region of ['US', 'WEUR', 'APAC'] as const) {
      if (region === this.failActivationRegion) {
        throw new Error('Injected regional activation outage');
      }
      await this.stores[region].activate(admission);
    }
  }
}

function regionalStore(
  database: D1DatabaseLike,
  databaseId: string,
): D1RegionalDeploymentAdmission {
  return new D1RegionalDeploymentAdmission(
    database,
    TenantDeploymentD1ResourceIdentityV1.parse({
      namespace: 'wallet',
      accountId: '0123456789abcdef0123456789abcdef',
      databaseId,
    }),
  );
}
