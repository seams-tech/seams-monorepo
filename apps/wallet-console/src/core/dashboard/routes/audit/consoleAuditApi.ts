import {
  buildConsoleAcceptHeaders,
  consoleErrorMessage,
  parseConsoleJson,
  requireConsoleBaseUrl,
} from '../../consoleHttp';

export type DashboardConsoleAuditCategory =
  | 'POLICY'
  | 'SETTINGS'
  | 'KEY_EXPORT'
  | 'BILLING'
  | 'WEBHOOK'
  | 'API_KEY'
  | 'TEAM'
  | 'APPROVAL'
  | 'ORG_PROJECT_ENV'
  | 'RUNTIME_SNAPSHOT'
  | 'SYSTEM';

export type DashboardConsoleAuditOutcome = 'SUCCESS' | 'FAILURE' | 'PENDING';
export type DashboardConsolePolicyKind = 'TRANSACTION' | 'GAS_SPONSORSHIP';
export interface DashboardConsoleAuditEvent {
  id: string;
  orgId: string;
  projectId?: string;
  environmentId?: string;
  policyId: string | null;
  policyName: string | null;
  policyKind: DashboardConsolePolicyKind | null;
  actorUserId: string;
  actorType: 'USER' | 'SYSTEM';
  category: DashboardConsoleAuditCategory;
  action: string;
  outcome: DashboardConsoleAuditOutcome;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface ConsoleAuditEventsResponse {
  ok?: boolean;
  code?: string;
  message?: string;
  events?: unknown;
}

const CATEGORY_SET = new Set<DashboardConsoleAuditCategory>([
  'POLICY',
  'SETTINGS',
  'KEY_EXPORT',
  'BILLING',
  'WEBHOOK',
  'API_KEY',
  'TEAM',
  'APPROVAL',
  'ORG_PROJECT_ENV',
  'RUNTIME_SNAPSHOT',
  'SYSTEM',
]);
const OUTCOME_SET = new Set<DashboardConsoleAuditOutcome>(['SUCCESS', 'FAILURE', 'PENDING']);
function decodePolicyKind(raw: unknown): DashboardConsolePolicyKind | null {
  const value = String(raw || '')
    .trim()
    .toUpperCase();
  if (value === 'TRANSACTION' || value === 'GAS_SPONSORSHIP') return value;
  return null;
}

function decodeAuditEvent(raw: unknown): DashboardConsoleAuditEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || '').trim();
  const orgId = String(row.orgId || '').trim();
  const actorUserId = String(row.actorUserId || '').trim();
  const category = String(row.category || '')
    .trim()
    .toUpperCase() as DashboardConsoleAuditCategory;
  const outcome = String(row.outcome || '')
    .trim()
    .toUpperCase() as DashboardConsoleAuditOutcome;
  if (!id || !orgId || !actorUserId || !CATEGORY_SET.has(category) || !OUTCOME_SET.has(outcome)) {
    return null;
  }
  const actorType = String(row.actorType || '')
    .trim()
    .toUpperCase();
  return {
    id,
    orgId,
    ...(row.projectId ? { projectId: String(row.projectId || '').trim() } : {}),
    ...(row.environmentId ? { environmentId: String(row.environmentId || '').trim() } : {}),
    policyId: String(row.policyId || '').trim() || null,
    policyName: String(row.policyName || '').trim() || null,
    policyKind: decodePolicyKind(row.policyKind),
    actorUserId,
    actorType: actorType === 'SYSTEM' ? 'SYSTEM' : 'USER',
    category,
    action: String(row.action || '').trim(),
    outcome,
    summary: String(row.summary || '').trim(),
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? { ...(row.metadata as Record<string, unknown>) }
        : {},
    createdAt: String(row.createdAt || '').trim(),
  };
}

function appendOptionalQuery(url: URL, key: string, value: string | undefined): void {
  const normalized = String(value || '').trim();
  if (!normalized) return;
  url.searchParams.set(key, normalized);
}

