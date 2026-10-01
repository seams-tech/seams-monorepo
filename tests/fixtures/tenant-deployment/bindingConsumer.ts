import {
  resolveActiveTenantDeploymentFromServiceV1,
  type TenantDeploymentServiceBindingV1,
} from '../../../packages/wallet-console-server-ts/src/tenantDeployment/runtimeBinding';

export default {
  async fetch(
    _request: Request,
    env: { WALLET_CONSOLE: TenantDeploymentServiceBindingV1; DEPLOYMENT_LANE: string },
  ): Promise<Response> {
    const headers = new Headers();
    try {
      const binding = await resolveActiveTenantDeploymentFromServiceV1({
        deploymentLane: env.DEPLOYMENT_LANE,
        service: env.WALLET_CONSOLE,
        timingHeaders: headers,
      });
      if (!binding) return Response.json({ kind: 'unavailable' }, { status: 503, headers });
      return Response.json(
        { revision: binding.revision, namespace: binding.tenant.namespace },
        { headers },
      );
    } catch {
      return Response.json({ kind: 'rejected' }, { status: 502, headers });
    }
  },
};
