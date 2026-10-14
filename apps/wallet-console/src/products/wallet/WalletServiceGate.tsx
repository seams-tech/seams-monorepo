import React from 'react';
import { useDashboardConsoleSession } from '@core/dashboard/consoleSession';
import { DashboardLoadingState } from '@core/dashboard/components/DashboardLoadingState';
import { requireConsoleBaseUrl } from '@core/dashboard/consoleHttp';
import { DASHBOARD_ENVIRONMENTS_UPDATED_EVENT } from '@core/dashboard/consoleContextApi';
import { useDashboardSelectedContext } from '@core/dashboard/selectedContext';
import {
  changeProjectService,
  getServiceStatus,
  isEnableableService,
  type ServiceOperation,
  type ServiceStatus,
} from '@core/dashboard/routes/services/consoleServicesApi';

type SetupState =
  | { kind: 'loading' }
  | { kind: 'ready'; service: ServiceStatus }
  | { kind: 'enabling' }
  | { kind: 'failed'; message: string };

function operationStorageKey(organizationId: string, projectId: string): string {
  return `seams:wallet-enable:${JSON.stringify([requireConsoleBaseUrl(), organizationId, projectId])}`;
}

function readStoredOperation(key: string): ServiceOperation | null {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? 'null');
    if (
      typeof value !== 'object' ||
      value === null ||
      !('operationId' in value) ||
      typeof value.operationId !== 'string' ||
      !value.operationId.trim() ||
      !('desiredRevision' in value) ||
      typeof value.desiredRevision !== 'number' ||
      !Number.isSafeInteger(value.desiredRevision) ||
      value.desiredRevision < 1
    )
      return null;
    return { operationId: value.operationId, desiredRevision: value.desiredRevision };
  } catch {
    return null;
  }
}

function retainPendingOperation(key: string, service: ServiceStatus): void {
  if (service.kind === 'absent') return;
  if (service.kind === 'provisioning') {
    writeStoredOperation(key, {
      operationId: service.operationId,
      desiredRevision: service.desiredRevision,
    });
    return;
  }
  try {
    window.sessionStorage.removeItem(key);
  } catch {}
}

function writeStoredOperation(key: string, operation: ServiceOperation): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(operation));
  } catch {
    throw new Error(
      'This browser could not save Wallet setup progress. Allow site storage and retry.',
    );
  }
}

interface WalletProjectSetupProps {
  readonly organizationId: string;
  readonly projectId: string;
  readonly canEnable: boolean;
  readonly children: React.ReactNode;
}

interface WalletSetupOptions {
  readonly organizationId: string;
  readonly projectId: string;
  readonly canEnable: boolean;
  readonly setState: React.Dispatch<React.SetStateAction<SetupState>>;
}

// Each mounted project owns its requests and polling. A previous project cannot
// update the next project's gate after navigation or a session change.
class WalletSetup {
  private readonly key: string;
  private readonly cancellation = new AbortController();
  private timer: number | null = null;
  private polls = 0;

  constructor(private readonly options: WalletSetupOptions) {
    this.key = operationStorageKey(options.organizationId, options.projectId);
  }

