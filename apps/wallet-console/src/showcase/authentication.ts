import '@wallet-ui/sdk/wallet-ui.css';
import './showcase.css';
import './authentication.css';
import { schedulePlayback } from './playbackClock';
import {
  mountAuthMenuSurface,
  type AuthMenuSurfaceHandle,
} from '@wallet-ui/SeamsWeb/walletIframe/host/ui/auth-menu/mountAuthMenuSurface';
import type {
  AuthMenuIntent,
  AuthMenuLoginViewModel,
  AuthMenuRegisterViewModel,
  AuthMenuViewModel,
} from '@wallet-ui/SeamsWeb/walletIframe/host/auth-menu/domain';
import {
  linkMenu,
  recoveryEntry,
  passkeyRecovery,
  googleRecovery,
  recoveryCode,
} from './accessMenus';
import linkingCode from './linking-code.svg';
import { paperIframeAppearance } from '@/context/app-themes';

const stage = document.getElementById('root');
if (!stage) throw new Error('Authentication showcase requires a root element.');

function registration(): AuthMenuRegisterViewModel {
  return {
    kind: 'passkey',
    mode: 'register',
    appearance: paperIframeAppearance(),
    hostname: 'shop.example.com',
    closeLabel: 'Back',
    heading: 'Create a wallet',
    subtitle: 'Your keys. Your next chapter.',
    ctaLabel: 'Create with passkey',
    showProgress: false,
    enabledExternalProviders: ['google'],
    status: { kind: 'idle', interaction: 'actionable' },
    showRegistrationInput: false,
    passkeyNameReadOnly: true,
    passkeyName: 'alex',
    passkeyNameLabel: 'Wallet name',
  };
}

function login(): AuthMenuLoginViewModel {
  return {
    kind: 'passkey',
    mode: 'login',
    appearance: paperIframeAppearance(),
    hostname: 'shop.example.com',
    closeLabel: 'Back',
    heading: 'Unlock wallet',
    subtitle: 'Welcome back.',
    ctaLabel: 'Continue with passkey',
    showProgress: false,
    enabledExternalProviders: ['google'],
    status: { kind: 'idle', interaction: 'actionable' },
    accountOptions: [],
    selectedAccount: null,
  };
}

const combinedAccess = location.pathname.includes('/showcase/access/');
function noApproval(): void {}
let cancelApproval: () => void = noApproval;

function mountMenu(viewModel: AuthMenuViewModel): AuthMenuSurfaceHandle {
  // The showcase must retain focus on its carousel selector during mounting.
  if (!stage) throw new Error('Authentication showcase requires a root element.');
  stage.inert = true;
  const handle = mountAuthMenuSurface({ parent: stage, viewModel, onIntent });
  stage.inert = false;
  return handle;
}

type AuthenticationState =
  | { kind: 'menu'; handle: AuthMenuSurfaceHandle; model: AuthMenuViewModel }
  | { kind: 'result'; next: 'home' | 'recovery' };
const initialModel = combinedAccess
  ? linkMenu({ kind: 'ready', qrCodeDataURL: linkingCode, message: 'Waiting for approval' })
  : registration();
let state: AuthenticationState = {
  kind: 'menu',
  handle: mountMenu(initialModel),
  model: initialModel,
};
const result = document.createElement('section');
result.className = 'authentication-result';
result.hidden = true;
result.innerHTML =
  '<h1></h1><p role="status"></p><button type="button" data-authentication-reset>Back</button>';
stage.append(result);
result.querySelector('button')?.addEventListener('click', continueAfterResult);
if (combinedAccess) cancelApproval = schedulePlayback(approveLink, 4000);

function show(model: AuthMenuViewModel): void {
  cancelApproval();
  result.hidden = true;
  if (state.kind === 'menu') {
    const manual = state.handle.element.contains(document.activeElement);
    if (!manual) state.handle.element.inert = true;
    state.handle.update(model);
    state.handle.element.inert = false;
    state = { kind: 'menu', handle: state.handle, model };
  } else {
    state = { kind: 'menu', handle: mountMenu(model), model };
  }
}

