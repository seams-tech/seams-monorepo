import React from 'react';
import {
  ensureGoogleIdentityScriptLoaded,
  readGoogleIdToken,
  type GoogleIdentityButtonApi,
} from './googleIdentity';

export interface GoogleSignInButtonProps {
  readonly clientId: string;
  readonly disabled: boolean;
  readonly oneTap: 'enabled' | 'disabled';
  readonly label: string;
  readonly className: string;
  readonly iconClassName: string;
  readonly onCredential: (idToken: string) => void;
  readonly onError: (message: string) => void;
}

type ButtonStatus = 'loading' | 'ready' | 'failed';

class GoogleButtonMount {
  private width = 0;
  private readonly resizeObserver = new ResizeObserver(this.resize.bind(this));
  private state:
    | { kind: 'loading' }
    | { kind: 'ready'; api: GoogleIdentityButtonApi }
    | { kind: 'prompted'; api: GoogleIdentityButtonApi }
    | { kind: 'disposed' } = { kind: 'loading' };

  constructor(
    private readonly element: HTMLDivElement,
    private readonly callbacks: React.RefObject<GoogleSignInButtonProps>,
    private readonly setStatus: React.Dispatch<React.SetStateAction<ButtonStatus>>,
  ) {}

  async render(clientId: string): Promise<void> {
    this.setStatus('loading');
    try {
      const api = await ensureGoogleIdentityScriptLoaded();
      if (this.state.kind === 'disposed') return;
      api.initialize({
        client_id: clientId,
        ux_mode: 'popup',
        callback: this.receive.bind(this),
        auto_select: true,
        use_fedcm_for_button: false,
      });
      this.renderButton(api);
      this.state = { kind: 'ready', api };
      if (this.element.parentElement) this.resizeObserver.observe(this.element.parentElement);
      this.setStatus('ready');
    } catch (error: unknown) {
      if (this.state.kind === 'disposed') return;
      this.setStatus('failed');
      this.callbacks.current.onError(error instanceof Error ? error.message : String(error));
    }
  }

  private renderButton(api: GoogleIdentityButtonApi): void {
    const width = Math.min(400, Math.floor(this.element.parentElement?.clientWidth || 400));
    if (this.width === width) return;
    this.width = width;
    this.element.replaceChildren();
    api.renderButton(this.element, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      width,
    });
  }

  private resize(): void {
    if (this.state.kind === 'ready' || this.state.kind === 'prompted')
      this.renderButton(this.state.api);
  }

  private receive(response: unknown): void {
    if (this.state.kind === 'disposed' || this.callbacks.current.disabled) return;
    const token = readGoogleIdToken(response);
    if (!token) {
      this.callbacks.current.onError('Google did not return a sign-in credential. Retry sign-in.');
      return;
    }
    this.callbacks.current.onCredential(token);
  }

  prompt(): void {
    if (this.state.kind !== 'ready') return;
    const api = this.state.api;
    this.state = { kind: 'prompted', api };
    try {
      // The button stays available when One Tap cannot show an account.
      api.prompt();
    } catch {
      console.debug('[Google SSO] One Tap is unavailable; the sign-in button remains available.');
    }
  }

  dispose(): void {
    const state = this.state;
    this.state = { kind: 'disposed' };
    this.resizeObserver.disconnect();
    if (state.kind === 'ready' || state.kind === 'prompted') state.api.cancel();
    this.element.replaceChildren();
  }
}

function updateGoogleButtonCallbacks(
  callbacks: React.RefObject<GoogleSignInButtonProps>,
  props: GoogleSignInButtonProps,
): void {
  callbacks.current = props;
}

function mountGoogleButton(
  element: React.RefObject<HTMLDivElement | null>,
  callbacks: React.RefObject<GoogleSignInButtonProps>,
  setStatus: React.Dispatch<React.SetStateAction<ButtonStatus>>,
  clientId: string,
  mounted: React.RefObject<GoogleButtonMount | null>,
): (() => void) | undefined {
  if (!element.current || !clientId) return;
  const mount = new GoogleButtonMount(element.current, callbacks, setStatus);
  mounted.current = mount;
  void mount.render(clientId);
  return mount.dispose.bind(mount);
}

function promptGoogleOneTap(
  mounted: React.RefObject<GoogleButtonMount | null>,
  status: ButtonStatus,
  disabled: boolean,
  oneTap: GoogleSignInButtonProps['oneTap'],
): void {
  if (status === 'ready' && !disabled && oneTap === 'enabled') mounted.current?.prompt();
}

function GoogleMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

function incrementAttempt(attempt: number): number {
  return attempt + 1;
}

function retryGoogleButton(
  callbacks: React.RefObject<GoogleSignInButtonProps>,
  setAttempt: React.Dispatch<React.SetStateAction<number>>,
): void {
  callbacks.current.onError('');
  setAttempt(incrementAttempt);
}

export function GoogleSignInButton(props: GoogleSignInButtonProps): React.JSX.Element {
  const element = React.useRef<HTMLDivElement | null>(null);
  const callbacks = React.useRef(props);
  const mounted = React.useRef<GoogleButtonMount | null>(null);
  const [status, setStatus] = React.useState<ButtonStatus>('loading');
  const [attempt, setAttempt] = React.useState(0);
  React.useLayoutEffect(() => updateGoogleButtonCallbacks(callbacks, props), [props]);
  React.useEffect(
    () => mountGoogleButton(element, callbacks, setStatus, props.clientId, mounted),
    [props.clientId, attempt],
  );
  React.useEffect(
    () => promptGoogleOneTap(mounted, status, props.disabled, props.oneTap),
    [status, props.disabled, props.oneTap],
  );
  const showButton = status === 'ready' && !props.disabled;
  const canRetry = status === 'failed' && !props.disabled;
  let label = props.label;
  if (!props.disabled) label = canRetry ? 'Retry Google sign-in' : 'Loading Google sign-in...';
  return (
    <div className="dashboard-login__google-sign-in">
      {/* Google's button cannot take the site's style, so the visitor sees this
          copy of the GitHub button. Google's own button lies over it, fully
          transparent, and takes the click and the keyboard focus; the popup,
          the credential and One Tap stay Google's. */}
      {showButton ? (
        <div className={`${props.className} dashboard-login__google-face`} aria-hidden="true">
          <span className={props.iconClassName}>
            <GoogleMark />
          </span>
          <span>{props.label}</span>
        </div>
      ) : null}
      <div ref={element} className="dashboard-login__google-overlay" hidden={!showButton} />
      {!showButton ? (
        <button
          type="button"
          className={props.className}
          disabled={!canRetry}
          onClick={retryGoogleButton.bind(null, callbacks, setAttempt)}
        >
          {label}
        </button>
      ) : null}
    </div>
  );
}
