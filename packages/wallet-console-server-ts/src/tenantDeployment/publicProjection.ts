import {
  tenantDeploymentPublicProjectionV1,
  type TenantDeploymentBindingV1,
} from '@seams-internal/wallet-console-shared/tenant-deployment';
import type { TenantDeploymentBindingReaderV1 } from './types';

export type TenantDeploymentPublicProjectionHandlerOptionsV1 = {
  readonly deploymentLane: string;
  readonly reader: TenantDeploymentBindingReaderV1;
  readonly maxAgeSeconds?: number;
};

export function tenantDeploymentPublicProjectionResponseV1(input: {
  readonly request: Request;
  readonly binding: TenantDeploymentBindingV1 | null;
  readonly maxAgeSeconds: number;
}): Response {
  if (!input.binding) {
    // Discovery must expose the unavailable state before a tenant origin policy exists.
    return Response.json(
      { ok: false, code: 'tenant_deployment_unavailable' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
      },
    );
  }
  const etag = `"${input.binding.revision}"`;
  const requestOrigin = input.request.headers.get('Origin');
  const allowedOrigin =
    requestOrigin && input.binding.browserCredential.allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : input.binding.surfaces.applicationOrigin;
  const headers = {
    'Cache-Control': `public, max-age=${input.maxAgeSeconds}, must-revalidate`,
    ETag: etag,
    'Access-Control-Allow-Origin': allowedOrigin,
    Vary: 'Origin',
  };
  if (input.request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  return Response.json(tenantDeploymentPublicProjectionV1(input.binding), { headers });
}

export function createTenantDeploymentPublicProjectionHandlerV1(
  options: TenantDeploymentPublicProjectionHandlerOptionsV1,
): (request: Request) => Promise<Response> {
  const maxAgeSeconds = options.maxAgeSeconds ?? 30;
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
    throw new Error('maxAgeSeconds must be a non-negative integer');
  }
  return async function tenantDeploymentPublicProjection(request: Request): Promise<Response> {
    const binding = await options.reader.resolveActiveBinding(options.deploymentLane);
    return tenantDeploymentPublicProjectionResponseV1({ request, binding, maxAgeSeconds });
  };
}
