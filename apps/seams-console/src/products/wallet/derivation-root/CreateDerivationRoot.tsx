import React from 'react';
import { useDashboardConsoleSession } from '@core/dashboard/consoleSession';
import { requireConsoleBaseUrl } from '@core/dashboard/consoleHttp';
import { createDerivationRoot } from './consoleDerivationRootApi';

type CreationState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'creating' }
  | { readonly kind: 'error'; readonly message: string };

async function submitCreation(
  storageKey: string,
  busy: React.MutableRefObject<boolean>,
  setState: React.Dispatch<React.SetStateAction<CreationState>>,
  refresh: () => Promise<void>,
): Promise<void> {
  if (busy.current) return;
  busy.current = true;
  setState({ kind: 'creating' });
  try {
    const operationId = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    // Keep the operation across reloads and uncertain responses.
    sessionStorage.setItem(storageKey, operationId);
    await createDerivationRoot(operationId);
    await refresh();
    setState({ kind: 'idle' });
  } catch (error: unknown) {
    setState({ kind: 'error', message: error instanceof Error ? error.message : 'Creation could not be confirmed. Retry to resume.' });
  } finally {
    busy.current = false;
  }
}

function CreationButton({ storageKey, refresh }: {
  readonly storageKey: string;
  readonly refresh: () => Promise<void>;
}): React.JSX.Element {
  const [state, setState] = React.useState<CreationState>({ kind: 'idle' });
  const busy = React.useRef(false);
  return <>
    <p>Create the root for this environment to enable signing and recovery setup.</p>
    <button type="button" className="dashboard-pagination-button"
      disabled={state.kind === 'creating'}
      onClick={submitCreation.bind(null, storageKey, busy, setState, refresh)}>
      {state.kind === 'creating' ? 'Creating derivation root…' : state.kind === 'error' ? 'Retry creation' : 'Create derivation root'}
    </button>
    {state.kind === 'creating' && <p role="status">Creating your derivation root. This may take a moment.</p>}
    {state.kind === 'error' && <p className="derivation-root-error" role="alert">{state.message}</p>}
  </>;
}

export function CreateDerivationRoot({ refresh }: { readonly refresh: () => Promise<void> }): React.JSX.Element {
  const { claims } = useDashboardConsoleSession();
  if (!claims?.projectId || !claims.environmentId) return <p>Select an environment to create its derivation root.</p>;
  if (claims.role !== 'OWNER' && !(claims.role === 'ADMIN' && claims.adminPermissions.includes('projects.manage'))) {
    return <p>Ask an organization owner or an administrator with project management access to create this root.</p>;
  }
  const storageKey = `seams:tenant-root-creation:${JSON.stringify([requireConsoleBaseUrl(), claims.orgId, claims.projectId, claims.environmentId])}`;
  return <CreationButton key={storageKey} storageKey={storageKey} refresh={refresh} />;
}
