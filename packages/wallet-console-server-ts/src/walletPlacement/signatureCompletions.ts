import { queryD1All, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantDeploymentBindingV1 } from '../tenantDeployment/types';
import type { ConsoleRegistrationHomeAdmission } from './registrationAdmission';

const DELIVERY_LIMIT = 100;

/**
 * Delivers the signatures that this Gateway's database recorded as completed to the
 * Console's production usage count, then deletes them. One database serves one lane, so
 * the lane's binding names the tenant; a row with an owner scope must match it. A
 * development lane deletes its rows without delivery, because development never counts.
 */
export async function resumeGatewaySignatureCompletions(input: {
  readonly database: D1DatabaseLike;
  readonly binding: TenantDeploymentBindingV1;
  readonly authority: Pick<ConsoleRegistrationHomeAdmission, 'publishSignatures'>;
}): Promise<{ readonly delivered: number; readonly discarded: number }> {
  const tenant = input.binding.tenant;
  const rows = await queryD1All(
    input.database,
    `SELECT authorized_operation_id, completed_at_ms FROM wallet_signature_completions
     WHERE namespace = ?1 AND tenant_id = ?2 AND (env_id IS NULL OR env_id = ?3)
     ORDER BY completed_at_ms, authorized_operation_id LIMIT ?4`,
    [tenant.namespace, tenant.organizationId, tenant.environmentId, DELIVERY_LIMIT],
  );
  if (rows.length === 0) return { delivered: 0, discarded: 0 };
  const signatures = rows.map((row) => ({
    signatureId: String(row.authorized_operation_id),
    completedAtMs: Number(row.completed_at_ms),
  }));
  const production = input.binding.mode.environment === 'production';
  if (production) await input.authority.publishSignatures(signatures);
  await input.database.batch(
    signatures.map((signature) =>
      input.database
        .prepare(
          `DELETE FROM wallet_signature_completions
           WHERE namespace = ?1 AND tenant_id = ?2 AND authorized_operation_id = ?3`,
        )
        .bind(tenant.namespace, tenant.organizationId, signature.signatureId),
    ),
  );
  return production
    ? { delivered: signatures.length, discarded: 0 }
    : { delivered: 0, discarded: signatures.length };
}
