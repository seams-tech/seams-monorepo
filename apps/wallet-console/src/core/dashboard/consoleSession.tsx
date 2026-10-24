import React from 'react';
import {
  parseOrganizationAccess,
  type DashboardAccountOrganizationAccess,
} from './routes/account-settings/consoleAccountApi';
import {
  buildConsoleAcceptHeaders,
  consoleErrorMessage,
  normalizeConsoleFetchError,
  parseConsoleJson,
  requireConsoleBaseUrl,
  resolveConsoleBaseUrl,
} from './consoleHttp';
import { readUnscopedConsoleSession } from './routes/onboarding/initialOrganizationApi';
import { consoleDeploymentFor, type ConsoleNetwork } from '@core/runtime';

interface DashboardConsoleSessionIdentity {
  userId: string;
  orgId: string;
  platformSupport: boolean;
  email?: string;
  name?: string;
  projectId: string | null;
}

export type DashboardConsoleSessionClaims = DashboardConsoleSessionIdentity &
  DashboardAccountOrganizationAccess;

interface DashboardConsoleSessionResponse {
  ok?: boolean;
  code?: string;
  message?: string;
  claims?: unknown;
}

interface DashboardConsoleSessionRevokeResponse {
  ok?: boolean;
  revoked?: boolean;
  code?: string;
  message?: string;
}

export interface DashboardConsoleSessionState {
  loading: boolean;
  claims: DashboardConsoleSessionClaims | null;
  errorMessage: string;
  errorCode: string;
  errorStatus: number | null;
  refresh: () => void;
}

export function canDashboardEditProject(
  claims: DashboardConsoleSessionClaims | null,
  projectId: string,
): boolean {
  if (!claims) return false;
  if (claims.role === 'OWNER' || claims.role === 'ADMIN') return true;
  return claims.projectAccess.assignments.some(
    (assignment) => assignment.projectId === projectId && assignment.accessLevel === 'editor',
  );
}

export function canDashboardViewBilling(claims: DashboardConsoleSessionClaims | null): boolean {
  if (!claims) return false;
  if (claims.role === 'OWNER') return true;
  return (
    claims.role === 'ADMIN' &&
    (claims.adminPermissions.includes('billing.view') ||
      claims.adminPermissions.includes('billing.manage'))
  );
}

export function canDashboardManageBilling(claims: DashboardConsoleSessionClaims | null): boolean {
  if (!claims) return false;
  if (claims.role === 'OWNER') return true;
  return claims.role === 'ADMIN' && claims.adminPermissions.includes('billing.manage');
}

const DashboardConsoleSessionContext = React.createContext<DashboardConsoleSessionState | null>(
  null,
);

type DashboardConsoleSessionError = Error & {
  code?: string;
  status?: number;
};

function asSessionError(error: unknown): DashboardConsoleSessionError {
  if (error instanceof Error) return error as DashboardConsoleSessionError;
  return new Error(String(error)) as DashboardConsoleSessionError;
}

function parseClaims(raw: unknown): DashboardConsoleSessionClaims | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const userId = String(row.userId || '').trim();
  const orgId = String(row.orgId || '').trim();
  const access = parseOrganizationAccess(row);
  if (!userId || !orgId || !access) return null;
  const email = String(row.email || '').trim();
  const name = String(row.name || '').trim();
  const projectId = typeof row.projectId === 'string' ? row.projectId.trim() : null;
  return buildDashboardSessionClaims(
    {
      userId,
      orgId,
      platformSupport: row.platformSupport === true,
      email: email || undefined,
      name: name || undefined,
      projectId: projectId || null,
    },
    access,
  );
}

function buildDashboardSessionClaims(
  identity: DashboardConsoleSessionIdentity,
  access: DashboardAccountOrganizationAccess,
): DashboardConsoleSessionClaims {
  switch (access.role) {
    case 'OWNER':
    case 'ADMIN':
      return {
        userId: identity.userId,
        orgId: identity.orgId,
        projectId: identity.projectId,
        platformSupport: identity.platformSupport,
        email: identity.email,
        name: identity.name,
        membershipId: access.membershipId,
        authorizationVersion: access.authorizationVersion,
        role: access.role,
        adminPermissions: access.adminPermissions,
        projectAccess: access.projectAccess,
      };
    case 'MEMBER':
      return {
        userId: identity.userId,
        orgId: identity.orgId,
        projectId: identity.projectId,
        platformSupport: identity.platformSupport,
        email: identity.email,
        name: identity.name,
        membershipId: access.membershipId,
        authorizationVersion: access.authorizationVersion,
        role: 'MEMBER',
        adminPermissions: [],
        projectAccess: access.projectAccess,
      };
    default:
      return assertNeverAccess(access);
  }
}

