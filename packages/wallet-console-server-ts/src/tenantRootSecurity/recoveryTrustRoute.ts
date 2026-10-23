const RECOVERY_TRUST_PATH = '/console/tenant-root/security/recovery-trust';
const CONTROL_PLANE_TRUST_URL =
  'https://tenant-root-control-plane.internal/router-ab/tenant-root-control-plane/recovery/trust';
const WALLET_RUNTIME_TRUST_URL =
  'https://wallet-runtime.internal/internal/wallet-runtime/v1/recovery-trust';

interface TrustFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export type RecoveryTrustSource =
  | {
      kind: 'direct-control-plane';
      binding: TrustFetcher | undefined;
      internalServiceAuthSecret: string;
    }
  | {
      kind: 'wallet-runtime';
      binding: TrustFetcher;
      internalServiceAuthSecret?: never;
    };

function fetchRecoveryTrust(source: RecoveryTrustSource): Promise<Response> | null {
  switch (source.kind) {
    case 'direct-control-plane':
      if (!source.binding) return null;
      return source.binding.fetch(CONTROL_PLANE_TRUST_URL, {
        headers: { 'x-router-ab-internal-service-auth': source.internalServiceAuthSecret },
      });
    case 'wallet-runtime':
      return source.binding.fetch(WALLET_RUNTIME_TRUST_URL);
    default:
      return assertNever(source);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported recovery trust source: ${String(value)}`);
}

/** Public authority metadata is authenticated by the console's HTTPS identity. */
export async function recoveryTrustResponse(
  source: RecoveryTrustSource,
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
  const pending = fetchRecoveryTrust(source);
  if (!pending) return Response.json({ error: 'recovery_trust_unavailable' }, { status: 503 });
  const response = await pending;
  if (!response.ok) return Response.json({ error: 'recovery_trust_unavailable' }, { status: 503 });
  return new Response(response.body, {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
