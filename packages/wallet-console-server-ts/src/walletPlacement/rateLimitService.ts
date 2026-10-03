import { D1EmailOtpRateLimitCounter, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { WalletPlacementError, type WalletOwnershipKey } from './home';
import { ScopedWalletAuthorityDatabase } from './scopedAuthorityDatabase';

export async function consumeSharedRateLimit(
  raw: unknown,
  database: D1DatabaseLike,
  scope: Pick<WalletOwnershipKey, 'namespace' | 'organizationId' | 'projectId' | 'environmentId'>,
): Promise<Response> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('key' in raw) ||
    typeof raw.key !== 'string' ||
    !raw.key ||
    raw.key.trim() !== raw.key ||
    !('limit' in raw) ||
    !('windowMs' in raw)
  ) {
    throw new WalletPlacementError('invalid_input', 'Invalid rate-limit request');
  }
  const limit = positiveInteger(raw.limit);
  const windowMs = positiveInteger(raw.windowMs);
  const scoped = new ScopedWalletAuthorityDatabase(database, scope);
  const counter = new D1EmailOtpRateLimitCounter(scoped.prepare.bind(scoped));
  return Response.json(await counter.consume({ key: raw.key, limit, windowMs }));
}
function positiveInteger(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0)
    throw new WalletPlacementError('invalid_input', 'Invalid rate-limit policy');
  return raw;
}
