import {
  HostedSeamsAuthMenu,
  useSeams,
  type HostedAuthMenuExternalAuthEvidence,
  type HostedAuthMenuExternalAuthRequest,
  type HostedAuthMenuMode,
  type HostedAuthMenuOutcome,
} from '@seams/wallet/react';
import React from 'react';
import { toast } from 'sonner';

import './PasskeyLoginMenu.css';
import { AuthMenuPreview } from './AuthMenuPreview';
import { FRONTEND_CONFIG } from '@/config';
import {
  cancelGoogleIdTokenRequest,
  ensureGoogleIdentityScriptLoaded,
  fetchGoogleAuthOptions,
  requestGoogleIdToken,
} from '@/shared/auth/googleIdentity';

type HostedPasskeyLoginMenuProps = {
  defaultModeWhenNoDetectedAccount?: HostedAuthMenuMode;
};

const HOSTED_AUTH_MENU_ERROR_EVENT = 'seams:hosted-auth-menu-error';

type HostedAuthMenuErrorEventDetail = {
  readonly kind: 'hosted_auth_menu_error_v1';
  readonly mode: 'login' | 'register';
  readonly message: string;
};

type GoogleSsoReadiness =
  | { kind: 'checking' }
  | { kind: 'ready'; clientId: string }
  | { kind: 'unavailable'; message: string };

const HOSTED_AUTH_MENU_ERROR_FIELDS = ['kind', 'mode', 'message'] as const;

function hostedAuthMenuPlainObject(raw: unknown): object | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

function hostedAuthMenuOwnValue(raw: object, field: string): unknown {
  return Reflect.get(raw, field);
}

function hostedAuthMenuExactObject(raw: unknown): object | null {
  const object = hostedAuthMenuPlainObject(raw);
  if (!object) return null;
  const actualFields = Object.keys(object);
  if (actualFields.length !== HOSTED_AUTH_MENU_ERROR_FIELDS.length) return null;
  const expectedFields = new Set<string>(HOSTED_AUTH_MENU_ERROR_FIELDS);
  return actualFields.every((field) => expectedFields.has(field)) ? object : null;
}

function normalizeBaseUrl(input: unknown): string {
  return String(input || '')
    .trim()
    .replace(/\/+$/, '');
}

function formatGoogleBrokerError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Google SSO is unavailable. Please retry.';
}

function parseHostedAuthMenuErrorEvent(event: Event): HostedAuthMenuErrorEventDetail | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail = hostedAuthMenuExactObject(event.detail);
  if (!detail) return null;
  const kind = hostedAuthMenuOwnValue(detail, 'kind');
  const mode = hostedAuthMenuOwnValue(detail, 'mode');
  const message = hostedAuthMenuOwnValue(detail, 'message');
  if (
    kind !== 'hosted_auth_menu_error_v1' ||
    (mode !== 'login' && mode !== 'register') ||
    typeof message !== 'string' ||
    !message.trim()
  ) {
    return null;
  }
  return { kind, mode, message: message.trim() };
}

function handleHostedAuthMenuError(event: Event): void {
  const error = parseHostedAuthMenuErrorEvent(event);
  if (!error) return;
  console.error(`[HostedSeamsAuthMenu:${error.mode}]`, new Error(error.message));
  toast.error(error.message, { id: error.mode === 'register' ? 'registration' : 'login' });
}

function noop(): void {}

function subscribeToHostedAuthMenuErrors(
  containerRef: React.RefObject<HTMLDivElement | null>,
): () => void {
  const container = containerRef.current;
  if (!container) return noop;
  container.addEventListener(HOSTED_AUTH_MENU_ERROR_EVENT, handleHostedAuthMenuError);
  return container.removeEventListener.bind(
    container,
    HOSTED_AUTH_MENU_ERROR_EVENT,
    handleHostedAuthMenuError,
  );
}

function requirePreparedGoogleSsoClientId(readiness: GoogleSsoReadiness): string {
  switch (readiness.kind) {
    case 'ready':
      return readiness.clientId;
    case 'checking':
      throw new Error('Google SSO is still loading. Try again in a moment.');
    case 'unavailable':
      throw new Error(readiness.message);
    default: {
      const exhaustive: never = readiness;
      throw new Error(`Unknown Google SSO readiness state: ${JSON.stringify(exhaustive)}`);
    }
  }
}

