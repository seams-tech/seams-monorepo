import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { createD1TenantDeploymentServiceV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import { NamespaceD1HomeV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/namespaceHome';
import { isTenantDeploymentStoreError } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/service';

// Test-only transport exercises the production store in separate Worker instances.
export default {
  async fetch(request: Request, env: { CONSOLE_DB: D1DatabaseLike }): Promise<Response> {
    const store = createD1TenantDeploymentServiceV1({ database: env.CONSOLE_DB });
    const url = new URL(request.url);
    try {
      if (request.method === 'GET') {
        const assignment = await store.findNamespaceHome(url.searchParams.get('namespace') ?? '');
        return Response.json(assignment, { status: assignment ? 200 : 404 });
      }
      const home = NamespaceD1HomeV1.parse(await request.json());
      const result = await store.reserveNamespaceHome(home);
      if (url.searchParams.get('discardResponse') === '1') {
        return Response.json({ injected: 'response_lost_after_reservation' }, { status: 503 });
      }
      return Response.json(result, { status: result.ok ? 200 : 409 });
    } catch (error) {
      if (isTenantDeploymentStoreError(error)) {
        return Response.json({ code: error.code }, { status: error.statusCode });
      }
      throw error;
    }
  },
};