export async function listDashboardAuditEvents(input?: {
  projectId?: string;
  environmentId?: string;
  category?: DashboardConsoleAuditCategory;
  actorUserId?: string;
  outcome?: DashboardConsoleAuditOutcome;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<DashboardConsoleAuditEvent[]> {
  const base = requireConsoleBaseUrl();
  const url = new URL('/console/audit/events', base);
  appendOptionalQuery(url, 'projectId', input?.projectId);
  appendOptionalQuery(url, 'environmentId', input?.environmentId);
  appendOptionalQuery(url, 'category', input?.category);
  appendOptionalQuery(url, 'actorUserId', input?.actorUserId);
  appendOptionalQuery(url, 'outcome', input?.outcome);
  appendOptionalQuery(url, 'q', input?.q);
  appendOptionalQuery(url, 'from', input?.from);
  appendOptionalQuery(url, 'to', input?.to);
  if (Number.isFinite(Number(input?.limit)) && Number(input?.limit) > 0) {
    url.searchParams.set('limit', String(Math.floor(Number(input?.limit))));
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: buildConsoleAcceptHeaders(),
    credentials: 'include',
    cache: 'no-store',
  });
  const body = (await parseConsoleJson(response)) as ConsoleAuditEventsResponse | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(consoleErrorMessage(response, body, 'Audit event list request failed'));
  }
  const rows = Array.isArray(body?.events) ? body.events : [];
  return rows
    .map((entry) => decodeAuditEvent(entry))
    .filter((entry): entry is DashboardConsoleAuditEvent => entry !== null);
}

export interface DashboardConsoleAuditActivityBin {
  startMs: number;
  endMs: number;
  total: number;
  failures: number;
}

interface ConsoleAuditActivityResponse {
  ok?: boolean;
  code?: string;
  message?: string;
  bins?: unknown;
}

function decodeActivityBin(raw: unknown): DashboardConsoleAuditActivityBin | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const startMs = Number(row.startMs);
  const endMs = Number(row.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return {
    startMs,
    endMs,
    total: Math.max(0, Math.floor(Number(row.total) || 0)),
    failures: Math.max(0, Math.floor(Number(row.failures) || 0)),
  };
}

/* Counts for the activity chart over the whole range, so the chart is not
   limited to the one page of events the table lists. */
export async function getDashboardAuditActivity(input: {
  projectId?: string;
  environmentId?: string;
  category?: DashboardConsoleAuditCategory;
  actorUserId?: string;
  outcome?: DashboardConsoleAuditOutcome;
  q?: string;
  from: string;
  to: string;
  bins: number;
  includeOrgScoped: boolean;
}): Promise<DashboardConsoleAuditActivityBin[]> {
  const base = requireConsoleBaseUrl();
  const url = new URL('/console/audit/activity', base);
  appendOptionalQuery(url, 'projectId', input.projectId);
  appendOptionalQuery(url, 'environmentId', input.environmentId);
  appendOptionalQuery(url, 'category', input.category);
  appendOptionalQuery(url, 'actorUserId', input.actorUserId);
  appendOptionalQuery(url, 'outcome', input.outcome);
  appendOptionalQuery(url, 'q', input.q);
  url.searchParams.set('from', input.from);
  url.searchParams.set('to', input.to);
  url.searchParams.set('bins', String(input.bins));
  if (input.includeOrgScoped) url.searchParams.set('includeOrgScoped', 'true');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: buildConsoleAcceptHeaders(),
    credentials: 'include',
    cache: 'no-store',
  });
  const body = (await parseConsoleJson(response)) as ConsoleAuditActivityResponse | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(consoleErrorMessage(response, body, 'Audit activity request failed'));
  }
  const rows = Array.isArray(body?.bins) ? body.bins : [];
  return rows
    .map((entry) => decodeActivityBin(entry))
    .filter((entry): entry is DashboardConsoleAuditActivityBin => entry !== null);
}
