import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import type { WalletOwnershipKey } from './home';

export async function claimPasskeyCredential(input: {
  readonly database: D1DatabaseLike;
  readonly wallet: WalletOwnershipKey;
  readonly writer: TenantRuntimeWriterV1;
  readonly rpId: string;
  readonly credentialIdB64u: string;
}): Promise<boolean> {
  const { wallet, writer } = input;
  const values = [
    wallet.namespace,
    wallet.organizationId,
    wallet.projectId,
    wallet.environmentId,
    input.rpId,
    input.credentialIdB64u,
    wallet.walletId,
    writer.resource.accountId,
    writer.resource.databaseId,
  ];
  await input.database
    .prepare(
      `INSERT INTO wallet_passkey_claims
    (namespace, organization_id, project_id, environment_id, rp_id, credential_id, wallet_id)
    SELECT namespace, organization_id, project_id, environment_id, ?5, ?6, wallet_id
    FROM wallet_homes
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
      AND environment_id = ?4 AND wallet_id = ?7 AND account_id = ?8
      AND database_id = ?9 AND state IN ('reserved', 'established') AND placement_state = 'active'
    ON CONFLICT DO NOTHING`,
    )
    .bind(...values)
    .run();
  const claimed = await input.database
    .prepare(
      `SELECT 1 AS claimed
    FROM wallet_passkey_claims AS claim JOIN wallet_homes AS home
      ON home.namespace = claim.namespace AND home.organization_id = claim.organization_id
      AND home.project_id = claim.project_id AND home.environment_id = claim.environment_id
      AND home.wallet_id = claim.wallet_id
    WHERE claim.namespace = ?1 AND claim.organization_id = ?2 AND claim.project_id = ?3
      AND claim.environment_id = ?4 AND claim.rp_id = ?5 AND claim.credential_id = ?6
      AND claim.wallet_id = ?7 AND home.account_id = ?8 AND home.database_id = ?9
      AND home.state IN ('reserved', 'established') AND home.placement_state = 'active'`,
    )
    .bind(...values)
    .first<number>('claimed');
  return claimed === 1;
}
