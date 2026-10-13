import { readPersistedDashboardSelectedContext } from '@core/dashboard/useDashboardUiPreferences';

type WalletRequestSelection =
  | { kind: 'selected'; projectId: string; environmentId: string }
  | { kind: 'unselected'; projectId?: never; environmentId?: never };

function readWalletRequestSelection(): WalletRequestSelection {
  const selected = readPersistedDashboardSelectedContext();
  const projectId = selected.project?.trim() ?? '';
  const environmentId = selected.environment?.trim() ?? '';
  if (!projectId || !environmentId) return { kind: 'unselected' };
  return { kind: 'selected', projectId, environmentId };
}

export function buildWalletAcceptHeaders(): HeadersInit {
  const headers = new Headers({ Accept: 'application/json' });
  const selection = readWalletRequestSelection();
  if (selection.kind === 'selected') {
    headers.set('X-Console-Project-Id', selection.projectId);
    headers.set('X-Console-Environment-Id', selection.environmentId);
  }
  return headers;
}

export function buildWalletJsonHeaders(): HeadersInit {
  const headers = new Headers(buildWalletAcceptHeaders());
  headers.set('Content-Type', 'application/json');
  return headers;
}
