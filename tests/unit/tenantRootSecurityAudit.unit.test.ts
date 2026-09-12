import { expect, test } from '@playwright/test';
import type { TenantRootOperationKindV1 } from '../../packages/shared-ts/src/tenant-root';
import {
  buildTenantRootAuditEventV1,
  checkTenantRootAuditEventRedactionV1,
  tenantRootAuditActionForOperationV1,
  TENANT_ROOT_AUDIT_MAX_VALUE_LENGTH_V1,
  type TenantRootAuditEventInputV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/audit';

const BASE: TenantRootAuditEventInputV1 = {
  action: 'rotation_requested',
  outcome: 'success',
  atIso: '2026-09-05T12:00:00.000Z',
  orgId: 'org-1',
  actorUserId: 'owner-1',
  identityDigestB64u: 'nF1YOuRpN5POO1FZDHiGUboN9MIzmyW4RnZmX85Eqos',
  custodyLineageB64u: 'MTExMTExMTExMTExMTExMQ',
  lifecycleRevision: 7,
};

const ALL_OPERATIONS: readonly TenantRootOperationKindV1[] = [
  'tenant_root_operational_share_rotation_v1',
  'tenant_root_recovery_governance_change_v1',
  'tenant_root_recovery_recipient_pair_enroll_v1',
  'tenant_root_recovery_recipient_pair_replace_v1',
  'tenant_root_recovery_backup_create_v1',
  'tenant_root_recovery_backup_replace_v1',
  'tenant_root_recovery_role_package_download_v1',
  'tenant_root_recovery_manifest_download_v1',
  'tenant_root_restore_session_start_v1',
  'tenant_root_restore_manifest_register_v1',
  'tenant_root_restore_role_import_key_issue_v1',
  'tenant_root_restore_role_import_v1',
  'tenant_root_restore_activate_v1',
  'tenant_root_source_lineage_retire_v1',
];

test('a built event carries every field explicitly, absent ones as null', () => {
  const event = buildTenantRootAuditEventV1(BASE);
  expect(event.role).toBeNull();
  expect(event.recoverySetId).toBeNull();
  expect(event.receiptDigestB64u).toBeNull();
  expect(event.failureCode).toBeNull();
  expect(event.authorization).toEqual({
    stepUpMethod: null,
    approverUserId: null,
    operationKind: null,
    operationDigestB64u: null,
  });
  expect(checkTenantRootAuditEventRedactionV1(event)).toEqual({ ok: true });
});

test('a rejection is recorded rather than suppressed', () => {
  const rejected = buildTenantRootAuditEventV1({
    ...BASE,
    action: 'approval_capability_rejected',
    outcome: 'failure',
    failureCode: 'approver_is_the_requester',
    operationKind: 'tenant_root_recovery_recipient_pair_replace_v1',
    operationDigestB64u: 'operation-digest-1',
    stepUpMethod: 'webauthn_platform_v1',
  });
  expect(rejected.outcome).toBe('failure');
  expect(rejected.failureCode).toBe('approver_is_the_requester');
  expect(rejected.authorization.operationKind).toBe(
    'tenant_root_recovery_recipient_pair_replace_v1',
  );
  expect(checkTenantRootAuditEventRedactionV1(rejected)).toEqual({ ok: true });
});

test('redaction is an allowlist, so a new field fails closed', () => {
  const smuggled = {
    ...buildTenantRootAuditEventV1(BASE),
    recoveryShareB64u: 'AAAA',
  };
  expect(checkTenantRootAuditEventRedactionV1(smuggled)).toEqual({
    ok: false,
    errors: [{ kind: 'unexpected_field', path: 'recoveryShareB64u' }],
  });

  const smuggledNested = {
    ...buildTenantRootAuditEventV1(BASE),
    authorization: {
      stepUpMethod: null,
      approverUserId: null,
      operationKind: null,
      operationDigestB64u: null,
      passphrase: 'hunter2',
    },
  };
  expect(checkTenantRootAuditEventRedactionV1(smuggledNested)).toEqual({
    ok: false,
    errors: [{ kind: 'unexpected_field', path: 'authorization.passphrase' }],
  });
});

test('no audit value is large enough to carry an artifact', () => {
  const oversized = {
    ...buildTenantRootAuditEventV1(BASE),
    receiptDigestB64u: 'A'.repeat(TENANT_ROOT_AUDIT_MAX_VALUE_LENGTH_V1 + 1),
  };
  expect(checkTenantRootAuditEventRedactionV1(oversized)).toEqual({
    ok: false,
    errors: [
      {
        kind: 'value_too_long',
        path: 'receiptDigestB64u',
        length: TENANT_ROOT_AUDIT_MAX_VALUE_LENGTH_V1 + 1,
      },
    ],
  });

  // A real SHA-256 digest fits comfortably.
  const digest = {
    ...buildTenantRootAuditEventV1(BASE),
    receiptDigestB64u: 'nF1YOuRpN5POO1FZDHiGUboN9MIzmyW4RnZmX85Eqos',
  };
  expect(checkTenantRootAuditEventRedactionV1(digest)).toEqual({ ok: true });

  // Structured values are refused outright: only scalars are auditable here.
  const structured = {
    ...buildTenantRootAuditEventV1(BASE),
    recoverySetId: { nested: 'value' },
  };
  expect(checkTenantRootAuditEventRedactionV1(structured)).toEqual({
    ok: false,
    errors: [{ kind: 'unsupported_value_type', path: 'recoverySetId' }],
  });
});

test('every operation kind decides what it audits', () => {
  const actions = new Set<string>();
  for (const kind of ALL_OPERATIONS) {
    const action = tenantRootAuditActionForOperationV1(kind);
    expect(typeof action).toBe('string');
    actions.add(action);
  }
  expect(actions.size).toBeGreaterThan(0);
  expect(tenantRootAuditActionForOperationV1('tenant_root_source_lineage_retire_v1')).toBe(
    'source_custody_disposition_recorded',
  );
});
