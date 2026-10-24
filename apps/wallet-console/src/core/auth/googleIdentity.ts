export interface GoogleAuthOptions {
  configured: boolean;
  clientId?: string;
  message?: string;
}

export interface GoogleIdentityButtonApi {
  initialize(config: {
    readonly client_id: string;
    readonly callback: (response: unknown) => void;
    readonly ux_mode: 'popup';
    readonly auto_select: true;
    readonly use_fedcm_for_prompt: true;
  }): void;
  prompt(): void;
  cancel(): void;
  renderButton(
    element: HTMLElement,
    options: {
      readonly type: 'standard';
      readonly theme: 'filled_black';
      readonly size: 'large';
      readonly text: 'continue_with';
      readonly shape: 'rectangular';
      readonly width: number;
    },
  ): void;
}

let googleIdentityScriptLoadPromise: Promise<GoogleIdentityButtonApi> | null = null;
const GOOGLE_IDENTITY_SCRIPT_TIMEOUT_MS = 15_000;

function objectValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Reflect.get(value, key);
}

function readGoogleIdentityButtonApi(): GoogleIdentityButtonApi | null {
  const api = objectValue(objectValue(Reflect.get(window, 'google'), 'accounts'), 'id');
  const initialize = objectValue(api, 'initialize');
  const renderButton = objectValue(api, 'renderButton');
  const prompt = objectValue(api, 'prompt');
  const cancel = objectValue(api, 'cancel');
  if (
    typeof initialize !== 'function' ||
    typeof renderButton !== 'function' ||
    typeof prompt !== 'function' ||
    typeof cancel !== 'function'
  )
    return null;
  return {
    initialize: initialize.bind(api),
    renderButton: renderButton.bind(api),
    prompt: prompt.bind(api),
    cancel: cancel.bind(api),
  };
}

export async function fetchGoogleAuthOptions(relayerBaseUrl: string): Promise<GoogleAuthOptions> {
  const baseUrl = relayerBaseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) return { configured: false, message: 'Relayer base URL is not configured' };
  const response = await fetch(`${baseUrl}/console/auth/google/options`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body: unknown = await response.json().catch(invalidGoogleOptions);
  const rawClientId = objectValue(body, 'clientId');
  const clientId = typeof rawClientId === 'string' ? rawClientId.trim() : '';
  const message = objectValue(body, 'message');
  return {
    configured:
      response.ok &&
      objectValue(body, 'ok') === true &&
      objectValue(body, 'configured') === true &&
      clientId.length > 0,
    ...(clientId ? { clientId } : {}),
    ...(typeof message === 'string' && message.trim() ? { message: message.trim() } : {}),
  };
}

function invalidGoogleOptions(): null {
  return null;
}

function failGoogleIdentityScript(
  script: HTMLScriptElement,
  reject: (error: Error) => void,
  message: string,
): void {
  script.onload = null;
  script.onerror = null;
  script.remove();
  googleIdentityScriptLoadPromise = null;
  reject(new Error(message));
}

function handleGoogleIdentityScriptError(
  script: HTMLScriptElement,
  timeout: number,
  reject: (error: Error) => void,
): void {
  window.clearTimeout(timeout);
  failGoogleIdentityScript(
    script,
    reject,
    'Could not load Google sign-in. Check your connection and retry.',
  );
}

function handleGoogleIdentityScriptLoaded(
  script: HTMLScriptElement,
  timeout: number,
  resolve: (api: GoogleIdentityButtonApi) => void,
  reject: (error: Error) => void,
): void {
  window.clearTimeout(timeout);
  const api = readGoogleIdentityButtonApi();
  if (!api) {
    failGoogleIdentityScript(
      script,
      reject,
      'Google sign-in loaded without its button API. Retry sign-in.',
    );
    return;
  }
  script.onload = null;
  script.onerror = null;
  resolve(api);
}

function loadGoogleIdentityScript(
  resolve: (api: GoogleIdentityButtonApi) => void,
  reject: (error: Error) => void,
): void {
  const script = document.createElement('script');
  const timeout = window.setTimeout(
    failGoogleIdentityScript.bind(
      null,
      script,
      reject,
      'Google sign-in took too long to load. Retry sign-in.',
    ),
    GOOGLE_IDENTITY_SCRIPT_TIMEOUT_MS,
  );
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.onload = handleGoogleIdentityScriptLoaded.bind(null, script, timeout, resolve, reject);
  script.onerror = handleGoogleIdentityScriptError.bind(null, script, timeout, reject);
  document.head.appendChild(script);
}

export function ensureGoogleIdentityScriptLoaded(): Promise<GoogleIdentityButtonApi> {
  if (typeof window === 'undefined')
    return Promise.reject(new Error('Browser runtime is required'));
  const api = readGoogleIdentityButtonApi();
  if (api) return Promise.resolve(api);
  googleIdentityScriptLoadPromise ??= new Promise(loadGoogleIdentityScript);
  return googleIdentityScriptLoadPromise;
}

export function readGoogleIdToken(response: unknown): string | null {
  const credential = objectValue(response, 'credential');
  return typeof credential === 'string' && credential.trim() ? credential.trim() : null;
}
