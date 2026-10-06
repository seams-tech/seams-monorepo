import { isPlainObject } from '@seams/wallet-server/cloud-host';
import type { WalletHome } from './home';
import { relocationTimestamp, type WalletRelocationRequest } from './relocation';

export interface WalletRelocationOwnerApprovalReader {
  // The source Gateway checks its durable factor approval and current owner
  // authority. This call must never consume another factor proof on retry.
  read(request: WalletRelocationRequest, source: WalletHome): Promise<unknown>;
}

export async function hasFreshRelocationOwnerApproval(
  reader: WalletRelocationOwnerApprovalReader,
  request: WalletRelocationRequest,
  source: WalletHome,
  clock: () => number,
): Promise<boolean> {
  const digest = await request.digest();
  const raw = await reader.read(request, source);
  const nowMs = relocationTimestamp(clock());
  return (
    isPlainObject(raw) &&
    Object.keys(raw).length === 6 &&
    raw.kind === 'approved' &&
    raw.requestDigest === digest &&
    raw.authorityId === request.authorityId &&
    raw.sourceGeneration === request.expectedGeneration &&
    typeof raw.approvedAtMs === 'number' &&
    Number.isSafeInteger(raw.approvedAtMs) &&
    raw.approvedAtMs > 0 &&
    raw.approvedAtMs <= nowMs &&
    typeof raw.expiresAtMs === 'number' &&
    Number.isSafeInteger(raw.expiresAtMs) &&
    raw.expiresAtMs > nowMs &&
    raw.expiresAtMs > raw.approvedAtMs &&
    raw.expiresAtMs - raw.approvedAtMs <= 300_000
  );
}
