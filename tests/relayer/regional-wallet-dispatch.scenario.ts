import { expect } from '@playwright/test';
import type { Miniflare } from 'miniflare';
import type { WalletHome } from '../../packages/wallet-console-server-ts/src/walletPlacement/home';

export async function verifyRegionalWalletDispatch(
  runtime: Miniflare,
  homes: readonly WalletHome[],
) {
  const observations = [];
  for (const home of homes) {
    const database = await runtime.getD1Database('SIGNER_DB', `gateway-${home.region}`);
    await database
      .prepare(
        'CREATE TABLE effects (ceremony_id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL, region TEXT NOT NULL)',
      )
      .run();
    await database
      .prepare(
        'CREATE TABLE continuation_effects (ceremony_id TEXT NOT NULL, operation TEXT NOT NULL, region TEXT NOT NULL)',
      )
      .run();
  }
  for (const home of homes) {
    const ingress = await runtime.getWorker(home.region === 'US' ? 'gateway-APAC' : 'gateway-US');
    const cf = registrationLocation(home);
    const request = {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-application',
        'x-seams-wallet-home': 'https://untrusted.invalid',
      },
      body: JSON.stringify({ operationId: `regional-dispatch-${home.region}` }),
      cf,
    };
    const unauthorized = await ingress.fetch('https://wallet.test/wallets/register/setup', {
      ...request,
      headers: {},
    });
    expect(unauthorized.status).toBe(401);
    const exhausted = await ingress.fetch('https://wallet.test/wallets/register/setup', {
      ...request,
      headers: { ...request.headers, 'x-seams-wallet-forwarded': '1' },
    });
    expect(exhausted.status).toBe(409);
    expect(await exhausted.json()).toMatchObject({ code: 'wallet_home_mismatch' });
    const exhaustedUnauthorized = await ingress.fetch(
      'https://wallet.test/wallets/register/setup',
      {
        ...request,
        headers: { 'x-seams-wallet-forwarded': '1' },
      },
    );
    expect(exhaustedUnauthorized.status).toBe(401);
    const discarded = await ingress.fetch('https://wallet.test/wallets/register/setup', request);
    expect(discarded.status).toBe(200);
    const first = await discarded.json();
    expect(first).toMatchObject({ ok: true, region: home.region, authenticatedAtHome: true });
    const competing = await Promise.all([
      ingress.fetch('https://wallet.test/wallets/register/setup', {
        ...request,
        cf: { continent: 'OC' },
      }),
      ingress.fetch('https://wallet.test/wallets/register/setup', {
        ...request,
        cf: { continent: 'EU' },
      }),
    ]);
    for (const response of competing) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(first);
    }
    const directContinuations = registrationContinuations(first.reservation.ceremonyId);
    for (const continuation of directContinuations) {
      const response = await ingress.fetch(`https://wallet.test${continuation.path}`, {
        ...request,
        body: JSON.stringify(continuation.body),
        cf: { continent: 'OC' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        region: home.region,
        walletId: first.reservation.walletId,
      });
    }
    const continued = await ingress.fetch('https://wallet.test/wallets/register/activate', {
      ...request,
      body: JSON.stringify({ registrationCeremonyId: first.reservation.ceremonyId }),
      cf: { continent: 'OC' },
    });
    expect(continued.status).toBe(200);
    expect(await continued.json()).toMatchObject({
      ok: true,
      region: home.region,
      walletId: first.reservation.walletId,
    });
    for (const continuation of directContinuations) {
      const response = await ingress.fetch(`https://wallet.test${continuation.path}`, {
        ...request,
        body: JSON.stringify(continuation.body),
        cf: { continent: 'EU' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ region: home.region });
    }
    observations.push({
      home,
      setup: first,
      completedAtAssignedHome: true,
      concurrentTravelReplays: 2,
      directYaoContinuationsBeforeAndAfterEstablishment: 4,
    });
  }
  const replay = {
    method: 'POST',
    headers: { Authorization: 'Bearer test-application' },
    body: JSON.stringify({ operationId: 'regional-dispatch-WEUR' }),
  };
  const wrongTarget = await runtime.getWorker('gateway-misdirected');
  const loop = await wrongTarget.fetch('https://wallet.test/wallets/register/setup', replay);
  expect(loop.status).toBe(409);
  expect(await loop.json()).toMatchObject({ code: 'wallet_home_mismatch' });
  const offline = await runtime.getWorker('gateway-unavailable');
  const unavailable = await offline.fetch('https://wallet.test/wallets/register/setup', replay);
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toMatchObject({ code: 'regional_gateway_unavailable' });
  const ingress = await runtime.getWorker('gateway-US');
  const redirect = await ingress.fetch('https://wallet.test/wallets/register/setup', {
    ...replay,
    headers: { ...replay.headers, 'x-test-response': 'redirect' },
  });
  expect(redirect.status).toBe(502);
  expect(await redirect.json()).toMatchObject({ code: 'regional_gateway_redirect_rejected' });
  const weur = observations.find(isWeurObservation);
  if (!weur) throw new Error('WEUR observation is required');
  for (const continuation of registrationContinuations(weur.setup.reservation.ceremonyId)) {
    const directRequest = { ...replay, body: JSON.stringify(continuation.body) };
    expect(
      (await wrongTarget.fetch(`https://wallet.test${continuation.path}`, directRequest)).status,
    ).toBe(409);
    expect(
      (await offline.fetch(`https://wallet.test${continuation.path}`, directRequest)).status,
    ).toBe(503);
    expect(
      (
        await ingress.fetch(`https://wallet.test${continuation.path}`, {
          ...directRequest,
          body: JSON.stringify({ registrationCeremonyId: weur.setup.reservation.ceremonyId }),
        })
      ).status,
    ).toBe(400);
  }
  for (const continuation of registrationContinuations(`wrc_${'z'.repeat(43)}`)) {
    expect(
      (
        await ingress.fetch(`https://wallet.test${continuation.path}`, {
          ...replay,
          body: JSON.stringify(continuation.body),
        })
      ).status,
    ).toBe(404);
  }
  const directory = await runtime.getD1Database('CONSOLE_DB', 'ingress-a');
  const cancelled = await directory
    .prepare(
      "SELECT ceremony_id FROM wallet_homes WHERE registration_id = 'gateway-admission-APAC' AND state = 'cancelled'",
    )
    .first<{ ceremony_id: string }>();
  if (!cancelled) throw new Error('Cancelled registration fixture is required');
  const directoryOffline = await runtime.getWorker('gateway-directory-unavailable');
  for (const continuation of registrationContinuations(cancelled.ceremony_id)) {
    const request = { ...replay, body: JSON.stringify(continuation.body) };
    expect((await ingress.fetch(`https://wallet.test${continuation.path}`, request)).status).toBe(
      404,
    );
    const outage = await directoryOffline.fetch(`https://wallet.test${continuation.path}`, request);
    expect(outage.status).toBe(503);
    expect(await outage.json()).toMatchObject({ code: 'wallet_home_unavailable' });
  }
  const physicalRows = [];
  for (const home of homes) {
    const database = await runtime.getD1Database('SIGNER_DB', `gateway-${home.region}`);
    const rows = await database.prepare('SELECT * FROM effects').all();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({ region: home.region });
    const continuations = await database.prepare('SELECT * FROM continuation_effects').all();
    expect(continuations.results).toHaveLength(4);
    for (const continuation of continuations.results) expect(continuation.region).toBe(home.region);
    physicalRows.push({ home, rows: rows.results, continuations: continuations.results });
  }
  return {
    observations,
    physicalRows,
    unavailableHomeRejected: true,
    misdirectedBindingCannotForwardAgain: true,
    redirectsRejected: true,
    directRegistrationLifecycleRouted: true,
    malformedUnknownAndCancelledDirectRegistrationRejected: true,
    directoryOutageReturns503BeforeLocalEffects: true,
    authentication: 'controlled application fixture',
    regionalCustodyExecuted: false,
  };
}

function registrationContinuations(ceremonyId: string) {
  return [
    {
      path: '/router-ab/ed25519/yao/registration/admit',
      body: { scope: { lifecycle_id: ceremonyId } },
    },
    {
      path: '/router-ab/ed25519/yao/registration/execute',
      body: { binding: { lifecycle: { lifecycle_id: ceremonyId } } },
    },
  ];
}

function isWeurObservation(observation: { home: WalletHome }): boolean {
  return observation.home.region === 'WEUR';
}

function registrationLocation(home: WalletHome): { continent: string; country: string } {
  switch (home.region) {
    case 'US':
      return { continent: 'NA', country: 'US' };
    case 'WEUR':
      return { continent: 'EU', country: 'GB' };
    case 'APAC':
      return { continent: 'AS', country: 'SG' };
    case 'OC':
      return { continent: 'OC', country: 'AU' };
  }
}
