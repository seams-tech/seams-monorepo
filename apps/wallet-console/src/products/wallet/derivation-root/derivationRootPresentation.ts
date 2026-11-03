import { t } from '@core/i18n';
import { recoveryKeySetupCommand, shellQuote } from './recoveryKeySetupCommand';
import type {
  TenantRootDownloadEvidenceV1,
  TenantRootRecoveryBackupV1,
  TenantRootRecoveryGovernanceV1,
  TenantRootRestoreSessionV1,
  TenantRootRotationJobV1,
  TenantRootSecurityStatusV1,
  TenantRootSourceCustodyDispositionV1,
  TenantRootTrustLevelV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import {
  tenantRootDownloadableRecoverySetV1,
  tenantRootRotationPermitsHealingClaimV1,
} from '@seams-internal/wallet-console-shared/tenant-root';

/**
 * Copy and state derivation for the Derivation root security page.
 *
 * This is separated from the component so the wording of every security claim
 * is testable. Two claims in particular must never drift:
 *
 * - compromise healing is only ever claimed by a deployment whose profile
 *   permits it *and* whose rotation proved both retirements;
 * - a browser download is never described as durable.
 */

/** How a status line should read to a screen reader and to the eye. */
export interface DerivationRootStatusLine {
  readonly tone: 'neutral' | 'progress' | 'warning' | 'danger' | 'success';
  readonly label: string;
  readonly detail: string;
}

/** Progress phases, in the order the page shows them. */
export const ROTATION_PHASES: readonly string[] = [
  t('derivationPhasePreparing'),
  t('derivationPhaseInstalling'),
  t('derivationPhaseVerifying'),
  t('derivationPhaseActivating'),
  t('derivationPhaseRetiring'),
  t('derivationPhaseComplete'),
];

/** Returns the phase index a job is currently in, or null when idle. */
export function rotationPhaseIndex(job: TenantRootRotationJobV1 | null): number | null {
  if (job === null) return null;
  switch (job.status) {
    case 'preparing':
      return 0;
    case 'installing':
      return 1;
    case 'verifying':
      return 2;
    case 'activating':
      return 3;
    case 'retiring':
      return 4;
    case 'complete':
      return 5;
    case 'failed_before_activation':
    case 'cleanup_incomplete':
    case 'retirement_incomplete':
      return null;
  }
}

/** Describes the rotation state in the page's own words. */
export function rotationStatusLine(status: TenantRootSecurityStatusV1): DerivationRootStatusLine {
  const job = status.operationalShares.job;
  if (job === null) {
    return {
      tone: 'neutral',
      label: t('derivationActiveSharesLabel'),
      detail: t('derivationActiveSharesDetail', {
        epoch: String(status.operationalShares.activeEpoch),
      }),
    };
  }
  switch (job.status) {
    case 'preparing':
    case 'installing':
    case 'verifying':
    case 'activating':
    case 'retiring':
      return {
        tone: 'progress',
        label: ROTATION_PHASES[rotationPhaseIndex(job) ?? 0] ?? t('derivationRotationInProgress'),
        detail: t('derivationRotationInProgressDetail'),
      };
    case 'complete':
      return {
        tone: 'success',
        label: t('derivationPhaseComplete'),
        detail: t('derivationRotationCompleteDetail', { epoch: String(job.activatedEpoch) }),
      };
    case 'retirement_incomplete':
      return {
        tone: 'warning',
        label: t('derivationRetirementIncompleteLabel'),
        detail: t('derivationRetirementIncompleteDetail'),
      };
    case 'failed_before_activation':
      return {
        tone: 'danger',
        label: t('derivationRotationFailedLabel'),
        detail: t('derivationRotationFailedDetail', { code: job.failureCode }),
      };
    case 'cleanup_incomplete':
      return {
        tone: 'danger',
        label: t('derivationRotationCleanupLabel'),
        detail: t('derivationRotationCleanupDetail', {
          description: job.outstanding.description,
          code: job.failureCode,
        }),
      };
  }
}

/**
 * Returns the sentence this deployment is allowed to say about retired shares.
 *
 * A deployment that only rotates operational shares must not imply it healed a
 * compromise, and an activated-but-unretired rotation must not either.
 */
export function retiredShareClaim(status: TenantRootSecurityStatusV1): string {
  if (
    tenantRootRotationPermitsHealingClaimV1(
      status.operationalShares.securityProfile,
      status.operationalShares.job,
    )
  ) {
    return t('derivationRetiredClaimErased');
  }
  return t('derivationRetiredClaimNotVerified');
}

/** Describes the recovery backup state. */
export function recoveryStatusLine(backup: TenantRootRecoveryBackupV1): DerivationRootStatusLine {
  switch (backup.status) {
    case 'not_configured':
      return {
        tone: 'warning',
        label: t('derivationNoBackupLabel'),
        detail: t('derivationNoBackupDetail'),
      };
    case 'recipients_pending':
      return {
        tone: 'progress',
        label: t('derivationWrapperIncompleteLabel'),
        detail:
          backup.enrolled.kind === 'neither_enrolled'
            ? t('derivationWrapperNeitherDetail')
            : t('derivationWrapperOneDetail'),
      };
    case 'preparing_initial':
      return {
        tone: 'progress',
        label: t('derivationCreatingBackupLabel'),
        detail: t('derivationCreatingBackupDetail'),
      };
    case 'ready':
      return {
        tone: 'success',
        label: t('derivationBackupReadyLabel'),
        detail: t('derivationBackupReadyDetail', { id: backup.active.recoverySetId }),
      };
    case 'replacing':
      return {
        tone: 'progress',
        label: t('derivationReplacingBackupLabel'),
        detail: t('derivationReplacingBackupDetail', { id: backup.active.recoverySetId }),
      };
    case 'failed_initial':
      return {
        tone: 'danger',
        label: t('derivationBackupFailedLabel'),
        detail: t('derivationBackupFailedDetail', { code: backup.failureCode }),
      };
    case 'failed_replacement':
      return {
        tone: 'warning',
        label: t('derivationReplacementFailedLabel'),
        detail: t('derivationReplacementFailedDetail', {
          id: backup.active.recoverySetId,
          code: backup.failureCode,
        }),
      };
    case 'cleanup_incomplete':
      if (tenantRootDownloadableRecoverySetV1(backup) !== null) {
        return {
          tone: 'warning',
          label: t('derivationBackupReadyCleanupLabel'),
          detail: t('derivationBackupReadyCleanupDetail'),
        };
      }
      return {
        tone: 'danger',
        label: t('derivationEarlierCleanupLabel'),
        detail: t('derivationEarlierCleanupDetail'),
      };
    case 'tenant_held_external':
      return {
        tone: 'warning',
        label: t('derivationTenantHeldLabel'),
        detail: t('derivationTenantHeldDetail'),
      };
  }
}

/** Describes one artifact's download evidence without overstating it. */
export function downloadEvidenceLine(evidence: TenantRootDownloadEvidenceV1): string {
  switch (evidence.kind) {
    case 'never_downloaded':
      return t('derivationNeverDownloaded');
    case 'download_issued':
      return t('derivationDownloadIssued', { date: evidence.issuedAt });
    case 'durable_verified':
      return t('derivationDownloadVerified', {
        date: evidence.verifiedAt,
        level: evidence.trustLevel.kind,
      });
  }
}

/** Describes which trust result a verification obtained. */
export function trustLevelLine(level: TenantRootTrustLevelV1): string {
  switch (level.kind) {
    case 'cryptographically_valid_offline':
      return t('derivationTrustOffline');
    case 'valid_at_trust_snapshot':
      return t('derivationTrustSnapshot', { date: level.snapshotIssuedAt });
    case 'current_trust_confirmed':
      return t('derivationTrustCurrent', { date: level.checkedAt });
  }
}

/** Describes the restore state for a destination deployment. */
export function sourceDispositionStatusLine(
  disposition: TenantRootSourceCustodyDispositionV1,
): DerivationRootStatusLine {
  switch (disposition.kind) {
    case 'verified_retired':
      return {
        tone: 'success',
        label: t('derivationSourceRetiredLabel'),
        detail: t('derivationSourceRetiredDetail'),
      };
    case 'unavailable_retirement_unverified':
      return {
        tone: 'warning',
        label: t('derivationSourceUnverifiedLabel'),
        detail: t('derivationSourceUnverifiedDetail'),
      };
    case 'retained_as_backup':
      return {
        tone: 'warning',
        label: t('derivationSourceRetainedLabel'),
        detail: t('derivationSourceRetainedDetail'),
      };
    default: {
      const exhaustive: never = disposition;
      throw new Error(`Unsupported source disposition: ${exhaustive}`);
    }
  }
}

export function restoreStatusLine(
  restore: TenantRootRestoreSessionV1 | null,
): DerivationRootStatusLine {
  if (restore === null) {
    return {
      tone: 'neutral',
      label: t('derivationNoRestoreLabel'),
      detail: t('derivationNoRestoreDetail'),
    };
  }
  switch (restore.status) {
    case 'awaiting_manifest':
      return {
        tone: 'progress',
        label: t('derivationAwaitingManifestLabel'),
        detail: t('derivationAwaitingManifestDetail'),
      };
    case 'awaiting_role_imports':
      return {
        tone: 'progress',
        label: t('derivationAwaitingRoleLabel'),
        detail:
          restore.installed.kind === 'neither_installed'
            ? t('derivationAwaitingRoleNeither')
            : t('derivationAwaitingRoleOne'),
      };
    case 'verifying':
      return {
        tone: 'progress',
        label: t('derivationVerifyingContinuityLabel'),
        detail: t('derivationVerifyingContinuityDetail'),
      };
    case 'ready_to_activate':
      return {
        tone: 'progress',
        label: t('derivationReadyToActivate'),
        detail: trustLevelLine(restore.trustLevel),
      };
    case 'refreshing':
      return {
        tone: 'progress',
        label: t('derivationRefreshingSharesLabel'),
        detail: t('derivationRefreshingSharesDetail'),
      };
    case 'active':
      return {
        tone: 'success',
        label: t('derivationRestoredRootActive'),
        detail: sourceDispositionStatusLine(restore.sourceDisposition).detail,
      };
    case 'failed_before_activation':
      return {
        tone: 'danger',
        label: t('derivationRestoreFailedLabel'),
        detail: t('derivationRestoreFailedDetail', { code: restore.failureCode }),
      };
    case 'cleanup_incomplete': {
      if (restore.phase === 'pre_activation') {
        return {
          tone: 'danger',
          label: t('derivationRestoreCleanupLabel'),
          detail: t('derivationStillRequiresRemoval', {
            description: restore.outstanding.description,
          }),
        };
      }
      const description =
        restore.roleCleanup.kind === 'complete'
          ? restore.bootstrapCleanup.kind === 'outstanding'
            ? restore.bootstrapCleanup.outstanding.description
            : t('derivationActivationCleanup')
          : restore.roleCleanup.outstanding.description;
      return {
        tone: 'danger',
        label: t('derivationActivatedCleanupLabel'),
        detail: t('derivationStillRequiresRemoval', { description }),
      };
    }
    case 'expired':
      return {
        tone: 'warning',
        label: t('derivationRestoreExpiredLabel'),
        detail: t('derivationRestoreExpiredDetail', { date: restore.expiredAt }),
      };
  }
}

/** Returns whether the page should warn that a backup was never taken. */
export function shouldWarnBackupNeverDownloaded(backup: TenantRootRecoveryBackupV1): boolean {
  const active =
    backup.status === 'ready' ||
    backup.status === 'replacing' ||
    backup.status === 'failed_replacement'
      ? backup.active
      : null;
  if (active === null) return false;
  return (
    active.deriverAPackage.kind === 'never_downloaded' ||
    active.deriverBPackage.kind === 'never_downloaded' ||
    active.manifest.kind === 'never_downloaded'
  );
}

/** One copyable command an operator runs themselves. */
export interface DerivationRootCliCommand {
  readonly label: string;
  readonly command: string;
  readonly note?: string;
  readonly completed?: boolean;
}

/**
 * Returns the role-specific restore commands for one session.
 *
 * The page shows these rather than collecting anything: it never asks for a
 * private wrapper key, and it never handles both roles in one flow. The two
 * commands may be run from different machines by different people.
 */
function bundledHolderRestoreCommand(
  destinationUrl: string,
  holder: 'a' | 'b',
): DerivationRootCliCommand {
  return {
    label: t('derivationHolderRestoreLabel', { holder: holder.toUpperCase() }),
    command: `seams-wallet derivation-root restore --destination ${shellQuote(destinationUrl)} --role deriver-${holder} --wrapping-key-file ./deriver-${holder}-wrapper.key`,
    note: t('derivationHolderRestoreNote'),
  };
}

export function restoreCliCommands(
  destinationUrl: string,
  session: TenantRootRestoreSessionV1 | null,
): readonly DerivationRootCliCommand[] {
  if (session === null || session.status === 'awaiting_manifest')
    return [
      bundledHolderRestoreCommand(destinationUrl, 'a'),
      bundledHolderRestoreCommand(destinationUrl, 'b'),
      {
        label: t('derivationCheckImportsLabel'),
        command: `seams-wallet derivation-root restore status --destination ${shellQuote(destinationUrl)}`,
        note: t('derivationCheckImportsNote'),
      },
      {
        label: t('derivationActivateRecoveryLabel'),
        command: `seams-wallet derivation-root restore activate --destination ${shellQuote(destinationUrl)} --session-file ./restore-session.json`,
        note: t('derivationActivateRecoveryNote'),
      },
    ];
  const resuming =
    session.status === 'refreshing' ||
    (session.status === 'cleanup_incomplete' && session.phase === 'post_activation');
  if (session.status === 'verifying' || session.status === 'ready_to_activate' || resuming) {
    return [
      {
        label: resuming
          ? t('derivationResumeActivationLabel')
          : t('derivationActivateRestoredLabel'),
        command: [
          'seams-wallet derivation-root restore activate',
          `  --destination ${shellQuote(destinationUrl)}`,
          '  --session-file ./restore-session.json',
        ].join(' \\\n'),
        note: resuming ? t('derivationResumeActivationNote') : t('derivationActivateRestoredNote'),
      },
    ];
  }
  if (session.status !== 'awaiting_role_imports') return [];

  const installed = session.installed;
  const needsA = installed.kind !== 'deriver_a_installed';
  const needsB = installed.kind !== 'deriver_b_installed';
  const commands: DerivationRootCliCommand[] = [];
  if (needsA) commands.push(bundledHolderRestoreCommand(destinationUrl, 'a'));
  if (needsB) commands.push(bundledHolderRestoreCommand(destinationUrl, 'b'));

  return commands;
}

/** Which recovery actions the current state permits. */
export interface DerivationRootRecoveryActions {
  readonly canChooseGovernance: boolean;
  readonly canEnrolRecipients: boolean;
  readonly canCreateBackup: boolean;
  readonly canReplaceBackup: boolean;
  readonly canDownload: boolean;
}

/**
 * Returns the recovery actions the current backup state permits.
 *
 * Download is offered only for a set this deployment actually holds, so a
 * restored `tenant_held_external` set never shows a download the service
 * cannot serve.
 */
export function recoveryActions(backup: TenantRootRecoveryBackupV1): DerivationRootRecoveryActions {
  const inFlight = backup.status === 'preparing_initial' || backup.status === 'replacing';
  const hasActiveSet =
    backup.status === 'ready' ||
    backup.status === 'replacing' ||
    backup.status === 'failed_replacement' ||
    (backup.status === 'cleanup_incomplete' && backup.active !== null);
  return {
    canChooseGovernance: !inFlight,
    canEnrolRecipients: !inFlight && backup.status !== 'tenant_held_external',
    canCreateBackup:
      !inFlight &&
      (backup.status === 'recipients_pending' ||
        backup.status === 'not_configured' ||
        backup.status === 'failed_initial' ||
        (backup.status === 'cleanup_incomplete' && backup.active === null)),
    canReplaceBackup: !inFlight && hasActiveSet,
    canDownload: tenantRootDownloadableRecoverySetV1(backup) !== null,
  };
}

/** How the chosen recovery governance reads, or that none has been chosen. */
export function governanceLine(backup: TenantRootRecoveryBackupV1): string {
  if (backup.status === 'not_configured') {
    return t('derivationGovernanceNotChosen');
  }
  return describeGovernance(backup.governance);
}

function describeGovernance(governance: TenantRootRecoveryGovernanceV1): string {
  switch (governance.kind) {
    case 'single_owner_v1':
      return t('derivationGovernanceSingle', {
        owner: governance.acknowledgedByOwnerId,
        date: governance.acknowledgedAt,
      });
    case 'two_person_v1':
      return t('derivationGovernanceTwo', {
        owner: governance.selectedByOwnerId,
        date: governance.selectedAt,
      });
  }
}

/**
 * Keep both wrapper-key setup commands visible after enrollment completes.
 *
 * Enrolment proves control of a private wrapper key, so it never happens in
 * the browser: the page shows the two role-local commands and nothing more.
 * Each command handles exactly one role.
 */
export function enrolCliCommands(
  consoleUrl: string,
  environmentId: string,
  backup: TenantRootRecoveryBackupV1,
  showSetup = false,
): readonly DerivationRootCliCommand[] {
  const commands: DerivationRootCliCommand[] = [];
  for (const role of ['deriver-a', 'deriver-b'] as const) {
    const complete =
      !showSetup &&
      (backup.status === 'recipients_pending'
        ? backup.enrolled.kind ===
          (role === 'deriver-a' ? 'deriver_a_enrolled' : 'deriver_b_enrolled')
        : backup.status !== 'not_configured');
    commands.push({
      label: t(complete ? 'derivationWrapperSetupCompleted' : 'derivationWrapperSetup', {
        role: role === 'deriver-a' ? 'Deriver A' : 'Deriver B',
      }),
      command: recoveryKeySetupCommand(consoleUrl, environmentId, role),
      completed: complete,
      note: complete ? undefined : t('derivationWrapperSetupNote', { role }),
    });
  }
  return commands;
}

export function recoveryBackupConflictMessage(code: string): string {
  switch (code) {
    case 'recipient_pair_not_committed':
      return t('derivationConflictPairNotCommitted');
    case 'governance_not_selected':
      return t('derivationConflictGovernance');
    case 'generation_already_in_flight':
      return t('derivationConflictInFlight');
    case 'cleanup_outstanding':
      return t('derivationConflictCleanup');
    case 'verification_incomplete':
      return t('derivationConflictVerification');
    default:
      return t('derivationConflictDefault', { code });
  }
}