function assertNeverAccess(access: never): never {
  throw new Error(`Unknown Console access state: ${String(access)}`);
}

export async function fetchDashboardConsoleSession(
  base: string = requireConsoleBaseUrl(),
): Promise<DashboardConsoleSessionClaims> {
  let response: Response;
  try {
    response = await fetch(`${base}/console/session`, {
      method: 'GET',
      headers: buildConsoleAcceptHeaders(),
      credentials: 'include',
      cache: 'no-store',
    });
  } catch (error: unknown) {
    throw normalizeConsoleFetchError({
      error,
      baseUrl: base,
      path: '/console/session',
      operation: 'Console session request',
    });
  }

  const body = (await parseConsoleJson(response)) as DashboardConsoleSessionResponse | null;
  if (!response.ok || body?.ok !== true) {
    const message = consoleErrorMessage(response, body, 'Console session request failed');
    const code = String(body?.code || '').trim();
    const error = new Error(message) as DashboardConsoleSessionError;
    error.code =
      code ||
      (response.status === 403 ? 'forbidden' : response.status === 401 ? 'unauthorized' : '');
    error.status = response.status;
    throw error;
  }
  const claims = parseClaims(body.claims);
  if (!claims) {
    throw new Error('Console session response did not include valid claims');
  }
  return claims;
}

