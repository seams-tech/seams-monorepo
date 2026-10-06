import { isWalletPlacementRequest, walletPlacementRequestWalletId } from './placementRouting';
import { authenticationHome } from './authenticationDispatch';
import { WalletRouteLocator } from './walletRouteLocators';
import { recoveryHome } from './recoveryDispatch';
import type { WalletRegistrationSetupDispatcher } from '@seams/wallet-server/cloud-host';
import { digestOpaqueValue, parseWalletId } from '@seams/wallet-server/cloud-host';
import { SessionLocator } from './sessionLocators';
import { WalletOwnershipKey, type WalletHomeAssignment } from './home';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantDeploymentBindingV1 } from '../tenantDeployment/types';
import type { WalletHome } from './home';
import { ConsoleRegistrationHomeAdmission } from './registrationAdmission';

type RegionalGateway = { fetch(request: Request): Promise<Response> };

export type RegionalGatewayBindings = {
  readonly WALLET_GATEWAY_US: RegionalGateway;
  readonly WALLET_GATEWAY_WEUR: RegionalGateway;
  readonly WALLET_GATEWAY_APAC: RegionalGateway;
  readonly WALLET_GATEWAY_OC: RegionalGateway;
};

export class WalletRegionalDispatch {
  constructor(private readonly bindings: RegionalGatewayBindings) {}

  async forward(home: WalletHome, original: Request): Promise<Response> {
    // This marker can only restrict forwarding. It grants no authority: the
    // destination still resolves the wallet home and authenticates the request.
    if (original.headers.has('x-seams-wallet-forwarded')) {
      return Response.json({ ok: false, code: 'wallet_home_mismatch' }, { status: 409 });
    }
    const headers = new Headers(original.headers);
    headers.delete('x-seams-wallet-home');
    headers.delete('x-seams-wallet-region');
    headers.set('x-seams-wallet-forwarded', '1');
    const request = new Request(original, { headers, redirect: 'manual' });
    try {
      const target = this.target(home);
      const response = await target.fetch(request);
      if (response.status >= 500) {
        return Response.json({ ok: false, code: 'regional_gateway_unavailable' }, { status: 503 });
      }
      if (response.status >= 300 && response.status < 400) {
        return Response.json(
          { ok: false, code: 'regional_gateway_redirect_rejected' },
          { status: 502 },
        );
      }
      return response;
    } catch {
      return Response.json({ ok: false, code: 'regional_gateway_unavailable' }, { status: 503 });
    }
  }

  private target(home: WalletHome): RegionalGateway {
    switch (home.region) {
      case 'US':
        return this.bindings.WALLET_GATEWAY_US;
      case 'WEUR':
        return this.bindings.WALLET_GATEWAY_WEUR;
      case 'APAC':
        return this.bindings.WALLET_GATEWAY_APAC;
      case 'OC':
        return this.bindings.WALLET_GATEWAY_OC;
    }
  }
}

export class ConsoleRegistrationSetupDispatcher implements WalletRegistrationSetupDispatcher {
  constructor(
    private readonly authority: ConsoleRegistrationHomeAdmission,
    private readonly transport: WalletRegionalDispatch,
    private readonly original: Request,
  ) {}

  async dispatch(input: Parameters<WalletRegistrationSetupDispatcher['dispatch']>[0]) {
    const resolved = await this.authority.resolveSetup(input);
    if (!resolved.ok) return { status: 409, body: resolved };
    if (this.authority.isLocal(resolved.assignment.home)) return null;
    const response = await this.transport.forward(resolved.assignment.home, this.original);
    const body: unknown = await response.json().catch(() => null);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 502, body: { ok: false, code: 'regional_gateway_invalid_response' } };
    }
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    for (const name of ['Server-Timing', 'Retry-After']) {
      const value = response.headers.get(name);
      if (value) headers[name] = value;
    }
    return { status: response.status, headers, body };
  }
}

export async function resolveLocalRegistrationContinuation(input: {
  readonly request: Request;
  readonly database: D1DatabaseLike;
  readonly tenant: TenantDeploymentBindingV1['tenant'];
  readonly session: SessionHomeResolution;
}): Promise<
  | { readonly kind: 'absent' }
  | { readonly kind: 'local' }
  | { readonly kind: 'rejected'; readonly response: Response }
