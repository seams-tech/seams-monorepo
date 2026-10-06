import type { WalletHomeCatalog } from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { handleWalletRelocationAdvance, WALLET_RELOCATION_ADVANCE_URL } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationService';
import { expect } from '@playwright/test';
import { queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { WalletRelocationCleanup } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationCleanup';
import type { WalletRelocationRequest } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import type { WalletRelocationAttempt } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationExecution';
import { readWalletRelocation } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationStore';
import { WalletAuthorizationRelocation } from '../../packages/wallet-console-server-ts/src/walletPlacement/authorizationRelocation';
import { WalletRegionalDispatch } from '../../packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
import { WalletD1RelocationCommand } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationCommands';
import { parseTenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { relocationWriterVersion } from '../fixtures/tenant-deployment/walletRelocationResources';
import { relocationAuthorizationManifest } from '../fixtures/tenant-deployment/walletRelocationReceipts';
import { routerSnapshotFixture, deriverSnapshotFixture, ed25519SnapshotFixture, ecdsaSnapshotFixture, presignSnapshotFixture } from '../fixtures/tenant-deployment/walletRelocationPreparation';
import { RegionalLifecycleParticipant, UnusedRegionalParticipant } from './authorization-transfer.scenario';

class CleanupRuntime {
  corrupt = true;
  pending = true;
  loseReply = true;
  unavailable = false;
  readonly cleaned = new Set<string>();
  constructor(
    private readonly request: WalletRelocationRequest,
    private readonly admittedAtMs: number,
    private readonly routerObject: string,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (this.unavailable) throw new Error('Source offline after cleanup');
    const operation = new URL(request.url).pathname.split('/').at(-1);
    let receipt: unknown;
    let field = 'receipt';
    let stateField = 'kind';
    switch (operation) {
      case 'presign-cleanup': receipt = presignSnapshotFixture(this.request, this.admittedAtMs, '5'.repeat(64)); break;
      case 'router-cleanup':
        field = 'activation';
        receipt = { source: await routerSnapshotFixture(this.request, '2'.repeat(64)), destination_object: this.routerObject };
        break;
      case 'deriver-a-cleanup':
      case 'deriver-b-cleanup': {
        const source = await deriverSnapshotFixture(this.request, operation === 'deriver-a-cleanup' ? 'deriverA' : 'deriverB', '4'.repeat(64));
        receipt = { source, destination_object: source.source_object };
        break;
      }
      case 'ed25519-cleanup': stateField = 'state'; receipt = ed25519SnapshotFixture(this.request, this.admittedAtMs, '1'.repeat(64)); break;
      case 'ecdsa-cleanup': receipt = ecdsaSnapshotFixture(this.request, this.admittedAtMs, '3'.repeat(64)); break;
      default: throw new Error('Unexpected cleanup participant');
    }
    if (this.corrupt) return Response.json({ [stateField]: 'cleaned', [field]: { wrong_move: true } });
    if (this.pending) {
      this.pending = false;
      return Response.json({ kind: 'cleaning' });
    }
    this.cleaned.add(operation);
    if (this.loseReply) {
      this.loseReply = false;
      throw new Error('Lost cleanup reply after source deletion');
    }
    return Response.json({ [stateField]: 'cleaned', [field]: receipt });
  }
}

function cleanupClock(admittedAtMs: number): number { return admittedAtMs + 1600; }

export async function verifyCleanupAssembly(database: D1DatabaseLike, request: WalletRelocationRequest, attempt: WalletRelocationAttempt, catalog: WalletHomeCatalog) {
  const move = await readWalletRelocation(database, request);
  if (!move || move.progress.state !== 'cutover' || move.progress.activation.state !== 'activated')
    throw new Error('Cleanup requires an active destination');
  const home = move.source;
  const resource = { accountId: home.accountId, databaseId: home.databaseId };
  const writer = parseTenantRuntimeWriterV1('walletRuntime', relocationWriterVersion(home.databaseId, 'walletRuntime'), resource);
  const gatewayWriter = parseTenantRuntimeWriterV1('gateway', relocationWriterVersion(home.databaseId, 'gateway'), resource);
  const command = await WalletD1RelocationCommand.authorize(database, move.wallet, gatewayWriter, attempt, 'cleanup');
  if (!command.ok) throw new Error('Gateway cleanup authority missing');
  const gateway = new RegionalLifecycleParticipant(command.command, relocationAuthorizationManifest());
  const unused = new UnusedRegionalParticipant();
  // The destination binding throws if called during cleanup.
  const dispatch = new WalletRegionalDispatch({ WALLET_GATEWAY_US: unused, WALLET_GATEWAY_WEUR: gateway,
    WALLET_GATEWAY_APAC: unused, WALLET_GATEWAY_OC: unused });
  const authorization = new WalletAuthorizationRelocation(database, dispatch);
  const row = await queryD1One(database, `SELECT json_extract(receipt_json, '$.destination_object') AS object
    FROM wallet_router_activations WHERE move_id = ?1`, [move.moveId]);
  if (typeof row?.object !== 'string') throw new Error('Router activation missing');
  const native = new CleanupRuntime(request, move.admittedAtMs, row.object);
  const clock = cleanupClock.bind(null, move.admittedAtMs);
  const cleanup = new WalletRelocationCleanup(database, authorization, native, gatewayWriter, writer, clock);
  const context = { request, move, attempt };
  const activation = move.progress.activation.receipt;
  expect(await cleanup.cleanup(context, activation)).toEqual({ state: 'failed', code: 'receipt_conflict' });
  native.corrupt = false;
  expect(await cleanup.cleanup(context, activation)).toEqual({ state: 'pending' });
  expect(await cleanup.cleanup(context, activation)).toEqual({ state: 'failed', code: 'transport_unavailable' });
  const restarted = new WalletRelocationCleanup(database, authorization, native, gatewayWriter, writer, clock);
  expect(await restarted.cleanup(context, activation)).toEqual({ state: 'pending' });
  expect(native.cleaned.size).toBe(6);
  gateway.pending = false;
  const scope = { namespace: move.wallet.namespace, organizationId: move.wallet.organizationId,
    projectId: move.wallet.projectId, environmentId: move.wallet.environmentId };
  const bindings = { gateways: dispatch, runtimes: { US: unused, WEUR: native, APAC: unused, OC: unused } };
  const options = { database, catalog, scope, bindings, clock };
  const body = JSON.stringify({ wallet: move.wallet, moveId: move.moveId, attemptId: attempt.id });
  const denied = await handleWalletRelocationAdvance(new Request(WALLET_RELOCATION_ADVANCE_URL, { method: 'POST', body }), {
    database, catalog, bindings, clock,
    scope: { namespace: 'another-namespace', organizationId: scope.organizationId, projectId: scope.projectId, environmentId: scope.environmentId },
  });
  expect(denied.status).toBe(403);
  const advanced = await handleWalletRelocationAdvance(new Request(WALLET_RELOCATION_ADVANCE_URL, { method: 'POST', body }), options);
  expect(advanced.status).toBe(200);
  const completed = await advanced.json();
  expect(completed.state).toBe('completed');
  const cleaned = await restarted.cleanup(context, activation);
  expect(cleaned.state).toBe('cleaned');
  if (cleaned.state !== 'cleaned') throw new Error('Source cleanup did not finish');
  native.unavailable = true;
  gateway.corruptReceipt = true;
  expect(await restarted.cleanup(context, activation)).toEqual(cleaned);
  const replay = await handleWalletRelocationAdvance(new Request(WALLET_RELOCATION_ADVANCE_URL, { method: 'POST', body }), options);
  expect(await replay.json()).toEqual(completed);
  return cleaned.receipt;
}
