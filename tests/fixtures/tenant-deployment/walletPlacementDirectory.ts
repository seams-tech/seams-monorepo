import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { parseTenantRuntimeWriterV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import type { WalletHomeCatalog } from '../../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { handleWalletHomeServiceRequest } from '../../../packages/wallet-console-server-ts/src/walletPlacement/service';

// Require the same writer headers as the Console entrypoint. No default writer.
export class StrictPlacementDirectory {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly catalog: WalletHomeCatalog,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const writer = parseTenantRuntimeWriterV1(
      request.headers.get('x-seams-writer-role'),
      request.headers.get('x-seams-writer-version'),
      {
        accountId: request.headers.get('x-seams-writer-account'),
        databaseId: request.headers.get('x-seams-writer-database'),
      },
    );
    const response = await handleWalletHomeServiceRequest(request, {
      database: this.database,
      writer,
      catalogJson: JSON.stringify([
        this.catalog.select('US'),
        this.catalog.select('WEUR'),
        this.catalog.select('APAC'),
        this.catalog.select('OC'),
      ]),
      admittedResources: this.catalog.deploymentResources(),
      scope: {
        namespace: 'shared',
        organizationId: 'owner',
        projectId: 'project',
        environmentId: 'test',
      },
      environmentKey: 'test',
      deploymentLane: 'test',
    });
    return response ?? new Response(null, { status: 404 });
  }
}
