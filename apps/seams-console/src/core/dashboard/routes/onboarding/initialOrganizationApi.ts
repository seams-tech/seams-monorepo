import { parseConsoleJson, requireConsoleBaseUrl } from '../../consoleHttp';

export async function readUnscopedConsoleSession(base: string): Promise<boolean> {
  const response = await fetch(`${base}/console/auth/session`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) return false;
  const body = await parseConsoleJson(response);
  return body?.ok === true && body.session?.kind === 'console_identity_v1';
}

export async function createInitialOrganization(name: string, slug: string): Promise<void> {
  const response = await fetch(`${requireConsoleBaseUrl()}/console/account/organizations`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ name, slug }),
  });
  const body = await parseConsoleJson(response);
  if (!response.ok || body?.ok !== true || body.session?.kind !== 'console_session_v1') {
    throw new Error(body?.message || 'Organization creation failed. Try again.');
  }
}
