import {
  WALLET_RUNTIME_OP_PATHS_V1,
  WALLET_RUNTIME_SERVICE_ORIGIN_V1,
  parseWalletRuntimeWalletIdentityRequest,
  type WalletRuntimeWalletIdentityRequest,
  type WalletRuntimeWalletIdentitiesResult,
} from '@seams/wallet-server/cloud-host';
import { WalletOwnershipKey } from '../walletPlacement/home';
import type { WalletHomeServiceClient } from '../walletPlacement/serviceClient';

export async function handleRuntimeIdentityHomeRequest(
  request: Request,
  options: {
    readonly scope: {
      readonly namespace: string;
      readonly organizationId: string;
      readonly projectId: string;
      readonly environmentId: string;
    };
    readonly localResource: { readonly accountId: string; readonly databaseId: string };
    readonly directory: Pick<WalletHomeServiceClient, 'find'>;
    readonly readIdentities: (
      input: WalletRuntimeWalletIdentityRequest,
    ) => Promise<WalletRuntimeWalletIdentitiesResult>;
  },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== WALLET_RUNTIME_OP_PATHS_V1.walletIdentities) return null;
  if (url.origin !== WALLET_RUNTIME_SERVICE_ORIGIN_V1) return failure('not_found', 404);
  if (request.method !== 'POST') return failure('method_not_allowed', 405);
  let input: WalletRuntimeWalletIdentityRequest | null;
  try {
    input = parseWalletRuntimeWalletIdentityRequest(await request.json());
  } catch {
    return failure('invalid_body', 400);
  }
  if (!input) return failure('invalid_body', 400);
  for (const selector of input.wallets) {
    if (
      input.orgId !== options.scope.organizationId ||
      selector.projectId !== options.scope.projectId ||
      selector.envId !== options.scope.environmentId
    )
      return failure('wallet_scope_mismatch', 403);
    let wallet: WalletOwnershipKey;
    try {
      wallet = WalletOwnershipKey.parse({
        namespace: options.scope.namespace,
        organizationId: input.orgId,
        projectId: selector.projectId,
        environmentId: selector.envId,
        walletId: selector.walletId,
      });
    } catch {
      return failure('invalid_body', 400);
    }
    try {
      const assignment = await options.directory.find(wallet);
      if (!assignment || assignment.state !== 'established') {
        return failure('wallet_home_unavailable', 404);
      }
      if (
        assignment.home.accountId !== options.localResource.accountId ||
        assignment.home.databaseId !== options.localResource.databaseId
      )
        return failure('wallet_home_mismatch', 409);
    } catch {
      return failure('wallet_home_unavailable', 503);
    }
  }
  return Response.json(await options.readIdentities(input), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

function failure(code: string, status: number): Response {
  return Response.json(
    { ok: false, code },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
