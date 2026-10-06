import { expect } from '@playwright/test';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { WalletRelocationRequest } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import type { WalletRelocationAttempt } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationExecution';
import { readWalletRelocation } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationStore';
import { WalletD1RelocationCommand } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationCommands';
import { recordPresignSnapshot } from '../../packages/wallet-console-server-ts/src/walletPlacement/presignRelocationCommand';
import { WalletRelocationSourceFreeze } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationSourceFreeze';
import { RuntimeRelocationFreeze } from '../../packages/wallet-console-server-ts/src/walletPlacement/runtimeRelocationFreeze';
import { PresignRelocationPreparation } from '../../packages/wallet-console-server-ts/src/walletPlacement/presignPreparation';
import { WalletAuthorizationRelocation } from '../../packages/wallet-console-server-ts/src/walletPlacement/authorizationRelocation';
import { WalletRegionalDispatch } from '../../packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
import { parseTenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { relocationWriterVersion } from '../fixtures/tenant-deployment/walletRelocationResources';
import { relocationAuthorizationManifest } from '../fixtures/tenant-deployment/walletRelocationReceipts';
import { deriverSnapshotFixture, ed25519SnapshotFixture, ecdsaSnapshotFixture, routerSnapshotFixture, presignSnapshotFixture } from '../fixtures/tenant-deployment/walletRelocationPreparation';
import { RegionalLifecycleParticipant, UnusedRegionalParticipant } from './authorization-transfer.scenario';

// Console and the orchestration code are real. Native participant responses are
// simulated here; the public Worker scenarios verify each native protocol.
class NativeFreezeParticipant {
  pending = true;
  capturing = true;
  unavailable = false;
  calls = 0;

  constructor(private readonly request: WalletRelocationRequest, private readonly admittedAtMs: number) {}

  async fetch(request: Request): Promise<Response> {
    this.calls += 1;
    if (this.unavailable) throw new Error('Runtime unavailable after durable source seal');
    const operation = new URL(request.url).pathname.split('/').at(-1);
    const ed25519 = ed25519SnapshotFixture(this.request, this.admittedAtMs, '1'.repeat(64));
    switch (operation) {
      case 'router-freeze':
        return Response.json(this.pending ? { state: 'draining', unsettled_lifecycles: ['operation'] }
          : { state: 'frozen', receipt: await routerSnapshotFixture(this.request, '2'.repeat(64)) });
      case 'ed25519-settle': return Response.json({ state: 'settled', command: ed25519.source });
      case 'ecdsa-freeze':
        return Response.json(this.pending ? { state: 'invalidating' }
          : { state: 'frozen', receipt: ecdsaSnapshotFixture(this.request, this.admittedAtMs, '3'.repeat(64)) });
      case 'deriver-a-fence':
      case 'deriver-b-fence': {
        const role = operation === 'deriver-a-fence' ? 'deriverA' : 'deriverB';
        const snapshot = await deriverSnapshotFixture(this.request, role, '4'.repeat(64));
        return Response.json({ kind: 'settled_fence', request: snapshot.source, source_object: snapshot.source_object });
      }
      case 'presign-inventory': {
        const session = presignSnapshotFixture(this.request, this.admittedAtMs, '5'.repeat(64));
        return Response.json({ state: 'complete', sessions: [{
          presign_session_id: session.command.presign_session_id,
          server_presignature_id: session.command.server_presignature_id, request_digest_hex: 'a'.repeat(64),
        }] });
      }
      case 'ed25519-capture':
        return Response.json(this.capturing ? { state: 'capturing' } : { state: 'frozen', receipt: ed25519 });
      case 'deriver-a-capture':
      case 'deriver-b-capture': {
        const role = operation === 'deriver-a-capture' ? 'deriverA' : 'deriverB';
        return Response.json({ kind: 'frozen', receipt: await deriverSnapshotFixture(this.request, role, '4'.repeat(64)) });
      }
      default: throw new Error(`Unexpected source operation: ${operation}`);
    }
  }
}

function sealClock(admittedAtMs: number): number {
  return admittedAtMs + 105;
}

export async function verifySourceFreezeAssembly(database: D1DatabaseLike, request: WalletRelocationRequest, attempt: WalletRelocationAttempt) {
  const move = await readWalletRelocation(database, request);
  if (!move) throw new Error('Source assembly requires an admitted move');
  const writer = parseTenantRuntimeWriterV1('gateway', relocationWriterVersion(move.source.databaseId, 'gateway'), {
    accountId: move.source.accountId, databaseId: move.source.databaseId,
  });
  const authorized = await WalletD1RelocationCommand.authorize(database, move.wallet, writer, attempt, 'freeze');
  if (!authorized.ok) throw new Error('Source command was not authorized');
  const runtimeWriter = parseTenantRuntimeWriterV1('walletRuntime', relocationWriterVersion(move.source.databaseId, 'walletRuntime'), {
    accountId: move.source.accountId, databaseId: move.source.databaseId,
  });
  const sessionReceipt = presignSnapshotFixture(request, move.admittedAtMs, '5'.repeat(64));
  expect(await recordPresignSnapshot(database, move.wallet, runtimeWriter, attempt, sessionReceipt)).toEqual({ ok: true, receipt: sessionReceipt });
  const gateway = new RegionalLifecycleParticipant(authorized.command, relocationAuthorizationManifest());
  const unused = new UnusedRegionalParticipant();
  const dispatch = new WalletRegionalDispatch({ WALLET_GATEWAY_US: unused, WALLET_GATEWAY_WEUR: gateway,
    WALLET_GATEWAY_APAC: unused, WALLET_GATEWAY_OC: unused });
  const authorization = new WalletAuthorizationRelocation(database, dispatch);
  const native = new NativeFreezeParticipant(request, move.admittedAtMs);
  const clock = sealClock.bind(null, move.admittedAtMs);
  const presign = new PresignRelocationPreparation(move.destination, native, unused, clock);
  const runtime = new RuntimeRelocationFreeze(database, native, presign);
  const source = new WalletRelocationSourceFreeze(database, authorization, runtime, writer, clock);
  const context = { request, move, attempt };
  expect(await source.freeze(context)).toEqual({ state: 'pending' });
  expect(native.calls).toBeGreaterThan(0);
  gateway.pending = false;
  native.pending = false;
  expect(await source.freeze(context)).toEqual({ state: 'pending' });
  native.capturing = false;
  const frozen = await source.freeze(context);
  expect(frozen.state).toBe('frozen');
  if (frozen.state !== 'frozen') throw new Error('Source did not seal');
  const callsAtSeal = native.calls;
  native.unavailable = true;
  gateway.corruptReceipt = true;
  const restarted = new WalletRelocationSourceFreeze(database, authorization, runtime, writer, clock);
  expect(await restarted.freeze(context)).toEqual(frozen);
  expect(native.calls).toBe(callsAtSeal);
  await expect(database.prepare('UPDATE wallet_relocation_stage_receipts SET receipt_json = receipt_json WHERE move_id = ?')
    .bind(move.moveId).run()).rejects.toThrow();
  return frozen.receipt;
}
