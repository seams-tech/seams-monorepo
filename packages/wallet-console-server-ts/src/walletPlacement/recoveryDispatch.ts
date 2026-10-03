import {
  base64UrlDecode,
  deriveRecoveryCodeLocatorV1FromBytes,
  parseWalletId,
} from '@seams/wallet-server/cloud-host';
import type { ConsoleRegistrationHomeAdmission } from './registrationAdmission';
import { RecoveryLocator } from './recoveryLocators';
import type { WalletHomeAssignment } from './home';

type RecoveryHomeResolution =
  | { readonly kind: 'absent' }
  | { readonly kind: 'resolved'; readonly assignment: WalletHomeAssignment }
  | { readonly kind: 'rejected'; readonly response: Response };

export async function recoveryHome(
  request: Request,
  authority: ConsoleRegistrationHomeAdmission,
): Promise<RecoveryHomeResolution> {
  const path = new URL(request.url).pathname;
  if (request.method !== 'POST' || !isRecoveryRoute(path)) return { kind: 'absent' };
  const body: unknown = await request.clone().json().catch(invalidJsonBody);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return rejectedRecovery(400, 'invalid_request');
  if (isRecoveryAdministration(path)) {
    const walletId = parseWalletId('walletId' in body ? body.walletId : null);
    if (!walletId.ok) return rejectedRecovery(400, 'invalid_request');
    try {
      const assignment = await authority.findHome({ kind: 'wallet', walletId: walletId.value });
      if (!assignment || assignment.state === 'cancelled') return refusedRecoveryCode();
      return { kind: 'resolved', assignment };
    } catch {
      return rejectedRecovery(503, 'wallet_home_unavailable');
    }
  }
  let locator: RecoveryLocator;
  if (path === '/wallets/recovery/prepare') {
    if (!('recoveryCodeB64u' in body) || typeof body.recoveryCodeB64u !== 'string')
      return rejectedRecovery(400, 'invalid_request');
    let bytes: Uint8Array | null = null;
    try {
      bytes = base64UrlDecode(body.recoveryCodeB64u);
      locator = RecoveryLocator.parse({
        kind: 'code',
        value: await deriveRecoveryCodeLocatorV1FromBytes(bytes),
      });
    } catch {
      return refusedRecoveryCode();
    } finally {
      bytes?.fill(0);
    }
  } else {
    if (!('recoveryOperationId' in body)) return rejectedRecovery(400, 'invalid_request');
    try {
      locator = RecoveryLocator.parse({ kind: 'operation', value: body.recoveryOperationId });
    } catch {
      return rejectedRecovery(400, 'invalid_request');
    }
  }
  try {
    const assignment = await authority.findRecovery(locator);
    if (!assignment || assignment.state === 'cancelled') return refusedRecoveryCode();
    if ('walletId' in body && body.walletId !== assignment.wallet.walletId)
      return refusedRecoveryCode();
    return { kind: 'resolved', assignment };
  } catch {
    return rejectedRecovery(503, 'wallet_home_unavailable');
  }
}

function isRecoveryRoute(path: string): boolean {
  return (
    isRecoveryAdministration(path) ||
    path === '/wallets/recovery/prepare' ||
    path === '/wallets/recovery/finalize' ||
    path === '/wallets/recovery/google/verify' ||
    path === '/wallets/recovery/email-otp/verify' ||
    path === '/wallets/recovery/email-otp/release' ||
    path === '/wallets/recovery/google-email-otp/finalize'
  );
}

function refusedRecoveryCode(): RecoveryHomeResolution {
  return {
    kind: 'rejected',
    response: Response.json(
      { ok: false, code: 'recovery_code_rejected', message: 'that recovery code cannot be used' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    ),
  };
}

function rejectedRecovery(status: number, code: string): RecoveryHomeResolution {
  return {
    kind: 'rejected',
    response: Response.json(
      { ok: false, code },
      { status, headers: { 'Cache-Control': 'no-store' } },
    ),
  };
}

function invalidJsonBody(): null {
  return null;
}

function isRecoveryAdministration(path: string): boolean {
  return (
    path === '/wallets/recovery/read' ||
    path === '/wallets/recovery/rotate' ||
    path === '/wallets/recovery/acknowledge-backup'
  );
}
