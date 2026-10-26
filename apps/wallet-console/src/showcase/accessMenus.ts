import { locale, t } from '@/marketing/i18n/browser';
import type {
  AuthMenuLinkDeviceState,
  AuthMenuLinkDeviceViewModel,
  AuthMenuRecoveryViewModel,
} from '@wallet-ui/SeamsWeb/walletIframe/host/auth-menu/domain';
import { parseWebAuthnRpId } from '@wallet-ui/shared-ts/src/utils/domainIds';
import { showcaseAppearance } from './showcaseTheme';

// A sample in the real code format: 32 Crockford Base32 characters in groups of four.
export const recoveryCode = '7K2M-9QXD-4HWP-3RTN-8VBC-6JFS-2YGA-5EZK';

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
    appearance: showcaseAppearance(locale),
    hostname: 'shop.example.com',
    closeLabel: t('back'),
    heading: t('linkDevice'),
    subtitle: t('scanDevice'),
    ctaLabel: t('createPasskeyButton'),
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
    appearance: showcaseAppearance(locale),
    hostname: 'shop.example.com',
    closeLabel: t('back'),
    heading: t('recoverWalletHeading'),
    subtitle: t('useRecoveryCode'),
    ctaLabel: t('recoverPasskey'),
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
    appearance: showcaseAppearance(locale),
    hostname: 'shop.example.com',
    closeLabel: t('back'),
    heading: stage === 'sign_in_ready' ? t('walletRecovered') : t('newPasskey'),
    subtitle: stage === 'sign_in_ready' ? t('unlockContinue') : t('secureDevice'),
    ctaLabel: t('newPasskeyButton'),
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
    appearance: showcaseAppearance(locale),
    hostname: 'shop.example.com',
    closeLabel: t('back'),
    heading: stage === 'sign_in_ready' ? t('walletRecovered') : t('recoverGoogle'),
    subtitle: t('restoreAccess'),
    ctaLabel: t('continueGoogle'),
    showProgress: false,
    status: { kind: 'idle', interaction: 'actionable' },
  };
}
