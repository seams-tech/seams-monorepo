import { PresignRelocationPreparation } from '../../packages/wallet-console-server-ts/src/walletPlacement/presignPreparation';
import { readWalletRelocation } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationStore';
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
  await verifyLateSessionSettlement(context);
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

class SettlementRuntime {
  preparationAvailable = false;
  lostFreezeReply = true;
  sourceMutations = 0;
  preparations = 0;

  constructor(private readonly context: Context) {}

  async fetch(request: Request): Promise<Response> {
    const body = await request.json();
    const receipt = presignSnapshotFixture(this.context.request, this.context.admittedAtMs, 'e'.repeat(64));
    const path = new URL(request.url).pathname;
    if (path.endsWith('/presign-transfer')) {
      this.preparations += 1;
      if (!this.preparationAvailable) return new Response(null, { status: 503 });
      return Response.json({ kind: 'prepared', command: body.command, chunk_bytes: body.chunk_bytes });
    }
    const operation = path.slice(path.lastIndexOf('presign-') + 8);
    const command = operation === 'inventory'
      ? { operation, cursor: body.cursor, limit: body.limit }
      : { operation, session: body.session };
    const authorization = await call(this.context, 'source', command, this.context.source);
    expect(authorization.ok).toBe(true);
    if (operation === 'inventory') return Response.json({ state: 'complete', sessions: [{
      presign_session_id: receipt.command.presign_session_id,
      server_presignature_id: receipt.command.server_presignature_id,
      request_digest_hex: 'a'.repeat(64),
    }] });
    this.sourceMutations += 1;
    if (operation === 'fence') return Response.json({ initialization: { state: 'registered' } });
    expect(operation).toBe('freeze');
    expect(await call(this.context, 'receipt', receipt, this.context.source)).toEqual({ ok: true, receipt });
    if (this.lostFreezeReply) throw new Error('Freeze reply lost after its durable receipt');
    return Response.json(receipt);
  }
}

async function verifyLateSessionSettlement(context: Context) {
  const database = await context.runtime.getD1Database('CONSOLE_DB', 'ingress-a');
  const move = await readWalletRelocation(database, context.request);
  if (!move) throw new Error('Admitted move is required');
  const runtime = new SettlementRuntime(context);
  const participant = new PresignRelocationPreparation(context.destination, runtime, runtime, Date.now);
  expect(await participant.settle(database, move, context.attempt)).toBe('unavailable');
  expect(runtime.sourceMutations).toBe(0);
  runtime.preparationAvailable = true;
  expect(await participant.settle(database, move, context.attempt)).toBe('unavailable');
  expect(runtime.sourceMutations).toBe(2);
  const restarted = new PresignRelocationPreparation(context.destination, runtime, runtime, Date.now);
  expect(await restarted.settle(database, move, context.attempt)).toBe('settled');
  expect(runtime.sourceMutations).toBe(2);
  expect(runtime.preparations).toBe(2);
}
