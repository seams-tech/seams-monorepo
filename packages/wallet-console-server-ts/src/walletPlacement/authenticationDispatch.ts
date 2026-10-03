import { parseWalletId } from '@seams/wallet-server/cloud-host';
import type { WalletHomeAssignment } from './home';
import type { ConsoleRegistrationHomeAdmission } from './registrationAdmission';
import { WalletRouteLocator } from './walletRouteLocators';

type AuthenticationHome =
  | { readonly kind: 'absent' }
  | { readonly kind: 'resolved'; readonly assignment: WalletHomeAssignment }
  | { readonly kind: 'rejected'; readonly response: Response };

type AuthenticationLocator =
  | { readonly kind: 'wallet'; readonly walletId: string }
  | { readonly kind: 'challenge'; readonly route: WalletRouteLocator };

export async function authenticationHome(
  request: Request,
  authority: ConsoleRegistrationHomeAdmission,
): Promise<AuthenticationHome> {
  const path = new URL(request.url).pathname;
  if (request.method !== 'POST' || !isAuthenticationRoute(path)) return { kind: 'absent' };
  const body: unknown = await request.clone().json().catch(invalidJson);
  if (path === '/auth/google/verify') {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return rejected(400, 'invalid_body');
    if (
      !('account_mode' in body) ||
      (body.account_mode !== 'login' && body.account_mode !== 'register')
    )
      return rejected(400, 'invalid_body');
    if (!('wallet_id' in body)) return { kind: 'absent' };
    if (body.account_mode !== 'login') return rejected(400, 'invalid_body');
  }
  let locator: AuthenticationLocator;
  try {
    locator = authenticationLocator(path, body);
  } catch {
    return rejected(400, 'invalid_body');
  }
  try {
    const assignment =
      locator.kind === 'wallet'
        ? await authority.findHome(locator)
        : await authority.findRoute(locator.route);
    if (!assignment || assignment.state === 'cancelled')
      return rejected(404, 'wallet_home_unavailable');
    if (
      body &&
      typeof body === 'object' &&
      'walletId' in body &&
      body.walletId !== assignment.wallet.walletId
    ) {
      return rejected(403, 'wallet_scope_mismatch');
    }
    return { kind: 'resolved', assignment };
  } catch {
    return rejected(503, 'wallet_home_unavailable');
  }
}

function authenticationLocator(path: string, body: unknown): AuthenticationLocator {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
  let wallet: unknown;
  switch (path) {
    case '/auth/google/verify':
      wallet = 'wallet_id' in body ? body.wallet_id : null;
      break;
    case '/auth/passkey/verify':
      return challengeLocator(body);
    case '/auth/passkey/options':
      wallet = 'user_id' in body ? body.user_id : null;
      break;
    case '/wallet/unlock/challenge':
    case '/wallet/unlock/verify':
      if (!('unlockBackend' in body)) throw new Error('Missing unlock backend');
      if (body.unlockBackend === 'passkey') {
        if (path === '/wallet/unlock/verify') return challengeLocator(body);
        wallet = 'userId' in body ? body.userId : null;
      } else if (body.unlockBackend === 'email_otp') {
        wallet = 'walletId' in body ? body.walletId : null;
      } else {
        throw new Error('Invalid unlock backend');
      }
      break;
    case '/wallet/email-otp/challenge':
    case '/wallet/email-otp/factor-release':
      wallet = 'walletId' in body ? body.walletId : null;
      break;
    default:
      throw new Error('Invalid authentication route');
  }
  const parsed = parseWalletId(wallet);
  if (!parsed.ok) throw new Error('Invalid wallet identity');
  return { kind: 'wallet', walletId: parsed.value };
}

function challengeLocator(body: object): AuthenticationLocator {
  return {
    kind: 'challenge',
    route: WalletRouteLocator.parse({
      kind: 'passkey_challenge',
      value: 'challengeId' in body ? body.challengeId : null,
    }),
  };
}

function isAuthenticationRoute(path: string): boolean {
  return (
    path === '/auth/google/verify' ||
    path === '/auth/passkey/options' ||
    path === '/auth/passkey/verify' ||
    path === '/wallet/unlock/challenge' ||
    path === '/wallet/unlock/verify' ||
    path === '/wallet/email-otp/challenge' ||
    path === '/wallet/email-otp/factor-release'
  );
}

function invalidJson(): null {
  return null;
}
function rejected(status: number, code: string): AuthenticationHome {
  return {
    kind: 'rejected',
    response: Response.json(
      { ok: false, code },
      { status, headers: { 'Cache-Control': 'no-store' } },
    ),
  };
}
