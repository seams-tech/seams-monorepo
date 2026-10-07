import { WalletOwnershipKey } from './home';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantDeploymentBindingV1 } from '../tenantDeployment/types';
import type { SessionLocator } from './sessionLocators';

// Presence selects a local handler. It never admits the credential or its operation.
// Keep retired records in this lookup so revocation cannot trigger rediscovery.
export async function findLocalSessionWallet(
  database: D1DatabaseLike,
  tenant: TenantDeploymentBindingV1['tenant'],
  locator: SessionLocator,
): Promise<WalletOwnershipKey | null> {
  const predicate = `namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
    AND tenant_id = ?2`;
  let sql: string;
  switch (locator.kind) {
    case 'credential':
      sql = `SELECT wallet_id FROM wallet_session_authorizations_v2
        WHERE ${predicate} AND operation_credential_hash = ?5
        UNION ALL SELECT wallet_id FROM wallet_session_hosted_credentials_v2
        WHERE ${predicate} AND credential_digest_b64u = ?5 LIMIT 1`;
      break;
    case 'exchange':
      sql = `SELECT wallet_id FROM wallet_session_hosted_exchange_codes_v2
        WHERE ${predicate} AND code_hash = ?5 LIMIT 1`;
      break;
  }
  const row = await database
    .prepare(sql)
    .bind(
      tenant.namespace,
      tenant.organizationId,
      tenant.projectId,
      tenant.environmentId,
      locator.digest,
    )
    .first<{ readonly wallet_id: unknown }>();
  if (!row) return null;
  return WalletOwnershipKey.parse({
    namespace: tenant.namespace,
    organizationId: tenant.organizationId,
    projectId: tenant.projectId,
    environmentId: tenant.environmentId,
    walletId: row.wallet_id,
  });
}
