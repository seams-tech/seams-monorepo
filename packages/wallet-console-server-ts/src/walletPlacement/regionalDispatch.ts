import type { WalletRegistrationSetupDispatcher } from '@seams/wallet-server/cloud-host';
import type { WalletHome } from './home';
import { ConsoleRegistrationHomeAdmission } from './registrationAdmission';

type RegionalGateway = { fetch(request: Request): Promise<Response> };

export type RegionalGatewayBindings = {
  readonly WALLET_GATEWAY_US: RegionalGateway;
  readonly WALLET_GATEWAY_WEUR: RegionalGateway;
  readonly WALLET_GATEWAY_APAC: RegionalGateway;
};

export class WalletRegionalDispatch {
  constructor(
    private readonly bindings: RegionalGatewayBindings,
    private readonly entry: 'ingress' | 'home',
  ) {}

  async forward(home: WalletHome, original: Request): Promise<Response> {
    if (this.entry === 'home') {
      return Response.json({ ok: false, code: 'wallet_home_mismatch' }, { status: 409 });
    }
    const headers = new Headers(original.headers);
    headers.delete('x-seams-wallet-home');
    headers.delete('x-seams-wallet-region');
    headers.delete('x-seams-wallet-forwarded');
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

export async function dispatchKnownWalletHome(
  request: Request,
  authority: ConsoleRegistrationHomeAdmission,
  transport: WalletRegionalDispatch,
): Promise<Response | null> {
  if (request.method === 'OPTIONS') return null;
  const pathname = new URL(request.url).pathname;
  let locator: { kind: 'ceremony'; ceremonyId: string } | { kind: 'wallet'; walletId: string };
  if (
    /^\/wallets\/register\/(respond|activate|near-admission|near-provisioning)$/u.test(pathname)
  ) {
    if (request.method !== 'POST') return null;
    const body: unknown = await request
      .clone()
      .json()
      .catch(() => null);
    if (
      !body ||
      typeof body !== 'object' ||
      !('registrationCeremonyId' in body) ||
      typeof body.registrationCeremonyId !== 'string' ||
      !/^wrc_[A-Za-z0-9_-]{43}$/u.test(body.registrationCeremonyId)
    ) {
      return Response.json({ ok: false, code: 'invalid_body' }, { status: 400 });
    }
    locator = { kind: 'ceremony', ceremonyId: body.registrationCeremonyId };
  } else {
    const path =
      /^\/wallets\/([^/]+)\/(custody\/credentials(?:\/label)?|custody\/envelope\/ownership|recovery\/status|signers\/.+|auth-methods\/.+|near\/implicit-account\/fund)$/u.exec(
        pathname,
      );
    if (!path) return null;
    let walletId: string;
    try {
      walletId = decodeURIComponent(path[1]);
    } catch {
      return Response.json({ ok: false, code: 'invalid_body' }, { status: 400 });
    }
    locator = { kind: 'wallet', walletId };
  }
  const assignment = await authority.findHome(locator);
  if (!assignment || assignment.state === 'cancelled') {
    return Response.json({ ok: false, code: 'wallet_home_unavailable' }, { status: 404 });
  }
  if (authority.isLocal(assignment.home)) return null;
  return transport.forward(assignment.home, request);
}
