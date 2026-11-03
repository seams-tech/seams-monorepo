import { shellQuote, WALLET_CLI_PACKAGE } from './recoveryKeySetupCommand';
import { CliRestoreApproval } from './CliRestoreApproval';
import { listDashboardOrganizationMemberships } from '@core/dashboard/routes/team-members/consoleTeamRbacApi';
import { CliBackupApproval } from './CliBackupApproval';
import { CliEnrollmentApproval } from './CliEnrollmentApproval';
import { VerificationMethodChoice, type VerificationMethod } from './VerificationMethodChoice';
import { CreateDerivationRoot } from './CreateDerivationRoot';
import type { DashboardDerivationRootStatus } from './consoleDerivationRootApi';
import React from 'react';
import { t } from '@core/i18n';
import './derivationRootSecurity.css';
import { toast } from 'sonner';
import {
  Archive,
  ShieldCheck,
  CircleCheck,
  CircleHelp,
  CircleX,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { DashboardInlineModal } from '@core/dashboard/components/DashboardInlineModal';
import { CopyButton } from '@core/components/CopyButton';
import { requireConsoleBaseUrl } from '@core/dashboard/consoleHttp';
import { buildWalletAcceptHeaders } from '../consoleWalletHttp';
import { formatDashboardTimestamp } from '@core/dashboard/utils/timestamps';
import type { TenantRootSecurityStatusV1 } from '@seams-internal/wallet-console-shared/tenant-root';
import {
  tenantRootDownloadableRecoverySetV1,
  tenantRootRotationPermitsHealingClaimV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
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
  healthy: { label: t('derivationHealthy'), tone: 'success' },
  degraded: { label: t('derivationDegraded'), tone: 'warning' },
  unavailable: { label: t('derivationUnavailable'), tone: 'danger' },
  unknown: { label: t('derivationUnknown'), tone: 'neutral' },
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
      { credentials: 'include', signal, headers: buildWalletAcceptHeaders() },
    );
    const body: unknown = await response.json();
    if (
      !response.ok ||
      typeof body !== 'object' ||
      body === null ||
      !('destination' in body) ||
      typeof body.destination !== 'string'
    ) {
      throw new Error(t('derivationRecoveryAccessNotConfigured'));
    }
    const destination = parseRestoreDestination(body.destination);
    if (destination === null) throw new Error(t('derivationRecoveryDestinationInvalid'));
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
        message: error instanceof Error ? error.message : t('derivationRecoveryAccessCheckFailed'),
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
        ariaLabel={t('derivationCopyLabel', { label })}
        onCopy={toast.success.bind(null, t('derivationLabelCopied', { label }))}
        onCopyError={toast.error.bind(null, t('derivationCouldNotCopyLabel', { label }))}
      />
    </span>
  );
}

