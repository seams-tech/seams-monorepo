import { expect } from '@playwright/test';
import type { Miniflare } from 'miniflare';
import type { WalletHome } from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import type { WalletRelocationRequest } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import type { WalletRelocationAttempt } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationExecution';
import { ecdsaSnapshotFixture } from '../fixtures/tenant-deployment/walletRelocationPreparation';
import { relocationWriterVersion } from '../fixtures/tenant-deployment/walletRelocationResources';

type Context = {
  readonly runtime: Miniflare;
  readonly request: WalletRelocationRequest;
  readonly attempt: WalletRelocationAttempt;
  readonly source: WalletHome;
  readonly destination: WalletHome;
  readonly admittedAtMs: number;
};

function receipt(context: Context, digest = 'e'.repeat(64)) {
  return ecdsaSnapshotFixture(context.request, context.admittedAtMs, digest);
}

async function call(context: Context, endpoint: 'receipt' | 'activation' | 'transfer', value: unknown, home: WalletHome) {
  const service = await context.runtime.getWorker('ingress-b');
  const body = endpoint === 'transfer'
    ? { wallet: context.request.wallet, attempt: context.attempt, request: value }
    : { wallet: context.request.wallet, attempt: context.attempt, receipt: value };
  const response = await service.fetch(`https://wallet-placement.internal/internal/wallet-placement/v1/relocation-ecdsa-${endpoint}`, {
    method: 'POST', headers: {
      'x-seams-writer-role': 'walletRuntime',
      'x-seams-writer-version': relocationWriterVersion(home.databaseId, 'walletRuntime'),
      'x-seams-writer-account': home.accountId, 'x-seams-writer-database': home.databaseId,
    }, body: JSON.stringify(body),
  });
  return response.json();
}

export async function verifyEcdsaSnapshotJournal(context: Context) {
  const snapshot = receipt(context);
  expect(await call(context, 'receipt', snapshot, context.source)).toEqual({ ok: true, receipt: snapshot });
  expect(await call(context, 'receipt', snapshot, context.source)).toEqual({ ok: true, receipt: snapshot });
  expect(await call(context, 'receipt', receipt(context, 'f'.repeat(64)), context.source)).toEqual({ ok: false, code: 'receipt_conflict' });
  expect(await call(context, 'receipt', snapshot, context.destination)).toEqual({ ok: false, code: 'participant_conflict' });
  expect(await call(context, 'transfer', { operation: 'export', segmentIndex: 0 }, context.source)).toEqual({ ok: false, code: 'phase_conflict' });
}

export async function verifyEcdsaTransferJournal(context: Context) {
  const snapshot = receipt(context);
  expect(await call(context, 'transfer', { operation: 'export', segmentIndex: 1 }, context.source))
    .toEqual({ ok: true, command: { kind: 'export', receipt: snapshot, segment_index: 1, chunk_bytes: 4096 } });
  expect(await call(context, 'transfer', { operation: 'export', segmentIndex: 0 }, context.destination))
    .toEqual({ ok: false, code: 'participant_conflict' });
  for (const operation of ['import', 'status'] as const) {
    expect(await call(context, 'transfer', { operation }, context.destination))
      .toEqual({ ok: true, command: { kind: operation, receipt: snapshot, chunk_bytes: 4096 } });
    expect(await call(context, 'transfer', { operation }, context.source)).toEqual({ ok: false, code: 'participant_conflict' });
  }
  expect(await call(context, 'transfer', { operation: 'verify' }, context.destination))
    .toEqual({ ok: true, command: { kind: 'verify', receipt: snapshot } });
}

export async function verifyEcdsaActivationJournal(context: Context) {
  const snapshot = receipt(context);
  expect(await call(context, 'transfer', { operation: 'activate' }, context.destination))
    .toEqual({ ok: true, command: { kind: 'activate', receipt: snapshot } });
  expect(await call(context, 'transfer', { operation: 'activate' }, context.source))
    .toEqual({ ok: false, code: 'participant_conflict' });
  expect(await call(context, 'activation', snapshot, context.destination)).toEqual({ ok: true, receipt: snapshot });
  expect(await call(context, 'activation', snapshot, context.destination)).toEqual({ ok: true, receipt: snapshot });
  expect(await call(context, 'activation', receipt(context, 'f'.repeat(64)), context.destination))
    .toEqual({ ok: false, code: 'receipt_conflict' });
  expect(await call(context, 'transfer', { operation: 'cleanup' }, context.source)).toEqual({ ok: false, code: 'phase_conflict' });
}

export async function verifyEcdsaCleanupJournal(context: Context) {
  const snapshot = receipt(context);
  const expected = { ok: true, command: { kind: 'cleanup', activation: snapshot } };
  expect(await call(context, 'transfer', { operation: 'cleanup' }, context.source)).toEqual(expected);
  expect(await call(context, 'transfer', { operation: 'cleanup' }, context.source)).toEqual(expected);
  expect(await call(context, 'transfer', { operation: 'cleanup' }, context.destination)).toEqual({ ok: false, code: 'participant_conflict' });
}
