import { parseWalletId } from '@seams/wallet-server/cloud-host';
import { WalletPlacementError, type WalletHome } from './home';
import type { WalletPlacementStatus } from './relocationStatus';

export function isWalletPlacementRequest(request: Request): boolean {
  const path = new URL(request.url).pathname;
  if (request.method === 'POST') {
    return (
      path === '/wallet/placement/v1/relocations' ||
      path === '/wallet/placement/v1/relocations/challenge'
    );
  }
  return (
    request.method === 'GET' &&
    (path === '/wallet/placement/v1' ||
      /^\/wallet\/placement\/v1\/relocations\/wmove_[A-Za-z0-9_-]{43}$/u.test(path))
  );
}

// This extracts a routing identity only. The selected home authenticates the owner
// or bounded move credential before returning placement or accepting any command.
export async function walletPlacementRequestWalletId(request: Request): Promise<string> {
  let candidate: unknown;
  if (request.method === 'GET') {
    const values = new URL(request.url).searchParams.getAll('walletId');
    if (values.length !== 1) {
      throw new WalletPlacementError('invalid_input', 'Placement requires one wallet identity');
    }
    candidate = values[0];
  } else {
    const body: unknown = await request.clone().json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('walletId' in body)) {
      throw new WalletPlacementError('invalid_input', 'Placement requires a wallet identity');
    }
    candidate = body.walletId;
  }
  const walletId = parseWalletId(candidate);
  if (!walletId.ok) {
    throw new WalletPlacementError('invalid_input', 'Placement wallet identity is invalid');
  }
  return walletId.value;
}

export function walletPlacementReadHome(status: WalletPlacementStatus): WalletHome | null {
  switch (status.state) {
    case 'unavailable':
      return null;
    case 'settled':
      return status.home;
    case 'moving': {
      const move = status.move;
      const progress = move.progress;
      // Directory cutover alone does not prove the destination can authenticate reads.
      const activated =
        progress.state === 'completed' ||
        (progress.state === 'cutover' && progress.activation.state === 'activated');
      return activated ? move.destination : move.source;
    }
  }
}
