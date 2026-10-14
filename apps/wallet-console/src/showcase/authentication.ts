import '@wallet-ui/sdk/wallet-ui.css';
import './showcase.css';
import './authentication.css';
import {
  mountAuthMenuSurface,
  type AuthMenuSurfaceHandle,
} from '@wallet-ui/SeamsWeb/walletIframe/host/ui/auth-menu/mountAuthMenuSurface';
import type {
  AuthMenuIntent,
  AuthMenuLoginViewModel,
  AuthMenuRegisterViewModel,
} from '@wallet-ui/SeamsWeb/walletIframe/host/auth-menu/domain';
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

function mountMenu(): AuthMenuSurfaceHandle {
  // The showcase must retain focus on its carousel selector during mounting.
  if (!stage) throw new Error('Authentication showcase requires a root element.');
  stage.inert = true;
  const handle = mountAuthMenuSurface({ parent: stage, viewModel: registration(), onIntent });
  stage.inert = false;
  return handle;
}

type AuthenticationState = { kind: 'menu'; handle: AuthMenuSurfaceHandle } | { kind: 'result' };
let state: AuthenticationState = { kind: 'menu', handle: mountMenu() };
const result = document.createElement('section');
result.className = 'authentication-result';
result.hidden = true;
result.innerHTML =
  '<h1></h1><p role="status"></p><button type="button" data-authentication-reset>Back</button>';
stage.append(result);
result.querySelector('button')?.addEventListener('click', reset);

function reset(): void {
  const returnFocus = result.contains(document.activeElement);
  if (state.kind === 'menu') state.handle.dispose();
  result.hidden = true;
  const handle = mountMenu();
  state = { kind: 'menu', handle };
  if (returnFocus)
    handle.element
      .querySelector<HTMLElement>('[data-auth-menu-primary]')
      ?.focus({ preventScroll: true });
}

function complete(heading: string, message: string): void {
  if (state.kind !== 'menu') return;
  const returnFocus = state.handle.element.contains(document.activeElement);
  state.handle.dispose();
  state = { kind: 'result' };
  const title = result.querySelector('h1');
  const status = result.querySelector('p');
  if (title) title.textContent = heading;
  if (status) status.textContent = message;
  result.hidden = false;
  if (returnFocus) result.querySelector('button')?.focus({ preventScroll: true });
}

// The showcase uses the SDK's real menu renderer with local preview outcomes.
// It does not start credential ceremonies or contact authentication services.
function onIntent(intent: AuthMenuIntent): void {
  switch (intent.kind) {
    case 'mode_selected':
      if (state.kind === 'menu')
        state.handle.update(intent.mode === 'register' ? registration() : login());
      return;
    case 'submit':
      complete(
        intent.mode === 'register' ? 'Wallet created' : 'Wallet unlocked',
        'Your wallet is ready.',
      );
      return;
    case 'external_auth':
      complete('Continue with Google', 'Choose your Google account to continue.');
      return;
    case 'link_device_open':
      complete('Link this device', 'Scan a code with your other device to connect this one.');
      return;
    case 'recovery_open':
      complete('Recover your wallet', 'Use your recovery code to restore access.');
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
