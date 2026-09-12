import { expect, test } from '@playwright/test';
import { createInMemoryConsoleAuditService } from '../../packages/console-server-ts/src/audit/service';
import type { ConsoleAuditEvent } from '../../packages/console-server-ts/src/audit/types';
import {
  buildTenantRootAuditEventV1,
  tenantRootAuditEventPersistenceIdV1,
  type TenantRootAuditEventInputV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/audit';
import { createConsoleTenantRootAuditWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/auditWriter';

const BASE: TenantRootAuditEventInputV1 = {
  action: 'rotation_activated',
  outcome: 'success',
  atIso: '2026-09-06T12:00:00.000Z',
  orgId: 'org-audit-writer',
  actorUserId: 'owner-audit-writer',
  identityDigestB64u: 'identity-audit-writer',
  custodyLineageB64u: 'lineage-audit-writer',
  lifecycleRevision: 8,
  receiptDigestB64u: 'activation-receipt-audit-writer',
  operationKind: 'tenant_root_operational_share_rotation_v1',
  operationDigestB64u: 'operation-digest-audit-writer',
};

test('uncertain rotation writes a pending console audit outcome', async () => {
  const audit = createInMemoryConsoleAuditService({ seedDemoData: false });
  const writer = createConsoleTenantRootAuditWriterV1({
    audit,
    actorType: 'SYSTEM',
  });
  const event = buildTenantRootAuditEventV1({
    ...BASE,
    action: 'rotation_requested',
    outcome: 'pending',
    receiptDigestB64u: undefined,
    failureCode: 'dispatch_uncertain',
  });

  await writer.write(event);

  await expect(
    audit.listEvents({ orgId: event.orgId, actorUserId: event.actorUserId }),
  ).resolves.toMatchObject([
    {
      id: tenantRootAuditEventPersistenceIdV1(event),
      actorType: 'SYSTEM',
      outcome: 'PENDING',
      action: 'rotation_requested',
      metadata: { outcome: 'pending', failureCode: 'dispatch_uncertain' },
    },
  ]);
});

test('a replay of one correlated event is idempotent', async () => {
  const audit = createInMemoryConsoleAuditService({ seedDemoData: false });
  const writer = createConsoleTenantRootAuditWriterV1({
    audit,
    actorType: 'USER',
  });
  const event = buildTenantRootAuditEventV1(BASE);

  await writer.write(event);
  await writer.write({ ...event, atIso: '2026-09-06T12:00:01.000Z' });

  await expect(audit.listEvents({ orgId: event.orgId })).resolves.toHaveLength(1);
});

test('unrelated recovery events retain generated audit IDs', async () => {
  const audit = createInMemoryConsoleAuditService({ seedDemoData: false });
  const writer = createConsoleTenantRootAuditWriterV1({
    audit,
    actorType: 'USER',
  });
  const event = buildTenantRootAuditEventV1({
    ...BASE,
    action: 'recovery_backup_created',
    recoverySetId: 'recovery-set-audit-writer',
    operationDigestB64u: undefined,
  });

  await writer.write(event);
  await writer.write({ ...event, atIso: '2026-09-06T12:00:01.000Z' });

  const events = await audit.listEvents({ orgId: event.orgId });
  expect(events).toHaveLength(2);
  expect(events[0]?.id).not.toBe(events[1]?.id);
});

test('redaction is checked before the console audit service is called', async () => {
  let writes = 0;
  const writer = createConsoleTenantRootAuditWriterV1({
    actorType: 'USER',
    audit: {
      async appendEvent(): Promise<ConsoleAuditEvent> {
        writes += 1;
        throw new Error('audit service was called after redaction failure');
      },
    },
  });
  const event = {
    ...buildTenantRootAuditEventV1(BASE),
    recoveryShareB64u: 'secret',
  };

  await expect(writer.write(event)).rejects.toThrow('unredacted tenant-root audit event');
  expect(writes).toBe(0);
});