> {
  const pathname = new URL(input.request.url).pathname;
  if (input.request.method !== 'POST' || !isRegistrationContinuation(pathname)) {
    return { kind: 'absent' };
  }
  if (input.session.kind === 'rejected') return input.session;
  const body: unknown = await input.request.clone().json().catch(invalidJsonBody);
  const ceremonyId = registrationCeremonyId(pathname, body);
  if (ceremonyId === null) {
    return {
      kind: 'rejected',
      response: Response.json({ ok: false, code: 'invalid_body' }, { status: 400 }),
    };
  }
  const tenant = input.tenant;
  const row = await input.database
    .prepare(
      `SELECT wallet_id FROM wallet_execution_generations
     WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
       AND origin = 'registration' AND origin_id = ?5`,
    )
    .bind(
      tenant.namespace,
      tenant.organizationId,
      tenant.projectId,
      tenant.environmentId,
      ceremonyId,
    )
    .first<{ readonly wallet_id: unknown }>();
  if (!row) return { kind: 'absent' };
  const wallet = WalletOwnershipKey.parse({ ...tenant, walletId: row.wallet_id });
  if (!sessionMatchesWallet(input.session, wallet)) {
    return {
      kind: 'rejected',
      response: Response.json(
        { ok: false, code: 'wallet_session_scope_mismatch' },
        { status: 403 },
      ),
    };
  }
  // Presence only selects the handler. Its admission and mutation fences still apply.
  return { kind: 'local' };
}

export async function dispatchKnownWalletHome(
  request: Request,
  authority: ConsoleRegistrationHomeAdmission,
  transport: WalletRegionalDispatch,
  googleClientId: string | undefined,
  session: SessionHomeResolution,
): Promise<Response | null> {
  if (request.method === 'OPTIONS') return null;
  if (session.kind === 'rejected') return session.response;
  if (isWalletPlacementRequest(request)) {
    let walletId: string;
    try {
      walletId = await walletPlacementRequestWalletId(request);
    } catch {
      return Response.json({ ok: false, code: 'invalid_body' }, { status: 400 });
    }
    try {
      const home = await authority.placementReadHome(walletId);
      if (!home) return Response.json({ ok: false, code: 'unauthorized' }, { status: 401 });
      return authority.isLocal(home) ? null : transport.forward(home, request);
    } catch {
      return Response.json({ ok: false, code: 'wallet_home_unavailable' }, { status: 503 });
    }
  }

  const authentication = await authenticationHome(
    request,
    authority,
    googleClientId,
    session.kind === 'local' ? session.wallet : null,
  );
  if (authentication.kind === 'local') return null;
  const scopedHome =
    authentication.kind === 'absent' ? await recoveryHome(request, authority) : authentication;
  if (scopedHome.kind === 'rejected') return scopedHome.response;
  if (scopedHome.kind === 'resolved') {
    if (
      !sessionMatchesWallet(session, scopedHome.assignment.wallet)
    ) {
      return Response.json({ ok: false, code: 'wallet_session_scope_mismatch' }, { status: 403 });
    }
    return authority.isLocal(scopedHome.assignment.home)
      ? null
      : transport.forward(scopedHome.assignment.home, request);
  }
  const pathname = new URL(request.url).pathname;
  let locator:
    | { kind: 'ceremony'; ceremonyId: string }
    | { kind: 'wallet'; walletId: string }
    | { kind: 'lifecycle'; route: WalletRouteLocator };
  const deviceSession = /^\/wallet\/device-linking\/v1\/sessions\/([^/]+)(?:\/[^/]+)*$/u.exec(
    pathname,
  );
  const createsDeviceSession =
    pathname === '/wallet/device-linking/v1/sessions' && request.method === 'POST';
  if (deviceSession || createsDeviceSession) {
    try {
      let linkSessionId: unknown;
      if (deviceSession) {
        linkSessionId = decodeURIComponent(deviceSession[1]);
      } else {
        const body: unknown = await request.clone().json();
        linkSessionId = requestField(body, ['payload', 'linkSessionId']);
      }
      locator = {
        kind: 'lifecycle',
        route: WalletRouteLocator.parse({
          kind: 'linked_device',
          value: linkSessionId,
        }),
      };
    } catch {
      return Response.json({ ok: false, code: 'invalid_body' }, { status: 400 });
    }
  } else if (isYaoContinuation(pathname)) {
    if (request.method !== 'POST') return null;
    const body: unknown = await request.clone().json().catch(invalidJsonBody);
    try {
      const isExport = pathname === '/router-ab/ed25519/yao/export/execute';
      const keys = isExport
        ? ['protocol', 'binding', 'ceremony', 'lifecycle', 'lifecycle_id']
        : ['binding', 'lifecycle', 'lifecycle_id'];
      locator = {
        kind: 'lifecycle',
        route: WalletRouteLocator.parse({
          kind: isExport ? 'yao_export' : 'yao_recovery',
          value: requestField(body, keys),
        }),
      };
    } catch {
      return Response.json({ ok: false, code: 'invalid_body' }, { status: 400 });
    }
  } else if (isWalletLifecycleEntry(pathname)) {
    if (request.method !== 'POST') return null;
    const body: unknown = await request.clone().json().catch(invalidJsonBody);
    const walletId = lifecycleEntryWalletId(pathname, body);
    if (!walletId.ok) {
      return Response.json({ ok: false, code: 'invalid_body' }, { status: 400 });
    }
    if (
      session.kind === 'local' &&
      pathname === '/router-ab/ecdsa-derivation/operation-step-up'
    ) {
      if (session.wallet.walletId !== walletId.value) {
        return Response.json({ ok: false, code: 'wallet_session_scope_mismatch' }, { status: 403 });
      }
      return null;
    }
    locator = { kind: 'wallet', walletId: walletId.value };
  } else if (isRegistrationContinuation(pathname)) {
    if (request.method !== 'POST') return null;
    const body: unknown = await request.clone().json().catch(invalidJsonBody);
    const ceremonyId = registrationCeremonyId(pathname, body);
    if (ceremonyId === null) {
      return Response.json({ ok: false, code: 'invalid_body' }, { status: 400 });
    }
    locator = { kind: 'ceremony', ceremonyId };
  } else {
    const path =
      /^\/wallets\/([^/]+)\/(custody\/credentials(?:\/label)?|custody\/envelope\/ownership|recovery\/status|signers\/.+|auth-methods\/.+|near\/implicit-account\/fund)$/u.exec(
        pathname,
      );
    if (!path) {
      if (
        session.kind === 'absent' ||
        session.kind === 'local' ||
        authority.isLocal(session.assignment.home)
      ) return null;
      return transport.forward(session.assignment.home, request);
    }
    let walletId: string;
    try {
      walletId = decodeURIComponent(path[1]);
    } catch {
      return Response.json({ ok: false, code: 'invalid_body' }, { status: 400 });
    }
    locator = { kind: 'wallet', walletId };
  }
  let assignment: WalletHomeAssignment | null;
  try {
    assignment =
      locator.kind === 'lifecycle'
        ? await authority.findRoute(locator.route)
        : await authority.findHome(locator);
  } catch {
    return Response.json({ ok: false, code: 'wallet_home_unavailable' }, { status: 503 });
  }
  if (!assignment && locator.kind === 'lifecycle' && locator.route.kind === 'linked_device') {
    if (
      session.kind === 'absent' ||
      session.kind === 'local' ||
      authority.isLocal(session.assignment.home)
    ) return null;
    return transport.forward(session.assignment.home, request);
  }
  if (!assignment || assignment.state === 'cancelled') {
    return Response.json({ ok: false, code: 'wallet_home_unavailable' }, { status: 404 });
  }
  if (!sessionMatchesWallet(session, assignment.wallet)) {
    return Response.json({ ok: false, code: 'wallet_session_scope_mismatch' }, { status: 403 });
  }
  if (authority.isLocal(assignment.home)) return null;
  return transport.forward(assignment.home, request);
}

