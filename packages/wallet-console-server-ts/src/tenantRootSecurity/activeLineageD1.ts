import type { D1DatabaseLike, D1ResultLike, D1Row } from '@seams/wallet-server/cloud-host';
import type {
  TenantRootIdentityV1,
  TenantRootRestoreSessionV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import { parseD1ActiveTenantRootCreationV1 } from '../tenantRootCreation/d1';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import { parseD1RestoredTenantRootActiveLineageV1 } from './restoreD1';

/** One signing-lineage lookup shared by local and hosted console composition. */
export class D1TenantRootActiveLineageResolverV1 {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly namespace: string,
  ) {}

  async resolveActiveLineage(identity: TenantRootIdentityV1): Promise<{
    readonly identityDigestB64u: string;
    readonly custodyLineageB64u: string;
    readonly rootCommitmentB64u: string;
    readonly restore: Extract<TenantRootRestoreSessionV1, { status: 'active' }> | null;
  } | null> {
    const identityDigestB64u = await tenantRootIdentityDigestB64uV1(identity);
    const [creation, restoration] = await this.database.batch<D1ResultLike<D1Row>>([
      this.database
        .prepare(
          `SELECT * FROM tenant_root_creation_grants
           WHERE namespace = ?1 AND identity_digest_b64u = ?2 AND status = 'ACTIVE'`,
        )
        .bind(this.namespace, identityDigestB64u),
      this.database
        .prepare(
          `SELECT session_json, destination_lineage_b64u FROM tenant_root_security_restore_state
           WHERE namespace = ?1 AND org_id = ?2 AND identity_digest_b64u = ?3
             AND json_extract(session_json, '$.status') = 'active' LIMIT 2`,
        )
        .bind(this.namespace, identity.orgId, identityDigestB64u),
    ]);
    if (!creation?.success || !restoration?.success || !creation.results || !restoration.results) {
      throw new Error('Active lineage lookup returned incomplete results');
    }
    const createdRow = creation.results[0];
    const created = createdRow ? parseD1ActiveTenantRootCreationV1(createdRow, identity) : null;
    const restored = parseD1RestoredTenantRootActiveLineageV1(restoration.results);
    if (
      created !== null &&
      restored !== null &&
      (created.custodyLineageB64u !== restored.custodyLineageB64u ||
        created.ready.rootCommitmentB64u !== restored.rootCommitmentB64u)
    ) {
      throw new Error('Tenant identity has conflicting creation and restore roots');
    }
    if (restored !== null)
      return {
        identityDigestB64u,
        custodyLineageB64u: restored.custodyLineageB64u,
        rootCommitmentB64u: restored.rootCommitmentB64u,
        restore: restored.restore,
      };
    if (created === null) return null;
    return {
      identityDigestB64u,
      custodyLineageB64u: created.custodyLineageB64u,
      rootCommitmentB64u: created.ready.rootCommitmentB64u,
      restore: null,
    };
  }
}
