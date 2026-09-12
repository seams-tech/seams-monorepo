import { expect, test } from '@playwright/test';
import type {
  TenantRootDownloadEvidenceV1,
  TenantRootRecoveryBackupV1,
  TenantRootRecoveryGovernanceV1,
  TenantRootRecoverySetStateV1,
  TenantRootRestoreSessionV1,
  TenantRootRotationJobV1,
  TenantRootSecurityStatusV1,
} from '../../packages/shared-ts/src/tenant-root';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '../../packages/shared-ts/src/tenant-root/tenantRootIdentity';
import {
  downloadEvidenceLine,
  enrolCliCommands,
  governanceLine,
  recoveryActions,
  recoveryBackupConflictMessage,
  recoveryStatusLine,
  restoreCliCommands,
  restoreStatusLine,
  retiredShareClaim,
  rotationPhaseIndex,
  rotationStatusLine,
  shouldWarnBackupNeverDownloaded,
  trustLevelLine,
} from '../../apps/seams-console/src/products/wallet/derivation-root/derivationRootPresentation';

const GOVERNANCE: TenantRootRecoveryGovernanceV1 = {
  kind: 'two_person_v1',
  selectedByOwnerId: 'owner-1',
  selectedAt: '2026-08-01T00:00:00.000Z',
};

const NEVER: TenantRootDownloadEvidenceV1 = { kind: 'never_downloaded' };

function identity() {
  const result = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: 'org-1',
    projectId: 'project-2',
    envId: 'production',
    signingRootId: 'root-main',
    signingRootVersion: 'v3',
  });
  if (!result.ok) throw new Error('identity fixture is invalid');
  return result.value;
}

function recoverySet(): TenantRootRecoverySetStateV1 {
  return {
    recoverySetId: 'set-1',
    recipientPair: {
      deriverAFingerprintB64u: 'fingerprint-a',
      deriverBFingerprintB64u: 'fingerprint-b',
    },
    createdAt: '2026-08-29T10:20:30.123Z',
    rootCommitmentFingerprintB64u: 'root-commitment',
    deriverAPackage: NEVER,
    deriverBPackage: NEVER,
    manifest: NEVER,
  };
}

function status(overrides: {
  job?: TenantRootRotationJobV1 | null;
  securityProfile?: 'operational_rotation_v1' | 'managed_healing_v1';
  backup?: TenantRootRecoveryBackupV1;
  restore?: TenantRootRestoreSessionV1 | null;
}): TenantRootSecurityStatusV1 {
  return {
    identity: identity(),
    custodyLineageId: 'lineage-1',
    lifecycleRevision: 7,
    operationalShares: {
      activeEpoch: 4,
      rootCommitmentFingerprintB64u: 'root-commitment',
      deriverAStatus: 'healthy',
      deriverBStatus: 'healthy',
      lastCompletedRotationAt: null,
      nextScheduledRotationAt: null,
      securityProfile: overrides.securityProfile ?? 'operational_rotation_v1',
      job: overrides.job ?? null,
    },
    recoveryBackup: overrides.backup ?? { status: 'not_configured' },
    restore: overrides.restore ?? null,
    trustLevel: { kind: 'cryptographically_valid_offline' },
  };
}

const COMPLETE_ROTATION: TenantRootRotationJobV1 = {
  status: 'complete',
  jobId: 'job-1',
  requestedAt: '2026-09-05T12:00:00.000Z',
  completedAt: '2026-09-05T12:04:00.000Z',
  activatedEpoch: 5,
  activationReceiptDigestB64u: 'receipt',
  retirementReceipts: { deriverA: 'receipt-a', deriverB: 'receipt-b' },
};

