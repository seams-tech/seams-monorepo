import { expect, test } from '@playwright/test';
import { handleWalletRecoveryBackupAcknowledge } from '../../packages/wallet-server/src/router/transport/fetch/routes/passkeyCustody';
import {
  createRouterApiRouteDefinitions,
  findRouteDefinitionById,
} from '../../packages/wallet-server/src/router/framework/routeDefinitions';
import {
  acknowledgeWalletRecoveryBackup,
  requestWalletCustodyEmailOtpChallenge,
} from '../../packages/wallet/src/core/rpcClients/relayer/walletRecoveryRotate';

/**
 * The acknowledgement route.
 *
 * The failure worth a test is the convenient one: succeeding for a wallet
 * with no issued codes. That writes an acknowledgement covering an issuance
 * that never happened, and the user is then never asked to save the codes
 * they eventually receive — silent until the day they need to recover.
 */

const routeDefinitions = createRouterApiRouteDefinitions();
let capturedAcknowledgementRequest: { url: string; init: RequestInit } | null = null;

async function captureAcknowledgementRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  capturedAcknowledgementRequest = { url: String(input), init: init ?? {} };
  return new Response(JSON.stringify({ ok: true, issuedAtMs: 1_700 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function context(body: unknown, service: unknown) {
  return {
    routeDefinitions,
    method: 'POST',
    pathname: '/wallets/recovery/acknowledge-backup',
    request: new Request('https://relay.localhost/wallets/recovery/acknowledge-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    service,
    logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    opts: {},
  } as never;
}

test('the route is registered', () => {
  const route = findRouteDefinitionById(routeDefinitions, 'wallet_recovery_backup_acknowledge');
  expect(route?.path).toBe('/wallets/recovery/acknowledge-backup');
  expect(route?.auth.plane).toBe('public');
  expect(route?.auth.plane === 'public' ? route.auth.proof : undefined).toBeUndefined();
  expect(route?.requiredServices).toEqual(['passkeyCustody']);
});

test('the client acknowledges with the wallet id and no factor proof', async () => {
  capturedAcknowledgementRequest = null;
  const result = await acknowledgeWalletRecoveryBackup({
    relayUrl: 'https://relay.localhost',
    walletId: 'alice.testnet',
    fetchImpl: captureAcknowledgementRequest as typeof fetch,
  });

  expect(result).toEqual({
    kind: 'acknowledged',
    walletId: 'alice.testnet',
    issuedAtMs: 1_700,
  });
  expect(capturedAcknowledgementRequest?.url).toBe(
    'https://relay.localhost/wallets/recovery/acknowledge-backup',
  );
  expect(JSON.parse(String(capturedAcknowledgementRequest?.init.body))).toEqual({
    walletId: 'alice.testnet',
  });
});

test('the client rejects an acknowledgement response with unsupported fields', async () => {
  const result = await acknowledgeWalletRecoveryBackup({
    relayUrl: 'https://relay.localhost',
    walletId: 'alice.testnet',
    fetchImpl: (async () =>
      new Response(JSON.stringify({ ok: true, issuedAtMs: 1_700, recoveryKeyIds: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch,
  });

  expect(result).toEqual({
    kind: 'transport_failed',
    message: 'recovery backup acknowledgement returned an unusable payload',
  });
});

test('the Email OTP challenge client rejects unsupported response fields', async () => {
  const result = await requestWalletCustodyEmailOtpChallenge({
    relayUrl: 'https://relay.localhost',
    walletId: 'alice.testnet',
    providerSubjectId: 'provider-subject-1',
    operation: 'recovery_read',
    payload: {},
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          challengeId: 'challenge-1',
          challenge_digest: 'digest-1',
          expiresAtMs: 1_700,
          otpChannel: 'email',
          recoveryKeyIds: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch,
  });

  expect(result).toEqual({
    kind: 'transport_failed',
    message: 'Email OTP challenge failed (HTTP 200)',
  });
});

test('the Email OTP challenge client returns the exact challenge facts', async () => {
  const result = await requestWalletCustodyEmailOtpChallenge({
    relayUrl: 'https://relay.localhost',
    walletId: 'alice.testnet',
    providerSubjectId: 'provider-subject-1',
    operation: 'recovery_read',
    payload: {},
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          challengeId: 'challenge-1',
          challenge_digest: 'digest-1',
          expiresAtMs: 1_700,
          otpChannel: 'email',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch,
  });

  expect(result).toEqual({
    kind: 'ready',
    challengeId: 'challenge-1',
    challenge_digest: 'digest-1',
    expiresAtMs: 1_700,
    otpChannel: 'email',
  });
});

test('an acknowledgement echoes the issuance it covered', () => {
  return handleWalletRecoveryBackupAcknowledge(
    context(
      { walletId: 'alice.testnet' },
      {
        passkeyCustody: {
          acknowledgeRecoveryBackup: async () => ({ kind: 'acknowledged', issuedAtMs: 1_700 }),
        },
      },
    ),
  ).then(async (response) => {
    expect(response?.status).toBe(200);
    const body = await response!.json();
    // So a client can tell whether its view of "which codes" matches what the
    // server recorded.
    expect(body.issuedAtMs).toBe(1_700);
  });
});

test('a wallet with no issued codes cannot acknowledge', async () => {
  const response = await handleWalletRecoveryBackupAcknowledge(
    context(
      { walletId: 'alice.testnet' },
      {
        passkeyCustody: {
          acknowledgeRecoveryBackup: async () => ({ kind: 'no_recovery_set' }),
        },
      },
    ),
  );
  expect(response?.status).toBe(404);
  const body = await response!.json();
  expect(body.code).toBe('no_recovery_set');
});

test('a request without a wallet never reaches the service', async () => {
  let called = false;
  const response = await handleWalletRecoveryBackupAcknowledge(
    context(
      {},
      {
        passkeyCustody: {
          acknowledgeRecoveryBackup: async () => {
            called = true;
            return { kind: 'acknowledged', issuedAtMs: 1 };
          },
        },
      },
    ),
  );
  expect(response?.status).toBe(400);
  expect(called).toBe(false);
});
