import { expect, test } from '@playwright/test';
import type {
  TenantRootDownloadEvidenceV1,
  TenantRootRecipientPairV1,
  TenantRootRecoveryBackupV1,
  TenantRootRecoveryGovernanceV1,
  TenantRootRecoverySetStateV1,
  TenantRootTrustLevelV1,
} from '../../packages/shared-ts/src/tenant-root';
import {
  activateRecoverySetV1,
  beginRecoverySetGenerationV1,
  failRecoverySetGenerationV1,
  recordDownloadEvidenceV1,
  recoverySetNeedsDownloadWarningV1,
  type TenantRootRecoverySetVerificationV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/recoverySets';

const GOVERNANCE: TenantRootRecoveryGovernanceV1 = {
  kind: 'two_person_v1',
  selectedByOwnerId: 'owner-1',
  selectedAt: '2026-08-01T00:00:00.000Z',
};

const PAIR: TenantRootRecipientPairV1 = {
  deriverAFingerprintB64u: 'fingerprint-a',
  deriverBFingerprintB64u: 'fingerprint-b',
};

const NEW_PAIR: TenantRootRecipientPairV1 = {
  deriverAFingerprintB64u: 'fingerprint-a2',
  deriverBFingerprintB64u: 'fingerprint-b2',
};

const NEVER_DOWNLOADED: TenantRootDownloadEvidenceV1 = { kind: 'never_downloaded' };

const TRUST: TenantRootTrustLevelV1 = { kind: 'cryptographically_valid_offline' };

function set(recoverySetId: string, pair = PAIR): TenantRootRecoverySetStateV1 {
  return {
    recoverySetId,
    recipientPair: pair,
    createdAt: '2026-08-29T10:20:30.123Z',
    rootCommitmentFingerprintB64u: 'root-commitment',
    deriverAPackage: NEVER_DOWNLOADED,
    deriverBPackage: NEVER_DOWNLOADED,
    manifest: NEVER_DOWNLOADED,
  };
}

const READY: TenantRootRecoveryBackupV1 = {
  status: 'ready',
  governance: GOVERNANCE,
  active: set('set-1'),
};

function verification(
  overrides: Partial<TenantRootRecoverySetVerificationV1> = {},
): TenantRootRecoverySetVerificationV1 {
  return {
    deriverAPackageSignatureVerified: true,
    deriverBPackageSignatureVerified: true,
    descriptorContinuityVerified: true,
    manifestSignatureVerified: true,
    packageDigestsVerified: true,
    persistenceReceipts: { deriverA: 'receipt-a', deriverB: 'receipt-b' },
    ...overrides,
  };
}

test('generation needs a committed pair, resumes its pending id, and refuses another id', () => {
  expect(
    beginRecoverySetGenerationV1({
      backup: { status: 'not_configured' },
      governance: GOVERNANCE,
      recipientPair: null,
      pendingRecoverySetId: 'set-1',
    }),
  ).toEqual({ ok: false, error: { kind: 'recipient_pair_not_committed' } });

  const initial = beginRecoverySetGenerationV1({
    backup: { status: 'not_configured' },
    governance: GOVERNANCE,
    recipientPair: PAIR,
    pendingRecoverySetId: 'set-1',
  });
  expect(initial.ok).toBe(true);
  if (initial.ok) {
    expect(initial.value.status).toBe('preparing_initial');
    expect(
      beginRecoverySetGenerationV1({
        backup: initial.value,
        governance: GOVERNANCE,
        recipientPair: PAIR,
        pendingRecoverySetId: 'set-1',
      }),
    ).toEqual(initial);
    if (initial.value.status === 'preparing_initial') {
      expect(initial.value.pendingRecoverySetId).toBe('set-1');
    }
  }

  expect(
    beginRecoverySetGenerationV1({
      backup: initial.ok ? initial.value : { status: 'not_configured' },
      governance: GOVERNANCE,
      recipientPair: PAIR,
      pendingRecoverySetId: 'set-2',
    }),
  ).toEqual({ ok: false, error: { kind: 'generation_already_in_flight' } });

  // A restored deployment's first backup is an initial generation.
  const external = beginRecoverySetGenerationV1({
    backup: {
      status: 'tenant_held_external',
      governance: GOVERNANCE,
      recoverySetId: 'source-set',
      manifestDigestB64u: 'digest',
    },
    governance: GOVERNANCE,
    recipientPair: PAIR,
    pendingRecoverySetId: 'set-1',
  });
  expect(external.ok && external.value.status === 'preparing_initial').toBe(true);

  // The generated set must be the pending one.
  expect(
    activateRecoverySetV1({
      backup: initial.ok ? initial.value : { status: 'not_configured' },
      pending: set('set-9'),
      verification: verification(),
      oldPackagesDestroyed: true,
    }),
  ).toEqual({ ok: false, error: { kind: 'generated_set_is_not_the_pending_set' } });
});

test('a failed generation is a failed branch, or cleanup-incomplete without receipts', () => {
  const initial = beginRecoverySetGenerationV1({
    backup: { status: 'not_configured' },
    governance: GOVERNANCE,
    recipientPair: PAIR,
    pendingRecoverySetId: 'set-1',
  });
  if (!initial.ok) throw new Error('expected generation to begin');
  const receipts = { deriverA: 'cleanup-a', deriverB: 'cleanup-b' };

  const failedInitial = failRecoverySetGenerationV1({
    backup: initial.value,
    failureCode: 'deriver_b_unavailable',
    cleanupReceipts: receipts,
  });
  expect(failedInitial.ok && failedInitial.value.status === 'failed_initial').toBe(true);

  const replacing = beginRecoverySetGenerationV1({
    backup: READY,
    governance: GOVERNANCE,
    recipientPair: NEW_PAIR,
    pendingRecoverySetId: 'set-2',
  });
  if (!replacing.ok) throw new Error('expected replacement to begin');
  const failedReplacement = failRecoverySetGenerationV1({
    backup: replacing.value,
    failureCode: 'deriver_b_unavailable',
    cleanupReceipts: receipts,
  });
  expect(failedReplacement.ok).toBe(true);
  if (failedReplacement.ok && failedReplacement.value.status === 'failed_replacement') {
    expect(failedReplacement.value.active.recoverySetId).toBe('set-1');
  }

  const uncleaned = failRecoverySetGenerationV1({
    backup: replacing.value,
    failureCode: 'deriver_b_unavailable',
    cleanupReceipts: null,
  });
  expect(uncleaned.ok && uncleaned.value.status === 'cleanup_incomplete').toBe(true);
  if (uncleaned.ok && uncleaned.value.status === 'cleanup_incomplete') {
    expect(uncleaned.value.active?.recoverySetId).toBe('set-1');
    // A fresh set can start while the earlier cleanup remains journaled.
    expect(
      beginRecoverySetGenerationV1({
        backup: uncleaned.value,
        governance: GOVERNANCE,
        recipientPair: NEW_PAIR,
        pendingRecoverySetId: 'set-3',
      }),
    ).toMatchObject({ ok: true, value: { status: 'replacing', pendingRecoverySetId: 'set-3' } });
  }

  // A settled state has nothing to fail.
  expect(
    failRecoverySetGenerationV1({ backup: READY, failureCode: 'x', cleanupReceipts: receipts }),
  ).toEqual({ ok: false, error: { kind: 'no_generation_in_flight' } });
});

test('the old set stays downloadable while a replacement is generated', () => {
  const replacing = beginRecoverySetGenerationV1({
    backup: READY,
    governance: GOVERNANCE,
    recipientPair: NEW_PAIR,
    pendingRecoverySetId: 'set-2',
  });
  expect(replacing.ok).toBe(true);
  if (!replacing.ok) return;
  expect(replacing.value.status).toBe('replacing');
  if (replacing.value.status === 'replacing') {
    expect(replacing.value.active.recoverySetId).toBe('set-1');
    expect(replacing.value.pendingRecipientPair).toEqual(NEW_PAIR);
    expect(replacing.value.pendingRecoverySetId).toBe('set-2');
  }
  // The replacement can never be the set it replaces.
  expect(
    beginRecoverySetGenerationV1({
      backup: READY,
      governance: GOVERNANCE,
      recipientPair: NEW_PAIR,
      pendingRecoverySetId: 'set-1',
    }),
  ).toEqual({ ok: false, error: { kind: 'replacement_set_id_matches_active' } });
});

test('activation requires every verification receipt', () => {
  const result = activateRecoverySetV1({
    backup: READY,
    pending: set('set-2', NEW_PAIR),
    verification: verification({ manifestSignatureVerified: false, persistenceReceipts: null }),
    oldPackagesDestroyed: true,
  });
  expect(result).toEqual({
    ok: false,
    error: {
      kind: 'verification_incomplete',
      missing: ['manifest_signature', 'persistence_receipts'],
    },
  });
});

test('a superseded set is never reactivated when cleanup fails', () => {
  const replacing = beginRecoverySetGenerationV1({
    backup: READY,
    governance: GOVERNANCE,
    recipientPair: NEW_PAIR,
    pendingRecoverySetId: 'set-2',
  });
  if (!replacing.ok) throw new Error('expected replacement to begin');

  const activated = activateRecoverySetV1({
    backup: replacing.value,
    pending: set('set-2', NEW_PAIR),
    verification: verification(),
    oldPackagesDestroyed: false,
  });
  expect(activated.ok).toBe(true);
  if (!activated.ok) return;
  expect(activated.value.status).toBe('cleanup_incomplete');
  if (activated.value.status === 'cleanup_incomplete') {
    // The replacement is active; the old set did not come back.
    expect(activated.value.active?.recoverySetId).toBe('set-2');
    expect(activated.value.outstanding.roles).toEqual(['deriver_a', 'deriver_b']);
  }

  const clean = activateRecoverySetV1({
    backup: replacing.value,
    pending: set('set-2', NEW_PAIR),
    verification: verification(),
    oldPackagesDestroyed: true,
  });
  expect(clean.ok).toBe(true);
  if (clean.ok && clean.value.status === 'ready') {
    expect(clean.value.active.recoverySetId).toBe('set-2');
    expect(clean.value.active.recipientPair).toEqual(NEW_PAIR);
  }
});

test('a replacement cannot reuse the active set id', () => {
  const replacing = beginRecoverySetGenerationV1({
    backup: READY,
    governance: GOVERNANCE,
    recipientPair: NEW_PAIR,
    pendingRecoverySetId: 'set-2',
  });
  if (!replacing.ok) throw new Error('expected replacement to begin');
  expect(
    activateRecoverySetV1({
      backup: replacing.value,
      pending: set('set-1', NEW_PAIR),
      verification: verification(),
      oldPackagesDestroyed: true,
    }),
  ).toEqual({ ok: false, error: { kind: 'replacement_set_id_matches_active' } });
});

test('a browser response can never record durable verification', () => {
  const issued = recordDownloadEvidenceV1({
    existing: NEVER_DOWNLOADED,
    channel: 'browser_response',
    actorUserId: 'owner-1',
    contentDigestB64u: 'digest-1',
    atIso: '2026-09-05T12:00:00.000Z',
    trustLevel: TRUST,
  });
  expect(issued.kind).toBe('download_issued');

  const durable = recordDownloadEvidenceV1({
    existing: issued,
    channel: 'cli_durable_verification',
    actorUserId: 'owner-1',
    contentDigestB64u: 'digest-1',
    atIso: '2026-09-05T12:01:00.000Z',
    trustLevel: TRUST,
  });
  expect(durable.kind).toBe('durable_verified');

  // A later browser response for the same digest does not downgrade it.
  const afterBrowser = recordDownloadEvidenceV1({
    existing: durable,
    channel: 'browser_response',
    actorUserId: 'owner-2',
    contentDigestB64u: 'digest-1',
    atIso: '2026-09-05T12:02:00.000Z',
    trustLevel: TRUST,
  });
  expect(afterBrowser).toEqual(durable);

  // A different digest is a different artifact and is only issued.
  const otherDigest = recordDownloadEvidenceV1({
    existing: durable,
    channel: 'browser_response',
    actorUserId: 'owner-2',
    contentDigestB64u: 'digest-2',
    atIso: '2026-09-05T12:03:00.000Z',
    trustLevel: TRUST,
  });
  expect(otherDigest.kind).toBe('download_issued');

  // Durability with no trust result is not durable verification.
  const withoutTrust = recordDownloadEvidenceV1({
    existing: NEVER_DOWNLOADED,
    channel: 'cli_durable_verification',
    actorUserId: 'owner-1',
    contentDigestB64u: 'digest-3',
    atIso: '2026-09-05T12:04:00.000Z',
    trustLevel: null,
  });
  expect(withoutTrust.kind).toBe('download_issued');
});

test('a set nobody has fully downloaded is warned about', () => {
  expect(recoverySetNeedsDownloadWarningV1(set('set-1'))).toBe(true);
  const downloaded: TenantRootDownloadEvidenceV1 = {
    kind: 'download_issued',
    issuedAt: '2026-09-05T12:00:00.000Z',
    actorUserId: 'owner-1',
    contentDigestB64u: 'digest-1',
  };
  expect(
    recoverySetNeedsDownloadWarningV1({
      ...set('set-1'),
      deriverAPackage: downloaded,
      deriverBPackage: downloaded,
      manifest: downloaded,
    }),
  ).toBe(false);
});