test('compromise healing is claimed only by a profile that permits it and a complete rotation', () => {
  // An operational-rotation deployment never claims healing, even when complete.
  expect(retiredShareClaim(status({ job: COMPLETE_ROTATION }))).toContain(
    'has not verified cryptographic erasure',
  );

  // A managed-healing deployment mid-rotation still does not claim it.
  expect(
    retiredShareClaim(
      status({
        securityProfile: 'managed_healing_v1',
        job: {
          status: 'retiring',
          jobId: 'job-1',
          requestedAt: '2026-09-05T12:00:00.000Z',
          activatedEpoch: 5,
          activationReceiptDigestB64u: 'receipt',
        },
      }),
    ),
  ).toContain('has not verified cryptographic erasure');

  // Activated but retirement incomplete is not healing either.
  expect(
    retiredShareClaim(
      status({
        securityProfile: 'managed_healing_v1',
        job: {
          status: 'retirement_incomplete',
          jobId: 'job-1',
          requestedAt: '2026-09-05T12:00:00.000Z',
          activatedEpoch: 5,
          activationReceiptDigestB64u: 'receipt',
          outstanding: { roles: ['deriver_b'], description: 'deriver-b retirement' },
        },
      }),
    ),
  ).toContain('has not verified cryptographic erasure');

  expect(
    retiredShareClaim(status({ securityProfile: 'managed_healing_v1', job: COMPLETE_ROTATION })),
  ).toContain('cryptographically destroyed');
});

test('an activated rotation with incomplete retirement says so plainly', () => {
  const line = rotationStatusLine(
    status({
      job: {
        status: 'retirement_incomplete',
        jobId: 'job-1',
        requestedAt: '2026-09-05T12:00:00.000Z',
        activatedEpoch: 5,
        activationReceiptDigestB64u: 'receipt',
        outstanding: { roles: ['deriver_b'], description: 'deriver-b retirement' },
      },
    }),
  );
  expect(line.tone).toBe('warning');
  expect(line.label).toBe('Rotation active; retirement incomplete');
  expect(rotationPhaseIndex(null)).toBeNull();
});

test('a browser download is never described as durable', () => {
  expect(downloadEvidenceLine(NEVER)).toBe('Never downloaded');
  const issued = downloadEvidenceLine({
    kind: 'download_issued',
    issuedAt: '2026-09-05T12:00:00.000Z',
    actorUserId: 'owner-1',
    contentDigestB64u: 'digest',
  });
  expect(issued).toContain('cannot confirm it was saved');
  expect(issued).not.toContain('Verified on disk');

  expect(
    downloadEvidenceLine({
      kind: 'durable_verified',
      verifiedAt: '2026-09-05T12:01:00.000Z',
      actorUserId: 'owner-1',
      contentDigestB64u: 'digest',
      trustLevel: {
        kind: 'current_trust_confirmed',
        snapshotVersion: 1,
        snapshotIssuedAt: 'x',
        checkedAt: 'y',
      },
    }),
  ).toContain('Verified on disk by the CLI');
});

test('a restored deployment says it cannot serve the source files', () => {
  const line = recoveryStatusLine({
    status: 'tenant_held_external',
    governance: GOVERNANCE,
    recoverySetId: 'set-1',
    manifestDigestB64u: 'digest',
  });
  expect(line.detail).toContain('does not store them for redownload');
});

test('a replacement in flight says the old set is still downloadable', () => {
  const line = recoveryStatusLine({
    status: 'replacing',
    governance: GOVERNANCE,
    active: recoverySet(),
    pendingRecipientPair: {
      deriverAFingerprintB64u: 'fingerprint-a2',
      deriverBFingerprintB64u: 'fingerprint-b2',
    },
    pendingRecoverySetId: 'set-2',
  });
  expect(line.detail).toContain('stays downloadable');
});

test('a never-downloaded backup is warned about, a downloaded one is not', () => {
  expect(
    shouldWarnBackupNeverDownloaded({
      status: 'ready',
      governance: GOVERNANCE,
      active: recoverySet(),
    }),
  ).toBe(true);

  const downloaded: TenantRootDownloadEvidenceV1 = {
    kind: 'download_issued',
    issuedAt: '2026-09-05T12:00:00.000Z',
    actorUserId: 'owner-1',
    contentDigestB64u: 'digest',
  };
  expect(
    shouldWarnBackupNeverDownloaded({
      status: 'ready',
      governance: GOVERNANCE,
      active: {
        ...recoverySet(),
        deriverAPackage: downloaded,
        deriverBPackage: downloaded,
        manifest: downloaded,
      },
    }),
  ).toBe(false);

  // Nothing to warn about when there is no set at all.
  expect(shouldWarnBackupNeverDownloaded({ status: 'not_configured' })).toBe(false);
});

