import { expect } from '@playwright/test';
import type { Miniflare } from 'miniflare';
import { parseTenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import {
  WalletHomeCatalog,
  type WalletHome,
  type WalletOwnershipKey,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { WalletHomeServiceClient } from '../../packages/wallet-console-server-ts/src/walletPlacement/serviceClient';
import { relocationWriterVersion } from '../fixtures/tenant-deployment/walletRelocationResources';

type ReplyMode = 'honest' | 'wrong_wallet' | 'wrong_writer' | 'invalid_generation' | 'wrong_status';

class ExecutionConsole {
  constructor(
    private readonly worker: Awaited<ReturnType<Miniflare['getWorker']>>,
    private readonly mode: ReplyMode,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const response = await this.worker.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.text(),
    });
    const body = await response.json();
    if (body.ok === true) {
      switch (this.mode) {
        case 'wrong_wallet':
          body.authority.wallet.walletId = 'unrelated';
          break;
        case 'wrong_writer':
          body.authority.versionId = '00000000-0000-4000-8000-000000000000';
          break;
        case 'invalid_generation':
          body.authority.generation = 0;
          break;
        case 'honest':
        case 'wrong_status':
          break;
      }
    }
    return Response.json(body, { status: this.mode === 'wrong_status' ? 409 : response.status });
  }
}

export async function executionAdmissionClient(
  runtime: Miniflare,
  wallet: WalletOwnershipKey,
  home: WalletHome,
  homes: readonly WalletHome[],
  mode: ReplyMode,
) {
  const worker = await runtime.getWorker('ingress-b');
  const writer = parseTenantRuntimeWriterV1(
    'gateway',
    relocationWriterVersion(home.databaseId, 'gateway'),
    { accountId: home.accountId, databaseId: home.databaseId },
  );
  const client = new WalletHomeServiceClient(
    new ExecutionConsole(worker, mode),
    writer,
    {
      namespace: wallet.namespace,
      organizationId: wallet.organizationId,
      projectId: wallet.projectId,
      environmentId: wallet.environmentId,
    },
    WalletHomeCatalog.parse(homes),
  );
  return client.executionAuthority(wallet);
}

export async function verifyExecutionAdmissionResponses(
  runtime: Miniflare,
  wallet: WalletOwnershipKey,
  home: WalletHome,
  homes: readonly WalletHome[],
) {
  for (const mode of [
    'wrong_wallet',
    'wrong_writer',
    'invalid_generation',
    'wrong_status',
  ] as const) {
    await expect(executionAdmissionClient(runtime, wallet, home, homes, mode)).rejects.toThrow();
  }
  const admitted = await executionAdmissionClient(runtime, wallet, home, homes, 'honest');
  if (!admitted.ok) throw new Error('Execution was not admitted');
  expect(admitted.authority.matches(wallet, 1)).toBe(true);
  expect(admitted.authority.matches(wallet, 2)).toBe(false);
  return { executionClientRejectsConflictingConsoleResponses: true };
}