  stop(): void {
    this.cancellation.abort();
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  async load(resume: boolean): Promise<void> {
    const { organizationId, projectId, canEnable, setState } = this.options;
    try {
      let service = await getServiceStatus(organizationId, projectId, 'wallet');
      if (this.cancellation.signal.aborted) return;
      retainPendingOperation(this.key, service);
      if (resume && canEnable && service.kind !== 'disabled' && isEnableableService(service)) {
        const operation = readStoredOperation(this.key) ?? {
          operationId: crypto.randomUUID(),
          desiredRevision: service.kind === 'absent' ? 1 : service.desiredRevision + 1,
        };
        writeStoredOperation(this.key, operation);
        setState({ kind: 'enabling' });
        service = await changeProjectService(
          organizationId,
          projectId,
          'wallet',
          'enable',
          operation,
        );
        if (this.cancellation.signal.aborted) return;
        retainPendingOperation(this.key, service);
      }
      if (service.kind === 'provisioning') {
        this.polls += 1;
        if (this.polls >= 60) {
          throw new Error(
            'Wallet setup is taking longer than expected. Retry to check its progress.',
          );
        }
        setState({ kind: 'enabling' });
        this.timer = window.setTimeout(this.load.bind(this, false), 1000);
        return;
      }
      setState({ kind: 'ready', service });
      if (service.kind === 'active') {
        window.dispatchEvent(new Event(DASHBOARD_ENVIRONMENTS_UPDATED_EVENT));
      }
    } catch (error: unknown) {
      if (this.cancellation.signal.aborted) return;
      setState({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Wallet setup could not be completed.',
      });
    }
  }
}

function startWalletSetup(options: WalletSetupOptions, _attempt: number): () => void {
  const setup = new WalletSetup(options);
  options.setState({ kind: 'loading' });
  void setup.load(true);
  return setup.stop.bind(setup);
}

function nextAttempt(attempt: number): number {
  return attempt + 1;
}

function setupDescription(service: ServiceStatus): string {
  switch (service.kind) {
    case 'absent':
      return 'An organization owner or administrator with project management access must open this project to finish Wallet setup.';
    case 'disabled':
      return 'Wallet access is disabled for this project. Contact your organization administrator.';
    case 'failed':
      return 'Wallet setup failed. Retry to check its progress.';
    case 'archived':
      return 'This Wallet instance is archived. Select another project to continue.';
    case 'active':
      return 'Select a Wallet environment to continue.';
    case 'provisioning':
      return 'Wallet setup is in progress.';
    default:
      return assertNever(service);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown Wallet setup state: ${String(value)}`);
}

function WalletProjectSetup({
  organizationId,
  projectId,
  canEnable,
  children,
}: WalletProjectSetupProps): React.JSX.Element {
  const selected = useDashboardSelectedContext();
  const [state, setState] = React.useState<SetupState>({ kind: 'loading' });
  const [attempt, retry] = React.useReducer(nextAttempt, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- All bound inputs are dependencies; setState is stable.
  React.useEffect(
    startWalletSetup.bind(null, { organizationId, projectId, canEnable, setState }, attempt),
    [organizationId, projectId, canEnable, attempt],
  );
  switch (state.kind) {
    case 'loading':
    case 'enabling':
      return <DashboardLoadingState title="Preparing Wallet..." />;
    case 'failed':
      return (
        <section className="dashboard-view__section">
          <h2>Wallet setup unavailable</h2>
          <p role="alert">{state.message}</p>
          <button type="button" className="dashboard-pagination-button" onClick={retry}>
            Retry setup
          </button>
        </section>
      );
    case 'ready':
      if (state.service.kind === 'active') {
        if (selected.environment) return <>{children}</>;
        return <DashboardLoadingState title="Loading Wallet environments..." />;
      }
      return (
        <section className="dashboard-view__section">
          <h2>Wallet unavailable</h2>
          <p>{setupDescription(state.service)}</p>
          <button type="button" className="dashboard-pagination-button" onClick={retry}>
            Check again
          </button>
        </section>
      );
    default:
      return assertNever(state);
  }
}

export function WalletServiceGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { claims } = useDashboardConsoleSession();
  const selected = useDashboardSelectedContext();
  if (!claims || !selected.project) {
    return <DashboardLoadingState title="Loading project..." />;
  }
  const canEnable =
    claims.role === 'OWNER' ||
    (claims.role === 'ADMIN' && claims.adminPermissions.includes('projects.manage'));
  return (
    <WalletProjectSetup
      key={JSON.stringify([claims.userId, claims.orgId, selected.project])}
      organizationId={claims.orgId}
      projectId={selected.project}
      canEnable={canEnable}
    >
      {children}
    </WalletProjectSetup>
  );
}
