import { isPlainObject, type D1DatabaseLike, type WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import type { WalletOwnershipKey } from './home';
import type { WalletRelocation } from './relocation';
import type { NativeRelocationSnapshots } from './relocationManifest';
import { PresignRelocationPreparation } from './presignPreparation';
import type { WalletRelocationAttempt, WalletRelocationFailure } from './relocationExecution';

type NativeSourceOperation = 'router-freeze' | 'ed25519-settle' | 'ecdsa-freeze'
  | 'deriver-a-fence' | 'deriver-b-fence' | 'ed25519-capture' | 'deriver-a-capture' | 'deriver-b-capture';

type Snapshot = { readonly receiptJson: string };
type FreezeResult =
  | { readonly state: 'pending'; readonly snapshots?: never; readonly code?: never }
  | { readonly state: 'frozen'; readonly snapshots: NativeRelocationSnapshots; readonly code?: never }
  | { readonly state: 'failed'; readonly code: WalletRelocationFailure; readonly snapshots?: never };
class RuntimeFreezeFailure extends Error {
  constructor(readonly code: WalletRelocationFailure) {
    super(code);
  }
}

// Native participants own durable cursors. Repeating this step resumes captures
// and cannot issue a new freeze identity after a lost response.
export class RuntimeRelocationFreeze {
  private readonly completed = new Map<string, Record<string, unknown>>();
  private readonly settledPresign = new Set<string>();
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly runtime: WalletRuntimeServiceBinding,
    private readonly presign: PresignRelocationPreparation,
  ) {}

  async advance(move: WalletRelocation, attempt: WalletRelocationAttempt): Promise<FreezeResult> {
    const wallet = move.wallet;
    if (move.progress.state !== 'freezing' || move.moveId !== attempt.moveId || attempt.phase !== 'freezing' || !attempt.wallet.matches(wallet))
      return { state: 'failed', code: 'identity_conflict' };
    const envelope = { wallet, attempt };
    try {
      const router = await this.call('router-freeze', envelope);
      const [ed25519, ecdsa, deriverA, deriverB] = await Promise.all([
        this.call('ed25519-settle', envelope), this.call('ecdsa-freeze', envelope),
        this.call('deriver-a-fence', envelope), this.call('deriver-b-fence', envelope),
      ]);
      const routerReady = routerFrozen(router);
      const ecdsaReady = ecdsaFrozen(ecdsa);
      const ed25519Ready = settledOrDraining(ed25519);
      const deriverAReady = settledDeriver(deriverA);
      const deriverBReady = settledDeriver(deriverB);
      const presignKey = JSON.stringify([wallet, move.moveId]);
      const sessions = this.settledPresign.has(presignKey)
        ? 'settled' : await this.presign.settle(this.database, move, attempt);
      if (sessions === 'unavailable') return { state: 'failed', code: 'authority_unavailable' };
      if (sessions === 'pending') return { state: 'pending' };
      if (!routerReady || !ecdsaReady || !ed25519Ready || !deriverAReady || !deriverBReady)
        return { state: 'pending' };
      // All source fences are settled, so no new linked session can enter the inventory.
      this.settledPresign.add(presignKey);
      const [ed25519Snapshot, deriverASnapshot, deriverBSnapshot] = await Promise.all([
        this.call('ed25519-capture', envelope), this.call('deriver-a-capture', envelope),
        this.call('deriver-b-capture', envelope),
      ]);
      const ed25519Receipt = captured(ed25519Snapshot, 'state');
      const deriverAReceipt = captured(deriverASnapshot, 'kind');
      const deriverBReceipt = captured(deriverBSnapshot, 'kind');
      if (!ed25519Receipt || !deriverAReceipt || !deriverBReceipt) return { state: 'pending' };
      return { state: 'frozen', snapshots: {
        router: receipt(router), ecdsa: receipt(ecdsa), ed25519: ed25519Receipt,
        deriverA: deriverAReceipt, deriverB: deriverBReceipt,
      } };
    } catch (error) {
      if (error instanceof RuntimeFreezeFailure) return { state: 'failed', code: error.code };
      throw error;
    }
  }

  private async call(operation: NativeSourceOperation, body: { readonly wallet: WalletOwnershipKey; readonly attempt: WalletRelocationAttempt }): Promise<Record<string, unknown>> {
    const key = JSON.stringify([body.wallet, body.attempt.moveId, operation]);
    const completed = this.completed.get(key);
    if (completed) return completed;
    let response: Response;
    try {
      response = await this.runtime.fetch(new Request(
        `https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/${operation}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        },
      ));
    } catch {
      throw new RuntimeFreezeFailure('transport_unavailable');
    }
    if (!response.ok) throw new RuntimeFreezeFailure(response.status >= 500 ? 'transport_unavailable' : 'authority_unavailable');
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new RuntimeFreezeFailure('receipt_conflict');
    }
    if (!isPlainObject(raw)) throw new RuntimeFreezeFailure('receipt_conflict');
    if (freezeOperationComplete(operation, raw)) this.completed.set(key, raw);
    return raw;
  }
}

function freezeOperationComplete(operation: NativeSourceOperation, raw: Record<string, unknown>): boolean {
  switch (operation) {
    case 'router-freeze': return routerFrozen(raw);
    case 'ecdsa-freeze': return ecdsaFrozen(raw);
    case 'ed25519-settle': return settledOrDraining(raw);
    case 'deriver-a-fence':
    case 'deriver-b-fence': return settledDeriver(raw);
    case 'ed25519-capture': return captured(raw, 'state') !== null;
    case 'deriver-a-capture':
    case 'deriver-b-capture': return captured(raw, 'kind') !== null;
  }
}

function routerFrozen(raw: Record<string, unknown>): boolean {
  if (raw.state === 'frozen' && Object.keys(raw).length === 2 && isPlainObject(raw.receipt)) return true;
  if (raw.state === 'draining' && Object.keys(raw).length === 2 && Array.isArray(raw.unsettled_lifecycles)) {
    for (const lifecycle of raw.unsettled_lifecycles) {
      if (typeof lifecycle !== 'string') throw new RuntimeFreezeFailure('receipt_conflict');
    }
    return false;
  }
  throw new RuntimeFreezeFailure('receipt_conflict');
}

function ecdsaFrozen(raw: Record<string, unknown>): boolean {
  if ((raw.state === 'invalidating' || raw.state === 'sealing') && Object.keys(raw).length === 1) return false;
  if (raw.state === 'frozen' && Object.keys(raw).length === 2 && isPlainObject(raw.receipt)) return true;
  if (raw.state === 'draining' && Object.keys(raw).length === 3 &&
      count(raw.pending_effects) && count(raw.pending_linked_sessions)) return false;
  throw new RuntimeFreezeFailure('receipt_conflict');
}

function settledOrDraining(raw: Record<string, unknown>): boolean {
  if (raw.state === 'settled' && isPlainObject(raw.command)) return true;
  if (raw.state === 'draining' && count(raw.pending_rounds)) return false;
  throw new RuntimeFreezeFailure('receipt_conflict');
}

function settledDeriver(raw: Record<string, unknown>): boolean {
  if (raw.kind === 'settled_fence' && isPlainObject(raw.request) && typeof raw.source_object === 'string') return true;
  if (raw.kind === 'pending' && count(raw.pending_pairs)) return false;
  throw new RuntimeFreezeFailure('receipt_conflict');
}

function captured(raw: Record<string, unknown>, tag: 'kind' | 'state'): Snapshot | null {
  if (raw[tag] === 'capturing') return null;
  if (raw[tag] === 'frozen') return receipt(raw);
  throw new RuntimeFreezeFailure('receipt_conflict');
}

function receipt(raw: Record<string, unknown>): Snapshot {
  if (!isPlainObject(raw.receipt)) throw new RuntimeFreezeFailure('receipt_conflict');
  return { receiptJson: JSON.stringify(raw.receipt) };
}

function count(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0;
}