async function prepareGoogleSsoReadiness(relayerBaseUrl: string): Promise<GoogleSsoReadiness> {
  if (!relayerBaseUrl) {
    return { kind: 'unavailable', message: 'Relayer base URL is not configured' };
  }

  const googleOptions = await fetchGoogleAuthOptions(relayerBaseUrl);
  if (!googleOptions.configured || !googleOptions.clientId) {
    return {
      kind: 'unavailable',
      message: 'Google SSO is not configured on the Router API server',
    };
  }

  await ensureGoogleIdentityScriptLoaded();
  return { kind: 'ready', clientId: googleOptions.clientId };
}

function outcomeMessage(outcome: Extract<HostedAuthMenuOutcome, { kind: 'failed' }>): string {
  return outcome.message.trim() || 'Hosted auth-menu operation failed';
}

function handleHostedAuthMenuOutcome(
  outcome: HostedAuthMenuOutcome,
  refreshSession: (walletId?: string) => Promise<void>,
): void {
  switch (outcome.kind) {
    case 'authenticated':
      toast.success(`Logged in as ${outcome.walletId}`, { id: 'login' });
      void refreshSession(String(outcome.walletId)).catch(() => {});
      return;
    case 'registered':
      toast.success(`Registration completed: ${outcome.walletId}`, { id: 'registration' });
      void refreshSession(String(outcome.walletId)).catch(() => {});
      return;
    case 'account_synced':
      toast.success(`Account synced: ${outcome.walletId}`, { id: 'sync' });
      void refreshSession(String(outcome.walletId)).catch(() => {});
      return;
    case 'wallet_connected':
      toast.success('External wallet connected', { id: 'login' });
      return;
    case 'cancelled':
      toast.info('Wallet authentication cancelled', { id: 'login' });
      return;
    case 'failed':
      console.error('[HostedSeamsAuthMenu]', new Error(outcomeMessage(outcome)));
      toast.error(outcomeMessage(outcome), { id: 'login' });
      return;
    default:
      throw new Error(`Unknown hosted auth-menu outcome: ${JSON.stringify(outcome)}`);
  }
}

function handleHostedAuthMenuOutcomeAndCancelGoogleRequest(
  refreshSession: (walletId?: string) => Promise<void>,
  outcome: HostedAuthMenuOutcome,
): void {
  cancelGoogleIdTokenRequest();
  handleHostedAuthMenuOutcome(outcome, refreshSession);
}

function providerUnavailableEvidence(message: string): HostedAuthMenuExternalAuthEvidence {
  return { kind: 'failed', code: 'provider_unavailable', message };
}

function providerErrorEvidence(message: string): HostedAuthMenuExternalAuthEvidence {
  return { kind: 'failed', code: 'provider_error', message };
}

function registerGoogleIdTokenRequestCancellation(): () => void {
  return cancelGoogleIdTokenRequest;
}

function syncAuthMenuContainerLock(
  containerRef: React.RefObject<HTMLDivElement | null>,
  lockState: 'idle' | 'cleaning_up',
): void {
  const container = containerRef.current;
  if (container) container.inert = lockState === 'cleaning_up';
}

// The wallet client sets this on the menu's anchor once the hosted menu paints there.
const HOSTED_MENU_PLACEHOLDER_OPACITY_VAR = '--seams-auth-menu-placeholder-opacity';

type DemoMenuPhase = 'preview' | 'opening' | 'live';

function hostedMenuHasPainted(anchor: HTMLElement): boolean {
  return anchor.style.getPropertyValue(HOSTED_MENU_PLACEHOLDER_OPACITY_VAR) === '0';
}

function finishOpeningWhenHostedMenuPaints(
  anchor: HTMLElement,
  setPhase: React.Dispatch<React.SetStateAction<DemoMenuPhase>>,
): void {
  if (hostedMenuHasPainted(anchor)) setPhase('live');
}

// The preview stays over the hosted menu's skeleton until the menu paints, so a
// visitor never sees the skeleton between the two.
function watchHostedMenuPaint(
  containerRef: React.RefObject<HTMLDivElement | null>,
  phase: DemoMenuPhase,
  setPhase: React.Dispatch<React.SetStateAction<DemoMenuPhase>>,
): () => void {
  if (phase !== 'opening') return noop;
  const anchor = containerRef.current?.querySelector<HTMLElement>('[data-seams-auth-menu-host]');
  if (!anchor) return noop;
  const check = finishOpeningWhenHostedMenuPaints.bind(null, anchor, setPhase);
  const observer = new MutationObserver(check);
  observer.observe(anchor, { attributes: true, attributeFilter: ['style'] });
  check();
  return observer.disconnect.bind(observer);
}