test('restore instructions explain the empty destination requirement', () => {
  const line = restoreStatusLine(null);
  expect(line.detail).toContain('an active derivation root cannot be overwritten');

  expect(trustLevelLine({ kind: 'cryptographically_valid_offline' })).toContain(
    'Revocation status was not available',
  );
});

test('the page shows role-specific restore commands and never asks for a key', () => {
  const guide = restoreCliCommands('https://localhost:4101', null);
  expect(guide).toHaveLength(4);
  for (const entry of guide) {
    if (entry.command.includes('--destination')) {
      expect(entry.command).toContain("--destination 'https://localhost:4101'");
    }
  }
  expect(guide[0]?.command).toContain('seams-wallet derivation-root restore --destination');
  for (const entry of guide) {
    expect(entry.command).not.toContain('--operation-id');
    expect(entry.command).not.toContain('--envelope-file');
    expect(entry.command).not.toContain('restore start');
  }

  const awaitingManifest = restoreCliCommands('https://destination.example', {
    status: 'awaiting_manifest',
    sessionId: 'session-1',
    expiresAt: '2026-09-06T12:00:00.000Z',
    destinationFingerprintB64u: 'fingerprint',
  });
  expect(awaitingManifest).toHaveLength(4);
  expect(awaitingManifest[0]?.command).toContain('restore --destination');
  expect(awaitingManifest[0]?.note).toContain('Approve the matching code in your browser');

  const bothPending = restoreCliCommands('https://destination.example', {
    status: 'awaiting_role_imports',
    sessionId: 'session-1',
    expiresAt: '2026-09-06T12:00:00.000Z',
    destinationFingerprintB64u: 'fingerprint',
    recoverySetId: 'set-1',
    installed: { kind: 'neither_installed' },
  });
  expect(bothPending).toHaveLength(2);
  // Each command names exactly one role, and neither takes a key value.
  expect(bothPending[0]?.command).toContain('--role deriver-a');
  expect(bothPending[0]?.command).not.toContain('deriver-b');
  expect(bothPending[1]?.command).toContain('--role deriver-b');
  expect(bothPending[1]?.command).not.toContain('deriver-a-wrapper.key');
  for (const entry of bothPending) {
    expect(entry.command).not.toContain('--passphrase-fd');
    expect(entry.command).not.toMatch(/--passphrase\s/u);
    // Trust is compiled into the binary; no command asks for a root or bundle.
    expect(entry.command).not.toContain('--trust-bundle');
  }

  // Once a role is installed, only the remaining one is offered.
  const oneInstalled = restoreCliCommands('https://destination.example', {
    status: 'awaiting_role_imports',
    sessionId: 'session-1',
    expiresAt: '2026-09-06T12:00:00.000Z',
    destinationFingerprintB64u: 'fingerprint',
    recoverySetId: 'set-1',
    installed: { kind: 'deriver_a_installed', deriverAReceiptDigestB64u: 'receipt' },
  });
  expect(oneInstalled).toHaveLength(1);
  expect(oneInstalled[0]?.command).toContain('--role deriver-b');

  // With both shares installed, the remaining step is activation, and the
  // command asserts no trust level: the destination established that itself.
  const verifying = restoreCliCommands('https://destination.example', {
    status: 'verifying',
    sessionId: 'session-1',
    expiresAt: '2026-09-06T12:00:00.000Z',
    destinationFingerprintB64u: 'fingerprint',
    recoverySetId: 'set-1',
    installationReceipts: { deriverA: 'receipt-a', deriverB: 'receipt-b' },
  });
  expect(verifying).toHaveLength(1);
  expect(verifying[0]?.command).toContain('restore activate');
  expect(verifying[0]?.command).not.toContain('--trust-level');
  expect(verifying[0]?.note).toContain('--acknowledge-offline-trust');
});

