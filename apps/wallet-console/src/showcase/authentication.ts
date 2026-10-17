import '@wallet-ui/sdk/wallet-ui.css';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
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

function registration(
  status: AuthMenuRegisterViewModel['status'] = { kind: 'idle', interaction: 'actionable' },
): AuthMenuRegisterViewModel {
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
    status,
    showRegistrationInput: false,
    passkeyNameReadOnly: true,
    passkeyName: 'alex',
    passkeyNameLabel: 'Wallet name',
  };
}

function login(
  status: AuthMenuLoginViewModel['status'] = { kind: 'idle', interaction: 'actionable' },
): AuthMenuLoginViewModel {
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
    status,
    accountOptions: [],
    selectedAccount: null,
  };
}

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
  | { kind: 'result' };
const initialModel = registration();
let state: AuthenticationState = {
  kind: 'menu',
  handle: mountMenu(initialModel),
  model: initialModel,
};
const result = document.createElement('section');
result.className = 'authentication-result';
result.hidden = true;
result.innerHTML = `
  <span class="authentication-result__icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  </span>
  <h1></h1>
  <p role="status"></p>
  <div class="authentication-result__actions">
    <button type="button" data-showcase-next>
      Next
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    </button>
    <button type="button" data-authentication-reset>Start over</button>
  </div>`;
stage.append(result);
const next = result.querySelector<HTMLButtonElement>('[data-showcase-next]');
// Next belongs to the component canvas; a standalone page has no next demo.
if (next) next.hidden = window.parent === window;
next?.addEventListener('click', showNextDemo);
result.querySelector('[data-authentication-reset]')?.addEventListener('click', reset);

// The canvas moves on when a visitor asks. Its player clicks with synthetic
// events and advances the canvas itself, so only real input sends the request.
function showNextDemo(event: MouseEvent): void {
  if (!event.isTrusted) return;
  window.parent.postMessage({ type: 'seams-showcase-next' }, window.location.origin);
}

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
  state = { kind: 'result' };
  show(registration());
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

function complete(heading: string, message: string): void {
  if (state.kind !== 'menu') return;
  cancelApproval();
  const returnFocus = state.handle.element.contains(document.activeElement);
  state.handle.dispose();
  state = { kind: 'result' };
  const title = result.querySelector('h1');
  const status = result.querySelector('p');
  const button = next && !next.hidden ? next : result.querySelector('button');
  if (title) title.textContent = heading;
  if (status) status.textContent = message;
  result.hidden = false;
  if (returnFocus) button?.focus({ preventScroll: true });
}

// The demo shows the new sign-in method as the end of recovery. The SDK's
// separate unlock with that method is left out here.
function completeRecovery(): void {
  complete('Wallet recovered', 'Your wallet is ready on this device.');
}

function finishAuthentication(): void {
  complete('Success', "You're logged in.");
}

function promptAuthentication(mode: 'login' | 'register'): void {
  const status: AuthMenuLoginViewModel['status'] = { kind: 'busy', headline: 'Signing you in…' };
  show(mode === 'register' ? registration(status) : login(status));
  cancelApproval = schedulePlayback(finishAuthentication, 2000);
}

function recover(method: 'passkey' | 'google'): void {
  if (state.kind !== 'menu' || state.model.kind !== 'recovery') return;
  const code = state.model.recoveryCode;
  if (code.toUpperCase().replaceAll(/[^0-9A-Z]/g, '') !== recoveryCode.replaceAll('-', '')) {
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
      promptAuthentication(intent.mode);
      return;
    case 'external_auth':
      if (state.kind === 'menu' && state.model.kind === 'recovery') completeRecovery();
      else if (state.kind === 'menu') promptAuthentication(state.model.mode);
      return;
    case 'link_device_open':
      openLink();
      return;
    case 'recovery_open':
      show(recoveryEntry(recoveryCode, null));
      return;
    case 'link_device_create_passkey':
      complete('Device linked', 'Your wallet is ready on this device.');
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
      if (state.kind === 'menu' && state.model.kind === 'recovery') completeRecovery();
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
