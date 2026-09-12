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
} from '@seams-internal/shared-ts/tenant-root';
import {
  tenantRootDownloadableRecoverySetV1,
  tenantRootRotationPermitsHealingClaimV1,
} from '@seams-internal/shared-ts/tenant-root';

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
  'Preparing rotation',
  'Installing new shares',
  'Verifying root continuity',
  'Activating new shares',
  'Retiring previous shares',
  'Rotation complete',
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
      label: 'Active operational shares',
      detail: `Deriver A and Deriver B hold epoch ${String(status.operationalShares.activeEpoch)} operational shares.`,
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
        label: ROTATION_PHASES[rotationPhaseIndex(job) ?? 0] ?? 'Rotation in progress',
        detail: 'Normal signing continues. New derivation ceremonies may pause briefly.',
      };
    case 'complete':
      return {
        tone: 'success',
        label: 'Rotation complete',
        detail: `Epoch ${String(job.activatedEpoch)} is active and both previous shares are proved retired.`,
      };
    case 'retirement_incomplete':
      return {
        tone: 'warning',
        label: 'Rotation active; retirement incomplete',
        detail:
          'The new shares are active, but this deployment has not proved the previous shares were retired.',
      };
    case 'failed_before_activation':
      return {
        tone: 'danger',
        label: 'Rotation failed before activation',
        detail: `The derivation root is unchanged (${job.failureCode}). Its material was cleaned up.`,
      };
    case 'cleanup_incomplete':
      return {
        tone: 'danger',
        label: 'Rotation failed; cleanup incomplete',
        detail: `${job.outstanding.description} still requires removal (${job.failureCode}).`,
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
    return 'Retired shares are cryptographically destroyed, so a copy of the previous shares cannot be reused.';
  }
  return 'Operational shares rotate, but this deployment has not verified cryptographic erasure of retired shares.';
}

/** Describes the recovery backup state. */
export function recoveryStatusLine(backup: TenantRootRecoveryBackupV1): DerivationRootStatusLine {
  switch (backup.status) {
    case 'not_configured':
      return {
        tone: 'warning',
        label: 'No recovery backup',
        detail: 'Choose a recovery governance policy and enrol both wrapper keys.',
      };
    case 'recipients_pending':
      return {
        tone: 'progress',
        label: 'Wrapper keys incomplete',
        detail:
          backup.enrolled.kind === 'neither_enrolled'
            ? 'Neither Deriver A nor Deriver B has proved control of a wrapper key.'
            : 'One role has proved control. Both are required before a backup can be created.',
      };
    case 'preparing_initial':
      return {
        tone: 'progress',
        label: 'Creating recovery backup',
        detail: 'Deriver A and Deriver B are generating a dedicated sharing of the same root.',
      };
    case 'ready':
      return {
        tone: 'success',
        label: 'Recovery backup ready',
        detail: `Recovery set ${backup.active.recoverySetId} is available to download.`,
      };
    case 'replacing':
      return {
        tone: 'progress',
        label: 'Replacing recovery backup',
        detail: `Recovery set ${backup.active.recoverySetId} stays downloadable until the replacement is verified.`,
      };
    case 'failed_initial':
      return {
        tone: 'danger',
        label: 'Recovery backup failed',
        detail: `No recovery backup exists (${backup.failureCode}). Its partial material was cleaned up.`,
      };
    case 'failed_replacement':
      return {
        tone: 'warning',
        label: 'Replacement failed; previous backup still active',
        detail: `Recovery set ${backup.active.recoverySetId} remains downloadable (${backup.failureCode}).`,
      };
    case 'cleanup_incomplete':
      if (tenantRootDownloadableRecoverySetV1(backup) !== null) {
        return {
          tone: 'warning',
          label: 'Backup ready — earlier cleanup pending',
          detail:
            'You can create a new backup. Provider deletion of earlier recovery material is still pending and will be checked again during backup creation.',
        };
      }
      return {
        tone: 'danger',
        label: 'Earlier backup cleanup pending',
        detail:
          'You can retry backup creation. Cleanup of the earlier attempt remains tracked until the provider confirms deletion.',
      };
    case 'tenant_held_external':
      return {
        tone: 'warning',
        label: 'Recovery files are tenant-held',
        detail:
          'This deployment can verify that your recovery files restored this root, but it does not store them for redownload. Keep your files, or replace the recovery backup to create a new set here.',
      };
  }
}

