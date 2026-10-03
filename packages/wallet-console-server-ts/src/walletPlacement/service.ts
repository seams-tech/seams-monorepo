import { handleRegistrationOfferCommand } from './registrationOfferService';
import { handleIdentityCommand } from './identityService';
import { D1WalletRoutes, WalletRouteLocator } from './walletRouteLocators';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { SessionLocator, D1WalletSessionLocators } from './sessionLocators';
import type { TenantDeploymentD1ResourcesV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';
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
    readonly writer: TenantRuntimeWriterV1;
    readonly catalogJson: unknown;
    readonly admittedResources: TenantDeploymentD1ResourcesV1;
    readonly scope: WalletHomeServiceScope;
    readonly deploymentLane: string;
  },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isWalletHomeServiceRequest(request)) return null;
  if (
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/registration-offer` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/identity` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/find-route` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/publish-routes` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/find-session` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/publish-session` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/publish-exchanged-session` &&
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
    if (!catalog.matchesResources(options.admittedResources)) {
      return json({ ok: false, code: 'wallet_home_resources_unverified' }, 503);
    }
    const directory = new D1WalletHomeDirectory(options.database, catalog);
    const body = record(await request.json().catch(() => null));
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/registration-offer`) {
      return await handleRegistrationOfferCommand(
        body,
        options.database,
        options.scope,
        directory,
        options.writer,
      );
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/identity`) {
      return await handleIdentityCommand(body, options.database, options.scope);
    }
    const sessions = new D1WalletSessionLocators(options.database, options.scope, directory);
    const routes = new D1WalletRoutes(options.database, options.scope);
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/find-route`) {
      const locator = WalletRouteLocator.parse(body.locator);
      const assignment = await routes.find(locator);
      return assignment
        ? json({ ok: true, locator, assignment })
        : json({ ok: false, code: 'not_found' }, 404);
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/find-session`) {
      const locator = SessionLocator.parse(body.locator);
      const assignment = await sessions.find(locator);
      return assignment
        ? json({ ok: true, locator, assignment })
        : json({ ok: false, code: 'not_found' }, 404);
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/publish-exchanged-session`) {
      const exchange = SessionLocator.exchange(body.exchangeDigest);
      const credential = SessionLocator.credential(body.digest);
      await sessions.publishExchangedCredential({ exchange, credential, writer: options.writer });
      return json({ ok: true });
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/find-by-ceremony`) {
      const assignment = await directory.findByCeremony(
        options.scope.namespace,
        requiredString(body.ceremonyId, 'ceremonyId'),
      );
      return assignment && inScope(assignment.wallet, options.scope)
        ? json({ ok: true, assignment })
        : json({ ok: false, code: 'not_found' }, 404);
    }
    const wallet = WalletOwnershipKey.parse(body.wallet);
    if (!inScope(wallet, options.scope)) {
      throw new WalletPlacementError('scope_conflict', 'Wallet belongs to another tenant scope');
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/publish-routes`) {
      if (!Array.isArray(body.locators) || body.locators.length < 1)
        throw new WalletPlacementError('invalid_input', 'Wallet route locators are required');
      const locators = body.locators.map(WalletRouteLocator.parse);
      const published = await routes.publish(wallet, locators, options.writer);
      return published ? json({ ok: true }) : json({ ok: false, code: 'locator_conflict' }, 409);
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/publish-session`) {
      if (typeof body.expiresAtMs !== 'number')
        throw new WalletPlacementError('invalid_input', 'Session expiry is required');
      await sessions.publish({
        locator: SessionLocator.parse(body.locator),
        wallet,
        expiresAtMs: body.expiresAtMs,
        writer: options.writer,
      });
      return json({ ok: true });
    }
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
          deploymentLane: options.deploymentLane,
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
      if (error.code === 'registration_paused') status = 503;
      return json({ ok: false, code: error.code }, status);
    }
    throw error;
  }
}
