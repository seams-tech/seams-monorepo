import { expect } from '@playwright/test';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantDeploymentBindingV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/types';
import { parseTenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { resolveGatewayDeployment } from '../../packages/wallet-console-server-ts/src/walletPlacement/gatewaySession';
import { D1WalletHomeDirectory } from '../../packages/wallet-console-server-ts/src/walletPlacement/d1';
import {
  WalletHomeCatalog,
  WalletOwnershipKey,
  RegistrationSetupAllocation,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import {
  D1WalletSessionLocators,
  SessionLocator,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/sessionLocators';

export function gatewaySessionCatalog(binding: TenantDeploymentBindingV1): string {
  return JSON.stringify(binding.resources.map(resourceHome));
}

function resourceHome(resource: TenantDeploymentBindingV1['resources'][number], index: number) {
  const regions = ['US', 'WEUR', 'APAC', 'OC'];
  return { ...resource, region: regions[index] };
}

class ObservedConsole {
  readonly paths: string[] = [];
  available = true;
  constructor(
    private readonly service: { fetch(url: string, init: RequestInit): Promise<Response> },
  ) {}
  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    this.paths.push(new URL(request.url).pathname);
    if (!this.available) return Promise.resolve(new Response(null, { status: 503 }));
    return this.service.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
    });
  }
}

export async function verifyGatewaySessionLookup(
  database: D1DatabaseLike,
  service: { fetch(url: string, init: RequestInit): Promise<Response> },
  binding: TenantDeploymentBindingV1,
) {
  const catalogJson = gatewaySessionCatalog(binding);
  const catalog = WalletHomeCatalog.parse(JSON.parse(catalogJson));
  const directory = new D1WalletHomeDirectory(database, catalog);
  const sessions = new D1WalletSessionLocators(database, binding.tenant, directory);
  const gateway = parseTenantRuntimeWriterV1(
    'gateway',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    binding.resources[0],
  );
  const homeWriter = parseTenantRuntimeWriterV1(
    'gateway',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    binding.resources[1],
  );
  const token = `wst_${'A'.repeat(43)}`;
  const digest = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
  ).toString('base64url');
  const wallet = WalletOwnershipKey.parse({
    ...binding.tenant,
    walletId: 'combined-lookup-wallet',
  });
  const nowMs = Date.now();
  const reservation = await directory.reserve({
    allocation: 'provided',
    wallet,
    proposedHome: catalog.select('WEUR'),
    proposedRegistrationAllocation: RegistrationSetupAllocation.parse({
      ceremonyId: `wrc_${'A'.repeat(43)}`,
      preparationId: 'regprep_combined',
      walletAuthorityId: 'wallet-authority:combined',
      deviceId: 'device:combined',
      walletAuthMethodId: 'wallet-auth-method:combined',
    }),
    registrationId: 'combined-lookup',
    requestDigest: 'a'.repeat(64),
    deploymentLane: binding.deploymentLane,
    nowMs,
  });
  expect(reservation.ok).toBe(true);
  await sessions.publish({
    locator: SessionLocator.credential(digest),
    wallet,
    expiresAtMs: nowMs + 60_000,
    writer: homeWriter,
  });
  const observed = new ObservedConsole(service);
  const timingHeaders = new Headers();
  const input = {
    binding,
    request: new Request('https://gateway.test/router-ab/ecdsa-derivation/sign/prepare', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),
    writer: gateway,
    deploymentLane: binding.deploymentLane,
    service: observed,
    catalogJson,
    timingHeaders,
  };
  const first = await resolveGatewayDeployment(input);
  expect(first.kind).toBe('ready');
  if (first.kind !== 'ready' || first.session.kind !== 'resolved')
    throw new Error('Session home was not resolved');
  expect(first.binding.revision).toBe(binding.revision);
  expect(first.session.assignment.home.region).toBe('WEUR');
  expect(first.session.assignment.wallet.matches(wallet)).toBe(true);
  expect(observed.paths).toEqual(['/internal/wallet-placement/v1/gateway-session']);
  expect(
    (timingHeaders.get('Server-Timing') ?? '').match(/wallet_console_binding_d1;/g),
  ).toHaveLength(1);

  const wrongWriter = await resolveGatewayDeployment({
    ...input,
    writer: parseTenantRuntimeWriterV1(
      'gateway',
      '99999999-9999-4999-8999-999999999999',
      gateway.resource,
    ),
  });
  expect(wrongWriter.kind).toBe('rejected');
  if (wrongWriter.kind !== 'rejected') throw new Error('Unadmitted writer was accepted');
  expect(wrongWriter.response.status).toBe(503);
  observed.available = false;
  const unavailable = await resolveGatewayDeployment(input);
  expect(unavailable.kind).toBe('rejected');
  if (unavailable.kind !== 'rejected') throw new Error('Unavailable directory was accepted');
  expect(unavailable.response.status).toBe(503);
  observed.available = true;
  // A subsequent request must observe a removed locator, even with the same token and Worker.
  await database
    .prepare('DELETE FROM wallet_session_locators WHERE digest = ?1')
    .bind(digest)
    .run();
  const removed = await resolveGatewayDeployment(input);
  expect(removed.kind).toBe('rejected');
  if (removed.kind !== 'rejected') throw new Error('Removed session locator was accepted');
  expect(removed.response.status).toBe(401);
  return {
    bindingRevision: binding.revision,
    home: first.session.assignment.home.region,
    consoleRequestsPerLookup: 1,
    deploymentReadsPerLookup: 1,
    unadmittedWriterStatus: wrongWriter.response.status,
    unavailableStatus: unavailable.response.status,
    removedLocatorStatus: removed.response.status,
  };
}
