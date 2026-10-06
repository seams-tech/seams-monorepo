import { expect } from '@playwright/test';
import type { WalletRelocationRequest } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import type { WalletRelocationAttempt } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationExecution';
import { RuntimeRelocationTransfer } from '../../packages/wallet-console-server-ts/src/walletPlacement/runtimeRelocationTransfer';
import { deriverSnapshotFixture, ed25519SnapshotFixture, ecdsaSnapshotFixture, presignSnapshotFixture, routerSnapshotFixture } from '../fixtures/tenant-deployment/walletRelocationPreparation';

type Target = Parameters<RuntimeRelocationTransfer['advance']>[2];

// Simulated regional transport shares the native wire shapes. Native Worker E2Es
// separately prove persistence; this scenario exercises coordinator retry choices.
class TransferParticipant {
  next = 0;
  verified = false;
  restoring = false;
  loseImportReply = true;
  corruptStatus = true;
  readonly exported: number[] = [];

  constructor(private readonly target: Target, private readonly receipt: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const operation = new URL(request.url).pathname.split('-').at(-1);
    const body = await request.json();
    const participant = this.target.participant;
    const stateKey = participant === 'ed25519' ? 'state' : 'kind';
    if (participant === 'presign') expect(body.session).toEqual(this.target.session);
    if (operation === 'status') {
      if (this.corruptStatus) return Response.json({ [stateKey]: 'unexpected' });
      if (this.verified) return Response.json({ [stateKey]: 'verified', receipt: this.receipt });
      if (this.restoring) return Response.json({ state: 'restoring' });
      if (participant === 'router') return Response.json({ kind: 'receiving', receipt: this.receipt,
        chunk_bytes: 4096, next_record: this.next === 2 ? 1 : 0, next_segment: this.next === 2 ? 0 : this.next });
      if (participant === 'deriver-a' || participant === 'deriver-b')
        return Response.json({ kind: this.next === 2 ? 'received' : 'receiving', receipt: this.receipt, next_segment: this.next });
      if ((participant === 'ecdsa' || participant === 'presign') && this.next === 0)
        return Response.json({ kind: 'prepared', chunk_bytes: 4096 });
      return Response.json({ [stateKey]: 'receiving', receipt: this.receipt,
        chunk_bytes: 4096, next_segment: this.next, segment_count: 2 });
    }
    if (operation === 'export') {
      expect(body.segmentIndex).toBe(this.next);
      this.exported.push(body.segmentIndex);
      const segment = { segment_index: this.next, record_index: 0, part_index: this.next,
        part_count: 2, data_b64u: 'YQ' };
      if (participant === 'deriver-a' || participant === 'deriver-b' || participant === 'ed25519')
        return Response.json({ [stateKey]: 'segment', receipt: this.receipt, segment });
      const chunk = { receipt: this.receipt, segment_index: this.next, segment_count: 2,
        chunk_bytes: 4096, data_b64u: 'YQ' };
      if (participant === 'router') return Response.json({ kind: 'exported', chunk: { ...chunk, record_index: 0 } });
      return Response.json(chunk);
    }
    if (operation === 'import') {
      const chunk = body.chunk ?? body.segment;
      expect(chunk.segment_index).toBe(this.next);
      this.next += 1;
      if (this.loseImportReply) {
        this.loseImportReply = false;
        throw new Error('Import committed before response loss');
      }
      return Response.json({ [stateKey]: 'imported', record_index: 0,
        segment_index: chunk.segment_index, input_digest_hex: 'a'.repeat(64) });
    }
    expect(operation).toBe('verify');
    expect(this.next).toBe(2);
    if (participant === 'ed25519' && !this.restoring) {
      this.restoring = true;
      return Response.json({ state: 'restoring' });
    }
    this.verified = true;
    return Response.json({ [stateKey]: 'verified', receipt: this.receipt });
  }
}

export async function verifyRuntimeTransferResume(request: WalletRelocationRequest, attempt: WalletRelocationAttempt, admittedAtMs: number) {
  const presign = presignSnapshotFixture(request, admittedAtMs, '5'.repeat(64));
  const targets: readonly Target[] = [
    { participant: 'router' }, { participant: 'deriver-a' }, { participant: 'deriver-b' },
    { participant: 'ed25519' }, { participant: 'ecdsa' }, { participant: 'presign', session: {
      presignSessionId: presign.command.presign_session_id,
      serverPresignatureId: presign.command.server_presignature_id,
    } },
  ];
  for (const target of targets) {
    let receipt: unknown;
    switch (target.participant) {
      case 'router': receipt = await routerSnapshotFixture(request, '2'.repeat(64)); break;
      case 'deriver-a': receipt = await deriverSnapshotFixture(request, 'deriverA', '4'.repeat(64)); break;
      case 'deriver-b': receipt = await deriverSnapshotFixture(request, 'deriverB', '4'.repeat(64)); break;
      case 'ed25519': receipt = ed25519SnapshotFixture(request, admittedAtMs, '1'.repeat(64)); break;
      case 'ecdsa': receipt = ecdsaSnapshotFixture(request, admittedAtMs, '3'.repeat(64)); break;
      case 'presign': receipt = presign; break;
    }
    const participant = new TransferParticipant(target, receipt);
    const first = new RuntimeRelocationTransfer(participant, participant);
    expect(await first.advance(request.wallet, attempt, target)).toEqual({ state: 'failed', code: 'receipt_conflict' });
    expect(participant.exported).toEqual([]);
    participant.corruptStatus = false;
    expect(await first.advance(request.wallet, attempt, target)).toEqual({ state: 'failed', code: 'transport_unavailable' });
    expect(participant.next).toBe(1);
    const restarted = new RuntimeRelocationTransfer(participant, participant);
    expect(await restarted.advance(request.wallet, attempt, target)).toEqual({ state: 'pending' });
    expect(participant.exported).toEqual([0, 1]);
    if (target.participant === 'ed25519')
      expect(await restarted.advance(request.wallet, attempt, target)).toEqual({ state: 'pending' });
    const verified = await restarted.advance(request.wallet, attempt, target);
    expect(verified).toEqual({ state: 'verified', receiptJson: JSON.stringify(receipt) });
    expect(await restarted.advance(request.wallet, attempt, target)).toEqual(verified);
    expect(participant.exported).toEqual([0, 1]);
  }
  return { nativeTransferDriver: { simulatedRegionalResponses: true, participants: targets.length,
    lostImportReplyResumesAtDestinationCursor: true, oneChunkPerAdvance: true,
    invalidStatusStopsSourceExport: true, verifiedRetrySkipsSourceExport: true } };
}