test('governance is described from the server branch and enrolment is a CLI step per role', () => {
  expect(governanceLine({ status: 'not_configured' })).toContain('has not been chosen');
  expect(
    governanceLine({
      status: 'recipients_pending',
      governance: GOVERNANCE,
      enrolled: { kind: 'neither_enrolled' },
    }),
  ).toContain(GOVERNANCE.kind === 'two_person_v1' ? 'second owner' : 'alone');

  // Instructions remain visible before setup and after enrollment completes.
  expect(
    enrolCliCommands('https://console.example', 'production', {
      status: 'not_configured',
    }),
  ).toHaveLength(2);
  expect(
    enrolCliCommands('https://console.example', 'production', {
      status: 'ready',
      governance: GOVERNANCE,
      active: recoverySet(),
    }),
  ).toHaveLength(2);

  const both = enrolCliCommands(
    'https://console.example',
    'production',
    {
      status: 'recipients_pending',
      governance: GOVERNANCE,
      enrolled: { kind: 'neither_enrolled' },
    },
  );
  expect(both).toHaveLength(2);
  expect(both[0]?.command).toContain(
    'npx @seams/wallet-cli@0.4.1 derivation-root recovery-key setup',
  );
  expect(both[0]?.command).not.toContain("--dashboard-url");
  expect(both[0]?.command).toContain("--environment 'production'");
  expect(both[0]?.command).not.toContain('deriver-b');
  expect(both[1]?.command).toContain('--role deriver-b');
  for (const entry of both) {
    expect(entry.command).not.toContain('--passphrase-fd');
    expect(entry.command).not.toContain('--credential-fd');
    expect(entry.command).not.toMatch(/--passphrase\s/u);
  }

  const oneEnrolled = enrolCliCommands(
    'https://console.example',
    'production',
    {
      status: 'recipients_pending',
      governance: GOVERNANCE,
      enrolled: { kind: 'deriver_a_enrolled', deriverAFingerprintB64u: 'fingerprint-a' },
    },
  );
  expect(oneEnrolled).toHaveLength(2);
  expect(oneEnrolled[0]?.label).toContain('complete');
  expect(oneEnrolled[0]?.command).toContain('--role deriver-a');
  expect(oneEnrolled[1]?.label).not.toContain('complete');
  expect(oneEnrolled[1]?.command).toContain('--role deriver-b');
});

test('recovery actions follow the exact backup branch', () => {
  const notConfigured = recoveryActions({ status: 'not_configured' });
  expect(notConfigured.canCreateBackup).toBe(true);
  expect(notConfigured.canDownload).toBe(false);
  expect(notConfigured.canReplaceBackup).toBe(false);

  const preparing = recoveryActions({
    status: 'preparing_initial',
    governance: GOVERNANCE,
    recipientPair: {
      deriverAFingerprintB64u: 'a',
      deriverBFingerprintB64u: 'b',
    },
    pendingRecoverySetId: 'set-1',
  });
  // Nothing may start while a set is being generated.
  expect(preparing.canCreateBackup).toBe(false);
  expect(preparing.canChooseGovernance).toBe(false);
  expect(preparing.canEnrolRecipients).toBe(false);

  const ready = recoveryActions({
    status: 'ready',
    governance: GOVERNANCE,
    active: recoverySet(),
  });
  expect(ready.canDownload).toBe(true);
  expect(ready.canReplaceBackup).toBe(true);
  expect(ready.canCreateBackup).toBe(false);

  // A restored set is not downloadable here: this deployment never stored it.
  const external = recoveryActions({
    status: 'tenant_held_external',
    governance: GOVERNANCE,
    recoverySetId: 'set-1',
    manifestDigestB64u: 'digest',
  });
  expect(external.canDownload).toBe(false);
  expect(external.canEnrolRecipients).toBe(false);
});

test('backup conflicts explain the prerequisite or cleanup blocker instead of only HTTP 409', () => {
  expect(recoveryBackupConflictMessage('recipient_pair_not_committed')).toContain(
    'Commit the pair in step 2',
  );
  expect(recoveryBackupConflictMessage('cleanup_outstanding')).toContain(
    'retry after the backup cooldown',
  );
  expect(recoveryBackupConflictMessage('verification_incomplete')).toContain(
    'No new backup is ready',
  );
  expect(recoveryBackupConflictMessage('generation_already_in_flight')).toContain(
    'already being created',
  );
  expect(recoveryBackupConflictMessage('unexpected_conflict')).toContain('unexpected_conflict');
});
