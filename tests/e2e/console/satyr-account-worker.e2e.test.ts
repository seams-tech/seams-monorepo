import { expect, test, type TestInfo } from '@playwright/test';
import { createHash, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  PlatformScopeV1,
  ServiceTenantBindingV1,
  parseServiceProvisionReceiptV1,
  type PlatformResult,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import {
  object,
  textValue,
} from '../../../packages/console-shared-ts/src/accountPlatform/boundary';
import { billingCanonicalDigest } from '../../../packages/console-server-ts/src/billing/pricing';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const issuer = 'https://satyr-runtime.invalid';
const audience = 'https://account-runtime.invalid';
const subject = 'verified-runtime-owner';
const nativeOrganizationId = 'native-runtime-organization';

function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}

function jwt(key: KeyObject, algorithm: 'RS256' | 'EdDSA', kid: string, payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT', kid })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const content = `${header}.${body}`;
  const signature = sign(algorithm === 'RS256' ? 'RSA-SHA256' : null, Buffer.from(content), key);
  return `${content}.${signature.toString('base64url')}`;
}

class ProviderEndpoints {
  googleAvailable = true;
  googleRequests = 0;
  provisioningRequests = 0;

  constructor(
    private readonly googlePublicKey: KeyObject,
    private readonly provisionPublicKey: KeyObject,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.href === 'https://www.googleapis.com/oauth2/v3/certs') {
      this.googleRequests += 1;
      if (!this.googleAvailable) return new Response('Provider unavailable', { status: 503 });
      const key = this.googlePublicKey.export({ format: 'jwk' });
      return Response.json({
        keys: [
          { kty: key.kty, n: key.n, e: key.e, use: 'sig', alg: 'RS256', kid: 'runtime-google' },
        ],
      });
    }
    if (url.href !== `${issuer}/account-platform/v1/provision`) {
      throw new Error(`Unexpected outbound origin/path: ${url.origin}${url.pathname}`);
    }
    this.provisioningRequests += 1;
    expect(request.headers.get('Authorization')).toBe('Bearer runtime-provision-token');
    const envelope = object(await request.json(), 'provision envelope');
    const proof = textValue(envelope.ownerAssertion, 'ownerAssertion').split('.');
    expect(proof).toHaveLength(3);
    expect(
      verify(
        null,
        Buffer.from(`${proof[0]}.${proof[1]}`),
        this.provisionPublicKey,
        Buffer.from(proof[2], 'base64url'),
      ),
    ).toBe(true);
    const delivery = object(envelope.delivery, 'delivery');
    const command = object(delivery.command, 'command');
    const owner = object(envelope.owner, 'owner');
    const scope = accepted(PlatformScopeV1.parse(delivery.scope));
    const instanceId = textValue(command.instanceId, 'instanceId');
    const binding = accepted(
      ServiceTenantBindingV1.parse({
        instanceId,
        scope,
        nativeScope: { serviceId: 'satyr', deploymentId: 'satyr-runtime', nativeOrganizationId },
      }),
    );
    const receipt = accepted(
      parseServiceProvisionReceiptV1({
        version: 1,
        operationId: command.operationId,
        instanceId,
        desiredRevision: command.desiredRevision,
        result: 'active',
        binding,
      }),
    );
    return Response.json({
      kind: 'accepted',
      value: {
        kind: 'applied',
        receipt,
        owner: {
          nativePrincipalId: 'native-runtime-owner',
          platformUserId: owner.platformUserId,
          issuer: owner.issuer,
          subject: owner.subject,
          verificationReceiptId: owner.verificationReceiptId,
        },
      },
    });
  }
}

