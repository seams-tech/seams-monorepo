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
  database: D1DatabaseLike,
  catalogJson: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.origin !== WALLET_HOME_SERVICE_ORIGIN) return null;
  if (!url.pathname.startsWith(`${WALLET_HOME_SERVICE_BASE_PATH}/`)) return null;
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);

  try {
    const catalog = WalletHomeCatalog.parse(JSON.parse(catalogJson));
    const directory = new D1WalletHomeDirectory(database, catalog);
    const body = record(await request.json().catch(() => null));
    const wallet = WalletOwnershipKey.parse(body.wallet);
    switch (url.pathname) {
      case `${WALLET_HOME_SERVICE_BASE_PATH}/find`: {
        const assignment = await directory.find(wallet);
        return assignment
          ? json({ ok: true, assignment })
          : json({ ok: false, code: 'not_found' }, 404);
      }
      case `${WALLET_HOME_SERVICE_BASE_PATH}/reserve`: {
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
      return json({ ok: false, code: error.code }, error.code === 'invalid_input' ? 400 : 409);
    }
    throw error;
  }
}