function startOpening(phase: DemoMenuPhase): DemoMenuPhase {
  return phase === 'preview' ? 'opening' : phase;
}

const HOSTED_AUTH_MENU_COPY = {
  login: { subtitle: 'Continue with a passkey or Google' },
  register: { subtitle: 'Continue with a passkey or Google' },
} as const;

export function HostedPasskeyLoginMenu(props: HostedPasskeyLoginMenuProps) {
  const authMenuContainerRef = React.useRef<HTMLDivElement>(null);
  // A landing visitor sees a preview until they use the demo; only then does the
  // wallet host load its runtime and the page load the Google script.
  const [phase, setPhase] = React.useState<DemoMenuPhase>('preview');
  const startDemo = React.useCallback(() => setPhase(startOpening), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(watchHostedMenuPaint.bind(null, authMenuContainerRef, phase, setPhase), [phase]);
  // Effect bodies are standalone to keep the component readable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(subscribeToHostedAuthMenuErrors.bind(null, authMenuContainerRef), []);
  React.useEffect(registerGoogleIdTokenRequestCancellation, []);
  const relayerBaseUrl = React.useMemo(
    () => normalizeBaseUrl(FRONTEND_CONFIG.relayerUrl || FRONTEND_CONFIG.consoleBaseUrl),
    [],
  );
  const { refreshSession, walletLockState } = useSeams();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(
    syncAuthMenuContainerLock.bind(null, authMenuContainerRef, walletLockState.kind),
    [walletLockState.kind],
  );
  const [googleSsoReadiness, setGoogleSsoReadiness] = React.useState<GoogleSsoReadiness>({
    kind: 'checking',
  });
  const demoInUse = phase !== 'preview';
  React.useEffect(() => {
    if (!demoInUse) return;
    let cancelled = false;
    setGoogleSsoReadiness({ kind: 'checking' });
    prepareGoogleSsoReadiness(relayerBaseUrl)
      .then((readiness) => {
        if (!cancelled) setGoogleSsoReadiness(readiness);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setGoogleSsoReadiness({ kind: 'unavailable', message: formatGoogleBrokerError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [demoInUse, relayerBaseUrl]);

  const externalAuthBroker = React.useCallback(
    async (
      _request: HostedAuthMenuExternalAuthRequest,
    ): Promise<HostedAuthMenuExternalAuthEvidence> => {
      if (googleSsoReadiness.kind !== 'ready') {
        return providerUnavailableEvidence(
          googleSsoReadiness.kind === 'unavailable'
            ? googleSsoReadiness.message
            : 'Google SSO is still loading. Try again in a moment.',
        );
      }
      try {
        const googleClientId = requirePreparedGoogleSsoClientId(googleSsoReadiness);
        const idToken = await requestGoogleIdToken(googleClientId);
        return { kind: 'google_id_token', idToken };
      } catch (error: unknown) {
        return providerErrorEvidence(formatGoogleBrokerError(error));
      }
    },
    [googleSsoReadiness],
  );

  const resolvedInitialMode = props.defaultModeWhenNoDetectedAccount ?? 'login';

  return (
    <div
      ref={authMenuContainerRef}
      className="passkey-login-container-root"
      aria-busy={walletLockState.kind === 'cleaning_up'}
      data-wallet-lock-state={walletLockState.kind}
    >
      {walletLockState.kind === 'idle' ? (
        <div className="landing-auth-menu-stack">
          {phase === 'live' ? null : (
            <AuthMenuPreview
              initialMode={resolvedInitialMode}
              copy={HOSTED_AUTH_MENU_COPY}
              usable={phase === 'preview'}
              onUse={startDemo}
            />
          )}
          {phase === 'preview' ? null : (
            <HostedSeamsAuthMenu
              initialMode={resolvedInitialMode}
              registrationAccountInput="implicit_wallet"
              showRegistrationInput={false}
              copy={HOSTED_AUTH_MENU_COPY}
              externalAuthBroker={externalAuthBroker}
              onOutcome={handleHostedAuthMenuOutcomeAndCancelGoogleRequest.bind(null, refreshSession)}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
