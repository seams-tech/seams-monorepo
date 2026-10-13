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
} from './consoleHttp';

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

export async function fetchDashboardConsoleSession(): Promise<DashboardConsoleSessionClaims> {
  const base = requireConsoleBaseUrl();
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
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [loading, setLoading] = React.useState<boolean>(true);
  const [claims, setClaims] = React.useState<DashboardConsoleSessionClaims | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [errorCode, setErrorCode] = React.useState<string>('');
  const [errorStatus, setErrorStatus] = React.useState<number | null>(null);

  const refresh = React.useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage('');
    setErrorCode('');
    setErrorStatus(null);
    fetchDashboardConsoleSession()
      .then((nextClaims) => {
        if (cancelled) return;
        setClaims(nextClaims);
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

  React.useEffect(() => {
    const cleanup = refresh();
    return cleanup;
  }, [refresh]);

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