function isYaoContinuation(pathname: string): boolean {
  return (
    pathname === '/router-ab/ed25519/yao/recovery/execute' ||
    pathname === '/router-ab/ed25519/yao/recovery/activate' ||
    pathname === '/router-ab/ed25519/yao/export/execute'
  );
}

function isWalletLifecycleEntry(pathname: string): boolean {
  return (
    pathname === '/router-ab/ed25519/yao/recovery/bootstrap' ||
    pathname === '/router-ab/ed25519/yao/recovery/admit' ||
    pathname === '/router-ab/ed25519/yao/recovery/status' ||
    pathname === '/router-ab/ed25519/yao/export/admit' ||
    pathname === '/router-ab/ecdsa-derivation/operation-step-up' ||
    pathname === '/router-ab/ecdsa-derivation/export'
  );
}

function lifecycleEntryWalletId(pathname: string, body: unknown): ReturnType<typeof parseWalletId> {
  // Only extract routing identity here. The home handler validates the full protocol and proof.
  let keys: readonly string[];
  switch (pathname) {
    case '/router-ab/ecdsa-derivation/operation-step-up':
      keys = ['operation', 'wallet_id'];
      break;
    case '/router-ab/ecdsa-derivation/export':
      keys = ['request', 'lifecycle', 'account_id'];
      break;
    case '/router-ab/ed25519/yao/recovery/bootstrap':
      keys = ['walletId'];
      break;
    case '/router-ab/ed25519/yao/recovery/status':
      keys = ['admission', 'application_binding', 'wallet_id'];
      break;
    case '/router-ab/ed25519/yao/export/admit':
      keys = ['protocol', 'application_binding', 'wallet_id'];
      break;
    case '/router-ab/ed25519/yao/recovery/admit':
      keys = ['application_binding', 'wallet_id'];
      break;
    default:
      return parseWalletId(null);
  }
  return parseWalletId(requestField(body, keys));
}

