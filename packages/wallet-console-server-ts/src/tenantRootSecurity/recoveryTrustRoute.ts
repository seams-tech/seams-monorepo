const RECOVERY_TRUST_PATH = '/console/tenant-root/security/recovery-trust';

/** Public authority metadata is authenticated by the console's HTTPS identity. */
export async function recoveryTrustResponse(
  controlPlane:
    | { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
    | undefined,
  internalServiceAuthSecret: string,
  dashboardOrigin: string,
  request: Request,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== RECOVERY_TRUST_PATH && pathname !== '/console/tenant-root/security/cli-info')
    return null;
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  if (pathname === '/console/tenant-root/security/cli-info') {
    return Response.json(
      { dashboardUrl: new URL(dashboardOrigin).origin },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  if (!controlPlane) return Response.json({ error: 'recovery_trust_unavailable' }, { status: 503 });
  const response = await controlPlane.fetch(
    'https://tenant-root-control-plane.internal/router-ab/tenant-root-control-plane/recovery/trust',
    { headers: { 'x-router-ab-internal-service-auth': internalServiceAuthSecret } },
  );
  if (!response.ok) return Response.json({ error: 'recovery_trust_unavailable' }, { status: 503 });
  return new Response(response.body, {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
