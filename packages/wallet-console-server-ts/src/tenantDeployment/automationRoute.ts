import type { TenantDeploymentProvisionerV1 } from './provisioning';

const AUTOMATION_PATH = '/internal/tenant-deployment/v1/cutover';
const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_JWKS = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const EXPECTED_AUDIENCE = 'seams-tenant-cutover';
const EXPECTED_SUBJECT = 'repo:seams-tech/seams-monorepo:environment:production-live-demo';
const EXPECTED_WORKFLOW =
  'seams-tech/seams-monorepo/.github/workflows/deploy-live-demo.yml@refs/heads/main';

type GithubOidcClaims = {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly repository: string;
  readonly ref: string;
  readonly workflow_ref: string;
  readonly exp: number;
  readonly nbf: number;
};

type JsonWebKeyWithId = JsonWebKey & { readonly kid: string };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decodeB64u(value: string): Uint8Array {
  const padded =
    value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonPart(value: string): Record<string, unknown> {
  const decoded = new TextDecoder().decode(decodeB64u(value));
  const parsed: unknown = JSON.parse(decoded);
  if (!isRecord(parsed)) throw new Error('GitHub OIDC token contains invalid JSON');
  return parsed;
}

function requiredStringClaim(claims: Record<string, unknown>, name: string): string {
  const value = claims[name];
  if (typeof value !== 'string') throw new Error(`GitHub OIDC token is missing ${name}`);
  return value;
}

function requiredNumberClaim(claims: Record<string, unknown>, name: string): number {
  const value = claims[name];
  if (typeof value !== 'number') throw new Error(`GitHub OIDC token is missing ${name}`);
  return value;
}

function parseClaims(value: Record<string, unknown>): GithubOidcClaims {
  return {
    iss: requiredStringClaim(value, 'iss'),
    aud: requiredStringClaim(value, 'aud'),
    sub: requiredStringClaim(value, 'sub'),
    repository: requiredStringClaim(value, 'repository'),
    ref: requiredStringClaim(value, 'ref'),
    workflow_ref: requiredStringClaim(value, 'workflow_ref'),
    exp: requiredNumberClaim(value, 'exp'),
    nbf: requiredNumberClaim(value, 'nbf'),
  };
}

function assertClaims(claims: GithubOidcClaims, nowSeconds: number): void {
  if (
    claims.iss !== GITHUB_OIDC_ISSUER ||
    claims.aud !== EXPECTED_AUDIENCE ||
    claims.sub !== EXPECTED_SUBJECT ||
    claims.repository !== 'seams-tech/seams-monorepo' ||
    claims.ref !== 'refs/heads/main' ||
    claims.workflow_ref !== EXPECTED_WORKFLOW ||
    claims.nbf > nowSeconds + 30 ||
    claims.exp <= nowSeconds - 30
  ) {
    throw new Error('GitHub OIDC token is outside the protected cutover scope');
  }
}

async function readGithubKey(kid: string): Promise<JsonWebKeyWithId> {
  const response = await fetch(GITHUB_OIDC_JWKS, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('GitHub OIDC keys are unavailable');
  const raw: unknown = await response.json();
  if (!isRecord(raw) || !Array.isArray(raw.keys)) throw new Error('GitHub OIDC keys are invalid');
  const key = raw.keys.find((candidate) => isRecord(candidate) && candidate.kid === kid);
  if (!isRecord(key) || typeof key.kid !== 'string')
    throw new Error('GitHub OIDC signing key was not found');
  return { ...key, kid: key.kid };
}

async function authenticate(request: Request): Promise<void> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) throw new Error('GitHub OIDC bearer token is required');
  const segments = authorization.slice(7).split('.');
  if (segments.length !== 3) throw new Error('GitHub OIDC bearer token is invalid');
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error('GitHub OIDC bearer token is invalid');
  }
  const header = decodeJsonPart(encodedHeader);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('GitHub OIDC token uses an unsupported signing algorithm');
  }
  const jwk = await readGithubKey(header.kid);
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    decodeB64u(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!verified) throw new Error('GitHub OIDC token signature is invalid');
  assertClaims(parseClaims(decodeJsonPart(encodedPayload)), Math.floor(Date.now() / 1_000));
}

async function parseRequest(request: Request): Promise<{
  readonly deploymentLane: string;
  readonly environmentId: string;
}> {
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || Object.keys(body).sort().join(',') !== 'deploymentLane,environmentId') {
    throw new Error('cutover request must contain only deploymentLane and environmentId');
  }
  if (
    typeof body.deploymentLane !== 'string' ||
    !body.deploymentLane ||
    typeof body.environmentId !== 'string' ||
    !body.environmentId
  ) {
    throw new Error('cutover request is invalid');
  }
  return { deploymentLane: body.deploymentLane, environmentId: body.environmentId };
}

export function createTenantDeploymentAutomationRouteV1(input: {
  readonly provisioner: TenantDeploymentProvisionerV1;
}): (request: Request) => Promise<Response | null> {
  return async function handleTenantDeploymentAutomation(request) {
    const url = new URL(request.url);
    if (url.pathname !== AUTOMATION_PATH) return null;
    if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
    try {
      await authenticate(request);
    } catch (error) {
      return json(
        {
          ok: false,
          code: 'unauthorized',
          message: error instanceof Error ? error.message : 'GitHub OIDC authentication failed',
        },
        401,
      );
    }
    try {
      const result = await input.provisioner.provision(await parseRequest(request));
      return json({ ok: true, result });
    } catch (error) {
      return json(
        {
          ok: false,
          code: 'tenant_deployment_cutover_failed',
          message: error instanceof Error ? error.message : 'tenant deployment cutover failed',
        },
        409,
      );
    }
  };
}
