import {
  isPlainObject,
  parseWalletRegistrationSetupRequest,
  proposeWalletRegistrationSetup,
  unavailableRegistrationContext,
  walletRegistrationContext,
  walletRegistrationSetupRequestDigest,
  type D1DatabaseLike,
  type RouterApiProjectEnvironmentResolver,
  type RouterApiPublishableKeyAuthAdapter,
  type RouterApiPublishableKeyAuthRequest,
  type WalletRegistrationContextResult,
} from '@seams/wallet-server/cloud-host';
import { D1WalletHomeDirectory } from './d1';
import { RegistrationSetupAllocation, WalletHomeCatalog, WalletOwnershipKey } from './home';

interface RegistrationSetupOptions {
  readonly database: D1DatabaseLike;
  readonly catalog: WalletHomeCatalog;
  readonly scope: {
    readonly namespace: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly environmentId: string;
  };
  readonly environmentKey: string;
  readonly deploymentLane: string;
  readonly publishableKeyAuth: RouterApiPublishableKeyAuthAdapter;
  readonly projectEnvironments: RouterApiProjectEnvironmentResolver;
}

/** Authenticate the browser and reserve its wallet in one Console invocation. */
export async function handleRegistrationSetupRequest(
  request: Request,
  options: RegistrationSetupOptions,
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, code: 'method_not_allowed' }, { status: 405 });
  }
  const body: unknown = await request.json().catch(invalidJson);
  if (
    !isPlainObject(body) ||
    !isPlainObject(body.registration) ||
    typeof body.secret !== 'string' ||
    typeof body.origin !== 'string' ||
    typeof body.environmentId !== 'string' ||
    (body.ingressRegion !== 'US' &&
      body.ingressRegion !== 'WEUR' &&
      body.ingressRegion !== 'APAC' &&
      body.ingressRegion !== 'OC')
  ) {
    return Response.json({ ok: false, code: 'invalid_body' }, { status: 400 });
  }
  const parsed = parseWalletRegistrationSetupRequest(body.registration);
  if (!parsed.ok) return Response.json(parsed, { status: 400 });
  const context = await resolveRegistrationSetupContext(options, {
    secret: body.secret.trim(),
    origin: body.origin.trim(),
    environmentId: body.environmentId.trim(),
  });
  if (!context.ok) return Response.json(context, { status: context.status });
  const { principal, environment } = context;
  if (
    environment.projectId !== options.scope.projectId ||
    environment.key !== options.environmentKey
  ) {
    return Response.json(
      {
        ok: false,
        code: 'publishable_key_environment_mismatch',
        message: 'Registration credential cannot create a wallet in this deployment',
      },
      { status: 403 },
    );
  }
  const input = {
    request: parsed.value,
    orgId: principal.orgId,
    expectedOrigin: body.origin,
    runtimePolicyScope: {
      orgId: principal.orgId,
      projectId: environment.projectId,
      envId: environment.key,
      signingRootVersion: environment.signingRootVersion,
    },
  };
  const requestDigest = await walletRegistrationSetupRequestDigest(options.scope.namespace, input);
  const proposed = proposeWalletRegistrationSetup(input);
  const wallet = WalletOwnershipKey.parse({ ...options.scope, walletId: proposed.walletId });
  const allocation =
    parsed.value.wallet?.kind === 'provided'
      ? { allocation: 'provided' as const, wallet }
      : { allocation: 'server_allocated' as const, candidate: wallet };
  const reservation = await new D1WalletHomeDirectory(options.database, options.catalog).reserve({
    ...allocation,
    proposedHome: options.catalog.select(body.ingressRegion),
    proposedRegistrationAllocation: RegistrationSetupAllocation.parse({
      ceremonyId: proposed.ceremonyId,
      preparationId: proposed.preparationId,
      walletAuthorityId: proposed.walletAuthorityId,
      deviceId: proposed.deviceId,
      walletAuthMethodId: proposed.walletAuthMethodId,
    }),
    registrationId: parsed.value.registrationOperationId,
    deploymentLane: options.deploymentLane,
    requestDigest,
    nowMs: Date.now(),
  });
  return Response.json({ context, reservation }, { headers: { 'Cache-Control': 'no-store' } });
}

async function resolveRegistrationSetupContext(
  options: RegistrationSetupOptions,
  input: RouterApiPublishableKeyAuthRequest,
): Promise<WalletRegistrationContextResult> {
  try {
    // The admitted deployment supplies the read scope before key authentication completes.
    const [authentication, environments] = await Promise.allSettled([
      options.publishableKeyAuth.authenticate(input),
      options.projectEnvironments.listEnvironments(
        {
          orgId: options.scope.organizationId,
          projectId: options.scope.projectId,
          environmentId: options.scope.environmentId,
          actorUserId: 'runtime-scope-bootstrap',
          roles: ['system'],
        },
        { status: 'ACTIVE' },
      ),
    ]);
    if (authentication.status === 'rejected') return unavailableRegistrationContext();
    if (!authentication.value.ok) return authentication.value;
    const { principal } = authentication.value;
    if (
      principal.orgId !== options.scope.organizationId ||
      principal.environmentId !== options.scope.environmentId
    ) {
      return {
        ok: false,
        status: 403,
        code: 'publishable_key_environment_mismatch',
        message: 'Registration credential cannot create a wallet in this deployment',
      };
    }
    if (environments.status === 'rejected') return unavailableRegistrationContext();
    for (const environment of environments.value) {
      if (environment.id === options.scope.environmentId) {
        return walletRegistrationContext(input, principal, environment);
      }
    }
    return unavailableRegistrationContext();
  } catch {
    return unavailableRegistrationContext();
  }
}

function invalidJson(): null {
  return null;
}
