import type { ConsoleBillingD1Runtime } from './d1';
import { queryD1All } from '../boundary/d1';
import { textValue, integer } from '@seams-internal/console-shared/accountPlatform/boundary';
import { createConsoleEmailOutboxInsertStatement } from '../email/d1';
import { buildBillingPaymentRecoveryEmailV1 } from '../email/templates';

export async function queueInvoiceRecoveryNotice(
  runtime: ConsoleBillingD1Runtime,
  orgId: string,
  monthUtc: string,
): Promise<void> {
  if (!runtime.emailConsoleBaseUrl) return;
  const rows = await queryD1All(
    runtime.database,
    `SELECT c.provider_invoice_ref,c.first_failed_at_ms,o.name,m.id,m.email,m.display_name
  FROM billing_monthly_collections c JOIN organizations o ON o.namespace=c.namespace AND o.id=c.org_id
  JOIN organization_memberships m ON m.namespace=c.namespace AND m.org_id=c.org_id
  WHERE c.namespace=? AND c.org_id=? AND c.month_utc=? AND c.status<>'paid' AND c.first_failed_at_ms IS NOT NULL
    AND m.kind='ACTIVE' AND (m.role='OWNER' OR (m.role='ADMIN' AND EXISTS(SELECT 1 FROM organization_admin_permissions a
      WHERE a.namespace=m.namespace AND a.org_id=m.org_id AND a.membership_id=m.id AND a.permission='billing.manage')))`,
    [runtime.namespace, orgId, monthUtc],
  );
  const statements = [];
  for (const row of rows) {
    const invoiceId = textValue(row.provider_invoice_ref, 'invoice id');
    const key = `billing:payment-recovery:${invoiceId}:${textValue(row.id, 'membership id')}`;
    const email = textValue(row.email, 'recipient email');
    const template = buildBillingPaymentRecoveryEmailV1({
      organizationName: textValue(row.name, 'organization name'),
      invoiceId,
      deadlineAt: new Date(
        integer(row.first_failed_at_ms, 'failure time', 1) + 604800000,
      ).toISOString(),
      consoleBaseUrl: runtime.emailConsoleBaseUrl,
    });
    statements.push(
      await createConsoleEmailOutboxInsertStatement({
        database: runtime.database,
        namespace: runtime.namespace,
        email: {
          outboxId: `email:${key}`,
          dedupeKey: key,
          orgId,
          recipient: {
            email,
            displayName:
              typeof row.display_name === 'string' && row.display_name ? row.display_name : email,
          },
          template,
          createdAt: runtime.now(),
          availableAt: runtime.now(),
        },
      }),
    );
  }
  if (statements.length > 0) await runtime.database.batch(statements);
}
