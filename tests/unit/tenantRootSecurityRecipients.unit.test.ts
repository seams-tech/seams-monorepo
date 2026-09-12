import { expect, test } from '@playwright/test';
import type {
  TenantRootRecoveryBackupV1,
  TenantRootRecoveryGovernanceV1,
} from '../../packages/shared-ts/src/tenant-root';
import {
  buildTenantRootRecoveryGovernanceV1,
  commitTenantRootRecipientPairV1,
  confirmTenantRootRecipientV1,
  openTenantRootRecipientChallengeV1,
  selectTenantRootRecoveryGovernanceV1,
  tenantRootRecipientEnrolmentV1,
  TENANT_ROOT_RECIPIENT_CHALLENGE_TTL_MS_V1,
  type TenantRootRecipientChallengeRecordV1,
  type TenantRootStagedRecipientV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/recipients';

const NOW_MS = Date.parse('2026-09-05T12:00:00.000Z');
const ACTOR = 'owner-1';

const SINGLE_OWNER: TenantRootRecoveryGovernanceV1 = {
  kind: 'single_owner_v1',
  acknowledgedByOwnerId: ACTOR,
  acknowledgedAt: '2026-08-01T00:00:00.000Z',
  warningVersion: 'tenant_root_single_owner_v1',
};

const TWO_PERSON: TenantRootRecoveryGovernanceV1 = {
  kind: 'two_person_v1',
  selectedByOwnerId: ACTOR,
  selectedAt: '2026-08-01T00:00:00.000Z',
};

const NOT_CONFIGURED: TenantRootRecoveryBackupV1 = { status: 'not_configured' };

function challenge(
  overrides: Partial<TenantRootRecipientChallengeRecordV1> = {},
): TenantRootRecipientChallengeRecordV1 {
  return {
    challengeIdB64u: 'challenge-1',
    expectedConfirmationB64u: 'A'.repeat(43),
    role: 'deriver_a',
    recipientPublicKeyB64u: 'public-key-a',
    recipientFingerprintB64u: 'fingerprint-a',
    actorUserId: ACTOR,
    lifecycleRevision: 7,
    issuedAtMs: NOW_MS - 1_000,
    expiresAtMs: NOW_MS + TENANT_ROOT_RECIPIENT_CHALLENGE_TTL_MS_V1,
    consumedAtMs: null,
    ...overrides,
  };
}

function staged(role: 'deriver_a' | 'deriver_b', fingerprint: string): TenantRootStagedRecipientV1 {
  return {
    role,
    recipientPublicKeyB64u: `public-key-${role}`,
    recipientFingerprintB64u: fingerprint,
    verifiedAtMs: NOW_MS,
  };
}

function confirm(
  overrides: {
    challenge?: TenantRootRecipientChallengeRecordV1 | null;
    role?: 'deriver_a' | 'deriver_b';
    actorUserId?: string;
    lifecycleRevision?: number;
    confirmationVerified?: boolean;
    nowMs?: number;
  } = {},
) {
  return confirmTenantRootRecipientV1({
    challenge: overrides.challenge === undefined ? challenge() : overrides.challenge,
    role: overrides.role ?? 'deriver_a',
    actorUserId: overrides.actorUserId ?? ACTOR,
    lifecycleRevision: overrides.lifecycleRevision ?? 7,
    confirmationVerified: overrides.confirmationVerified ?? true,
    nowMs: overrides.nowMs ?? NOW_MS,
  });
}

test('single-owner governance needs its warning acknowledgement', () => {
  expect(
    buildTenantRootRecoveryGovernanceV1({
      choice: { kind: 'single_owner_v1', acknowledgeWarning: true },
      actorUserId: ACTOR,
      atIso: '2026-08-01T00:00:00.000Z',
    }),
  ).toEqual({ ok: true, governance: SINGLE_OWNER });
  expect(
    buildTenantRootRecoveryGovernanceV1({
      choice: { kind: 'single_owner_v1', acknowledgeWarning: false },
      actorUserId: ACTOR,
      atIso: '2026-08-01T00:00:00.000Z',
    }),
  ).toEqual({ ok: false, error: { kind: 'single_owner_warning_not_acknowledged' } });
  // The acknowledging owner and the time are the server's, never a body's.
  expect(
    buildTenantRootRecoveryGovernanceV1({
      choice: { kind: 'two_person_v1' },
      actorUserId: ACTOR,
      atIso: '2026-08-01T00:00:00.000Z',
    }),
  ).toEqual({ ok: true, governance: TWO_PERSON });

  expect(selectTenantRootRecoveryGovernanceV1({ current: null, target: SINGLE_OWNER })).toEqual({
    ok: true,
    governance: SINGLE_OWNER,
  });
  expect(
    selectTenantRootRecoveryGovernanceV1({
      current: null,
      target: { ...SINGLE_OWNER, warningVersion: 'something_else' as never },
    }),
  ).toEqual({ ok: false, error: { kind: 'single_owner_warning_not_acknowledged' } });
});

test('a governance transition is validated for shape only; the quorum is the operation layer', () => {
  expect(
    selectTenantRootRecoveryGovernanceV1({ current: TWO_PERSON, target: SINGLE_OWNER }).ok,
  ).toBe(true);
  expect(
    selectTenantRootRecoveryGovernanceV1({ current: SINGLE_OWNER, target: TWO_PERSON }).ok,
  ).toBe(true);
  // Re-selecting the current branch changes nothing and is refused as such.
  expect(selectTenantRootRecoveryGovernanceV1({ current: TWO_PERSON, target: TWO_PERSON })).toEqual(
    {
      ok: false,
      error: { kind: 'governance_unchanged' },
    },
  );
});

test('a challenge cannot be opened before governance is settled', () => {
  const input = {
    role: 'deriver_a' as const,
    recipientPublicKeyB64u: 'public-key-a',
    recipientFingerprintB64u: 'fingerprint-a',
    actorUserId: ACTOR,
    lifecycleRevision: 7,
    challengeIdB64u: 'challenge-1',
    expectedConfirmationB64u: 'A'.repeat(43),
    nowMs: NOW_MS,
    backup: NOT_CONFIGURED,
  };
  expect(openTenantRootRecipientChallengeV1({ ...input, governance: null })).toEqual({
    ok: false,
    error: { kind: 'governance_not_selected' },
  });

  const opened = openTenantRootRecipientChallengeV1({ ...input, governance: SINGLE_OWNER });
  expect(opened.ok).toBe(true);
  if (opened.ok) {
    expect(opened.value.expiresAtMs - opened.value.issuedAtMs).toBe(600_000);
    expect(opened.value.consumedAtMs).toBeNull();
  }

  // Recipients cannot be changed while a recovery set is being generated.
  expect(
    openTenantRootRecipientChallengeV1({
      ...input,
      governance: SINGLE_OWNER,
      backup: {
        status: 'preparing_initial',
        governance: SINGLE_OWNER,
        recipientPair: {
          deriverAFingerprintB64u: 'a',
          deriverBFingerprintB64u: 'b',
        },
        pendingRecoverySetId: 'set-1',
      },
    }),
  ).toEqual({ ok: false, error: { kind: 'recovery_set_generation_in_flight' } });
});

test('a challenge is one-use and bound to its role, actor, and revision', () => {
  expect(confirm({ challenge: null })).toEqual({
    ok: false,
    error: { kind: 'challenge_not_found' },
  });
  expect(confirm({ challenge: challenge({ consumedAtMs: NOW_MS - 10 }) })).toEqual({
    ok: false,
    error: { kind: 'challenge_already_consumed' },
  });
  expect(confirm({ nowMs: NOW_MS + TENANT_ROOT_RECIPIENT_CHALLENGE_TTL_MS_V1 })).toEqual({
    ok: false,
    error: { kind: 'challenge_expired' },
  });
  expect(confirm({ role: 'deriver_b' })).toEqual({
    ok: false,
    error: { kind: 'challenge_role_mismatch' },
  });
  expect(confirm({ actorUserId: 'owner-2' })).toEqual({
    ok: false,
    error: { kind: 'challenge_actor_mismatch' },
  });
  expect(confirm({ lifecycleRevision: 8 })).toEqual({
    ok: false,
    error: { kind: 'challenge_lifecycle_revision_stale' },
  });
  expect(confirm({ confirmationVerified: false })).toEqual({
    ok: false,
    error: { kind: 'confirmation_invalid' },
  });

  const confirmed = confirm();
  expect(confirmed.ok).toBe(true);
  if (confirmed.ok) {
    expect(confirmed.value.role).toBe('deriver_a');
    expect(confirmed.value.recipientFingerprintB64u).toBe('fingerprint-a');
  }
});

test('a pair needs both roles and two different keys', () => {
  expect(commitTenantRootRecipientPairV1({ previousPair: null, staged: [] })).toEqual({
    ok: false,
    error: { kind: 'recipient_pair_incomplete', missingRole: 'deriver_a' },
  });
  expect(
    commitTenantRootRecipientPairV1({ previousPair: null, staged: [staged('deriver_a', 'fingerprint-a')] }),
  ).toEqual({
    ok: false,
    error: { kind: 'recipient_pair_incomplete', missingRole: 'deriver_b' },
  });
  expect(
    commitTenantRootRecipientPairV1({ previousPair: null,
      staged: [staged('deriver_a', 'same'), staged('deriver_b', 'same')],
    }),
  ).toEqual({ ok: false, error: { kind: 'recipient_pair_reuses_one_key' } });

  const committed = commitTenantRootRecipientPairV1({ previousPair: null,
    staged: [staged('deriver_a', 'fingerprint-a'), staged('deriver_b', 'fingerprint-b')],
  });
  expect(committed.ok).toBe(true);
});

test('the enrolment branch shows exactly which role has proved control', () => {
  expect(tenantRootRecipientEnrolmentV1([])).toEqual({ kind: 'neither_enrolled' });
  expect(tenantRootRecipientEnrolmentV1([staged('deriver_a', 'fingerprint-a')])).toEqual({
    kind: 'deriver_a_enrolled',
    deriverAFingerprintB64u: 'fingerprint-a',
  });
  expect(tenantRootRecipientEnrolmentV1([staged('deriver_b', 'fingerprint-b')])).toEqual({
    kind: 'deriver_b_enrolled',
    deriverBFingerprintB64u: 'fingerprint-b',
  });
});

test('replacement waits for both new wrapper keys', () => {
  const previousPair = { deriverAFingerprintB64u: 'old-a', deriverBFingerprintB64u: 'old-b' };
  expect(commitTenantRootRecipientPairV1({
    previousPair,
    staged: [staged('deriver_a', 'new-a'), staged('deriver_b', 'old-b')],
  })).toEqual({ ok: false, error: { kind: 'recipient_pair_incomplete', missingRole: 'deriver_b' } });
  expect(commitTenantRootRecipientPairV1({
    previousPair,
    staged: [staged('deriver_a', 'old-a'), staged('deriver_b', 'new-b')],
  })).toEqual({ ok: false, error: { kind: 'recipient_pair_incomplete', missingRole: 'deriver_a' } });
  expect(commitTenantRootRecipientPairV1({
    previousPair,
    staged: [staged('deriver_a', 'new-a'), staged('deriver_b', 'new-b')],
  }).ok).toBe(true);
});