function walletCliInstallCommand(): DerivationRootCliCommand {
  return {
    label: t('derivationInstallCliLabel'),
    command: `npm install --global ${WALLET_CLI_PACKAGE}`,
    note: t('derivationInstallCliNote'),
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
  if (token === WALLET_CLI_PACKAGE) {
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
              ariaLabel={t('derivationCopyCommandLabel', { label: entry.label })}
              onCopy={toast.success.bind(null, t('derivationCommandCopied'))}
              onCopyError={toast.error.bind(null, t('derivationCouldNotCopyCommand'))}
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
      return t('derivationRotationCompleted', { digest: outcome.receiptDigest });
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
      message: error instanceof Error ? error.message : t('derivationReadStateFailed'),
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
    input.setError(error instanceof Error ? error.message : t('derivationStartRotationFailed'));
  } finally {
    input.setPending(false);
  }
}

const SECURITY_TABS = [
  { id: 'recovery', label: t('derivationRecoveryBackup') },
  { id: 'rotation', label: t('derivationRotateShares') },
  { id: 'restore', label: t('derivationRestoreDeployment') },
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
  if (feedback === 'refreshing') message = t('derivationCheckingLatestStatus');
  if (feedback === 'complete') message = t('derivationStatusRefreshedLatest');
  return (
    <div className="derivation-root-refresh-status">
      <button
        type="button"
        className="dashboard-pagination-button"
        disabled={feedback === 'refreshing'}
        onClick={refreshWithFeedback.bind(null, refresh, setFeedback)}
      >
        {feedback === 'refreshing' ? t('derivationRefreshing') : label}
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
    <div
      className="derivation-root-backup-progress"
      aria-label={t('derivationBackupProgressLabel')}
    >
      {stage !== 'ready' && (
        <div className="derivation-root-progress-activity" role="status">
          <LoaderCircle className="derivation-root-spinner" size={24} aria-hidden="true" />
          <strong>
            {stage === 'request'
              ? t('derivationCreatingYourBackup')
              : t('derivationCheckingYourBackup')}
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
          <span>{t('derivationStepCreateBackup')}</span>
        </li>
        <li
          data-complete={stage === 'ready'}
          aria-current={stage === 'refresh' ? 'step' : undefined}
        >
          <span className="derivation-root-progress-pip" aria-hidden="true">
            {stage === 'ready' ? '✓' : '2'}
          </span>
          <span>{t('derivationStepRefreshStatus')}</span>
        </li>
        <li data-complete={stage === 'ready'} aria-current={stage === 'ready' ? 'step' : undefined}>
          <span className="derivation-root-progress-pip" aria-hidden="true">
            {stage === 'ready' ? '✓' : '3'}
          </span>
          <span>{t('derivationStepReady')}</span>
        </li>
      </ol>
      <p role="status">
        {stage === 'request' && t('derivationBackupStageRequest')}
        {stage === 'refresh' && t('derivationBackupStageRefresh')}
        {stage === 'ready' && t('derivationBackupStageReady')}
      </p>
      {stage !== 'ready' && (
        <p className="derivation-root-progress-elapsed">
          {t('derivationBackupElapsed', { seconds: elapsed })}
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
      failed: string,
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
          toast.message(t('derivationWaitingToast', { digest: outcome.operationDigestB64u }));
          return;
        }
        setPendingApprovals((current) => ({ ...current, [action]: undefined }));
        toast.success(
          outcome.replayed ? t('derivationAlreadyRecorded', { message: accepted }) : accepted,
        );
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
          message: error instanceof Error ? error.message : failed,
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
        t('derivationGovernanceRecorded'),
        t('derivationGovernanceRecordedFailed'),
      ),
    [runCustody],
  );

  const commitKeys = runCustody.bind(
    null,
    'recipients',
    commitRecoveryKeysFromId,
    t('derivationKeysCommitted'),
    t('derivationKeysCommittedFailed'),
  );

  const createBackup = React.useCallback(
    () =>
      runCustody(
        'backup',
        (idempotencyKey) => createRecoveryBackup({ idempotencyKey }),
        t('derivationBackupCreated'),
        t('derivationBackupCreatedFailed'),
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
        <header className="derivation-root-header">
          <h1>{t('navThresholdKeys')}</h1>
        </header>
        <section className="derivation-root-state-card" aria-labelledby="root-error-title">
          <span className="derivation-root-state-icon derivation-root-state-icon--error">
            <TriangleAlert size={22} aria-hidden="true" />
          </span>
          <div className="derivation-root-state-content">
            <p className="derivation-root-state-eyebrow">{t('derivationEnvironmentStatus')}</p>
            <h2 id="root-error-title">{t('derivationUnableToLoad')}</h2>
            <p className="derivation-root-error" role="alert">
              {pageState.message}
            </p>
            <div className="derivation-root-state-actions">
              <button
                type="button"
                className="dashboard-pagination-button dashboard-pagination-button--primary"
                onClick={refresh}
              >
                {t('derivationTryAgain')}
              </button>
            </div>
          </div>
        </section>
      </section>
    );
  }

  if (pageState.kind === 'not_provisioned') {
    return (
      <section className="dashboard-page derivation-root-page">
        <header className="derivation-root-header">
          <h1>{t('navThresholdKeys')}</h1>
          <p>{t('derivationPageIntroEmpty')}</p>
        </header>
        <section className="derivation-root-state-card" aria-labelledby="root-empty-title">
          <span className="derivation-root-state-icon">
            <KeyRound size={22} aria-hidden="true" />
          </span>
          <div className="derivation-root-state-content">
            <p className="derivation-root-state-eyebrow">{t('derivationEnvironmentSetup')}</p>
            <h2 id="root-empty-title">{t('derivationRootRequired')}</h2>
            <p className="derivation-root-description">{t('derivationRootRequiredDescription')}</p>
            <CreateDerivationRoot refresh={refresh} />
          </div>
        </section>
      </section>
    );
  }

  if (status === null) {
    return (
      <section className="dashboard-page derivation-root-page">
        <header className="derivation-root-header">
          <h1>{t('navThresholdKeys')}</h1>
        </header>
        <section
          className="derivation-root-state-card"
          aria-labelledby="root-loading-title"
          aria-live="polite"
        >
          <span className="derivation-root-state-icon">
            <LoaderCircle className="derivation-root-spinner" size={22} aria-hidden="true" />
          </span>
          <div className="derivation-root-state-content">
            <p className="derivation-root-state-eyebrow">{t('derivationEnvironmentStatus')}</p>
            <h2 id="root-loading-title">{t('derivationLoadingKeys')}</h2>
            <p className="derivation-root-description">{t('derivationCheckingShareStatus')}</p>
          </div>
        </section>
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
        <h1>{t('navThresholdKeys')}</h1>
        <p>{t('derivationPageIntro')}</p>
        <p className="derivation-root-environment">
          <span className="derivation-root-environment-label">{t('derivationEnvironment')}</span>
          <ShortId label={t('derivationLabelEnvironment')} value={status.identity.envId} full />
        </p>
      </header>
      <div
        className="derivation-root-tabs"
        role="tablist"
        aria-label={t('derivationWorkflowsLabel')}
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
          aria-label={t('derivationTenantRecoveryLabel')}
        >
          <h2 className="derivation-root-section-title">
            <span className="derivation-root-section-icon">
              <Archive size={18} aria-hidden="true" />
            </span>
            {t('derivationRecoveryBackup')}
          </h2>
          <p>{t('derivationRecoveryIntro')}</p>
          {status.recoveryBackup.status === 'cleanup_incomplete' && downloadable !== null ? null : (
            <StatusLine
              line={
                pageState.kind === 'active' &&
                pageState.recoveryEnrollment === 'ready_to_commit' &&
                status.recoveryBackup.status === 'recipients_pending'
                  ? {
                      tone: 'success',
                      label: t('derivationStatusEnrolledCommit'),
                      detail: t('derivationStatusEnrolledCommitDetail'),
                    }
                  : pageState.kind === 'active' &&
                      pageState.recoveryEnrollment === 'committed' &&
                      status.recoveryBackup.status === 'recipients_pending'
                    ? {
                        tone: 'progress',
                        label: t('derivationStatusCommittedNoBackup'),
                        detail: t('derivationStatusCommittedNoBackupDetail'),
                      }
                    : recovery
              }
            />
          )}
          {shouldWarnBackupNeverDownloaded(status.recoveryBackup) ? (
            <p role="alert">{t('derivationWarnNeverDownloaded')}</p>
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
                <h3 id="recovery-step-1">{t('derivationStep1Title')}</h3>
                <span>{t('derivationStep1Subtitle')}</span>
              </span>
              {status.recoveryBackup.status !== 'not_configured' && (
                <span className="derivation-root-step-state dashboard-status--success">
                  {t('derivationSaved')}
                </span>
              )}
            </summary>
            <div className="derivation-root-step-body">
              <p>
                {status.recoveryBackup.status === 'not_configured'
                  ? t('derivationStep1Choose')
                  : t('derivationApprovalPolicySavedPeriod')}
              </p>
              {governancePending && (
                <p role="status">
                  {t('derivationWaitingPrefix')}{' '}
                  <ShortId
                    label={t('derivationLabelOperationDigest')}
                    value={governancePending.operationDigestB64u}
                  />{' '}
                  {t('derivationWaitingGovernanceSuffix', {
                    date: formatDashboardTimestamp(governancePending.expiresAt),
                  })}
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
                <legend>{t('derivationApprovalPolicy')}</legend>
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
                    <strong>{t('derivationTwoOwners')}</strong>
                    <span>{t('derivationTwoOwnersDescription')}</span>
                    {!twoOwnersAvailable && (
                      <small id="recovery-owner-requirement">
                        {ownerEligibility.kind === 'loading' && t('derivationCheckingOwners')}
                        {ownerEligibility.kind === 'error' && t('derivationCheckOwnersFailed')}
                        {ownerEligibility.kind === 'ready' && t('derivationRequiresTwoOwners')}
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
                    <strong>{t('derivationOneOwner')}</strong>
                    <span>{t('derivationOneOwnerDescription')}</span>
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
                      {t('derivationOneOwnerAcknowledge')}
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
                  confirmLabel: t('derivationVerifyAndSavePolicy'),
                  label:
                    custodyProgress.kind === 'saving' && custodyProgress.action === 'governance'
                      ? t('derivationVerifyingAndSaving')
                      : governancePending
                        ? t('derivationCheckPolicyApproval')
                        : policyUnchanged
                          ? t('derivationApprovalPolicySaved')
                          : t('derivationSaveApprovalPolicy'),
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
                <h3 id="recovery-step-2">{t('derivationStep2Title')}</h3>
                <span>{t('derivationStep2Subtitle')}</span>
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
                    ? t('derivationCommitted')
                    : pageState.recoveryEnrollment === 'ready_to_commit'
                      ? t('derivationEnrolledNotCommitted')
                      : t('derivationSetUp')}
                </span>
              )}
            </summary>
            <div className="derivation-root-step-body">
              <p>{t('derivationStep2Body')}</p>
              {status.recoveryBackup.status === 'not_configured' && (
                <p>{t('derivationStep2NeedPolicy')}</p>
              )}
              {pageState.kind === 'active' &&
              pageState.recoveryEnrollment === 'committed' &&
              !restartingKeys ? (
                <div role="status">
                  <StatusLine
                    line={{
                      tone: 'success',
                      label: t('derivationStep2DoneLabel'),
                      detail: t('derivationStep2DoneDetail'),
                    }}
                  />
                </div>
              ) : pageState.kind === 'active' &&
                pageState.recoveryEnrollment === 'ready_to_commit' ? null : enrolCommands.length ===
                0 ? null : (
                <>
                  <p>{t('derivationStep2Folder')}</p>
                  <p>{t('derivationStep2Approve')}</p>
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
                      {t('derivationRestartStep2')}
                    </button>
                  </div>
                )}

              {pageState.kind === 'active' &&
                pageState.recoveryEnrollment === 'ready_to_commit' && (
                  <>
                    <p>{t('derivationStep2ReadyToCommit')}</p>
                    <button
                      type="button"
                      className="dashboard-pagination-button dashboard-pagination-button--primary derivation-root-commit-keys"
                      disabled={custodyProgress.kind === 'saving' || recoveryMethod !== 'passkey'}
                      onClick={commitKeys}
                    >
                      {pendingApprovals.recipients
                        ? t('derivationCheckKeyPairApproval')
                        : t('derivationCommitWrapperKeys')}
                    </button>
                    {pendingApprovals.recipients && (
                      <p role="status">
                        {t('derivationWaitingRecipients', {
                          digest: pendingApprovals.recipients.operationDigestB64u,
                        })}
                      </p>
                    )}
                  </>
                )}
              {custodyProgress.kind === 'error' && custodyProgress.action === 'recipients' && (
                <p role="alert">{custodyProgress.message}</p>
              )}
              <RefreshStatusButton
                label={t('derivationRefreshEnrollmentStatus')}
                refresh={refresh}
              />
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
                <h3 id="recovery-step-3">{t('derivationStep3Title')}</h3>
                <span>{t('derivationStep3Subtitle')}</span>
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
                  ? t('derivationCreating')
                  : downloadable !== null
                    ? status.recoveryBackup.status === 'failed_replacement'
                      ? t('derivationReplacementFailed')
                      : t('derivationPackagesGenerated')
                    : status.recoveryBackup.status === 'cleanup_incomplete'
                      ? t('derivationBlocked')
                      : status.recoveryBackup.status === 'preparing_initial'
                        ? t('derivationCreating')
                        : t('derivationNotReady')}
              </span>
            </summary>
            <div className="derivation-root-step-body">
              {pageState.kind === 'active' &&
                pageState.recoveryEnrollment === 'committed' &&
                downloadable === null &&
                status.recoveryBackup.status !== 'cleanup_incomplete' &&
                status.recoveryBackup.status !== 'preparing_initial' &&
                !(custodyProgress.kind === 'saving' && custodyProgress.action === 'backup') && (
                  <p>{t('derivationStep3PairCommitted')}</p>
                )}
              {downloadable !== null && !canDownloadKit && <p>{t('derivationStep3NoAccess')}</p>}
              {downloadable !== null &&
                canDownloadKit &&
                status.recoveryBackup.status !== 'failed_replacement' && (
                  <p>{t('derivationStep3Ready')}</p>
                )}
              {status.recoveryBackup.status === 'failed_replacement' && (
                <p>{t('derivationStep3ReplacementFailed')}</p>
              )}
              {pageState.kind === 'active' && pageState.recoveryEnrollment !== 'committed' && (
                <p>{t('derivationStep3FinishEnrollments')}</p>
              )}
              {backupPending ? (
                <p role="status">
                  {t('derivationWaitingPrefix')}{' '}
                  <ShortId
                    label={t('derivationLabelOperationDigest')}
                    value={backupPending.operationDigestB64u}
                  />{' '}
                  {t('derivationWaitingBackupSuffix', {
                    date: formatDashboardTimestamp(backupPending.expiresAt),
                  })}
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
                    ? t('derivationCreatingBackup')
                    : t('derivationGenerateNewBackup')}
                </button>
              </div>
              {status.recoveryBackup.status === 'cleanup_incomplete' && (
                <p id="backup-cleanup-reason">{t('derivationStep3CleanupPending')}</p>
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
              <RefreshStatusButton label={t('derivationRefreshBackupStatus')} refresh={refresh} />
            </div>
          </details>
          <details className="derivation-root-recovery-step" open={downloadable !== null}>
            <summary>
              <span className="derivation-root-step-number" aria-hidden="true">
                04
              </span>
              <span className="derivation-root-step-label">
                <h3 id="recovery-step-4">{t('derivationStep4Title')}</h3>
                <span>
                  {splitRecoveryDownloads
                    ? t('derivationStep4SubtitleSplit')
                    : t('derivationStep4SubtitleBoth')}
                </span>
              </span>
            </summary>
            <div className="derivation-root-step-body">
              {downloadable === null && <p>{t('derivationStep4NeedBackup')}</p>}
              {downloadable !== null && (
                <>
                  <p>
                    {splitRecoveryDownloads
                      ? t('derivationStep4KitSplit')
                      : t('derivationStep4KitBoth')}
                  </p>
                  <p>{t('derivationStep4Run')}</p>
                  <CommandList
                    commands={[
                      {
                        label: t('derivationSaveKitLabel'),
                        command: `npx ${WALLET_CLI_PACKAGE} derivation-root backup kit --console-url ${shellQuote(consoleBaseUrl)} --environment ${shellQuote(status.identity.envId)} --recovery-set ${shellQuote(downloadable.recoverySetId)}${kitRole === null ? '' : ` --role ${kitRole}`}`,
                        note:
                          kitRole === null
                            ? t('derivationSaveKitNoteBoth')
                            : t('derivationSaveKitNoteOwn'),
                      },
                    ]}
                  />
                </>
              )}
            </div>
          </details>
          {actions.canReplaceBackup ? (
            <div className="derivation-root-recovery-notes">
              <p role="note">{t('derivationReplaceWarning')}</p>
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
            {t('derivationOperationalShares')}
          </h2>
          <span className="derivation-root-epoch">
            {t('derivationShareVersion', { epoch: status.operationalShares.activeEpoch })}
          </span>
        </div>
        <p className="derivation-root-panel-intro">{t('derivationTwoServices')}</p>
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
            <dt>{t('derivationLastRotation')}</dt>
            <dd>
              {status.operationalShares.lastCompletedRotationAt === null ? (
                t('derivationNotRotatedYet')
              ) : (
                <time dateTime={status.operationalShares.lastCompletedRotationAt}>
                  {formatDashboardTimestamp(status.operationalShares.lastCompletedRotationAt)}
                </time>
              )}
            </dd>
          </div>
          <div>
            <dt>{t('derivationNextScheduled')}</dt>
            <dd>
              {status.operationalShares.nextScheduledRotationAt === null ? (
                t('derivationNoScheduler')
              ) : (
                <time dateTime={status.operationalShares.nextScheduledRotationAt}>
                  {formatDashboardTimestamp(status.operationalShares.nextScheduledRotationAt)}
                </time>
              )}
            </dd>
          </div>
        </dl>
        <p className="derivation-root-description">{t('derivationRotationDescription')}</p>
        <button
          type="button"
          className="dashboard-pagination-button dashboard-pagination-button--primary derivation-root-rotate"
          disabled={jobInFlight || rotationPending}
          onClick={setConfirmingRotation.bind(null, true)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {jobInFlight ? t('derivationRotationInProgress') : t('derivationReviewShareRotation')}
        </button>
        {phase !== null ? (
          <ol className="dashboard-progress" aria-live="polite">
            {ROTATION_PHASES.map((label, index) => (
              <li key={label} aria-current={index === phase ? 'step' : undefined}>
                {label}
                {index < phase ? t('derivationPhaseDone') : null}
              </li>
            ))}
          </ol>
        ) : null}
        {erasureVerified && (
          <StatusLine
            line={{
              tone: 'success',
              label: t('derivationPreviousSharesErased'),
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
          {t('derivationRestoreDeployment')}
        </h2>
        {restoreAccess.kind === 'ready' && restoreAccess.restoration === 'active' ? (
          <div className="derivation-root-restore-success" role="status">
            <strong>✓ {t('derivationRecoveryCompleted')}</strong>
            <p>{t('derivationRestoredRootActiveAt', { destination: restoreAccess.destination })}</p>
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
          <h3 id="restore-instructions-title">{t('derivationHowToRestore')}</h3>
          <p className="derivation-root-description">{t('derivationNeedCliAndZip')}</p>
          <CommandList commands={[walletCliInstallCommand()]} />
          <p className="derivation-root-description">{t('derivationExtractZip')}</p>
          <h3 className="derivation-root-restore-access-heading">
            {t('derivationApproveRecoveryAccess')}
          </h3>
          <p className="derivation-root-description">{t('derivationApproveAccessBody')}</p>
          <CommandList
            commands={[
              {
                label: t('derivationConnectTrustLabel'),
                command: `seams-wallet derivation-root trust connect --console-url ${shellQuote(consoleBaseUrl)} --manifest ./manifest.json`,
                note: t('derivationConnectTrustNote'),
              },
            ]}
          />
          <div className="derivation-root-destination">
            <label htmlFor="restore-destination">{t('derivationDestination')}</label>
            <input
              id="restore-destination"
              className="dashboard-input"
              type="url"
              disabled={restoreAccess.kind !== 'ready'}
              placeholder={t('derivationDestinationPlaceholder')}
              value={restoreDestination}
              onChange={changeRestoreDestination.bind(null, setRestoreDestination)}
              aria-describedby="restore-destination-help"
              aria-invalid={destination === null}
              spellCheck={false}
              autoCapitalize="none"
            />
            <p id="restore-destination-help" className="derivation-root-description">
              {destination === null
                ? t('derivationDestinationInvalid')
                : t('derivationDestinationHelp')}
            </p>
          </div>
          {restoreAccess.kind === 'loading' && (
            <p role="status">{t('derivationCheckingRecoveryAccess')}</p>
          )}
          {restoreAccess.kind === 'unavailable' && <p role="status">{restoreAccess.message}</p>}
          {restoreAccess.kind === 'ready' &&
            destination !== null &&
            destination !== restoreAccess.destination && (
              <p role="status">
                {t('derivationConsoleCanAuthorize', { destination: restoreAccess.destination })}
              </p>
            )}
          <CommandList commands={restoreCommands} />
          {restoreAccess.kind === 'ready' && destination === restoreAccess.destination && (
            <details className="derivation-root-offline-activation">
              <summary>{t('derivationOfflineSummary')}</summary>
              <p>{t('derivationOfflineBody')}</p>
              <CommandList
                commands={[
                  authorizeRestoreCommand(consoleBaseUrl, status.identity.envId, {
                    label: t('derivationOfflineActivateLabel'),
                    command: `seams-wallet derivation-root restore activate --destination ${shellQuote(destination)} --session-file ./restore-session.json --acknowledge-offline-trust`,
                    note: t('derivationOfflineActivateNote'),
                  }),
                ]}
              />
            </details>
          )}
        </section>
      </section>

      <DashboardInlineModal
        isOpen={confirmingRotation}
        ariaLabel={t('derivationRotateSharesQuestion')}
        ariaDescribedBy="rotate-operational-shares-description"
        onRequestClose={setConfirmingRotation.bind(null, false)}
        className="derivation-root-modal"
      >
        <h2>{t('derivationRotateSharesQuestion')}</h2>
        <p id="rotate-operational-shares-description">{t('derivationRotateSharesDescription')}</p>
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
            {t('derivationCancel')}
          </button>
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--primary"
            disabled={rotationPending || rotationMethod !== 'passkey'}
            onClick={startRotation}
          >
            {rotationPending
              ? t('derivationVerifyingAndRotating')
              : rotationOutcome?.kind === 'retryable'
                ? t('derivationRetryRotation')
                : t('derivationRotateSharesButton')}
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