/** Describes one artifact's download evidence without overstating it. */
export function downloadEvidenceLine(evidence: TenantRootDownloadEvidenceV1): string {
  switch (evidence.kind) {
    case 'never_downloaded':
      return 'Never downloaded';
    case 'download_issued':
      return `Sent to a browser on ${evidence.issuedAt}. This deployment cannot confirm it was saved.`;
    case 'durable_verified':
      return `Verified on disk by the CLI on ${evidence.verifiedAt} (${evidence.trustLevel.kind}).`;
  }
}

/** Describes which trust result a verification obtained. */
export function trustLevelLine(level: TenantRootTrustLevelV1): string {
  switch (level.kind) {
    case 'cryptographically_valid_offline':
      return 'Signatures and certificates verify against pinned roots. Revocation status was not available.';
    case 'valid_at_trust_snapshot':
      return `Checked against a saved trust snapshot issued ${level.snapshotIssuedAt}.`;
    case 'current_trust_confirmed':
      return `Checked against current revocation status at ${level.checkedAt}.`;
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
        label: 'Source retirement verified',
        detail: 'The source deployment has verified retirement evidence.',
      };
    case 'unavailable_retirement_unverified':
      return {
        tone: 'warning',
        label: 'Source retirement unverified',
        detail: 'The source deployment is unavailable. Its retirement has not been verified.',
      };
    case 'retained_as_backup':
      return {
        tone: 'warning',
        label: 'Source retained as backup',
        detail:
          'The source deployment is retained as a backup and remains part of the custody boundary.',
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
      label: 'No restore in progress',
      detail:
        'Restore uses this site’s console API. Recovery imports require an empty destination; an active derivation root cannot be overwritten.',
    };
  }
  switch (restore.status) {
    case 'awaiting_manifest':
      return {
        tone: 'progress',
        label: 'Waiting for the recovery manifest',
        detail: 'Register the public manifest from your recovery files.',
      };
    case 'awaiting_role_imports':
      return {
        tone: 'progress',
        label: 'Waiting for role shares',
        detail:
          restore.installed.kind === 'neither_installed'
            ? 'Run the Deriver A and Deriver B commands. They may run on different machines.'
            : 'One role share is installed. Run the remaining role command.',
      };
    case 'verifying':
      return {
        tone: 'progress',
        label: 'Verifying continuity',
        detail: 'Both role shares are installed.',
      };
    case 'ready_to_activate':
      return {
        tone: 'progress',
        label: 'Ready to activate',
        detail: trustLevelLine(restore.trustLevel),
      };
    case 'refreshing':
      return {
        tone: 'progress',
        label: 'Refreshing operational shares',
        detail: 'The restored root is being forward-refreshed before activation.',
      };
    case 'active':
      return {
        tone: 'success',
        label: 'Restored root active',
        detail: sourceDispositionStatusLine(restore.sourceDisposition).detail,
      };
    case 'failed_before_activation':
      return {
        tone: 'danger',
        label: 'Restore failed before activation',
        detail: `No root was activated (${restore.failureCode}). Imported material was cleaned up.`,
      };
    case 'cleanup_incomplete': {
      if (restore.phase === 'pre_activation') {
        return {
          tone: 'danger',
          label: 'Restore material requires cleanup',
          detail: `${restore.outstanding.description} still requires removal.`,
        };
      }
      const description =
        restore.roleCleanup.kind === 'complete'
          ? restore.bootstrapCleanup.kind === 'outstanding'
            ? restore.bootstrapCleanup.outstanding.description
            : 'activation cleanup'
          : restore.roleCleanup.outstanding.description;
      return {
        tone: 'danger',
        label: 'Activated root requires cleanup',
        detail: `${description} still requires removal.`,
      };
    }
    case 'expired':
      return {
        tone: 'warning',
        label: 'Restore session expired',
        detail: `The session expired on ${restore.expiredAt}. Start a new one.`,
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
    label: `Holder ${holder.toUpperCase()}: restore your share`,
    command: `seams-wallet derivation-root restore --destination ${shellQuote(destinationUrl)} --role deriver-${holder} --wrapping-key-file ./deriver-${holder}-wrapper.key`,
    note: 'Run inside your extracted recovery folder. Use your actual wrapper-key file path. Approve the matching code in your browser when prompted. The CLI registers the manifest and saves retry state automatically; rerun this command to retry.',
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
        label: 'Check both imports',
        command: `seams-wallet derivation-root restore status --destination ${shellQuote(destinationUrl)}`,
        note: 'Both holders must finish before activation. Retry any missing import with the same holder command.',
      },
      {
        label: 'Activate recovery',
        command: `seams-wallet derivation-root restore activate --destination ${shellQuote(destinationUrl)} --session-file ./restore-session.json`,
        note: 'After both holders finish, check the status first. Run the activation command when both imports are ready. Keep restore-session.json for activation retries. If activation requests offline trust acknowledgement, read the explanation below before retrying.',
      },
    ];
  const resuming =
    session.status === 'refreshing' ||
    (session.status === 'cleanup_incomplete' && session.phase === 'post_activation');
  if (session.status === 'verifying' || session.status === 'ready_to_activate' || resuming) {
    return [
      {
        label: resuming ? 'Resume activation' : 'Activate the restored root',
        command: [
          'seams-wallet derivation-root restore activate',
          `  --destination ${shellQuote(destinationUrl)}`,
          '  --session-file ./restore-session.json',
        ].join(' \\\n'),
        note: resuming
          ? 'Reuse the session file from your first activation attempt. Bootstrap access is destroyed after activation. If you originally used --acknowledge-offline-trust, include it again.'
          : 'Keep the private session file for retries. Activation verifies the root commitment, refreshes operational shares, and destroys imported material. Add --acknowledge-offline-trust only if current trust could not be confirmed and you accept offline verification.',
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
    return 'Recovery governance has not been chosen. Choose it before enrolling wrapper keys.';
  }
  return describeGovernance(backup.governance);
}

function describeGovernance(governance: TenantRootRecoveryGovernanceV1): string {
  switch (governance.kind) {
    case 'single_owner_v1':
      return `Single owner: one organization owner can change recovery custody alone. Warning acknowledged by ${governance.acknowledgedByOwnerId} on ${governance.acknowledgedAt}.`;
    case 'two_person_v1':
      return `Two-person: recovery custody changes need a second owner's approval. Selected by ${governance.selectedByOwnerId} on ${governance.selectedAt}.`;
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
    const complete = !showSetup && (backup.status === 'recipients_pending'
      ? backup.enrolled.kind === (role === 'deriver-a' ? 'deriver_a_enrolled' : 'deriver_b_enrolled')
      : backup.status !== 'not_configured');
    commands.push({
      label: `${role === 'deriver-a' ? 'Deriver A' : 'Deriver B'} wrapper key setup${complete ? ' (completed)' : ''}`,
      command: recoveryKeySetupCommand(consoleUrl, environmentId, role),
      completed: complete,
      note: complete
        ? undefined
        : `Requires Node.js 22 or later. Run in a macOS or Linux terminal, then approve the matching code in the dashboard. The CLI creates the wrapper key file at ./${role}-wrapper.key. Keep this file for step 4.`,
    });
  }
  return commands;
}

export function recoveryBackupConflictMessage(code: string): string {
  switch (code) {
    case 'recipient_pair_not_committed':
      return 'Both wrapper keys must be enrolled and committed before a backup can be created. Commit the pair in step 2.';
    case 'governance_not_selected':
      return 'Save an approval policy in step 1 before creating a backup.';
    case 'generation_already_in_flight':
      return 'A backup is already being created. Refresh the status before starting another request.';
    case 'cleanup_outstanding':
      return 'Backup creation failed and provider cleanup is still pending. You can retry after the backup cooldown.';
    case 'verification_incomplete':
      return 'The generated backup did not pass all required checks. No new backup is ready. Ask your deployment operator to review the failed generation before retrying.';
    default:
      return `The server refused this backup request (${code}). Refresh the status and review the recovery details before retrying.`;
  }
}
