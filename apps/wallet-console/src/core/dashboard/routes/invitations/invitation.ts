import {
  buildConsoleJsonHeaders,
  fetchConsoleEndpoint,
  requireConsoleBaseUrl,
} from '../../consoleHttp';

const INVITATION_STORAGE_KEY = 'seams.console.pendingInvitation';

export interface DashboardInvitation {
  readonly invitationId: string;
  readonly token: string;
}

export type InvitationAcceptanceResult =
  | { readonly ok: true; readonly orgId: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

function objectField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Reflect.get(value, key);
}

function parseInvitation(value: unknown): DashboardInvitation | null {
  const invitationId = objectField(value, 'invitationId');
  const token = objectField(value, 'token');
  if (typeof invitationId !== 'string' || !invitationId.trim()) return null;
  if (typeof token !== 'string' || !token.trim()) return null;
  return { invitationId: invitationId.trim(), token: token.trim() };
}

export function readPendingDashboardInvitation(): DashboardInvitation | null {
  try {
    const saved = window.sessionStorage.getItem(INVITATION_STORAGE_KEY);
    return saved ? parseInvitation(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

export function clearPendingDashboardInvitation(): void {
  window.sessionStorage.removeItem(INVITATION_STORAGE_KEY);
}

export function readDashboardInvitationLink(): DashboardInvitation | null {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('invitation_id') && !url.searchParams.has('token')) {
    return readPendingDashboardInvitation();
  }
  const invitation = parseInvitation({
    invitationId: url.searchParams.get('invitation_id'),
    token: url.searchParams.get('token'),
  });
  clearPendingDashboardInvitation();
  if (invitation) {
    window.sessionStorage.setItem(INVITATION_STORAGE_KEY, JSON.stringify(invitation));
  }
  // The provider receives a fixed login callback. Keep the invitation secret out of that URL.
  url.searchParams.delete('invitation_id');
  url.searchParams.delete('token');
  window.history.replaceState(window.history.state, '', url.pathname + url.search);
  return invitation;
}

function parseAcceptanceResponse(value: unknown): InvitationAcceptanceResult {
  const ok = objectField(value, 'ok');
  if (ok === true) {
    const orgId = objectField(objectField(value, 'membership'), 'orgId');
    if (typeof orgId === 'string' && orgId.trim()) return { ok: true, orgId: orgId.trim() };
  }
  if (ok === false) {
    const code = objectField(value, 'code');
    const message = objectField(value, 'message');
    if (typeof code === 'string' && typeof message === 'string') {
      if (code === 'invitation_email_mismatch') {
        return {
          ok: false,
          code,
          message:
            'This invitation belongs to another email address. Use the account that received it.',
        };
      }
      return { ok: false, code, message };
    }
  }
  return {
    ok: false,
    code: 'invalid_response',
    message: 'The invitation response was invalid. Try again.',
  };
}

export async function acceptDashboardInvitation(
  invitation: DashboardInvitation,
): Promise<InvitationAcceptanceResult> {
  const baseUrl = requireConsoleBaseUrl();
  const path = `/console/account/invitations/${encodeURIComponent(invitation.invitationId)}/accept`;
  try {
    const response = await fetchConsoleEndpoint(
      `${baseUrl}${path}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: buildConsoleJsonHeaders(),
        body: JSON.stringify({ token: invitation.token }),
      },
      { baseUrl, path, operation: 'Invitation acceptance' },
    );
    const body: unknown = await response.json();
    const result = parseAcceptanceResponse(body);
    if (!response.ok && result.ok) {
      return { ok: false, code: 'invalid_response', message: 'Invitation acceptance failed.' };
    }
    return result;
  } catch (error: unknown) {
    return {
      ok: false,
      code: 'request_failed',
      message: error instanceof Error ? error.message : 'Invitation acceptance failed. Try again.',
    };
  }
}
