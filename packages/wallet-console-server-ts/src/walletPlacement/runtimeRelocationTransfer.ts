import { isPlainObject, type WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import type { WalletOwnershipKey } from './home';
import type { WalletRelocationAttempt, WalletRelocationFailure } from './relocationExecution';

type Participant = 'router' | 'deriver-a' | 'deriver-b' | 'ed25519' | 'ecdsa';
type Target =
  | { readonly participant: Participant; readonly session?: never }
  | { readonly participant: 'presign'; readonly session: {
      readonly presignSessionId: string; readonly serverPresignatureId: string;
    } };
type Result =
  | { readonly state: 'pending'; readonly receiptJson?: never; readonly code?: never }
  | { readonly state: 'verified'; readonly receiptJson: string; readonly code?: never }
  | { readonly state: 'failed'; readonly code: WalletRelocationFailure; readonly receiptJson?: never };
type Progress =
  | { readonly state: 'verified'; readonly receiptJson: string }
  | { readonly state: 'verify' }
  | { readonly state: 'segment'; readonly segmentIndex: number }
  | { readonly state: 'record'; readonly recordIndex: number; readonly segmentIndex: number };
type ImportPayload =
  | { readonly chunk: Record<string, unknown>; readonly segment?: never }
  | { readonly segment: Record<string, unknown>; readonly chunk?: never };
type TransferRequest =
  | { readonly operation: 'status' | 'verify'; readonly fields?: never }
  | { readonly operation: 'export'; readonly fields: {
      readonly segmentIndex: number; readonly recordIndex?: never;
    } | { readonly recordIndex: number; readonly segmentIndex: number } }
  | { readonly operation: 'import'; readonly fields: ImportPayload };
type Envelope = { readonly wallet: WalletOwnershipKey; readonly attempt: WalletRelocationAttempt };

class TransferFailure extends Error {
  constructor(readonly code: WalletRelocationFailure) { super(code); }
}

// Each advance moves at most one chunk or performs one bounded verification step.
// Destination status is authoritative after a lost reply or a process restart.
export class RuntimeRelocationTransfer {
  constructor(
    private readonly source: WalletRuntimeServiceBinding,
    private readonly destination: WalletRuntimeServiceBinding,
  ) {}

  async advance(wallet: WalletOwnershipKey, attempt: WalletRelocationAttempt, target: Target): Promise<Result> {
    if (attempt.phase !== 'copying' || !attempt.wallet.matches(wallet))
      return { state: 'failed', code: 'identity_conflict' };
    const envelope: Envelope = { wallet, attempt };
    try {
      const status = await this.call(this.destination, target, envelope, { operation: 'status' });
      const progress = parseProgress(status, target.participant);
      if (progress.state === 'verified') return progress;
      if (progress.state === 'verify') {
        const verified = await this.call(this.destination, target, envelope, { operation: 'verify' });
        const tag = target.participant === 'ed25519' ? verified.state : verified.kind;
        if (tag === 'restoring' && target.participant === 'ed25519') return { state: 'pending' };
        if (tag !== 'verified' || !isPlainObject(verified.receipt)) throw new TransferFailure('receipt_conflict');
        return { state: 'verified', receiptJson: JSON.stringify(verified.receipt) };
      }
      const cursor = progress.state === 'record'
        ? { recordIndex: progress.recordIndex, segmentIndex: progress.segmentIndex }
        : { segmentIndex: progress.segmentIndex };
      const exported = await this.call(this.source, target, envelope, { operation: 'export', fields: cursor });
      const payload = importPayload(exported, target.participant, progress);
      const accepted = await this.call(this.destination, target, envelope, { operation: 'import', fields: payload });
      const kind = target.participant === 'ed25519' ? accepted.state : accepted.kind;
      if (kind !== 'imported' || accepted.segment_index !== progress.segmentIndex ||
          (progress.state === 'record' && accepted.record_index !== progress.recordIndex) ||
          typeof accepted.input_digest_hex !== 'string' || !/^[a-f0-9]{64}$/u.test(accepted.input_digest_hex))
        throw new TransferFailure('receipt_conflict');
      return { state: 'pending' };
    } catch (error) {
      if (error instanceof TransferFailure) return { state: 'failed', code: error.code };
      throw error;
    }
  }

  private async call(
    runtime: WalletRuntimeServiceBinding, target: Target,
    envelope: Envelope, request: TransferRequest,
  ): Promise<Record<string, unknown>> {
    const fields = request.operation === 'export' || request.operation === 'import' ? request.fields : {};
    const body = target.participant === 'presign'
      ? { ...fields, wallet: envelope.wallet, attempt: envelope.attempt, session: target.session }
      : { ...fields, wallet: envelope.wallet, attempt: envelope.attempt };
    let response: Response;
    try {
      response = await runtime.fetch(new Request(
        `https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/${target.participant}-${request.operation}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        },
      ));
    } catch {
      throw new TransferFailure('transport_unavailable');
    }
    if (!response.ok) throw new TransferFailure(response.status >= 500 ? 'transport_unavailable' : 'authority_unavailable');
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new TransferFailure('receipt_conflict'); }
    if (!isPlainObject(raw)) throw new TransferFailure('receipt_conflict');
    return raw;
  }
}

function parseProgress(raw: Record<string, unknown>, participant: Target['participant']): Progress {
  const tag = participant === 'ed25519' ? raw.state : raw.kind;
  if (tag === 'verified' && isPlainObject(raw.receipt))
    return { state: 'verified', receiptJson: JSON.stringify(raw.receipt) };
  if (participant === 'router') {
    if (tag !== 'receiving' || raw.chunk_bytes !== 4096 || !isPlainObject(raw.receipt) ||
        !count(raw.receipt.record_count) || !count(raw.next_record) || !count(raw.next_segment) ||
        raw.next_record > raw.receipt.record_count) throw new TransferFailure('receipt_conflict');
    if (raw.next_record === raw.receipt.record_count) {
      if (raw.next_segment !== 0) throw new TransferFailure('receipt_conflict');
      return { state: 'verify' };
    }
    return { state: 'record', recordIndex: raw.next_record, segmentIndex: raw.next_segment };
  }
  if (participant === 'deriver-a' || participant === 'deriver-b') {
    if ((tag !== 'prepared' && tag !== 'receiving' && tag !== 'received') || !isPlainObject(raw.receipt) ||
        !count(raw.receipt.segment_count) || !count(raw.next_segment) || raw.next_segment > raw.receipt.segment_count)
      throw new TransferFailure('receipt_conflict');
    return segmentProgress(raw.next_segment, raw.receipt.segment_count);
  }
  if (participant === 'ed25519' && tag === 'restoring') return { state: 'verify' };
  if ((participant === 'ecdsa' || participant === 'presign') && tag === 'prepared') {
    if (raw.chunk_bytes !== 4096) throw new TransferFailure('receipt_conflict');
    return { state: 'segment', segmentIndex: 0 };
  }
  if (tag !== 'receiving' || !count(raw.segment_count) || !count(raw.next_segment) ||
      raw.next_segment > raw.segment_count || (participant !== 'ed25519' && raw.chunk_bytes !== 4096))
    throw new TransferFailure('receipt_conflict');
  return segmentProgress(raw.next_segment, raw.segment_count);
}

function segmentProgress(next: number, total: number): Progress {
  return next === total ? { state: 'verify' } : { state: 'segment', segmentIndex: next };
}

function importPayload(
  raw: Record<string, unknown>, participant: Target['participant'],
  cursor: Extract<Progress, { state: 'segment' | 'record' }>,
): ImportPayload {
  const segmented = participant === 'deriver-a' || participant === 'deriver-b' || participant === 'ed25519';
  let chunk: unknown = raw;
  if (segmented) chunk = raw.segment;
  else if (participant === 'router') chunk = raw.chunk;
  if (!isPlainObject(chunk) || chunk.segment_index !== cursor.segmentIndex ||
      (cursor.state === 'record' && chunk.record_index !== cursor.recordIndex) ||
      typeof chunk.data_b64u !== 'string' || chunk.data_b64u.length > 5462 || !/^[A-Za-z0-9_-]+$/u.test(chunk.data_b64u))
    throw new TransferFailure('content_conflict');
  return segmented ? { segment: chunk } : { chunk };
}

function count(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 && raw <= 4294967295;
}