function reset(): void {
  cancelApproval();
  if (state.kind === 'menu') state.handle.dispose();
  state = { kind: 'result', next: 'home' };
  if (combinedAccess) openLink();
  else show(registration());
}

function continueAfterResult(): void {
  if (state.kind === 'result' && state.next === 'recovery') {
    show(recoveryEntry(recoveryCode, null));
  } else reset();
}

function openLink(): void {
  show(linkMenu({ kind: 'ready', qrCodeDataURL: linkingCode, message: 'Waiting for approval' }));
  // The remote device's approval arrives independently of this menu's controls.
  cancelApproval = schedulePlayback(approveLink, 4000);
}

function approveLink(): void {
  if (
    state.kind === 'menu' &&
    state.model.kind === 'link_device' &&
    state.model.linkDevice.kind === 'ready'
  ) {
    show(linkMenu({ kind: 'passkey_required', message: 'Device approved' }));
  }
}

function complete(heading: string, message: string, next: 'home' | 'recovery' = 'home'): void {
  if (state.kind !== 'menu') return;
  cancelApproval();
  const returnFocus = state.handle.element.contains(document.activeElement);
  state.handle.dispose();
  state = { kind: 'result', next };
  const title = result.querySelector('h1');
  const status = result.querySelector('p');
  const button = result.querySelector('button');
  if (title) title.textContent = heading;
  if (status) status.textContent = message;
  if (button) {
    button.textContent = next === 'recovery' ? 'Explore account recovery' : 'Back';
    button.toggleAttribute('data-access-next', next === 'recovery');
  }
  result.hidden = false;
  if (returnFocus) button?.focus({ preventScroll: true });
}

function recover(method: 'passkey' | 'google'): void {
  if (state.kind !== 'menu' || state.model.kind !== 'recovery') return;
  const code = state.model.recoveryCode;
  if (code.replaceAll(/[^0-9]/g, '') !== recoveryCode.replaceAll('-', '')) {
    show(recoveryEntry(code, 'Check your recovery code and try again.'));
    return;
  }
  show(
    method === 'passkey'
      ? passkeyRecovery('passkey_ready', code)
      : googleRecovery('google_ready', code),
  );
}

// The showcase uses the SDK's real menu renderer with local preview outcomes.
// It does not start credential ceremonies or contact authentication services.
function onIntent(intent: AuthMenuIntent): void {
  switch (intent.kind) {
    case 'mode_selected':
      if (state.kind === 'menu') show(intent.mode === 'register' ? registration() : login());
      return;
    case 'submit':
      complete('Success', "You're logged in.");
      return;
    case 'external_auth':
      if (state.kind === 'menu' && state.model.kind === 'recovery')
        show(googleRecovery('sign_in_ready', state.model.recoveryCode));
      else complete('Success', "You're logged in.");
      return;
    case 'link_device_open':
      openLink();
      return;
    case 'recovery_open':
      show(recoveryEntry(recoveryCode, null));
      return;
    case 'link_device_create_passkey':
      complete(
        'Device linked',
        'Your wallet is ready on this device.',
        combinedAccess ? 'recovery' : 'home',
      );
      return;
    case 'recovery_code_changed':
      show(recoveryEntry(intent.recoveryCode, null));
      return;
    case 'recovery_passkey_selected':
      recover('passkey');
      return;
    case 'recovery_google_selected':
      recover('google');
      return;
    case 'recovery_create_passkey':
      if (state.kind === 'menu' && state.model.kind === 'recovery')
        show(passkeyRecovery('sign_in_ready', state.model.recoveryCode));
      return;
    case 'recovery_sign_in':
      complete('Wallet recovered', 'Your wallet is ready.');
      return;
    case 'close':
    case 'back':
    case 'retry':
      reset();
      return;
    default:
      return;
  }
}
