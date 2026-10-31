import type { ConsoleAuditService } from '../audit/service';
import { getConsoleAuditD1Runtime } from '../audit/d1';
import { queryD1One } from '../boundary/d1';
import { createConsoleEmailOutboxInsertStatement } from '../email/d1';
import { buildFreePlanNoticeEmailV1 } from '../email/templates';

/** The outbox's unique key and delayed availability make onboarding retries safe. */
export async function enqueuePlanStartReminder(
  audit: ConsoleAuditService,
  account: {
    readonly orgId: string;
    readonly userId: string;
    readonly email: string;
    readonly name: string | null;
  },
  plan: 'growth' | 'pro',
  consoleBaseUrl: string,
): Promise<void> {
  const runtime = getConsoleAuditD1Runtime(audit);
  if (!runtime) return;
  const now = runtime.now();
  const row = await queryD1One(
    runtime.database,
    `SELECT o.name, o.created_at_ms FROM organizations o
     JOIN billing_account_plans p ON p.namespace = o.namespace AND p.org_id = o.id
     WHERE o.namespace = ? AND o.id = ? AND o.created_by_user_id = ? AND p.plan = 'free'
       AND o.created_at_ms > ?
       AND NOT EXISTS (SELECT 1 FROM billing_payment_methods m WHERE m.namespace = o.namespace AND m.org_id = o.id AND m.status = 'usable')`,
    [runtime.namespace, account.orgId, account.userId, now.getTime() - 86_400_000],
  );
  if (!row) return;
  const createdAtMs = Number(row.created_at_ms);
  const organizationName = String(row.name);
  const dedupeKey = `plan-start-reminder:${account.userId}`;
  const statement = await createConsoleEmailOutboxInsertStatement({
    database: runtime.database,
    namespace: runtime.namespace,
    conflictPolicy: 'IGNORE_DEDUPE',
    email: {
      outboxId: dedupeKey,
      dedupeKey,
      orgId: account.orgId,
      recipient: { email: account.email, displayName: account.name || account.email },
      template: buildFreePlanNoticeEmailV1({
        organizationName,
        consoleBaseUrl,
        notice: { kind: 'plan_start_reminder', plan, orgId: account.orgId, userId: account.userId },
      }),
      createdAt: now,
      availableAt: new Date(createdAtMs + 86_400_000),
    },
  });
  await statement.run();
}
