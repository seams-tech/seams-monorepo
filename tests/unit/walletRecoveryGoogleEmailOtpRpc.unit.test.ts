import { expect, test } from '@playwright/test';
import {
  parseEmailOtpChallengeId,
  parseWalletRecoveryOperationId,
} from '../../packages/shared-ts/src/utils/domainIds';
import { parseRecoveryCodeReservationId } from '../../packages/shared-ts/src/wallet-recovery/recoveryCodeReservation';
import { verifyWalletRecoveryEmailOtp } from '../../packages/wallet/src/core/rpcClients/relayer/walletRecoveryGoogleEmailOtp';

function required<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error('invalid recovery RPC fixture identity');
  return result.value;
}

const RECOVERY_OPERATION_ID = required(
  parseWalletRecoveryOperationId('wallet-recovery-operation:rpc-boundary'),
);
const RESERVATION_ID = parseRecoveryCodeReservationId('recovery-reservation:rpc-boundary');
const CHALLENGE_ID = required(parseEmailOtpChallengeId('email-otp-challenge:rpc-boundary'));

function respondWith(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

function verify(fetchImpl: typeof fetch) {
  return verifyWalletRecoveryEmailOtp({
    relayUrl: 'https://relay.localhost',
    recoveryOperationId: RECOVERY_OPERATION_ID,
    reservationId: RESERVATION_ID,
    challengeId: CHALLENGE_ID,
    otpCode: '123456',
    fetchImpl,
  });
}

test('email OTP verification accepts the exact success response', async () => {
  await expect(
    verify(
      respondWith({
        ok: true,
        recoveryOperationId: RECOVERY_OPERATION_ID,
        reservationId: RESERVATION_ID,
        challengeId: CHALLENGE_ID,
      }),
    ),
  ).resolves.toEqual({
    kind: 'verified',
    recoveryOperationId: RECOVERY_OPERATION_ID,
    reservationId: RESERVATION_ID,
    challengeId: CHALLENGE_ID,
  });
});

test('email OTP verification rejects an extended success response at the boundary', async () => {
  await expect(
    verify(
      respondWith({
        ok: true,
        recoveryOperationId: RECOVERY_OPERATION_ID,
        reservationId: RESERVATION_ID,
        challengeId: CHALLENGE_ID,
        legacyRecoveryKeyIds: [],
      }),
    ),
  ).resolves.toEqual({ kind: 'transport_uncertain' });
});
