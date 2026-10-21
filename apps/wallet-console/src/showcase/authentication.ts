import { locale, t } from '@/marketing/i18n/browser';
import './embeddedFocus';
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
    appearance: paperIframeAppearance(locale),
    hostname: 'shop.example.com',
    closeLabel: t('back'),
    heading: t('createWallet'),
    subtitle: t('yourKeys'),
    ctaLabel: t('createPasskey'),
    showProgress: false,
    enabledExternalProviders: ['google'],
    status,
    showRegistrationInput: false,
    passkeyNameReadOnly: true,
    passkeyName: 'alex',
    passkeyNameLabel: t('walletName'),
  };
}

function login(
  status: AuthMenuLoginViewModel['status'] = { kind: 'idle', interaction: 'actionable' },
): AuthMenuLoginViewModel {
  return {
    kind: 'passkey',
    mode: 'login',
    appearance: paperIframeAppearance(locale),
    hostname: 'shop.example.com',
    closeLabel: t('back'),
    heading: t('unlockWallet'),
    subtitle: t('welcomeBackPeriod'),
    ctaLabel: t('continuePasskey'),
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
result.tabIndex = -1;
result.innerHTML = `
  <span class="authentication-result__icon" aria-hidden="true">
    <svg viewBox="0 0 56 56" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <circle class="authentication-result__track" cx="28" cy="28" r="26.75" stroke-width="2.5" />
      <circle class="authentication-result__arc" cx="28" cy="28" r="26.75" stroke-width="2.5" pathLength="100" />
      <circle class="authentication-result__seal" cx="28" cy="28" r="28" />
      <path class="authentication-result__check" d="M36.7 21.5 24.75 33.4l-5.4-5.4" stroke-width="3.2" pathLength="1" />
    </svg>
  </span>
  <h1></h1>
  <p role="status"></p>
  <div class="authentication-result__actions">
    <button type="button" data-showcase-next>
      ${t('next')}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    </button>
    <button type="button" data-authentication-reset>${t('startOver')}</button>
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
    state.handle.element.classList.remove('authentication-wait--leaving');
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
  show(linkMenu({ kind: 'ready', qrCodeDataURL: linkingCode, message: t('waitingApproval') }));
  // The remote device's approval arrives independently of this menu's controls.
  cancelApproval = schedulePlayback(approveLink, 4000);
}

function approveLink(): void {
  if (
    state.kind === 'menu' &&
    state.model.kind === 'link_device' &&
    state.model.linkDevice.kind === 'ready'
  ) {
    show(linkMenu({ kind: 'passkey_required', message: t('deviceApproved') }));
  }
}

// The busy spinner closes into the check before the actions appear. The
// actions stay disabled until then, so the canvas player waits for them too.
const resultEntryMilliseconds = 1000;
const waitMilliseconds = 1000;
const waitFadeMilliseconds = 200;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

type RingAnchor = {
  readonly cardTop: number;
  readonly cardHeight: number;
  readonly cardRadius: string;
  readonly ringTop: number;
};

// Where the SDK's passkey wait draws its ring, read before the menu goes.
function ringAnchor(menu: HTMLElement): RingAnchor | null {
  const card = menu.querySelector('.seams-signup-menu-root');
  const ring = menu.querySelector('.seams-passkey-prompt');
  if (!card || !ring) return null;
  const cardBox = card.getBoundingClientRect();
  return {
    cardTop: cardBox.top,
    cardHeight: cardBox.height,
    cardRadius: getComputedStyle(card).borderTopLeftRadius,
    ringTop: ring.getBoundingClientRect().top,
  };
}

// After a passkey wait, the result card takes the SDK card's place: the same
// top edge, and its ring at the height of the waiting ring. Only the content
// changes, and the card grows downward. The offsets are measured, because the
// SDK card's rows above the ring and the result's actions differ by context.
function anchorResult(anchor: RingAnchor | null): void {
  result.classList.toggle('authentication-result--anchored', anchor !== null);
  result.style.paddingTop = '';
  result.style.translate = '';
  result.style.removeProperty('--authentication-result-from-height');
  result.style.removeProperty('--authentication-result-to-height');
  result.style.removeProperty('--authentication-result-from-radius');
  const icon = result.querySelector('.authentication-result__icon');
  if (!anchor || !icon) return;
  const padding = parseFloat(getComputedStyle(result).paddingTop);
  const offset = icon.getBoundingClientRect().top - result.getBoundingClientRect().top;
  result.style.paddingTop = `${padding + anchor.ringTop - anchor.cardTop - offset}px`;
  // The card opens from the SDK card's height and corners to its own as the
  // text fades in. The stage centres the card, so it grows up and down about
  // the SDK card's centre; the shift places that centre where the SDK card's was.
  const box = result.getBoundingClientRect();
  const growth = box.height - anchor.cardHeight;
  result.style.translate = `0 ${anchor.cardTop - box.top - growth / 2}px`;
  result.style.setProperty('--authentication-result-from-height', `${anchor.cardHeight}px`);
  result.style.setProperty('--authentication-result-to-height', `${box.height}px`);
  result.style.setProperty('--authentication-result-from-radius', anchor.cardRadius);
}

function complete(heading: string, message: string): void {
  if (state.kind !== 'menu') return;
  cancelApproval();
  const returnFocus = state.handle.element.contains(document.activeElement);
  const anchor = ringAnchor(state.handle.element);
  state.handle.dispose();
  state = { kind: 'result' };
  const title = result.querySelector('h1');
  const status = result.querySelector('p');
  const actions = [...result.querySelectorAll<HTMLButtonElement>('button')];
  const button =
    next && !next.hidden
      ? next
      : result.querySelector<HTMLButtonElement>('[data-authentication-reset]');
  if (title) title.textContent = heading;
  if (status) status.textContent = message;
  result.hidden = false;
  anchorResult(anchor);
  const reveal = (): void => {
    for (const action of actions) action.disabled = false;
    if (returnFocus) button?.focus({ preventScroll: true });
  };
  if (reducedMotion.matches) {
    reveal();
    return;
  }
  for (const action of actions) action.disabled = true;
  if (returnFocus) result.focus({ preventScroll: true });
  cancelApproval = schedulePlayback(reveal, resultEntryMilliseconds);
}

// The demo shows the new sign-in method as the end of recovery. The SDK's
// separate unlock with that method is left out here.
function completeRecovery(): void {
  complete(t('walletRecovered'), t('readyOnDevice'));
}

function finishAuthentication(mode: 'login' | 'register'): void {
  if (mode === 'register') complete(t('walletCreated'), t('readyOnDevice'));
  else complete(t('signedIn'), t('walletUnlocked'));
}

// A passkey wait shows the SDK's passkey ring; the result card's ring then
// closes into the check in the same place.
function promptAuthentication(mode: 'login' | 'register', method: 'passkey' | 'google'): void {
  const status: AuthMenuLoginViewModel['status'] =
    method === 'passkey'
      ? {
          kind: 'busy',
          headline: mode === 'register' ? t('creatingWallet') : t('unlockingWallet'),
          illustration: 'passkey',
        }
      : { kind: 'busy', headline: t('signingIn') };
  show(mode === 'register' ? registration(status) : login(status));
  if (reducedMotion.matches) {
    cancelApproval = schedulePlayback(() => finishAuthentication(mode), waitMilliseconds);
    return;
  }
  // The wait's text fades out before the result replaces the card.
  cancelApproval = schedulePlayback(() => {
    if (state.kind === 'menu') state.handle.element.classList.add('authentication-wait--leaving');
    cancelApproval = schedulePlayback(() => finishAuthentication(mode), waitFadeMilliseconds);
  }, waitMilliseconds - waitFadeMilliseconds);
}

function recover(method: 'passkey' | 'google'): void {
  if (state.kind !== 'menu' || state.model.kind !== 'recovery') return;
  const code = state.model.recoveryCode;
  if (code.toUpperCase().replaceAll(/[^0-9A-Z]/g, '') !== recoveryCode.replaceAll('-', '')) {
    show(recoveryEntry(code, t('checkRecovery')));
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
      promptAuthentication(intent.mode, 'passkey');
      return;
    case 'external_auth':
      if (state.kind === 'menu' && state.model.kind === 'recovery') completeRecovery();
      else if (state.kind === 'menu') promptAuthentication(state.model.mode, 'google');
      return;
    case 'link_device_open':
      openLink();
      return;
    case 'recovery_open':
      show(recoveryEntry(recoveryCode, null));
      return;
    case 'link_device_create_passkey':
      complete(t('deviceLinked'), t('readyOnDevice'));
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
