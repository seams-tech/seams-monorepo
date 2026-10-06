import { D1EmailOtpRateLimitCounter, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { WalletOwnershipKey } from './home';
import { ScopedWalletAuthorityDatabase } from './scopedAuthorityDatabase';

export function createSharedEmailOtpRateLimitCounter(
  database: D1DatabaseLike,
  scope: Pick<WalletOwnershipKey, 'namespace' | 'organizationId' | 'projectId' | 'environmentId'>,
): D1EmailOtpRateLimitCounter {
  const scoped = new ScopedWalletAuthorityDatabase(database, scope);
  return new D1EmailOtpRateLimitCounter(scoped.prepare.bind(scoped));
}
