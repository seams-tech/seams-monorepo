import { isPlainObject } from '@seams/wallet-server/cloud-host';
import type { WalletHome } from './home';
import { WalletRegionalDispatch } from './regionalDispatch';
import { relocationTimestamp, type WalletRelocationRequest } from './relocation';

export interface WalletRelocationOwnerApprovalReader {
  // The source Gateway checks its durable factor approval and current owner
  // authority. This call must never consume another factor proof on retry.
  read(request: WalletRelocationRequest, source: WalletHome): Promise<unknown>;
}

export class GatewayRelocationOwnerApproval implements WalletRelocationOwnerApprovalReader {
  constructor(private readonly transport: WalletRegionalDispatch) {}

  async read(request: WalletRelocationRequest, source: WalletHome): Promise<unknown> {
    const response = await this.transport.forward(
      source,
      new Request(
        'https://wallet-relocation.internal/internal/wallet-relocation/v1/authorization/owner-approval',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletId: request.wallet.walletId,
            moveId: request.moveId,
            requestDigest: await request.digest(),
            authorityId: request.authorityId,
            sourceGeneration: request.expectedGeneration,
          }),
        },
      ),
    );
    if (response.status !== 200) return { kind: 'denied' };
    try {
      return await response.json();
    } catch {
      return { kind: 'denied' };
    }
  }
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
