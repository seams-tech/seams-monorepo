import { prepareD1TenantStatement, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { WalletOwnershipKey } from './home';
type Scope = Pick<
  WalletOwnershipKey,
  'namespace' | 'organizationId' | 'projectId' | 'environmentId'
>;

export class ScopedWalletAuthorityDatabase {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: Scope,
  ) {}
  prepare(sql: string, values: readonly unknown[]) {
    return prepareD1TenantStatement(
      this.database,
      {
        namespace: this.scope.namespace,
        orgId: this.scope.organizationId,
        projectId: this.scope.projectId,
        envId: this.scope.environmentId,
      },
      sql,
      values,
    );
  }
}
