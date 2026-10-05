import { expect } from '@playwright/test';
import type { Miniflare } from 'miniflare';
import type { WalletHome } from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import type { WalletRelocationRequest } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import { ConsoleRegistrationHomeAdmission } from '../../packages/wallet-console-server-ts/src/walletPlacement/registrationAdmission';
import {
  dispatchKnownWalletHome,
  readRequestSessionLocator,
  WalletRegionalDispatch,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';

const credential = `Bearer wst_${'r'.repeat(43)}`;

class PlacementConsole {
  readonly paths: string[] = [];
  constructor(private readonly worker: Awaited<ReturnType<Miniflare['getWorker']>>) {}
  async fetch(request: Request): Promise<Response> {
    this.paths.push(new URL(request.url).pathname);
    expect(request.headers.has('authorization')).toBe(false);
    const response = await this.worker.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.text(),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: Object.fromEntries(response.headers),
    });
  }
}

// Authentication is outside this routing fixture. Its rejection must reach the caller.
class RejectingRegionalGateway {
  constructor(private readonly region: string) {}
  async fetch(request: Request): Promise<Response> {
    return Response.json(
      {
        region: this.region,
        credentialPreserved: request.headers.get('authorization') === credential,
        forwarded: request.headers.get('x-seams-wallet-forwarded'),
        body: request.method === 'POST' ? await request.json() : null,
      },
      { status: 401 },
    );
  }
}

export async function verifyRelocationReadRouting(
  runtime: Miniflare,
  move: WalletRelocationRequest,
  expectedHome: WalletHome,
  homes: readonly WalletHome[],
) {
  const ingress = homes.find(isUsHome);
  if (!ingress || expectedHome.region === 'US')
    throw new Error('Routing fixture needs remote home');
  const service = new PlacementConsole(await runtime.getWorker('ingress-b'));
  const authority = new ConsoleRegistrationHomeAdmission({
    service,
    writer: { role: 'gateway', versionId: ingress.databaseId, resource: ingress },
    scope: move.wallet,
    environmentKey: 'test',
    localResource: ingress,
    catalogJson: JSON.stringify(homes),
    ingressRegion: 'US',
  });
  const transport = new WalletRegionalDispatch({
    WALLET_GATEWAY_US: new RejectingRegionalGateway('US'),
    WALLET_GATEWAY_WEUR: new RejectingRegionalGateway('WEUR'),
    WALLET_GATEWAY_APAC: new RejectingRegionalGateway('APAC'),
    WALLET_GATEWAY_OC: new RejectingRegionalGateway('OC'),
  });
  const replayBody = {
    walletId: move.wallet.walletId,
    moveId: move.moveId,
    destinationRegion: move.destination.region,
    expectedGeneration: move.expectedGeneration,
    sourceProof: { kind: 'passkey', credential: {} },
  };
  const requests = [
    new Request(
      `https://gateway.test/wallet/placement/v1/relocations/${move.moveId}?walletId=${move.wallet.walletId}`,
      {
        headers: { Authorization: credential },
      },
    ),
    new Request('https://gateway.test/wallet/placement/v1/relocations', {
      method: 'POST',
      headers: { Authorization: credential },
      body: JSON.stringify(replayBody),
    }),
  ];
  for (const request of requests) {
    // This credential has no Console session locator. Move authentication owns its validity.
    const session = await readRequestSessionLocator(request);
    expect(session).toEqual({ kind: 'absent' });
    const response = await dispatchKnownWalletHome(
      request,
      authority,
      transport,
      undefined,
      session,
    );
    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({
      region: expectedHome.region,
      credentialPreserved: true,
      forwarded: '1',
      body: request.method === 'POST' ? replayBody : null,
    });
  }
  const ordinary = await readRequestSessionLocator(
    new Request('https://gateway.test/wallet/session/status', {
      headers: { Authorization: credential },
    }),
  );
  expect(ordinary.kind).toBe('locator');
  expect(service.paths).toEqual([
    '/internal/wallet-placement/v1/placement-route',
    '/internal/wallet-placement/v1/placement-route',
  ]);
  return {
    region: expectedHome.region,
    statusAndReplayReachHomeWithoutSigningLocator: true,
    ordinarySessionLookupPreserved: true,
    homeAuthenticationRejectionPreserved: true,
  };
}

function isUsHome(home: WalletHome): boolean {
  return home.region === 'US';
}
