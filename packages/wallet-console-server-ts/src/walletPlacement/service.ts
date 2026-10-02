import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { D1WalletHomeDirectory } from './d1';
import {
  RegistrationSetupAllocation,
  WalletHome,
  WalletHomeCatalog,
  WalletOwnershipKey,
  WalletPlacementError,
  type WalletRegion,
} from './home';

export const WALLET_HOME_SERVICE_ORIGIN = 'https://wallet-placement.internal';
export const WALLET_HOME_SERVICE_BASE_PATH = '/internal/wallet-placement/v1';

type WalletHomeServiceScope = {
  readonly namespace: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly environmentId: string;
};

function inScope(wallet: WalletOwnershipKey, scope: WalletHomeServiceScope): boolean {
  return (
    wallet.namespace === scope.namespace &&
    wallet.organizationId === scope.organizationId &&
    wallet.projectId === scope.projectId &&
    wallet.environmentId === scope.environmentId
  );
}

export function isWalletHomeServiceRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.origin === WALLET_HOME_SERVICE_ORIGIN &&
    url.pathname.startsWith(`${WALLET_HOME_SERVICE_BASE_PATH}/`)
  );
}

function record(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new WalletPlacementError('invalid_input', 'Wallet home request must be an object');
  }
  return raw as Record<string, unknown>;
}

function selectedRegion(raw: unknown): WalletRegion {
  if (raw !== 'US' && raw !== 'WEUR' && raw !== 'APAC') {
    throw new WalletPlacementError('invalid_input', 'Wallet home region is invalid');
  }
  return raw;
}

function requiredString(raw: unknown, name: string): string {
  if (typeof raw !== 'string') {
    throw new WalletPlacementError('invalid_input', `${name} is required`);
  }
  return raw;
}

function completionOutcome(raw: unknown): 'established' | 'cancelled' {
  if (raw !== 'established' && raw !== 'cancelled') {
    throw new WalletPlacementError('invalid_input', 'Wallet home completion outcome is invalid');
  }
  return raw;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleWalletHomeServiceRequest(
  request: Request,
  options: {
    readonly database: D1DatabaseLike;
    readonly catalogJson: unknown;
    readonly scope: WalletHomeServiceScope;
    readonly setupAllowed: boolean;
  },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isWalletHomeServiceRequest(request)) return null;
  if (
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/find` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/find-by-ceremony` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/reserve` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/complete`
  ) {
    return json({ ok: false, code: 'not_found' }, 404);
  }
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
  if (typeof options.catalogJson !== 'string' || options.catalogJson.length === 0) {
    return json({ ok: false, code: 'wallet_home_catalog_unavailable' }, 503);
  }

  try {
    const catalog = WalletHomeCatalog.parse(JSON.parse(options.catalogJson));
    const directory = new D1WalletHomeDirectory(options.database, catalog);
    const body = record(await request.json().catch(() => null));
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/find-by-ceremony`) {
      const assignment = await directory.findByCeremony(
        options.scope.namespace,
        requiredString(body.ceremonyId, 'ceremonyId'),
      );
      return assignment &&
        assignment.state !== 'cancelled' &&
        inScope(assignment.wallet, options.scope)
        ? json({ ok: true, assignment })
        : json({ ok: false, code: 'not_found' }, 404);
    }
    const wallet = WalletOwnershipKey.parse(body.wallet);
    if (!inScope(wallet, options.scope)) {
      throw new WalletPlacementError('scope_conflict', 'Wallet belongs to another tenant scope');
    }
    switch (url.pathname) {
      case `${WALLET_HOME_SERVICE_BASE_PATH}/find`: {
        const assignment = await directory.find(wallet);
        return assignment
          ? json({ ok: true, assignment })
          : json({ ok: false, code: 'not_found' }, 404);
      }
      case `${WALLET_HOME_SERVICE_BASE_PATH}/reserve`: {
        if (!options.setupAllowed) {
          return json({ ok: false, code: 'wallet_registration_paused' }, 503);
        }
        let selection:
          | { readonly allocation: 'provided'; readonly wallet: WalletOwnershipKey }
          | { readonly allocation: 'server_allocated'; readonly candidate: WalletOwnershipKey };
        switch (body.allocation) {
          case 'provided':
            selection = { allocation: 'provided', wallet };
            break;
          case 'server_allocated':
            selection = { allocation: 'server_allocated', candidate: wallet };
            break;
          default:
            throw new WalletPlacementError('invalid_input', 'Wallet allocation branch is invalid');
        }
        const outcome = await directory.reserve({
          ...selection,
          proposedHome: catalog.select(selectedRegion(body.ingressRegion)),
          proposedRegistrationAllocation: RegistrationSetupAllocation.parse(
            body.registrationAllocation,
          ),
          registrationId: requiredString(body.registrationId, 'registrationId'),
          requestDigest: requiredString(body.requestDigest, 'requestDigest'),
          nowMs: Date.now(),
        });
        return json(outcome, outcome.ok ? 200 : 409);
      }
      case `${WALLET_HOME_SERVICE_BASE_PATH}/complete`: {
        const assignment = await directory.complete({
          wallet,
          home: WalletHome.parse(body.home),
          registrationId: requiredString(body.registrationId, 'registrationId'),
          requestDigest: requiredString(body.requestDigest, 'requestDigest'),
          outcome: completionOutcome(body.outcome),
          nowMs: Date.now(),
        });
        return json({ ok: true, assignment });
      }
      default:
        return json({ ok: false, code: 'not_found' }, 404);
    }
  } catch (error) {
    if (error instanceof WalletPlacementError) {
      let status = 409;
      if (error.code === 'invalid_input') status = 400;
      if (error.code === 'scope_conflict') status = 403;
      return json({ ok: false, code: error.code }, status);
    }
    throw error;
  }
}