async function onboarding(
  runtime: Miniflare,
  signingKey: KeyObject,
  operation: 'identity' | 'options' | 'start',
  body: object,
  assertedSubject = subject,
) {
  const pathname = `/account-platform/v1/onboarding/${operation}`;
  const assertion = jwt(signingKey, 'EdDSA', 'runtime-user', {
    version: 1,
    purpose: 'satyr_onboarding',
    issuer,
    audience,
    nativePrincipalId: 'native-runtime-owner',
    nativeSessionId: 'native-runtime-session',
    subject: assertedSubject,
    requestDigest: await billingCanonicalDigest({ path: pathname, body }),
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
  });
  return runtime.dispatchFetch(`${audience}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Account-User-Assertion': assertion },
    body: JSON.stringify(body),
  });
}

async function readyState(
  runtime: Miniflare,
  signingKey: KeyObject,
  body: object,
): Promise<unknown> {
  const response = await onboarding(runtime, signingKey, 'start', body);
  const value: unknown = await response.json();
  return value;
}

async function verifySatyrAccountRuntime(
  { browserName: _browserName }: { browserName: string },
  testInfo: TestInfo,
): Promise<void> {
  const artifact =
    process.env.SEAMS_CONSOLE_WORKER_ARTIFACT ??
    path.join(repository, '.release-artifacts/console/payload/d1ConsoleStagingWorker.js');
  const payloadDirectory = path.dirname(artifact);
  const evidence = testInfo.outputPath('satyr-account-runtime');
  await mkdir(evidence, { recursive: true });
  const google = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const user = generateKeyPairSync('ed25519');
  const provision = generateKeyPairSync('ed25519');
  const endpoints = new ProviderEndpoints(google.publicKey, provision.publicKey);
  const runtime = new Miniflare({
    workers: [
      {
        name: 'driver',
        modules: true,
        script: `
          export default {
            fetch(request, env) {
              return env.ACCOUNT.fetch(request);
            }
          };
        `,
        compatibilityDate: '2026-07-17',
        serviceBindings: { ACCOUNT: { name: 'console', entrypoint: 'SatyrAccountPlatform' } },
      },
      {
        name: 'console',
        modules: true,
        modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }],
        scriptPath: artifact,
        modulesRoot: payloadDirectory,
        compatibilityDate: '2026-07-17',
        compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
        d1Databases: { CONSOLE_DB: 'satyr-account-runtime' },
        outboundService: endpoints.fetch.bind(endpoints),
        bindings: {
          SEAMS_TENANT_STORAGE_NAMESPACE: 'satyr-account-runtime',
          CONSOLE_BASE_URL: audience,
          CONSOLE_EMAIL_RUNTIME_PROFILE: 'DEVELOPMENT',
          CONSOLE_EMAIL_PROVIDER: 'CAPTURE',
          CONSOLE_EMAIL_INVITATION_SECRET_KEY_ID: 'runtime-email',
          CONSOLE_EMAIL_INVITATION_SECRET_KEY_B64U: Buffer.alloc(32, 7).toString('base64url'),
          SATYR_DEPLOYMENT_ID: 'satyr-runtime',
          SATYR_ACCOUNT_ASSERTION_ISSUER: issuer,
          SATYR_ACCOUNT_ASSERTION_AUDIENCE: audience,
          SATYR_ACCOUNT_USER_ASSERTION_KEY_ID: 'runtime-user',
          SATYR_ACCOUNT_USER_ASSERTION_PUBLIC_JWK_JSON: JSON.stringify(
            user.publicKey.export({ format: 'jwk' }),
          ),
          SATYR_GOOGLE_OIDC_CLIENT_ID: 'runtime-google-client',
          SATYR_SERVICE_ORIGIN: issuer,
          SATYR_PROVISION_PLACEMENT_CELL_ID: 'runtime-apac',
          SATYR_PROVISION_ENVIRONMENT: 'development',
          SATYR_PROVISION_TOKEN: 'runtime-provision-token',
          ACCOUNT_PROVISION_ASSERTION_ISSUER: audience,
          ACCOUNT_PROVISION_ASSERTION_AUDIENCE: issuer,
          ACCOUNT_PROVISION_ASSERTION_KEY_ID: 'runtime-provision',
          ACCOUNT_PROVISION_ASSERTION_PRIVATE_JWK_JSON: JSON.stringify(
            provision.privateKey.export({ format: 'jwk' }),
          ),
        },
      },
    ],
  });
  try {
    const database = await runtime.getD1Database('CONSOLE_DB', 'console');
    const migrations = path.join(
      repository,
      'packages/console-server-ts/migrations/d1-console-core',
    );
    for (const filename of (await readdir(migrations)).sort()) {
      if (!filename.endsWith('.sql')) continue;
      for (const statement of unstable_splitSqlQuery(
        await readFile(path.join(migrations, filename), 'utf8'),
      )) {
        await database.prepare(statement).run();
      }
    }
    const token = jwt(google.privateKey, 'RS256', 'runtime-google', {
      iss: 'https://accounts.google.com',
      aud: 'runtime-google-client',
      sub: subject,
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: 'owner@runtime.invalid',
      email_verified: true,
      name: 'Runtime owner',
    });
    const identityBody = { version: 1, googleIdToken: token };
    endpoints.googleAvailable = false;
    const unavailable = await onboarding(runtime, user.privateKey, 'identity', identityBody);
    expect(endpoints.googleRequests).toBeGreaterThan(0);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      kind: 'rejected',
      error: { code: 'authority_unavailable' },
    });
    endpoints.googleAvailable = true;
    const mismatch = await onboarding(
      runtime,
      user.privateKey,
      'identity',
      identityBody,
      'another-owner',
    );
    expect(mismatch.status).toBe(403);
    const identity = await onboarding(runtime, user.privateKey, 'identity', identityBody);
    expect(identity.status).toBe(200);
    expect(await identity.json()).toMatchObject({
      kind: 'accepted',
      value: { platformUserId: `google:${subject}` },
    });
    const options = await onboarding(runtime, user.privateKey, 'options', { version: 1 });
    expect(await options.json()).toEqual({ kind: 'accepted', value: { organizations: [] } });
    const start = {
      version: 1,
      operationId: 'runtime-onboarding',
      selection: {
        kind: 'new_organization',
        organizationName: 'Runtime account',
        projectName: 'Runtime project',
      },
    };
    await expect.poll(readyState.bind(null, runtime, user.privateKey, start)).toMatchObject({
      kind: 'accepted',
      value: { kind: 'ready', nativeOrganizationId },
    });
    expect(await readyState(runtime, user.privateKey, start)).toMatchObject({
      kind: 'accepted',
      value: { kind: 'ready' },
    });
    expect(endpoints.provisioningRequests).toBe(1);
    const services = await database
      .prepare('SELECT service_id, observed_state FROM platform_service_instances')
      .all();
    expect(services.results).toEqual([{ service_id: 'satyr', observed_state: 'active' }]);
    await writeFile(
      path.join(evidence, 'report.json'),
      JSON.stringify(
        {
          workerArtifact: artifact,
          workerSha256: createHash('sha256')
            .update(await readFile(artifact))
            .digest('hex'),
          compatibilityDate: '2026-07-17',
          productionEntrypoint: 'SatyrAccountPlatform',
          nativeGlobalFetchUsed: true,
          googleRequests: endpoints.googleRequests,
          provisioningRequests: endpoints.provisioningRequests,
          providerOutageIsUnavailable: true,
          mismatchedIdentityRejected: true,
          completedOnceAndReplayed: true,
          serviceStates: services.results,
        },
        null,
        2,
      ),
    );
  } finally {
    await runtime.dispose();
  }
}

test(
  'production Satyr account entrypoint verifies Google and provisions through native Worker fetch',
  verifySatyrAccountRuntime,
);