function requestField(body: unknown, keys: readonly string[]): unknown {
  let value = body;
  for (const key of keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    value = Reflect.get(value, key);
  }
  return value;
}

export type SessionHomeResolution =
  | { readonly kind: 'absent' }
  | { readonly kind: 'local'; readonly wallet: WalletOwnershipKey }
  | { readonly kind: 'resolved'; readonly assignment: WalletHomeAssignment }
  | { readonly kind: 'rejected'; readonly response: Response };

function sessionMatchesWallet(
  session: Exclude<SessionHomeResolution, { kind: 'rejected' }>,
  wallet: WalletOwnershipKey,
): boolean {
  switch (session.kind) {
    case 'absent':
      return true;
    case 'local':
      return session.wallet.matches(wallet);
    case 'resolved':
      return session.assignment.wallet.matches(wallet);
  }
}

type RequestSessionLocator =
  | { readonly kind: 'absent' }
  | { readonly kind: 'locator'; readonly locator: SessionLocator }
  | { readonly kind: 'rejected'; readonly response: Response };

export async function readRequestSessionLocator(request: Request): Promise<RequestSessionLocator> {
  if (request.method === 'OPTIONS') return { kind: 'absent' };
  // Move-only credentials deliberately outlive signing sessions. Authentication
  // belongs to the relocation handler at the journal-selected home.
  if (isWalletPlacementRequest(request)) return { kind: 'absent' };

  const pathname = new URL(request.url).pathname;
  let locator: SessionLocator;
  if (request.method === 'POST' && pathname === '/wallet/session/exchange/redeem') {
    const body: unknown = await request
      .clone()
      .json()
      .catch(() => null);
    if (
      !body ||
      typeof body !== 'object' ||
      !('exchangeCode' in body) ||
      typeof body.exchangeCode !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(body.exchangeCode)
    ) {
      return rejectedSessionHome(400, 'invalid_body');
    }
    locator = SessionLocator.parse({
      kind: 'exchange',
      digest: await digestOpaqueValue(body.exchangeCode),
    });
  } else {
    const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/iu)?.[1];
    if (!token || (!token.startsWith('wst_') && !token.startsWith('wsh_')))
      return { kind: 'absent' };
    if (!/^ws[th]_[A-Za-z0-9_-]{43}$/u.test(token)) return rejectedSessionHome(401, 'unauthorized');
    locator = SessionLocator.parse({ kind: 'credential', digest: await digestOpaqueValue(token) });
  }
  return { kind: 'locator', locator };
}

function rejectedSessionHome(
  status: number,
  code: string,
): Extract<SessionHomeResolution, { kind: 'rejected' }> {
  return {
    kind: 'rejected',
    response: Response.json(
      { ok: false, authenticated: false, code },
      {
        status,
        headers: { 'Cache-Control': 'no-store' },
      },
    ),
  };
}

function isRegistrationContinuation(pathname: string): boolean {
  return (
    /^\/wallets\/register\/(respond|activate|near-admission|near-provisioning)$/u.test(pathname) ||
    pathname === '/router-ab/ed25519/yao/registration/admit' ||
    pathname === '/router-ab/ed25519/yao/registration/execute'
  );
}

function registrationCeremonyId(pathname: string, body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  let candidate: unknown;
  switch (pathname) {
    case '/router-ab/ed25519/yao/registration/admit': {
      if (!('scope' in body) || !body.scope || typeof body.scope !== 'object') return null;
      if (!('lifecycle_id' in body.scope)) return null;
      candidate = body.scope.lifecycle_id;
      break;
    }
    case '/router-ab/ed25519/yao/registration/execute': {
      if (!('binding' in body) || !body.binding || typeof body.binding !== 'object') return null;
      if (!('lifecycle' in body.binding)) return null;
      const lifecycle = body.binding.lifecycle;
      if (!lifecycle || typeof lifecycle !== 'object' || !('lifecycle_id' in lifecycle))
        return null;
      candidate = lifecycle.lifecycle_id;
      break;
    }
    default:
      if (!('registrationCeremonyId' in body)) return null;
      candidate = body.registrationCeremonyId;
  }
  // This selects the home only; the receiving handler verifies the complete request and proof.
  return typeof candidate === 'string' && /^wrc_[A-Za-z0-9_-]{43}$/u.test(candidate)
    ? candidate
    : null;
}

function invalidJsonBody(): null {
  return null;
}
