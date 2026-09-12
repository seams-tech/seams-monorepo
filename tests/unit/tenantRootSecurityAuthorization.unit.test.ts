import { expect, test } from '@playwright/test';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '../../packages/shared-ts/src/tenant-root/tenantRootIdentity';
import {
  buildTenantRootOperationRecordV1,
  type TenantRootOperationRecordInputV1,
  type TenantRootOperationRecordV1,
  type TenantRootOperationSubjectV1,
  type TenantRootRecoveryGovernanceV1,
} from '../../packages/shared-ts/src/tenant-root';

type ActiveTenantRootOperationRecordInputV1 = Exclude<
  TenantRootOperationRecordInputV1,
  { readonly operationKind: 'tenant_root_restore_role_import_key_issue_v1' }
>;
import {
  authorizeTenantRootOperationV1,
  type TenantRootOperationApprovalRecordV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/authorization';
import {
  parseTenantRootStepUpV1,
  type TenantRootStepUpSessionRecordV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/stepUp';

const NOW_MS = Date.parse('2026-09-05T12:00:00.000Z');
const ISSUED_AT = '2026-09-05T11:58:00.000Z';
const EXPIRES_AT = '2026-09-05T12:05:00.000Z';
const GOVERNANCE_DIGEST = 'hUXBekkP6CYYQtt4VJAzSMt0jTshXPte-Te5Q0uBKpc';
const DIGEST = 'rHTBFBUkNdB0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const REQUESTER = 'owner-1';
const APPROVER = 'owner-2';

const TWO_PERSON: TenantRootRecoveryGovernanceV1 = {
  kind: 'two_person_v1',
  selectedByOwnerId: REQUESTER,
  selectedAt: '2026-08-01T00:00:00.000Z',
};

const SINGLE_OWNER: TenantRootRecoveryGovernanceV1 = {
  kind: 'single_owner_v1',
  acknowledgedByOwnerId: REQUESTER,
  acknowledgedAt: '2026-08-01T00:00:00.000Z',
  warningVersion: 'tenant_root_single_owner_v1',
};

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

function record(
  operationKind: ActiveTenantRootOperationRecordInputV1['operationKind'],
  subject: TenantRootOperationSubjectV1 = { kind: 'tenant_root' },
): TenantRootOperationRecordV1 {
  const built = buildTenantRootOperationRecordV1({
    operationKind,
    identity: identity(),
    tenantRootIdentityDigest: 'nF1YOuRpN5POO1FZDHiGUboN9MIzmyW4RnZmX85Eqos',
    custodyLineageId: 'MTExMTExMTExMTExMTExMQ',
    expectedLifecycleRevision: 7,
    recoveryGovernanceDigest: GOVERNANCE_DIGEST,
    subject,
    requesterActorId: REQUESTER,
    idempotencyKey: 'idempotency-1',
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    expectedRootCommitment: '6IKxMQFrUsHTM3CAGHz3aEI-_Mu1F7tJWrgSxBYP9E4',
  });
  if (!built.ok) throw new Error(`record rejected: ${JSON.stringify(built.error)}`);
  return built.record;
}

function stepUp(
  actorUserId: string,
  verifiedAtMs = NOW_MS - 30_000,
): TenantRootStepUpSessionRecordV1 {
  return {
    actorUserId,
    sessionId: `session-${actorUserId}`,
    method: 'webauthn_platform_v1',
    verifiedAtMs,
  };
}

function approval(
  overrides: Partial<TenantRootOperationApprovalRecordV1> = {},
): TenantRootOperationApprovalRecordV1 {
  return {
    operationDigestB64u: DIGEST,
    approverUserId: APPROVER,
    approverStepUp: stepUp(APPROVER),
    approvedAtMs: NOW_MS - 60_000,
    consumedAtMs: null,
    ...overrides,
  };
}

function authorize(input: {
  operationKind?: ActiveTenantRootOperationRecordInputV1['operationKind'];
  subject?: TenantRootOperationSubjectV1;
  governance?: TenantRootRecoveryGovernanceV1 | null;
  targetGovernance?: TenantRootRecoveryGovernanceV1;
  requesterStepUp?: TenantRootStepUpSessionRecordV1 | null;
  requesterSessionId?: string;
  approval?: TenantRootOperationApprovalRecordV1 | null;
  nowMs?: number;
}) {
  const operationKind = input.operationKind ?? 'tenant_root_recovery_recipient_pair_replace_v1';
  const subject =
    input.subject ??
    (operationKind === 'tenant_root_recovery_recipient_pair_replace_v1'
      ? ({
          kind: 'recipient_pair',
          recipientPairDigest: 'mpqampqampqampqampqampqampqampqampqampqampo',
        } as const)
      : ({ kind: 'tenant_root' } as const));
  return authorizeTenantRootOperationV1({
    record: record(operationKind, subject),
    operationDigestB64u: DIGEST,
    governance: input.governance === undefined ? TWO_PERSON : input.governance,
    governanceDigestB64u: GOVERNANCE_DIGEST,
    ...(input.targetGovernance === undefined ? {} : { targetGovernance: input.targetGovernance }),
    requesterStepUp:
      input.requesterStepUp === undefined ? stepUp(REQUESTER) : input.requesterStepUp,
    ...(input.requesterSessionId === undefined
      ? {}
      : { requesterSessionId: input.requesterSessionId }),
    approval: input.approval === undefined ? approval() : input.approval,
    nowMs: input.nowMs ?? NOW_MS,
  });
}

test('a step-up proof can only come from a parsed session record', () => {
  expect(
    parseTenantRootStepUpV1({ record: null, expectedActorUserId: REQUESTER, nowMs: NOW_MS }),
  ).toEqual({
    ok: false,
    error: { kind: 'no_step_up_recorded' },
  });
  expect(
    parseTenantRootStepUpV1({
      record: stepUp(APPROVER),
      expectedActorUserId: REQUESTER,
      nowMs: NOW_MS,
    }),
  ).toEqual({ ok: false, error: { kind: 'actor_mismatch' } });
  expect(
    parseTenantRootStepUpV1({
      record: stepUp(REQUESTER, NOW_MS - 300_001),
      expectedActorUserId: REQUESTER,
      nowMs: NOW_MS,
    }),
  ).toEqual({ ok: false, error: { kind: 'stale', ageMs: 300_001 } });
  // Sixty seconds of clock skew is tolerated; more fails closed.
  expect(
    parseTenantRootStepUpV1({
      record: stepUp(REQUESTER, NOW_MS + 60_000),
      expectedActorUserId: REQUESTER,
      nowMs: NOW_MS,
    }).ok,
  ).toBe(true);
  expect(
    parseTenantRootStepUpV1({
      record: stepUp(REQUESTER, NOW_MS + 60_001),
      expectedActorUserId: REQUESTER,
      nowMs: NOW_MS,
    }),
  ).toEqual({ ok: false, error: { kind: 'dated_in_the_future' } });
  // A proof belongs to the session that recorded it.
  expect(
    parseTenantRootStepUpV1({
      record: stepUp(REQUESTER),
      expectedActorUserId: REQUESTER,
      expectedSessionId: 'session-someone-else',
      nowMs: NOW_MS,
    }),
  ).toEqual({ ok: false, error: { kind: 'session_mismatch' } });

  const parsed = parseTenantRootStepUpV1({
    record: stepUp(REQUESTER),
    expectedActorUserId: REQUESTER,
    nowMs: NOW_MS,
  });
  expect(parsed.ok).toBe(true);
});

test('two-person governance refuses a missing approval and self-approval', () => {
  expect(authorize({ approval: null })).toEqual({
    ok: false,
    error: { kind: 'approval_required' },
  });

  // A genuinely recorded approval, but by the requester.
  expect(
    authorize({
      approval: approval({ approverUserId: REQUESTER, approverStepUp: stepUp(REQUESTER) }),
    }),
  ).toEqual({ ok: false, error: { kind: 'approver_is_the_requester' } });

  const authorized = authorize({});
  expect(authorized.ok).toBe(true);
  if (authorized.ok) {
    expect(authorized.authorized.approverUserId).toBe(APPROVER);
    expect(authorized.authorized.requesterUserId).toBe(REQUESTER);
  }
});

test('an approval is one-use, digest-bound, and expires', () => {
  expect(authorize({ approval: approval({ consumedAtMs: NOW_MS - 1_000 }) })).toEqual({
    ok: false,
    error: { kind: 'approval_already_consumed' },
  });
  expect(authorize({ approval: approval({ operationDigestB64u: 'AAAA' }) })).toEqual({
    ok: false,
    error: { kind: 'approval_not_for_this_operation' },
  });
  expect(authorize({ approval: approval({ approvedAtMs: NOW_MS - 600_001 }) })).toEqual({
    ok: false,
    error: { kind: 'approval_expired', ageMs: 600_001 },
  });
  // The approving owner's own step-up must also still be fresh.
  expect(
    authorize({ approval: approval({ approverStepUp: stepUp(APPROVER, NOW_MS - 300_001) }) }),
  ).toEqual({
    ok: false,
    error: { kind: 'approver_step_up_invalid', reason: 'stale:300001' },
  });
});

test('an approval on an operation that does not use one is a contract violation', () => {
  // Single-owner governance needs no second owner.
  expect(authorize({ governance: SINGLE_OWNER })).toEqual({
    ok: false,
    error: { kind: 'approval_not_used_by_this_operation' },
  });
  expect(authorize({ governance: SINGLE_OWNER, approval: null }).ok).toBe(true);

  // Rotation never follows recovery governance, even under two-person.
  expect(
    authorize({
      operationKind: 'tenant_root_operational_share_rotation_v1',
      subject: { kind: 'tenant_root' },
    }),
  ).toEqual({ ok: false, error: { kind: 'approval_not_used_by_this_operation' } });
  expect(
    authorize({
      operationKind: 'tenant_root_operational_share_rotation_v1',
      subject: { kind: 'tenant_root' },
      approval: null,
    }).ok,
  ).toBe(true);
});

test('no mutation is authorized without fresh step-up from the requester', () => {
  expect(authorize({ requesterStepUp: null, approval: null, governance: SINGLE_OWNER })).toEqual({
    ok: false,
    error: { kind: 'step_up_required', reason: 'no_step_up_recorded' },
  });
  expect(
    authorize({
      requesterStepUp: stepUp(REQUESTER, NOW_MS - 300_001),
      approval: null,
      governance: SINGLE_OWNER,
    }),
  ).toEqual({
    ok: false,
    error: { kind: 'step_up_required', reason: 'stale:300001' },
  });
  // Someone else's step-up is not the requester's.
  expect(
    authorize({ requesterStepUp: stepUp(APPROVER), approval: null, governance: SINGLE_OWNER }),
  ).toEqual({ ok: false, error: { kind: 'step_up_actor_mismatch' } });
});

test('an expired operation or a different governance policy is refused', () => {
  expect(authorize({ nowMs: Date.parse(EXPIRES_AT) })).toEqual({
    ok: false,
    error: { kind: 'operation_expired' },
  });

  expect(
    authorizeTenantRootOperationV1({
      record: record('tenant_root_operational_share_rotation_v1'),
      operationDigestB64u: DIGEST,
      governance: SINGLE_OWNER,
      governanceDigestB64u: 'a-different-governance-digest',
      requesterStepUp: stepUp(REQUESTER),
      approval: null,
      nowMs: NOW_MS,
    }),
  ).toEqual({ ok: false, error: { kind: 'governance_mismatch' } });
});

test('a governance change takes the stronger quorum of its two branches', () => {
  const change = (
    governance: TenantRootRecoveryGovernanceV1 | null,
    targetGovernance: TenantRootRecoveryGovernanceV1,
    approvalRecord: TenantRootOperationApprovalRecordV1 | null,
  ) =>
    authorize({
      operationKind: 'tenant_root_recovery_governance_change_v1',
      subject: { kind: 'tenant_root' },
      governance,
      targetGovernance,
      approval: approvalRecord,
    });

  // Selecting two-person governance takes two owners from the very start.
  expect(change(null, TWO_PERSON, null)).toEqual({
    ok: false,
    error: { kind: 'approval_required' },
  });
  expect(change(null, TWO_PERSON, approval()).ok).toBe(true);
  expect(change(SINGLE_OWNER, TWO_PERSON, null)).toEqual({
    ok: false,
    error: { kind: 'approval_required' },
  });
  // Leaving two-person governance takes two owners as well.
  expect(change(TWO_PERSON, SINGLE_OWNER, null)).toEqual({
    ok: false,
    error: { kind: 'approval_required' },
  });
  expect(change(TWO_PERSON, SINGLE_OWNER, approval()).ok).toBe(true);
  // A single-owner tenant choosing single-owner again needs one owner.
  expect(change(null, SINGLE_OWNER, null).ok).toBe(true);
  expect(change(null, SINGLE_OWNER, approval())).toEqual({
    ok: false,
    error: { kind: 'approval_not_used_by_this_operation' },
  });
});

test('the requesting step-up must belong to the requesting session', () => {
  expect(
    authorize({
      governance: SINGLE_OWNER,
      approval: null,
      requesterSessionId: 'session-owner-1',
    }).ok,
  ).toBe(true);
  expect(
    authorize({
      governance: SINGLE_OWNER,
      approval: null,
      requesterSessionId: 'session-hijacked',
    }),
  ).toEqual({ ok: false, error: { kind: 'step_up_required', reason: 'session_mismatch' } });
});
