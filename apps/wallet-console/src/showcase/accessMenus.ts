import type {
  AuthMenuLinkDeviceState,
  AuthMenuLinkDeviceViewModel,
  AuthMenuRecoveryViewModel,
} from '@wallet-ui/SeamsWeb/walletIframe/host/auth-menu/domain';
import { parseWebAuthnRpId } from '@wallet-ui/shared-ts/src/utils/domainIds';
import { paperIframeAppearance } from '@/context/app-themes';

export const recoveryCode = '4821-7396-2058-1643';

type PasskeyTarget = Extract<AuthMenuRecoveryViewModel, { stage: 'passkey_ready' }>['target'];
function recoveryTarget(): PasskeyTarget {
  const parsed = parseWebAuthnRpId('example.com');
  if (!parsed.ok) throw new Error(parsed.error.message);
  return { kind: 'passkey', rpId: parsed.value };
}
const target = recoveryTarget();

export function linkMenu(linkDevice: AuthMenuLinkDeviceState): AuthMenuLinkDeviceViewModel {
  return {
    kind: 'link_device',
    mode: 'login',
    linkDevice,
    appearance: paperIframeAppearance(),
    hostname: 'shop.example.com',
    closeLabel: 'Back',
    heading: 'Link this device',
    subtitle: 'Scan this code with your other device to connect this one.',
    ctaLabel: 'Create passkey',
    showProgress: false,
    status: { kind: 'idle', interaction: 'actionable' },
  };
}

export function recoveryEntry(code: string, error: string | null): AuthMenuRecoveryViewModel {
  return {
    kind: 'recovery',
    mode: 'login',
    stage: 'enter_code',
    recoveryCode: code,
    recoveryCodeError: error,
    appearance: paperIframeAppearance(),
    hostname: 'shop.example.com',
    closeLabel: 'Back',
    heading: 'Recover wallet',
    subtitle: 'Use your recovery code to restore access.',
    ctaLabel: 'Recover with Passkey',
    showProgress: false,
    status: { kind: 'idle', interaction: 'actionable' },
  };
}

export function passkeyRecovery(
  stage: 'passkey_ready' | 'sign_in_ready',
  code: string,
): AuthMenuRecoveryViewModel {
  return {
    kind: 'recovery',
    mode: 'login',
    stage,
    target,
    walletId: 'alex',
    recoveryCode: code,
    recoveryCodeError: null,
    appearance: paperIframeAppearance(),
    hostname: 'shop.example.com',
    closeLabel: 'Back',
    heading: stage === 'sign_in_ready' ? 'Wallet recovered' : 'Create a new passkey',
    subtitle:
      stage === 'sign_in_ready'
        ? 'Unlock your wallet to continue.'
        : 'Secure your wallet on this device.',
    ctaLabel: 'Create new passkey',
    showProgress: false,
    status: { kind: 'idle', interaction: 'actionable' },
  };
}

export function googleRecovery(
  stage: 'google_ready' | 'sign_in_ready',
  code: string,
): AuthMenuRecoveryViewModel {
  return {
    kind: 'recovery',
    mode: 'login',
    stage,
    target: { kind: 'google_email_otp', googleProvider: 'google' },
    walletId: 'alex',
    recoveryCode: code,
    recoveryCodeError: null,
    appearance: paperIframeAppearance(),
    hostname: 'shop.example.com',
    closeLabel: 'Back',
    heading: stage === 'sign_in_ready' ? 'Wallet recovered' : 'Recover with Google',
    subtitle: 'Restore access to your wallet.',
    ctaLabel: 'Continue with Google',
    showProgress: false,
    status: { kind: 'idle', interaction: 'actionable' },
  };
}
