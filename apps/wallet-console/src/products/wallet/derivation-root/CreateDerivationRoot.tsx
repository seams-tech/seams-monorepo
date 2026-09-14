import React from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useDashboardConsoleSession } from '@core/dashboard/consoleSession';
import { requireConsoleBaseUrl } from '@core/dashboard/consoleHttp';
import { createDerivationRoot } from './consoleDerivationRootApi';

type CreationState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'creating' }
  | { readonly kind: 'refreshing' }
  | { readonly kind: 'refreshed' }
  | {
      readonly kind: 'error';
      readonly action: 'creation' | 'refresh';
      readonly message: string;
    };

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
    setState({
      kind: 'error',
      action: 'creation',
      message:
        error instanceof Error
          ? error.message
          : 'Creation could not be confirmed. Retry to resume.',
    });
  } finally {
    busy.current = false;
  }
}

async function submitRefresh(
  busy: React.MutableRefObject<boolean>,
  setState: React.Dispatch<React.SetStateAction<CreationState>>,
  refresh: () => Promise<void>,
): Promise<void> {
  if (busy.current) return;
  busy.current = true;
  setState({ kind: 'refreshing' });
  try {
    await refresh();
    setState({ kind: 'refreshed' });
  } catch (error: unknown) {
    setState({
      kind: 'error',
      action: 'refresh',
      message: error instanceof Error ? error.message : 'The latest status could not be loaded.',
    });
  } finally {
    busy.current = false;
  }
}

function CreationButton({
  storageKey,
  refresh,
}: {
  readonly storageKey: string;
  readonly refresh: () => Promise<void>;
}): React.JSX.Element {
  const [state, setState] = React.useState<CreationState>({ kind: 'idle' });
  const busy = React.useRef(false);
  const pending = state.kind === 'creating' || state.kind === 'refreshing';
  return (
    <div className="derivation-root-create-flow">
      <div className="derivation-root-create-actions">
        <button
          type="button"
          className="dashboard-pagination-button dashboard-pagination-button--primary dashboard-pagination-button--with-icon"
          disabled={pending}
          onClick={submitCreation.bind(null, storageKey, busy, setState, refresh)}
        >
          {state.kind === 'creating' && (
            <LoaderCircle className="derivation-root-spinner" size={16} aria-hidden="true" />
          )}
          {state.kind === 'creating'
            ? 'Creating derivation root…'
            : state.kind === 'error' && state.action === 'creation'
              ? 'Retry creation'
              : 'Create derivation root'}
        </button>
        <button
          type="button"
          className="dashboard-pagination-button dashboard-pagination-button--secondary dashboard-pagination-button--with-icon"
          disabled={pending}
          onClick={submitRefresh.bind(null, busy, setState, refresh)}
        >
          <RefreshCw
            className={state.kind === 'refreshing' ? 'derivation-root-spinner' : undefined}
            size={16}
            aria-hidden="true"
          />
          {state.kind === 'refreshing' ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {state.kind === 'creating' && (
        <div className="derivation-root-create-feedback" role="status" aria-live="polite">
          <LoaderCircle className="derivation-root-spinner" size={17} aria-hidden="true" />
          <p>Creating your derivation root. This may take a moment.</p>
        </div>
      )}
      {state.kind === 'refreshing' && (
        <div className="derivation-root-create-feedback" role="status" aria-live="polite">
          <LoaderCircle className="derivation-root-spinner" size={17} aria-hidden="true" />
          <p>Checking the latest root status…</p>
        </div>
      )}
      {state.kind === 'refreshed' && (
        <p className="derivation-root-create-note" role="status" aria-live="polite">
          Status refreshed. No derivation root is active yet.
        </p>
      )}
      {state.kind === 'error' && (
        <div className="derivation-root-create-feedback derivation-root-create-feedback--error">
          <p className="derivation-root-error" role="alert">
            {state.message}
          </p>
        </div>
      )}
    </div>
  );
}

export function CreateDerivationRoot({
  refresh,
}: {
  readonly refresh: () => Promise<void>;
}): React.JSX.Element {
  const { claims } = useDashboardConsoleSession();
  if (!claims?.projectId || !claims.environmentId)
    return (
      <p className="derivation-root-empty-guidance">
        Select an environment to create its derivation root.
      </p>
    );
  if (
    claims.role !== 'OWNER' &&
    !(claims.role === 'ADMIN' && claims.adminPermissions.includes('projects.manage'))
  ) {
    return (
      <p className="derivation-root-empty-guidance">
        Ask an organization owner or an administrator with project management access to create this
        root.
      </p>
    );
  }
  const storageKey = `seams:tenant-root-creation:${JSON.stringify([requireConsoleBaseUrl(), claims.orgId, claims.projectId, claims.environmentId])}`;
  return <CreationButton key={storageKey} storageKey={storageKey} refresh={refresh} />;
}
