import { shellQuote } from './recoveryKeySetupCommand';
import { CliRestoreApproval } from './CliRestoreApproval';
import { listDashboardOrganizationMemberships } from '@core/dashboard/routes/team-members/consoleTeamRbacApi';
import { CliBackupApproval } from './CliBackupApproval';
import { CliEnrollmentApproval } from './CliEnrollmentApproval';
import { VerificationMethodChoice, type VerificationMethod } from './VerificationMethodChoice';
import { CreateDerivationRoot } from './CreateDerivationRoot';
import type { DashboardDerivationRootStatus } from './consoleDerivationRootApi';
import React from 'react';
import './derivationRootSecurity.css';
import { toast } from 'sonner';
import {
  Archive,
  ShieldCheck,
  CircleCheck,
  CircleHelp,
  CircleX,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { DashboardInlineModal } from '@core/dashboard/components/DashboardInlineModal';
import { CopyButton } from '@core/components/CopyButton';
import { requireConsoleBaseUrl } from '@core/dashboard/consoleHttp';
import { formatDashboardTimestamp } from '@core/dashboard/utils/timestamps';
import type { TenantRootSecurityStatusV1 } from '@seams-internal/shared-ts/tenant-root';
import {
  tenantRootDownloadableRecoverySetV1,
  tenantRootRotationPermitsHealingClaimV1,
} from '@seams-internal/shared-ts/tenant-root';
import {
  createRecoveryBackup,
  commitRecoveryKeys,
  readDerivationRootSecurityStatus,
  setRecoveryGovernance,
  startOperationalShareRotation,
  readOperationalShareRotation,
  type DashboardRotationOutcome,
  type DashboardCustodyOutcome,
  type DashboardRecoveryGovernanceChoice,
} from './consoleDerivationRootApi';
import {
  enrolCliCommands,
  recoveryActions,
  restoreCliCommands,
  recoveryStatusLine,
  restoreStatusLine,
  retiredShareClaim,
  rotationPhaseIndex,
  rotationStatusLine,
  shouldWarnBackupNeverDownloaded,
  sourceDispositionStatusLine,
  ROTATION_PHASES,
  type DerivationRootCliCommand,
  type DerivationRootStatusLine,
} from './derivationRootPresentation';

/**
 * The Threshold Keys page.
 *
 * The page renders the server's state branches rather than deriving its own
 * conclusions from them, so a claim can only appear on screen if the server
 * actually reported the state that permits it.
 */

const TONE_CLASS: Record<DerivationRootStatusLine['tone'], string> = {
  neutral: 'dashboard-status dashboard-status--neutral',
  progress: 'dashboard-status dashboard-status--progress',
  warning: 'dashboard-status dashboard-status--warning',
  danger: 'dashboard-status dashboard-status--danger',
  success: 'dashboard-status dashboard-status--success',
};

const TONE_ICON: Record<DerivationRootStatusLine['tone'], LucideIcon> = {
  neutral: CircleHelp,
  progress: LoaderCircle,
  warning: TriangleAlert,
  danger: CircleX,
  success: CircleCheck,
};

/** Status text and an icon; colour never carries the status alone. */
function StatusLine({ line }: { line: DerivationRootStatusLine }): React.JSX.Element {
  const Icon = TONE_ICON[line.tone];
  return (
    <p className={TONE_CLASS[line.tone]}>
      <Icon size={16} aria-hidden="true" />
      <span>
        <strong>{line.label}</strong>
        <span>{line.detail}</span>
      </span>
    </p>
  );
}

const DERIVER_HEALTH: Record<
  TenantRootSecurityStatusV1['operationalShares']['deriverAStatus'],
  { readonly label: string; readonly tone: DerivationRootStatusLine['tone'] }
> = {
  healthy: { label: 'Healthy', tone: 'success' },
  degraded: { label: 'Degraded', tone: 'warning' },
  unavailable: { label: 'Unavailable', tone: 'danger' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

function DeriverHealthBadge({
  health,
}: {
  health: TenantRootSecurityStatusV1['operationalShares']['deriverAStatus'];
}): React.JSX.Element {
  const { label, tone } = DERIVER_HEALTH[health];
  const Icon = TONE_ICON[tone];
  return (
    <span className={`derivation-root-health derivation-root-health--${tone}`}>
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

type RestoreAccessState =
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'ready'; destination: string; restoration: 'active' | 'pending' | 'unavailable' };

async function loadRestoreAccess(
  signal: AbortSignal,
  setAccess: React.Dispatch<React.SetStateAction<RestoreAccessState>>,
  setDestination: React.Dispatch<React.SetStateAction<string>>,
): Promise<void> {
  try {
    const response = await fetch(
      `${requireConsoleBaseUrl()}/console/tenant-root/security/restore-access`,
      { credentials: 'include', signal },
    );
    const body: unknown = await response.json();
    if (
      !response.ok ||
      typeof body !== 'object' ||
      body === null ||
      !('destination' in body) ||
      typeof body.destination !== 'string'
    ) {
      throw new Error(
        'Recovery access has not been configured for this environment. Contact your deployment administrator to prepare a recovery destination. Your backup files are unchanged.',
      );
    }
    const destination = parseRestoreDestination(body.destination);
    if (destination === null)
      throw new Error(
        'The configured recovery destination is invalid. Contact your deployment administrator.',
      );
    setDestination(destination);
    const restoration =
      'restoration' in body && (body.restoration === 'active' || body.restoration === 'pending')
        ? body.restoration
        : 'unavailable';
    setAccess({ kind: 'ready', destination, restoration });
  } catch (error) {
    if (!signal.aborted)
      setAccess({
        kind: 'unavailable',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to check recovery access. Refresh this page to retry.',
      });
  }
}

function beginRestoreAccess(
  environment: string | null,
  setAccess: React.Dispatch<React.SetStateAction<RestoreAccessState>>,
  setDestination: React.Dispatch<React.SetStateAction<string>>,
): (() => void) | undefined {
  if (environment === null) return;
  const controller = new AbortController();
  void loadRestoreAccess(controller.signal, setAccess, setDestination);
  const interval = window.setInterval(
    loadRestoreAccess.bind(null, controller.signal, setAccess, setDestination),
    5000,
  );
  return stopRestoreAccess.bind(null, controller, interval);
}

function stopRestoreAccess(controller: AbortController, interval: number): void {
  controller.abort();
  window.clearInterval(interval);
}

function parseRestoreDestination(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function changeRestoreDestination(
  setValue: (value: string) => void,
  event: React.ChangeEvent<HTMLInputElement>,
): void {
  setValue(event.currentTarget.value);
}

/** A long identifier shown short, with its full value available. */
function ShortId({
  label,
  value,
  full = false,
}: {
  label: string;
  value: string;
  full?: boolean;
}): React.JSX.Element {
  const shortened = !full && value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
  return (
    <span className="dashboard-shortid">
      <code aria-hidden="true" title={value}>
        {shortened}
      </code>
      <span className="sr-only">{`${label}: ${value}`}</span>
      <CopyButton
        text={value}
        size={14}
        className="dashboard-shortid__copy"
        ariaLabel={`Copy ${label}`}
        onCopy={toast.success.bind(null, `${label} copied`)}
        onCopyError={toast.error.bind(null, `Could not copy ${label}. Try again.`)}
      />
    </span>
  );
}

function walletCliInstallCommand(): DerivationRootCliCommand {
  return {
    label: 'Install the Seams wallet CLI',
    command: 'npm install --global @seams/wallet-cli@0.4.1',
    note: 'Run once to install the CLI. Requires Node.js 22 or later.',
  };
}

function authorizeRestoreCommand(
  consoleUrl: string,
  environment: string,
  command: DerivationRootCliCommand,
): DerivationRootCliCommand {
  return {
    label: command.label,
    note: command.note,
    command: `${command.command} --console-url ${shellQuote(consoleUrl)} --environment ${shellQuote(environment)}`,
  };
}

function renderCommandToken(token: string, index: number): React.ReactNode {
  if (token.startsWith('@seams/wallet-cli@')) {
    return (
      <span key={index} className="derivation-root-command-package">
        {token}
      </span>
    );
  }
  if (index === 0) {
    return (
      <span key={index} className="derivation-root-command-executable">
        {token}
      </span>
    );
  }
  if (token.startsWith('--')) {
    return (
      <span key={index} className="derivation-root-command-option">
        {token}
      </span>
    );
  }
  return token;
}

/** CLI steps the operator runs outside the browser. */
function CommandList({ commands }: { commands: readonly DerivationRootCliCommand[] }) {
  if (commands.length === 0) return null;
  return (
    <ol className="dashboard-commands">
      {commands.map((entry) => (
        <li key={entry.label}>
          <h3>{entry.label}</h3>
          {entry.note && <p>{entry.note}</p>}
          <div
            className={`derivation-root-command${entry.completed ? ' derivation-root-command--completed' : ''}`}
          >
            <pre>
              <code>{entry.command.split(/(\s+)/).map(renderCommandToken)}</code>
            </pre>
            <CopyButton
              text={entry.command}
              size={14}
              className="dashboard-shortid__copy"
              ariaLabel={`Copy ${entry.label} command`}
              onCopy={toast.success.bind(null, 'Command copied')}
              onCopyError={toast.error.bind(null, 'Could not copy command. Try again.')}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A custody request a second owner still has to approve. */
interface PendingApproval {
  readonly idempotencyKey: string;
  readonly operationDigestB64u: string;
  readonly expiresAt: string;
}

type CustodyAction = 'governance' | 'backup' | 'recipients';

function rotationStorageKey(status: TenantRootSecurityStatusV1): string {
  return `seams:tenant-root-rotation:${JSON.stringify([status.identity, status.custodyLineageId])}`;
}

function savedRotationId(status: TenantRootSecurityStatusV1): string | null {
  if (status.operationalShares.job !== null) return status.operationalShares.job.jobId;
  const id = sessionStorage.getItem(rotationStorageKey(status));
  if (id !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id)) {
    sessionStorage.removeItem(rotationStorageKey(status));
    return null;
  }
  return id;
}

function rotationOutcomeText(outcome: DashboardRotationOutcome | null): string {
  if (outcome === null) return '';
  switch (outcome.kind) {
    case 'complete':
      return `Rotation completed. Activation receipt: ${outcome.receiptDigest}`;
    case 'retryable':
    case 'refused':
      return outcome.message;
    default:
      return assertNeverRotationOutcome(outcome);
  }
}

function assertNeverRotationOutcome(value: never): never {
  throw new Error(`Unknown rotation outcome: ${String(value)}`);
}

function retainRotationOutcome(
  status: TenantRootSecurityStatusV1,
  outcome: DashboardRotationOutcome,
): void {
  switch (outcome.kind) {
    case 'complete':
    case 'refused':
      sessionStorage.removeItem(rotationStorageKey(status));
      return;
    case 'retryable':
      return;
    default:
      assertNeverRotationOutcome(outcome);
  }
}

type DerivationRootPageState =
  | DashboardDerivationRootStatus
  | { readonly kind: 'loading'; readonly status?: never }
  | { readonly kind: 'error'; readonly message: string; readonly status?: never };

async function refreshRotationPage(
  setPageState: React.Dispatch<React.SetStateAction<DerivationRootPageState>>,
  setOutcome: React.Dispatch<React.SetStateAction<DashboardRotationOutcome | null>>,
): Promise<void> {
  try {
    const current = await readDerivationRootSecurityStatus();
    setPageState(current);
    if (current.kind === 'not_provisioned') return;
    const operationId = savedRotationId(current.status);
    if (operationId !== null) {
      const outcome = await readOperationalShareRotation(operationId);
      retainRotationOutcome(current.status, outcome);
      setOutcome(outcome);
    }
  } catch (error: unknown) {
    setPageState({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Could not read derivation root state',
    });
  }
}

function isPasskeyCancellation(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  );
}

async function submitRotation(input: {
  readonly status: TenantRootSecurityStatusV1 | null;
  readonly setPending: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setError: React.Dispatch<React.SetStateAction<string | null>>;
  readonly setOutcome: React.Dispatch<React.SetStateAction<DashboardRotationOutcome | null>>;
  readonly setConfirming: React.Dispatch<React.SetStateAction<boolean>>;
  readonly refresh: () => Promise<void>;
}): Promise<void> {
  if (input.status === null) return;
  input.setPending(true);
  input.setError(null);
  try {
    const operationId = savedRotationId(input.status) ?? crypto.randomUUID();
    sessionStorage.setItem(rotationStorageKey(input.status), operationId);
    const outcome = await startOperationalShareRotation({ operationId });
    retainRotationOutcome(input.status, outcome);
    input.setOutcome(outcome);
    if (outcome.kind === 'complete') input.setConfirming(false);
    await input.refresh();
  } catch (error: unknown) {
    if (isPasskeyCancellation(error)) return;
    input.setError(
      error instanceof Error ? error.message : 'Could not start rotation. Retry to resume.',
    );
  } finally {
    input.setPending(false);
  }
}

const SECURITY_TABS = [
  { id: 'recovery', label: 'Recovery backup' },
  { id: 'rotation', label: 'Rotate shares' },
  { id: 'restore', label: 'Restore a deployment' },
] as const;

type SecurityTab = (typeof SECURITY_TABS)[number]['id'];

function renderSecurityTab(
  activeTab: SecurityTab,
  selectTab: React.Dispatch<React.SetStateAction<SecurityTab>>,
  tab: (typeof SECURITY_TABS)[number],
): React.JSX.Element {
  return (
    <button
      key={tab.id}
      id={`security-tab-${tab.id}`}
      type="button"
      role="tab"
      aria-selected={activeTab === tab.id}
      aria-controls={`security-panel-${tab.id}`}
      tabIndex={activeTab === tab.id ? 0 : -1}
      onClick={selectTab.bind(null, tab.id)}
    >
      {tab.label}
    </button>
  );
}

function navigateSecurityTabs(event: React.KeyboardEvent<HTMLDivElement>): void {
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  if (!(event.target instanceof HTMLButtonElement)) return;
  const index = tabs.indexOf(event.target);
  if (index === -1) return;
  let nextIndex: number;
  switch (event.key) {
    case 'ArrowRight':
      nextIndex = (index + 1) % tabs.length;
      break;
    case 'ArrowLeft':
      nextIndex = (index + tabs.length - 1) % tabs.length;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = tabs.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

type RefreshFeedback = 'idle' | 'refreshing' | 'complete';

async function refreshWithFeedback(
  refresh: () => Promise<void>,
  setFeedback: React.Dispatch<React.SetStateAction<RefreshFeedback>>,
): Promise<void> {
  setFeedback('refreshing');
  await refresh();
  setFeedback('complete');
}

function RefreshStatusButton({
  label,
  refresh,
}: {
  label: string;
  refresh: () => Promise<void>;
}): React.JSX.Element {
  const [feedback, setFeedback] = React.useState<RefreshFeedback>('idle');
  let message = '';
  if (feedback === 'refreshing') message = 'Checking the latest status…';
  if (feedback === 'complete') message = 'Status refreshed. You’re viewing the latest results.';
  return (
    <div className="derivation-root-refresh-status">
      <button
        type="button"
        className="dashboard-pagination-button"
        disabled={feedback === 'refreshing'}
        onClick={refreshWithFeedback.bind(null, refresh, setFeedback)}
      >
        {feedback === 'refreshing' ? 'Refreshing…' : label}
      </button>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}

function RotationOutcome({
  outcome,
}: {
  outcome: DashboardRotationOutcome | null;
}): React.JSX.Element | null {
  if (outcome === null) return null;
  const failed = outcome.kind !== 'complete';
  return (
    <p
      className={
        failed ? 'derivation-root-error derivation-root-feedback' : 'derivation-root-outcome'
      }
      role={failed ? 'alert' : 'status'}
    >
      {rotationOutcomeText(outcome)}
    </p>
  );
}

type RecoveryOwnerEligibility =
  | { kind: 'loading' }
  | { kind: 'ready'; ownerCount: number }
  | { kind: 'error' };

async function loadRecoveryOwnerEligibility(
  setEligibility: React.Dispatch<React.SetStateAction<RecoveryOwnerEligibility>>,
): Promise<void> {
  try {
    const memberships = await listDashboardOrganizationMemberships('active');
    const ownerCount = memberships.filter(
      (member) => member.kind === 'active' && member.role === 'OWNER',
    ).length;
    setEligibility({ kind: 'ready', ownerCount });
  } catch {
    setEligibility({ kind: 'error' });
  }
}

type BackupProgressStage = 'request' | 'refresh' | 'ready';

function updateBackupElapsed(startedAt: number, setElapsed: (seconds: number) => void): void {
  setElapsed(Math.floor((Date.now() - startedAt) / 1000));
}

function BackupProgress({
  stage,
  startedAt,
}: {
  stage: BackupProgressStage;
  startedAt: number;
}): React.JSX.Element {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (stage === 'ready') return;
    const timer = window.setInterval(updateBackupElapsed.bind(null, startedAt, setElapsed), 1000);
    return () => window.clearInterval(timer);
  }, [stage, startedAt]);

  return (
    <div className="derivation-root-backup-progress" aria-label="Backup creation progress">
      {stage !== 'ready' && (
        <div className="derivation-root-progress-activity" role="status">
          <LoaderCircle className="derivation-root-spinner" size={24} aria-hidden="true" />
          <strong>
            {stage === 'request' ? 'Creating your recovery backup…' : 'Checking your backup…'}
          </strong>
        </div>
      )}
      <ol className="derivation-root-progress-steps" data-stage={stage}>
        <li
          data-complete={stage !== 'request'}
          aria-current={stage === 'request' ? 'step' : undefined}
        >
          <span className="derivation-root-progress-pip" aria-hidden="true">
            {stage === 'request' ? '1' : '✓'}
          </span>
          <span>Create backup</span>
        </li>
        <li
          data-complete={stage === 'ready'}
          aria-current={stage === 'refresh' ? 'step' : undefined}
        >
          <span className="derivation-root-progress-pip" aria-hidden="true">
            {stage === 'ready' ? '✓' : '2'}
          </span>
          <span>Refresh status</span>
        </li>
        <li data-complete={stage === 'ready'} aria-current={stage === 'ready' ? 'step' : undefined}>
          <span className="derivation-root-progress-pip" aria-hidden="true">
            {stage === 'ready' ? '✓' : '3'}
          </span>
          <span>Ready</span>
        </li>
      </ol>
      <p role="status">
        {stage === 'request' &&
          'Creating your recovery backup. Complete any identity verification prompt. This can take 30 seconds or longer. Keep this page open.'}
        {stage === 'refresh' &&
          'Backup created. Checking the latest status before showing your downloads.'}
        {stage === 'ready' && 'Your backup is ready. Download and verify the files in step 4.'}
      </p>
      {stage !== 'ready' && (
        <p className="derivation-root-progress-elapsed">
          {elapsed}s elapsed · This page updates automatically.
        </p>
      )}
    </div>
  );
}

export function DerivationRootSecurityPage(): React.JSX.Element {
  const backupApprovalId = new URLSearchParams(window.location.search).get('cliBackup');
  const restoreApprovalId = new URLSearchParams(window.location.search).get('cliRestore');
  return (
    <>
      <DerivationRootSecurityWorkspace />
      {backupApprovalId !== null && <CliBackupApproval id={backupApprovalId} />}
      {restoreApprovalId !== null && <CliRestoreApproval id={restoreApprovalId} />}
    </>
  );
}

function DerivationRootSecurityWorkspace(): React.JSX.Element {
  const [ownerEligibility, setOwnerEligibility] = React.useState<RecoveryOwnerEligibility>({
    kind: 'loading',
  });
  const twoOwnersAvailable = ownerEligibility.kind === 'ready' && ownerEligibility.ownerCount >= 2;
  React.useEffect(() => {
    const reload = loadRecoveryOwnerEligibility.bind(null, setOwnerEligibility);
    void reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, []);
  const [restoreDestination, setRestoreDestination] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<SecurityTab>(
    new URLSearchParams(window.location.search).has('cliRestore') ? 'restore' : 'recovery',
  );
  const [restartEnvironment, setRestartEnvironment] = React.useState<string | null>(null);
  const [pageState, setPageState] = React.useState<DerivationRootPageState>({ kind: 'loading' });
  const status = pageState.kind === 'active' ? pageState.status : null;
  const [restoreAccess, setRestoreAccess] = React.useState<RestoreAccessState>({ kind: 'loading' });
  const restoreEnvironment = status?.identity.envId ?? null;
  const restartingKeys = restartEnvironment !== null && restartEnvironment === restoreEnvironment;
  // The effect body is standalone and receives its complete dependency set explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(
    beginRestoreAccess.bind(null, restoreEnvironment, setRestoreAccess, setRestoreDestination),
    [restoreEnvironment],
  );
  const [confirmingRotation, setConfirmingRotation] = React.useState(false);
  const [rotationPending, setRotationPending] = React.useState(false);
  const [rotationError, setRotationError] = React.useState<string | null>(null);
  const [rotationOutcome, setRotationOutcome] = React.useState<DashboardRotationOutcome | null>(
    null,
  );
  const [rotationMethod, setRotationMethod] = React.useState<VerificationMethod>('passkey');
  const [recoveryMethod, setRecoveryMethod] = React.useState<VerificationMethod>('passkey');
  const [policyDraft, setPolicyChoice] = React.useState<'two_person_v1' | 'single_owner_v1' | null>(
    null,
  );
  const savedPolicy =
    status !== null && status.recoveryBackup.status !== 'not_configured'
      ? status.recoveryBackup.governance.kind
      : null;
  const policyChoice =
    policyDraft ?? savedPolicy ?? (twoOwnersAvailable ? 'two_person_v1' : 'single_owner_v1');
  const policyUnchanged = savedPolicy === policyChoice;
  const [singleOwnerAcknowledged, setSingleOwnerAcknowledged] = React.useState(false);
  const [custodyProgress, setCustodyProgress] = React.useState<
    | { kind: 'idle' }
    | { kind: 'saving'; action: CustodyAction; stage: 'request' | 'refresh'; startedAt: number }
    | { kind: 'error'; action: CustodyAction; message: string }
  >({ kind: 'idle' });
  const [pendingApprovals, setPendingApprovals] = React.useState<
    Partial<Record<CustodyAction, PendingApproval>>
  >({});

  const refresh = React.useRef(
    refreshRotationPage.bind(null, setPageState, setRotationOutcome),
  ).current;

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // Progress is resumed from server state, so a reload never loses a job.
  const job = status?.operationalShares.job ?? null;
  const jobInFlight =
    job !== null &&
    (job.status === 'preparing' ||
      job.status === 'installing' ||
      job.status === 'verifying' ||
      job.status === 'activating' ||
      job.status === 'retiring');
  const recoveryEnrollmentPending =
    pageState.kind === 'active' && pageState.recoveryEnrollment !== 'committed';

  React.useEffect(() => {
    if (
      !jobInFlight &&
      !restartingKeys &&
      rotationOutcome?.kind !== 'retryable' &&
      !recoveryEnrollmentPending
    )
      return undefined;
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [restartingKeys, jobInFlight, rotationOutcome?.kind, refresh, recoveryEnrollmentPending]);

  /**
   * Runs one custody mutation as an idempotent operation.
   *
   * A request a second owner still has to approve keeps its idempotency key:
   * retrying with the same key after the approval resolves the very record
   * the approver saw, while a fresh key would be a different operation.
   */
  const runCustody = React.useCallback(
    async <T,>(
      action: CustodyAction,
      run: (idempotencyKey: string) => Promise<DashboardCustodyOutcome<T>>,
      accepted: string,
    ) => {
      if (custodyProgress.kind === 'saving' || recoveryMethod !== 'passkey') return;
      const idempotencyKey = pendingApprovals[action]?.idempotencyKey ?? crypto.randomUUID();
      const startedAt = Date.now();
      setCustodyProgress({ kind: 'saving', action, stage: 'request', startedAt });
      try {
        const outcome = await run(idempotencyKey);
        if (outcome.kind === 'approval_pending') {
          setPendingApprovals((current) => ({
            ...current,
            [action]: {
              idempotencyKey,
              operationDigestB64u: outcome.operationDigestB64u,
              expiresAt: outcome.expiresAt,
            },
          }));
          setCustodyProgress({ kind: 'idle' });
          toast.message(
            `Waiting for a second owner to approve operation ${outcome.operationDigestB64u}. Retry the same action once they have.`,
          );
          return;
        }
        setPendingApprovals((current) => ({ ...current, [action]: undefined }));
        toast.success(outcome.replayed ? `${accepted} (already recorded)` : accepted);
        setCustodyProgress({ kind: 'saving', action, stage: 'refresh', startedAt });
        await refresh();
        if (action === 'recipients') setRestartEnvironment(null);
        setCustodyProgress({ kind: 'idle' });
      } catch (error: unknown) {
        if (isPasskeyCancellation(error)) {
          setCustodyProgress({ kind: 'idle' });
          return;
        }
        if (action === 'backup') await refresh();
        setCustodyProgress({
          kind: 'error',
          action,
          message: error instanceof Error ? error.message : `${accepted} failed`,
        });
      }
    },
    [pendingApprovals, refresh, custodyProgress, recoveryMethod],
  );

  const chooseGovernance = React.useCallback(
    (choice: DashboardRecoveryGovernanceChoice) =>
      runCustody(
        'governance',
        (idempotencyKey) => setRecoveryGovernance({ choice, idempotencyKey }),
        'Recovery governance recorded',
      ),
    [runCustody],
  );

  const commitKeys = runCustody.bind(
    null,
    'recipients',
    commitRecoveryKeysFromId,
    'Wrapper keys committed',
  );

  const createBackup = React.useCallback(
    () =>
      runCustody(
        'backup',
        (idempotencyKey) => createRecoveryBackup({ idempotencyKey }),
        'Recovery backup created',
      ),
    [runCustody],
  );

  const startRotation = submitRotation.bind(null, {
    status,
    setPending: setRotationPending,
    setError: setRotationError,
    setOutcome: setRotationOutcome,
    setConfirming: setConfirmingRotation,
    refresh,
  });

  if (pageState.kind === 'error') {
    return (
      <section className="dashboard-page derivation-root-page">
        <h1>Threshold Keys</h1>
        <p className="derivation-root-error" role="alert">
          {pageState.message}
        </p>
        <button type="button" className="dashboard-pagination-button" onClick={refresh}>
          Try again
        </button>
      </section>
    );
  }

  if (pageState.kind === 'not_provisioned') {
    return (
      <section className="dashboard-page derivation-root-page">
        <h1>Threshold Keys</h1>
        <p>No server-side derivation root is provisioned for this environment.</p>
        <CreateDerivationRoot refresh={refresh} />
        <button type="button" className="dashboard-pagination-button" onClick={refresh}>
          Refresh
        </button>
      </section>
    );
  }

  if (status === null) {
    return (
      <section className="dashboard-page derivation-root-page">
        <h1>Threshold Keys</h1>
        <p aria-live="polite">Loading server-side share status…</p>
      </section>
    );
  }

  const rotation = rotationStatusLine(status);
  const recovery = recoveryStatusLine(status.recoveryBackup);
  const restore = restoreStatusLine(status.restore);
  const phase = rotationPhaseIndex(job);
  const downloadable = tenantRootDownloadableRecoverySetV1(status.recoveryBackup);
  const splitRecoveryDownloads =
    status.recoveryBackup.status !== 'not_configured' &&
    status.recoveryBackup.governance.kind === 'two_person_v1';
  const kitRole =
    splitRecoveryDownloads && pageState.kind === 'active'
      ? pageState.recoveryDownloadAccess.deriverA
        ? 'deriver-a'
        : 'deriver-b'
      : null;
  const canDownloadKit =
    pageState.kind === 'active' &&
    (pageState.recoveryDownloadAccess.deriverA || pageState.recoveryDownloadAccess.deriverB);
  const actions = recoveryActions(status.recoveryBackup);
  const consoleBaseUrl = requireConsoleBaseUrl();
  const enrolCommands = enrolCliCommands(
    consoleBaseUrl,
    status.identity.envId,
    status.recoveryBackup,
    restartingKeys || (pageState.kind === 'active' && pageState.recoveryEnrollment !== 'committed'),
  );
  const destination = parseRestoreDestination(restoreDestination);
  const restoreCommands =
    destination === null ||
    restoreAccess.kind !== 'ready' ||
    destination !== restoreAccess.destination
      ? []
      : restoreCliCommands(destination, status.restore).map(
          authorizeRestoreCommand.bind(null, consoleBaseUrl, status.identity.envId),
        );
  const governancePending = pendingApprovals.governance;
  const backupPending = pendingApprovals.backup;
  const erasureVerified = tenantRootRotationPermitsHealingClaimV1(
    status.operationalShares.securityProfile,
    status.operationalShares.job,
  );

  return (
    <section className="dashboard-page derivation-root-page">
      <header className="derivation-root-header">
        <h1>Threshold Keys</h1>
        <p>
          Manage the server-side root used to derive threshold signing shares. Rotate its shares and
          prepare a recovery backup.
        </p>
        <p className="derivation-root-environment">
          <span className="derivation-root-environment-label">Environment</span>
          <ShortId label="environment" value={status.identity.envId} full />
        </p>
      </header>
      <div
        className="derivation-root-tabs"
        role="tablist"
        aria-label="Threshold Keys workflows"
        onKeyDown={navigateSecurityTabs}
      >
        {SECURITY_TABS.map(renderSecurityTab.bind(null, activeTab, setActiveTab))}
      </div>

      <div
        className="derivation-root-tab-panel"
        id="security-panel-recovery"
        role="tabpanel"
        aria-labelledby="security-tab-recovery"
        hidden={activeTab !== 'recovery'}
        tabIndex={0}
      >
        {new URLSearchParams(window.location.search).get('cliEnrollment') !== null && (
          <CliEnrollmentApproval
            id={new URLSearchParams(window.location.search).get('cliEnrollment') ?? ''}
          />
        )}

        <section
          className="derivation-root-panel derivation-root-recovery"
          aria-label="Tenant-controlled recovery"
        >
          <h2 className="derivation-root-section-title">
            <span className="derivation-root-section-icon">
              <Archive size={18} aria-hidden="true" />
            </span>
            Recovery backup
          </h2>
          <p>
            Prepare a backup so you can restore this root if a deployment is lost. Follow the four
            steps below.
          </p>
          {status.recoveryBackup.status === 'cleanup_incomplete' && downloadable !== null ? null : (
            <StatusLine
              line={
                pageState.kind === 'active' &&
                pageState.recoveryEnrollment === 'ready_to_commit' &&
                status.recoveryBackup.status === 'recipients_pending'
                  ? {
                      tone: 'success',
                      label: 'Wrapper keys enrolled · commit required',
                      detail:
                        'Both holders have proved control of their keys. Commit the pair in step 2; no backup is ready yet.',
                    }
                  : pageState.kind === 'active' &&
                      pageState.recoveryEnrollment === 'committed' &&
                      status.recoveryBackup.status === 'recipients_pending'
                    ? {
                        tone: 'progress',
                        label: 'Wrapper keys committed · backup not created',
                        detail:
                          'The enrolled pair is committed. Create a backup in step 3, then download and verify it in step 4.',
                      }
                    : recovery
              }
            />
          )}
          {shouldWarnBackupNeverDownloaded(status.recoveryBackup) ? (
            <p role="alert">
              Download all three files in step 4 and verify them in your terminal so you can use
              this backup.
            </p>
          ) : null}
          <details
            className="derivation-root-recovery-step"
            open={
              status.recoveryBackup.status === 'not_configured' ||
              !!governancePending ||
              (custodyProgress.kind !== 'idle' && custodyProgress.action === 'governance')
            }
          >
            <summary>
              <span className="derivation-root-step-number" aria-hidden="true">
                01
              </span>
              <span className="derivation-root-step-label">
                <h3 id="recovery-step-1">Choose who approves changes</h3>
                <span>Set the approval policy for wrapper keys and backups.</span>
              </span>
              {status.recoveryBackup.status !== 'not_configured' && (
                <span className="derivation-root-step-state dashboard-status--success">Saved</span>
              )}
            </summary>
            <div className="derivation-root-step-body">
              <p>
                {status.recoveryBackup.status === 'not_configured'
                  ? 'Choose a policy, then save it to continue.'
                  : 'Approval policy saved.'}
              </p>
              {governancePending && (
                <p role="status">
                  Waiting for a second owner to approve operation{' '}
                  <ShortId label="operation digest" value={governancePending.operationDigestB64u} />{' '}
                  before {formatDashboardTimestamp(governancePending.expiresAt)}. Retry the saved
                  choice after approval.
                </p>
              )}
              <fieldset
                className="derivation-root-policy-options"
                disabled={
                  !actions.canChooseGovernance ||
                  recoveryMethod !== 'passkey' ||
                  custodyProgress.kind === 'saving' ||
                  !!governancePending
                }
              >
                <legend>Approval policy</legend>
                <label className="derivation-root-policy-choice">
                  <input
                    type="radio"
                    name="recovery-policy"
                    checked={policyChoice === 'two_person_v1'}
                    disabled={!twoOwnersAvailable}
                    aria-describedby={
                      !twoOwnersAvailable ? 'recovery-owner-requirement' : undefined
                    }
                    onChange={setPolicyChoice.bind(null, 'two_person_v1')}
                  />
                  <span>
                    <strong>Two owners</strong>
                    <span>A second organization owner must approve recovery changes.</span>
                    {!twoOwnersAvailable && (
                      <small id="recovery-owner-requirement">
                        {ownerEligibility.kind === 'loading' && 'Checking organization owners…'}
                        {ownerEligibility.kind === 'error' &&
                          'Unable to check organization owners. Refocus this window to retry.'}
                        {ownerEligibility.kind === 'ready' &&
                          'Requires at least two active organization owners. Add another owner in Team members to enable this option.'}
                      </small>
                    )}
                  </span>
                </label>
                <label className="derivation-root-policy-choice">
                  <input
                    type="radio"
                    name="recovery-policy"
                    checked={policyChoice === 'single_owner_v1'}
                    onChange={setPolicyChoice.bind(null, 'single_owner_v1')}
                  />
                  <span>
                    <strong>One owner</strong>
                    <span>One organization owner can change wrapper keys and backups.</span>
                  </span>
                </label>
                {policyChoice === 'single_owner_v1' && (
                  <p>
                    <label>
                      <input
                        type="checkbox"
                        checked={singleOwnerAcknowledged}
                        onChange={(event) => setSingleOwnerAcknowledged(event.target.checked)}
                      />{' '}
                      I understand that one owner alone can replace wrapper keys and backups.
                    </label>
                  </p>
                )}
              </fieldset>
              <VerificationMethodChoice
                value={recoveryMethod}
                onChange={setRecoveryMethod}
                disabled={
                  !actions.canChooseGovernance ||
                  policyUnchanged ||
                  (policyChoice === 'two_person_v1' && !twoOwnersAvailable) ||
                  custodyProgress.kind === 'saving' ||
                  (policyChoice === 'single_owner_v1' && !singleOwnerAcknowledged)
                }
                action={{
                  confirmLabel: 'Verify and save policy',
                  label:
                    custodyProgress.kind === 'saving' && custodyProgress.action === 'governance'
                      ? 'Verifying and saving…'
                      : governancePending
                        ? 'Check policy approval'
                        : policyUnchanged
                          ? 'Approval policy saved'
                          : 'Save approval policy',
                  onConfirm: chooseGovernance.bind(
                    null,
                    policyChoice === 'two_person_v1'
                      ? { kind: 'two_person_v1' }
                      : { kind: 'single_owner_v1', acknowledgeWarning: true },
                  ),
                }}
              />
              {custodyProgress.kind === 'error' && custodyProgress.action === 'governance' && (
                <p role="alert" className="derivation-root-error">
                  {custodyProgress.message}
                </p>
              )}
            </div>
          </details>
          <details
            className="derivation-root-recovery-step"
            open={
              restartingKeys ||
              (pageState.kind === 'active' &&
                status.recoveryBackup.status !== 'not_configured' &&
                pageState.recoveryEnrollment !== 'committed')
            }
          >
            <summary>
              <span className="derivation-root-step-number" aria-hidden="true">
                02
              </span>
              <span className="derivation-root-step-label">
                <h3 id="recovery-step-2">Enroll public wrapper keys</h3>
                <span>Generate wrapper keypairs to encrypt and decrypt the recovery packages.</span>
              </span>
              {pageState.kind === 'active' && (
                <span
                  className={`derivation-root-step-state ${
                    pageState.recoveryEnrollment === 'committed' && !restartingKeys
                      ? 'dashboard-status--success'
                      : 'dashboard-status--warning'
                  }`}
                >
                  {pageState.recoveryEnrollment === 'committed' && !restartingKeys
                    ? 'Committed'
                    : pageState.recoveryEnrollment === 'ready_to_commit'
                      ? 'Enrolled · not committed'
                      : 'Set up'}
                </span>
              )}
            </summary>
            <div className="derivation-root-step-body">
              <p>
                Generate wrapper keypairs to encrypt the server recovery material in step 3. The
                private wrapper keys stay on the holders’ devices and decrypt those packages during
                restoration.
              </p>
              {status.recoveryBackup.status === 'not_configured' && (
                <p>Save an approval policy to enroll public wrapper keys.</p>
              )}
              {pageState.kind === 'active' &&
              pageState.recoveryEnrollment === 'committed' &&
              !restartingKeys ? (
                <div role="status">
                  <StatusLine
                    line={{
                      tone: 'success',
                      label:
                        'Both public wrapper keys are registered and approved for this backup.',
                      detail: 'Create your backup in step 3, then save the recovery ZIP in step 4.',
                    }}
                  />
                </div>
              ) : pageState.kind === 'active' &&
                pageState.recoveryEnrollment === 'ready_to_commit' ? null : enrolCommands.length ===
                0 ? null : (
                <>
                  <p>
                    Start in a new, empty folder on each holder’s device. Each command creates the
                    named wrapper key file there. Keep that file for step 4.
                  </p>
                  <p>
                    Approve the matching code in this dashboard. In step 4, the CLI includes these
                    key files in your recovery ZIP and prompts for an optional ZIP password.
                  </p>
                </>
              )}

              <CommandList commands={enrolCommands} />

              {pageState.kind === 'active' &&
                pageState.recoveryEnrollment === 'committed' &&
                !restartingKeys && (
                  <div className="dashboard-actions">
                    <button
                      type="button"
                      className="dashboard-pagination-button"
                      disabled={!actions.canEnrolRecipients || custodyProgress.kind === 'saving'}
                      onClick={setRestartEnvironment.bind(null, status.identity.envId)}
                    >
                      Restart from step 2
                    </button>
                  </div>
                )}

              {pageState.kind === 'active' &&
                pageState.recoveryEnrollment === 'ready_to_commit' && (
                  <>
                    <p>
                      Both public wrapper keys are enrolled: each holder has proved control of the
                      matching private wrapper key. Commit this pair to authorize backup creation.
                    </p>
                    <button
                      type="button"
                      className="dashboard-pagination-button dashboard-pagination-button--primary derivation-root-commit-keys"
                      disabled={custodyProgress.kind === 'saving' || recoveryMethod !== 'passkey'}
                      onClick={commitKeys}
                    >
                      {pendingApprovals.recipients
                        ? 'Check key-pair approval'
                        : 'Commit wrapper keys'}
                    </button>
                    {pendingApprovals.recipients && (
                      <p role="status">
                        Waiting for a second owner to approve operation{' '}
                        {pendingApprovals.recipients.operationDigestB64u}.
                      </p>
                    )}
                  </>
                )}
              {custodyProgress.kind === 'error' && custodyProgress.action === 'recipients' && (
                <p role="alert">{custodyProgress.message}</p>
              )}
              <RefreshStatusButton label="Refresh enrollment status" refresh={refresh} />
            </div>
          </details>
          <details
            className="derivation-root-recovery-step"
            open={
              (pageState.kind === 'active' &&
                pageState.recoveryEnrollment === 'committed' &&
                downloadable === null) ||
              !!backupPending ||
              (custodyProgress.kind !== 'idle' && custodyProgress.action === 'backup')
            }
          >
            <summary>
              <span className="derivation-root-step-number" aria-hidden="true">
                03
              </span>
              <span className="derivation-root-step-label">
                <h3 id="recovery-step-3">Create your backup</h3>
                <span>Encrypt a recovery package for each key holder.</span>
              </span>
              <span
                className={`derivation-root-step-state ${
                  downloadable !== null &&
                  status.recoveryBackup.status !== 'failed_replacement' &&
                  !(custodyProgress.kind === 'saving' && custodyProgress.action === 'backup')
                    ? 'dashboard-status--success'
                    : 'dashboard-status--warning'
                }`}
              >
                {custodyProgress.kind === 'saving' && custodyProgress.action === 'backup'
                  ? 'Creating'
                  : downloadable !== null
                    ? status.recoveryBackup.status === 'failed_replacement'
                      ? 'Replacement failed'
                      : 'Packages generated'
                    : status.recoveryBackup.status === 'cleanup_incomplete'
                      ? 'Blocked'
                      : status.recoveryBackup.status === 'preparing_initial'
                        ? 'Creating'
                        : 'Not ready'}
              </span>
            </summary>
            <div className="derivation-root-step-body">
              {pageState.kind === 'active' &&
                pageState.recoveryEnrollment === 'committed' &&
                downloadable === null &&
                status.recoveryBackup.status !== 'cleanup_incomplete' &&
                status.recoveryBackup.status !== 'preparing_initial' &&
                !(custodyProgress.kind === 'saving' && custodyProgress.action === 'backup') && (
                  <p>The wrapper key pair is committed. No backup is ready to download yet.</p>
                )}
              {downloadable !== null && !canDownloadKit && (
                <p>
                  Your account does not have access to download a recovery package. Each designated
                  holder must sign in to save their own kit.
                </p>
              )}
              {downloadable !== null &&
                canDownloadKit &&
                status.recoveryBackup.status !== 'failed_replacement' && (
                  <p>
                    The encrypted backup is ready. Download and verify the files in step 4 to
                    confirm they are saved safely.
                  </p>
                )}
              {status.recoveryBackup.status === 'failed_replacement' && (
                <p>
                  The replacement failed. Step 4 still contains your previous backup and its
                  original wrapper keys are required to open it.
                </p>
              )}
              {pageState.kind === 'active' && pageState.recoveryEnrollment !== 'committed' && (
                <p>
                  Finish both enrollments, then select Commit wrapper keys in step 2 before creating
                  the new backup.
                </p>
              )}
              {backupPending ? (
                <p role="status">
                  Waiting for a second owner to approve operation{' '}
                  <ShortId label="operation digest" value={backupPending.operationDigestB64u} />{' '}
                  before {formatDashboardTimestamp(backupPending.expiresAt)}. Retry once they have.
                </p>
              ) : null}
              <div className="dashboard-actions">
                <button
                  type="button"
                  className="dashboard-pagination-button"
                  disabled={
                    recoveryMethod !== 'passkey' ||
                    custodyProgress.kind === 'saving' ||
                    pageState.kind !== 'active' ||
                    pageState.recoveryEnrollment !== 'committed' ||
                    restartingKeys ||
                    status.recoveryBackup.status === 'not_configured' ||
                    (!actions.canCreateBackup && !actions.canReplaceBackup)
                  }
                  aria-describedby={
                    status.recoveryBackup.status === 'cleanup_incomplete'
                      ? 'backup-cleanup-reason'
                      : undefined
                  }
                  onClick={() => void createBackup()}
                >
                  {custodyProgress.kind === 'saving' && custodyProgress.action === 'backup'
                    ? 'Creating backup…'
                    : 'Generate a new recovery backup'}
                </button>
              </div>
              {status.recoveryBackup.status === 'cleanup_incomplete' && (
                <p id="backup-cleanup-reason">
                  Provider deletion of earlier recovery material is pending. You can create a new
                  backup while cleanup continues to be tracked.
                </p>
              )}
              {custodyProgress.kind === 'saving' && custodyProgress.action === 'backup' ? (
                <BackupProgress
                  stage={custodyProgress.stage}
                  startedAt={custodyProgress.startedAt}
                />
              ) : actions.canDownload && status.recoveryBackup.status !== 'failed_replacement' ? (
                <BackupProgress stage="ready" startedAt={0} />
              ) : null}
              {custodyProgress.kind === 'error' && custodyProgress.action === 'backup' && (
                <p role="alert" className="derivation-root-error">
                  {custodyProgress.message}
                </p>
              )}
              <RefreshStatusButton label="Refresh backup status" refresh={refresh} />
            </div>
          </details>
          <details className="derivation-root-recovery-step" open={downloadable !== null}>
            <summary>
              <span className="derivation-root-step-number" aria-hidden="true">
                04
              </span>
              <span className="derivation-root-step-label">
                <h3 id="recovery-step-4">Save and verify the files</h3>
                <span>
                  {splitRecoveryDownloads
                    ? 'Download your package and check it in your terminal.'
                    : 'Download both packages and check them in your terminal.'}
                </span>
              </span>
            </summary>
            <div className="derivation-root-step-body">
              {downloadable === null && (
                <p>Generate a backup in step 3 to download the recovery ZIP.</p>
              )}
              {downloadable !== null && (
                <>
                  <p>
                    {splitRecoveryDownloads
                      ? 'Each holder saves a recovery kit containing the manifest, their encrypted package, their private wrapper key, and instructions.'
                      : 'Save a recovery kit containing the manifest, both encrypted packages, both private wrapper keys, and instructions.'}
                  </p>
                  <p>
                    Run this command from the same Terminal folder you used for enrollment to create
                    and save your recovery ZIP. Approve the matching code in your browser. The CLI
                    downloads the encrypted recovery packages, verifies them with your local wrapper
                    keys, and combines those files into a ZIP. Enter a ZIP password when prompted,
                    or press Enter to skip encryption.
                  </p>
                  <CommandList
                    commands={[
                      {
                        label: 'Save your recovery kit',
                        command: `npx @seams/wallet-cli@0.4.1 derivation-root backup kit --console-url ${shellQuote(consoleBaseUrl)} --environment ${shellQuote(status.identity.envId)} --recovery-set ${shellQuote(downloadable.recoverySetId)}${kitRole === null ? '' : ` --role ${kitRole}`}`,
                        note:
                          kitRole === null
                            ? 'Your private wrapper keys and password stay in Terminal. The ZIP includes both wrapper keys, both encrypted recovery packages, the manifest and restore instructions.'
                            : 'Your private wrapper key and password stay in Terminal. The ZIP includes your wrapper key, your encrypted recovery package, the manifest and restore instructions.',
                      },
                    ]}
                  />
                </>
              )}
            </div>
          </details>
          {actions.canReplaceBackup ? (
            <div className="derivation-root-recovery-notes">
              <p role="note">
                Replacing this recovery backup cannot revoke copies you previously downloaded.
                Securely destroy old files and wrapper keys when you no longer need them.
              </p>
            </div>
          ) : null}
        </section>
      </div>
      <section
        className="derivation-root-panel derivation-root-tab-panel"
        id="security-panel-rotation"
        role="tabpanel"
        aria-labelledby="security-tab-rotation"
        hidden={activeTab !== 'rotation'}
        tabIndex={0}
      >
        <div className="derivation-root-panel-header">
          <h2 id="operational-shares-title" className="derivation-root-section-title">
            <span className="derivation-root-section-icon">
              <RefreshCw size={18} aria-hidden="true" />
            </span>
            Operational shares
          </h2>
          <span className="derivation-root-epoch">
            Share version {status.operationalShares.activeEpoch}
          </span>
        </div>
        <p className="derivation-root-panel-intro">Two services each hold a share of this root.</p>
        <dl className="derivation-root-derivers">
          <div>
            <dt>Deriver A</dt>
            <dd>
              <DeriverHealthBadge health={status.operationalShares.deriverAStatus} />
            </dd>
          </div>
          <div>
            <dt>Deriver B</dt>
            <dd>
              <DeriverHealthBadge health={status.operationalShares.deriverBStatus} />
            </dd>
          </div>
        </dl>
        {job !== null ? <StatusLine line={rotation} /> : null}
        <RotationOutcome outcome={rotationOutcome} />
        <dl className="derivation-root-dates">
          <div>
            <dt>Last rotation</dt>
            <dd>
              {status.operationalShares.lastCompletedRotationAt === null ? (
                'Not rotated yet'
              ) : (
                <time dateTime={status.operationalShares.lastCompletedRotationAt}>
                  {formatDashboardTimestamp(status.operationalShares.lastCompletedRotationAt)}
                </time>
              )}
            </dd>
          </div>
          <div>
            <dt>Next scheduled</dt>
            <dd>
              {status.operationalShares.nextScheduledRotationAt === null ? (
                'No scheduler is running; rotate manually'
              ) : (
                <time dateTime={status.operationalShares.nextScheduledRotationAt}>
                  {formatDashboardTimestamp(status.operationalShares.nextScheduledRotationAt)}
                </time>
              )}
            </dd>
          </div>
        </dl>
        <p className="derivation-root-description">
          Rotation refreshes both shares while keeping wallet keys, addresses, and client data the
          same. Each service continues to hold only its own share.
        </p>
        <button
          type="button"
          className="dashboard-pagination-button dashboard-pagination-button--primary derivation-root-rotate"
          disabled={jobInFlight || rotationPending}
          onClick={setConfirmingRotation.bind(null, true)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {jobInFlight ? 'Rotation in progress' : 'Review share rotation'}
        </button>
        {phase !== null ? (
          <ol className="dashboard-progress" aria-live="polite">
            {ROTATION_PHASES.map((label, index) => (
              <li key={label} aria-current={index === phase ? 'step' : undefined}>
                {label}
                {index < phase ? ' — done' : null}
              </li>
            ))}
          </ol>
        ) : null}
        {erasureVerified && (
          <StatusLine
            line={{
              tone: 'success',
              label: 'Previous shares securely erased',
              detail: retiredShareClaim(status),
            }}
          />
        )}
      </section>
      <section
        className="derivation-root-panel derivation-root-tab-panel"
        id="security-panel-restore"
        role="tabpanel"
        aria-labelledby="security-tab-restore"
        hidden={activeTab !== 'restore'}
        tabIndex={0}
      >
        <h2 id="restore-status-title" className="derivation-root-section-title">
          <span className="derivation-root-section-icon">
            <ShieldCheck size={18} aria-hidden="true" />
          </span>
          Restore a deployment
        </h2>
        {restoreAccess.kind === 'ready' && restoreAccess.restoration === 'active' ? (
          <div className="derivation-root-restore-success" role="status">
            <strong>✓ Recovery completed successfully</strong>
            <p>The restored root is active at {restoreAccess.destination}.</p>
          </div>
        ) : status.restore?.status === 'active' ? (
          <>
            <p className="derivation-root-active">
              <CircleCheck size={16} aria-hidden="true" />
              {restore.label}
            </p>
            <StatusLine line={sourceDispositionStatusLine(status.restore.sourceDisposition)} />
          </>
        ) : (
          <StatusLine line={restore} />
        )}
        <section
          className="derivation-root-instructions"
          aria-labelledby="restore-instructions-title"
        >
          <h3 id="restore-instructions-title">How to restore</h3>
          <p className="derivation-root-description">
            You need the Seams wallet CLI and your complete recovery ZIP.
          </p>
          <CommandList commands={[walletCliInstallCommand()]} />
          <p className="derivation-root-description">
            Extract the ZIP and open Terminal in that folder. Keep all files together. If you
            encrypted the ZIP, enter its password when extracting it.
          </p>
          <h3 className="derivation-root-restore-access-heading">Approve recovery access</h3>
          <p className="derivation-root-description">
            Each holder runs the commands below, then approves the matching Terminal code in this
            dashboard. Use the organization and environment shown above. Your wrapper keys stay on
            your device.
          </p>
          <CommandList
            commands={[
              {
                label: 'Connect recovery trust',
                command: `seams-wallet derivation-root trust connect --console-url ${shellQuote(consoleBaseUrl)} --manifest ./manifest.json`,
                note: 'Run once on each holder’s device from the extracted folder to verify the backup’s authority and save it for offline checks.',
              },
            ]}
          />
          <div className="derivation-root-destination">
            <label htmlFor="restore-destination">Destination</label>
            <input
              id="restore-destination"
              className="dashboard-input"
              type="url"
              disabled={restoreAccess.kind !== 'ready'}
              placeholder="Waiting for a configured destination"
              value={restoreDestination}
              onChange={changeRestoreDestination.bind(null, setRestoreDestination)}
              aria-describedby="restore-destination-help"
              aria-invalid={destination === null}
              spellCheck={false}
              autoCapitalize="none"
            />
            <p id="restore-destination-help" className="derivation-root-description">
              {destination === null
                ? 'Enter an HTTPS destination URL without a path, query, or credentials.'
                : 'The commands below use this destination. It must be configured for recovery and have no active root.'}
            </p>
          </div>
          {restoreAccess.kind === 'loading' && <p role="status">Checking recovery access…</p>}
          {restoreAccess.kind === 'unavailable' && <p role="status">{restoreAccess.message}</p>}
          {restoreAccess.kind === 'ready' &&
            destination !== null &&
            destination !== restoreAccess.destination && (
              <p role="status">
                This console can authorize restoration to {restoreAccess.destination}. Use that
                destination, or ask your deployment administrator to update recovery access.
              </p>
            )}
          <CommandList commands={restoreCommands} />
          {restoreAccess.kind === 'ready' && destination === restoreAccess.destination && (
            <details className="derivation-root-offline-activation">
              <summary>Activation asks for offline trust acknowledgement?</summary>
              <p>
                Your backup passed cryptographic verification, but its current revocation status
                could not be checked. Continue only if you accept that this backup may have been
                revoked since it was created. Both imported shares are saved; you do not need to
                import them again.
              </p>
              <CommandList
                commands={[
                  authorizeRestoreCommand(consoleBaseUrl, status.identity.envId, {
                    label: 'Activate with offline verification',
                    command: `seams-wallet derivation-root restore activate --destination ${shellQuote(destination)} --session-file ./restore-session.json --acknowledge-offline-trust`,
                    note: 'If you accept offline verification, run this command from the same folder. Keep the existing restore-session.json file for retries.',
                  }),
                ]}
              />
            </details>
          )}
        </section>
      </section>

      <DashboardInlineModal
        isOpen={confirmingRotation}
        ariaLabel="Rotate operational shares?"
        ariaDescribedBy="rotate-operational-shares-description"
        onRequestClose={setConfirmingRotation.bind(null, false)}
        className="derivation-root-modal"
      >
        <h2>Rotate operational shares?</h2>
        <p id="rotate-operational-shares-description">
          Deriver A and Deriver B will replace their current shares while keeping the derivation
          root unchanged. Normal signing will continue. New derivation ceremonies may pause briefly.
          Verify your identity to authorize this rotation.
        </p>
        <VerificationMethodChoice
          action={null}
          value={rotationMethod}
          onChange={setRotationMethod}
          disabled={rotationPending}
        />
        {rotationError !== null ? (
          <p className="derivation-root-error" role="alert">
            {rotationError}
          </p>
        ) : null}
        <RotationOutcome outcome={rotationOutcome} />
        <div className="derivation-root-modal-actions">
          <button
            type="button"
            className="dashboard-pagination-button"
            onClick={setConfirmingRotation.bind(null, false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--primary"
            disabled={rotationPending || rotationMethod !== 'passkey'}
            onClick={startRotation}
          >
            {rotationPending
              ? 'Verifying and rotating…'
              : rotationOutcome?.kind === 'retryable'
                ? 'Retry rotation'
                : 'Rotate operational shares'}
          </button>
        </div>
      </DashboardInlineModal>
    </section>
  );
}

export default DerivationRootSecurityPage;

function commitRecoveryKeysFromId(idempotencyKey: string): Promise<DashboardCustodyOutcome<true>> {
  return commitRecoveryKeys({ idempotencyKey });
}
