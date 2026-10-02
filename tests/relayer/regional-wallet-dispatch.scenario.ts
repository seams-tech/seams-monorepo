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
  }
  for (const home of homes) {
    const ingress = await runtime.getWorker(home.region === 'US' ? 'gateway-APAC' : 'gateway-US');
    const cf = { continent: home.region === 'US' ? 'NA' : home.region === 'WEUR' ? 'EU' : 'AS' };
    const request = {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-application',
        'x-seams-wallet-home': 'https://untrusted.invalid',
        'x-seams-wallet-forwarded': 'yes',
      },
      body: JSON.stringify({ operationId: `regional-dispatch-${home.region}` }),
      cf,
    };
    const unauthorized = await ingress.fetch('https://wallet.test/wallets/register/setup', {
      ...request,
      headers: {},
    });
    expect(unauthorized.status).toBe(401);
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
    observations.push({
      home,
      setup: first,
      completedAtAssignedHome: true,
      concurrentTravelReplays: 2,
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
  const physicalRows = [];
  for (const home of homes) {
    const database = await runtime.getD1Database('SIGNER_DB', `gateway-${home.region}`);
    const rows = await database.prepare('SELECT * FROM effects').all();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({ region: home.region });
    physicalRows.push({ home, rows: rows.results });
  }
  return {
    observations,
    physicalRows,
    unavailableHomeRejected: true,
    misdirectedBindingCannotForwardAgain: true,
    redirectsRejected: true,
    authentication: 'controlled application fixture',
    regionalCustodyExecuted: false,
  };
}
