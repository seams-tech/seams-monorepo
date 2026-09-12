import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type {
  TenantRootIdentityV1,
  TenantRootRestoreSessionV1,
} from '@seams-internal/shared-ts/tenant-root';
import { createD1TenantRootCreationGrantServiceV1 } from '../tenantRootCreation/d1';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import { findD1RestoredTenantRootActiveLineageV1 } from './restoreD1';

/** One signing-lineage lookup shared by local and hosted console composition. */
export class D1TenantRootActiveLineageResolverV1 {
  private readonly grants;

  constructor(
    private readonly database: D1DatabaseLike,
    private readonly namespace: string,
  ) {
    this.grants = createD1TenantRootCreationGrantServiceV1({ database, namespace });
  }

  async resolveActiveLineage(identity: TenantRootIdentityV1): Promise<{
    readonly identityDigestB64u: string;
    readonly custodyLineageB64u: string;
    readonly rootCommitmentB64u: string;
    readonly restore: Extract<TenantRootRestoreSessionV1, { status: 'active' }> | null;
  } | null> {
    const identityDigestB64u = await tenantRootIdentityDigestB64uV1(identity);
    const created = await this.grants.findActiveLineageByIdentity({ identity, identityDigestB64u });
    const restored = await findD1RestoredTenantRootActiveLineageV1({
      database: this.database,
      namespace: this.namespace,
      orgId: identity.orgId,
      identityDigestB64u,
    });
    if (created !== null && created.status !== 'ACTIVE')
      throw new Error('Creation lookup returned an inactive root');
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
