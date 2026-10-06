import { expect } from '@playwright/test';
import type { Miniflare } from 'miniflare';
import type { WalletHome } from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import type { WalletRelocationRequest } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import type { WalletRelocationAttempt } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationExecution';
import { presignSnapshotFixture } from '../fixtures/tenant-deployment/walletRelocationPreparation';
import { relocationWriterVersion } from '../fixtures/tenant-deployment/walletRelocationResources';

type Context = {
  readonly runtime: Miniflare;
  readonly request: WalletRelocationRequest;
  readonly attempt: WalletRelocationAttempt;
  readonly source: WalletHome;
  readonly destination: WalletHome;
  readonly admittedAtMs: number;
};

async function call(context: Context, endpoint: 'source' | 'receipt' | 'transfer', value: unknown, home: WalletHome) {
  const service = await context.runtime.getWorker('ingress-b');
  const body = endpoint !== 'receipt'
    ? { wallet: context.request.wallet, attempt: context.attempt, request: value }
    : { wallet: context.request.wallet, attempt: context.attempt, receipt: value };
  const response = await service.fetch(`https://wallet-placement.internal/internal/wallet-placement/v1/relocation-presign-${endpoint}`, {
    method: 'POST', headers: {
      'x-seams-writer-role': 'walletRuntime',
      'x-seams-writer-version': relocationWriterVersion(home.databaseId, 'walletRuntime'),
      'x-seams-writer-account': home.accountId, 'x-seams-writer-database': home.databaseId,
    }, body: JSON.stringify(body),
  });
  return response.json();
}

export async function verifyPresignSourceJournal(context: Context) {
  const receipt = presignSnapshotFixture(context.request, context.admittedAtMs, 'e'.repeat(64));
  const session = { presignSessionId: receipt.command.presign_session_id, serverPresignatureId: receipt.command.server_presignature_id };
  for (const operation of ['fence', 'freeze'] as const) {
    expect(await call(context, 'source', { operation, session }, context.source))
      .toEqual({ ok: true, command: { operation, payload: receipt.command } });
    expect(await call(context, 'source', { operation, session }, context.destination))
      .toEqual({ ok: false, code: 'participant_conflict' });
  }
  expect(await call(context, 'transfer', { operation: 'export', session, segmentIndex: 0 }, context.source))
    .toEqual({ ok: false, code: 'phase_conflict' });
  const cursor = { kind: 'after', presign_session_id: 'session-before' };
  expect(await call(context, 'source', { operation: 'inventory', cursor, limit: 128 }, context.source))
    .toEqual({ ok: true, command: { operation: 'inventory', payload: {
      scope: receipt.command.wallet_scope, request: receipt.command.request, cursor, limit: 128,
    } } });
  expect(await call(context, 'receipt', receipt, context.source)).toEqual({ ok: true, receipt });
  expect(await call(context, 'receipt', receipt, context.source)).toEqual({ ok: true, receipt });
  expect(await call(context, 'receipt', presignSnapshotFixture(context.request, context.admittedAtMs, 'f'.repeat(64)), context.source))
    .toEqual({ ok: false, code: 'receipt_conflict' });
  expect(await call(context, 'receipt', receipt, context.destination)).toEqual({ ok: false, code: 'participant_conflict' });
}

export async function verifyPresignSourceClosedAfterFreeze(context: Context) {
  await verifyPresignTransferJournal(context);
  const receipt = presignSnapshotFixture(context.request, context.admittedAtMs, 'e'.repeat(64));
  expect(await call(context, 'receipt', receipt, context.source)).toEqual({ ok: false, code: 'phase_conflict' });
  expect(await call(context, 'source', { operation: 'inventory', cursor: { kind: 'start' }, limit: 1 }, context.source))
    .toEqual({ ok: false, code: 'phase_conflict' });
}

async function verifyPresignTransferJournal(context: Context) {
  const receipt = presignSnapshotFixture(context.request, context.admittedAtMs, 'e'.repeat(64));
  const session = { presignSessionId: receipt.command.presign_session_id, serverPresignatureId: receipt.command.server_presignature_id };
  expect(await call(context, 'transfer', { operation: 'export', session, segmentIndex: 2 }, context.source))
    .toEqual({ ok: true, command: { kind: 'export', receipt, segment_index: 2, chunk_bytes: 4096 } });
  expect(await call(context, 'transfer', { operation: 'export', session, segmentIndex: 2 }, context.destination))
    .toEqual({ ok: false, code: 'participant_conflict' });
  expect(await call(context, 'transfer', { operation: 'import', session }, context.destination))
    .toEqual({ ok: true, command: { kind: 'import', receipt, chunk_bytes: 4096 } });
  expect(await call(context, 'transfer', { operation: 'verify', session }, context.destination))
    .toEqual({ ok: true, command: { kind: 'verify', receipt } });
  expect(await call(context, 'transfer', { operation: 'verify', session }, context.source))
    .toEqual({ ok: false, code: 'participant_conflict' });
  expect(await call(context, 'transfer', { operation: 'verify', session: {
    presignSessionId: 'missing-session', serverPresignatureId: session.serverPresignatureId,
  } }, context.destination)).toEqual({ ok: false, code: 'source_manifest_unavailable' });
}