export async function revokeDashboardConsoleSession(): Promise<void> {
  const base = requireConsoleBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${base}/console/auth/revoke`, {
      method: 'POST',
      headers: buildConsoleAcceptHeaders(),
      credentials: 'include',
      cache: 'no-store',
    });
  } catch (error: unknown) {
    throw normalizeConsoleFetchError({
      error,
      baseUrl: base,
      path: '/console/auth/revoke',
      operation: 'Console session revoke request',
    });
  }

  const body = (await parseConsoleJson(response)) as DashboardConsoleSessionRevokeResponse | null;
  if (response.ok && body?.ok === true) {
    return;
  }
  if (response.status === 401) {
    return;
  }
  throw new Error(consoleErrorMessage(response, body, 'Console session revoke failed'));
}

/* Each network has its own Console backend and session cookie, so a switch must read
   the other network's session. The dashboard reads it ahead of the switch, and the
   switch hands the result to the dashboard that opens next. That dashboard shows it at
   once and reads the session again in the background. */
export type PrefetchedDashboardConsoleSession = {
  readonly fetchedAt: number;
  /** The identity has no organization yet, so the dashboard opens onboarding. */
  readonly onboarding: boolean;
  /** Null when the network has no organization session. */
  readonly claims: DashboardConsoleSessionClaims | null;
};

const PREFETCH_REFRESH_AFTER_MS = 30_000;
const PREFETCH_MAX_AGE_MS = 10 * 60_000;
const prefetchedSessions = new Map<ConsoleNetwork, PrefetchedDashboardConsoleSession>();
const prefetchesInFlight = new Set<ConsoleNetwork>();
let switchHandoff: {
  readonly network: ConsoleNetwork;
  readonly session: PrefetchedDashboardConsoleSession;
} | null = null;

/** Reads a network's session for a later switch. A read in the cache stays until a new
    one settles, so a switch never waits for a refresh. */
export function prefetchDashboardConsoleSession(network: ConsoleNetwork): void {
  const current = prefetchedSessions.get(network);
  if (prefetchesInFlight.has(network)) return;
  if (current && Date.now() - current.fetchedAt < PREFETCH_REFRESH_AFTER_MS) return;
  const base = resolveConsoleBaseUrl(consoleDeploymentFor(network));
  if (!base) return;
  prefetchesInFlight.add(network);
  void Promise.all([
    readUnscopedConsoleSession(base).catch(() => false),
    fetchDashboardConsoleSession(base).catch(() => null),
  ])
    .then(([onboarding, claims]) => {
      prefetchedSessions.set(network, { fetchedAt: Date.now(), onboarding, claims });
    })
    .finally(() => {
      prefetchesInFlight.delete(network);
    });
}

/** Called by the network switch: the next dashboard on this network takes the read. */
export function handOffPrefetchedDashboardConsoleSession(network: ConsoleNetwork): void {
  const session = prefetchedSessions.get(network);
  prefetchedSessions.delete(network);
  switchHandoff =
    session && Date.now() - session.fetchedAt < PREFETCH_MAX_AGE_MS ? { network, session } : null;
}

/** The read that the switch handed to this network. Reading it changes nothing, so a
    render may call it more than once. */
export function readDashboardConsoleSessionHandoff(
  network: ConsoleNetwork,
): PrefetchedDashboardConsoleSession | null {
  return switchHandoff?.network === network ? switchHandoff.session : null;
}

export function clearDashboardConsoleSessionHandoff(): void {
  switchHandoff = null;
}

const CONSOLE_SIGN_OUT_FLAG_KEY = 'seams.console.signedOut';

/**
 * Records that the user explicitly signed out. The login page consumes this to
 * skip its auto-resume redirect: if a revoke fails server-side the cookie is
 * still valid, and without the flag the login page would bounce the user
 * straight back into the console they just left.
 */
export function markDashboardConsoleSignOut(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CONSOLE_SIGN_OUT_FLAG_KEY, '1');
  } catch {}
}

/** Reads and clears the sign-out flag; true only for the first read after a sign-out. */
export function consumeDashboardConsoleSignOut(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem(CONSOLE_SIGN_OUT_FLAG_KEY);
    if (!raw) return false;
    window.sessionStorage.removeItem(CONSOLE_SIGN_OUT_FLAG_KEY);
    return true;
  } catch {
    return false;
  }
}

export function DashboardConsoleSessionProvider({
  children,
  prefetchedClaims,
}: {
  children: React.ReactNode;
  /** Claims read before a network switch: shown at once, then read again. */
  prefetchedClaims?: DashboardConsoleSessionClaims | null;
}): React.JSX.Element {
  const [initialClaims] = React.useState(() => prefetchedClaims ?? null);
  const [loading, setLoading] = React.useState<boolean>(!initialClaims);
  const [claims, setClaims] = React.useState<DashboardConsoleSessionClaims | null>(initialClaims);
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [errorCode, setErrorCode] = React.useState<string>('');
  const [errorStatus, setErrorStatus] = React.useState<number | null>(null);

  /* A background read keeps the claims on screen while it runs, and keeps the same
     claims object when nothing changed, so the dashboard does not load again. */
  const refresh = React.useCallback((background = false) => {
    let cancelled = false;
    if (!background) {
      setLoading(true);
      setErrorMessage('');
      setErrorCode('');
      setErrorStatus(null);
    }
    fetchDashboardConsoleSession()
      .then((nextClaims) => {
        if (cancelled) return;
        setClaims((current) =>
          current && JSON.stringify(current) === JSON.stringify(nextClaims) ? current : nextClaims,
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const parsed = asSessionError(error);
        setClaims(null);
        setErrorMessage(parsed.message || String(error));
        setErrorCode(String(parsed.code || '').trim());
        setErrorStatus(typeof parsed.status === 'number' ? parsed.status : null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => refresh(Boolean(initialClaims)), [initialClaims, refresh]);

  const value = React.useMemo<DashboardConsoleSessionState>(
    () => ({
      loading,
      claims,
      errorMessage,
      errorCode,
      errorStatus,
      refresh: () => {
        refresh();
      },
    }),
    [claims, errorCode, errorMessage, errorStatus, loading, refresh],
  );

  return (
    <DashboardConsoleSessionContext.Provider value={value}>
      {children}
    </DashboardConsoleSessionContext.Provider>
  );
}

export function useDashboardConsoleSession(): DashboardConsoleSessionState {
  const context = React.useContext(DashboardConsoleSessionContext);
  if (context) return context;
  return {
    loading: false,
    claims: null,
    errorMessage: 'Console session context is unavailable',
    errorCode: 'console_session_context_unavailable',
    errorStatus: null,
    refresh: () => {},
  };
}
