import { expect } from '@playwright/test';
import { queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { WalletRelocationActivation } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationActivation';
import type { WalletRelocationRequest } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import type { WalletRelocationAttempt } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationExecution';
import { readWalletRelocation } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationStore';
import { recordRouterActivation } from '../../packages/wallet-console-server-ts/src/walletPlacement/routerRelocationReceipt';
import { recordDeriverActivation } from '../../packages/wallet-console-server-ts/src/walletPlacement/deriverRelocationReceipt';
import { recordEd25519Activation } from '../../packages/wallet-console-server-ts/src/walletPlacement/ed25519RelocationReceipt';
import { recordEcdsaActivation } from '../../packages/wallet-console-server-ts/src/walletPlacement/ecdsaRelocationReceipt';
import { WalletAuthorizationRelocation } from '../../packages/wallet-console-server-ts/src/walletPlacement/authorizationRelocation';
import { WalletRegionalDispatch } from '../../packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
import { WalletD1RelocationCommand } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationCommands';
import { parseTenantRuntimeWriterV1, type TenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { relocationWriterVersion } from '../fixtures/tenant-deployment/walletRelocationResources';
import { relocationAuthorizationManifest } from '../fixtures/tenant-deployment/walletRelocationReceipts';
import { routerSnapshotFixture, deriverSnapshotFixture, ed25519SnapshotFixture, ecdsaSnapshotFixture } from '../fixtures/tenant-deployment/walletRelocationPreparation';
import { RegionalLifecycleParticipant, UnusedRegionalParticipant } from './authorization-transfer.scenario';

// Regional execution is simulated. Receipt admission and persistence use Console D1.
class ActivationRuntime {
  skipReceipt = true;
  loseReply = true;
  unavailable = false;
  readonly calls: string[] = [];
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly request: WalletRelocationRequest,
    private readonly attempt: WalletRelocationAttempt,
    private readonly writer: TenantRuntimeWriterV1,
    private readonly admittedAtMs: number,
    private readonly routerObject: string,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (this.unavailable) throw new Error('Runtime offline');
    const operation = new URL(request.url).pathname.split('/').at(-1);
    if (!operation) throw new Error('Missing activation operation');
    this.calls.push(operation);
    if (this.skipReceipt) return Response.json({ kind: 'activated' });
    const wallet = this.request.wallet;
    let result;
    switch (operation) {
      case 'router-activate':
        result = await recordRouterActivation(this.database, wallet, this.writer, this.attempt, {
          source: await routerSnapshotFixture(this.request, '2'.repeat(64)), destination_object: this.routerObject,
        });
        break;
      case 'deriver-a-activate':
      case 'deriver-b-activate': {
        const role = operation === 'deriver-a-activate' ? 'deriverA' : 'deriverB';
        const source = await deriverSnapshotFixture(this.request, role, '4'.repeat(64));
        result = await recordDeriverActivation(this.database, wallet, this.writer, this.attempt, role,
          { source, destination_object: source.source_object });
        break;
      }
      case 'ed25519-activate':
        result = await recordEd25519Activation(this.database, wallet, this.writer, this.attempt,
          ed25519SnapshotFixture(this.request, this.admittedAtMs, '1'.repeat(64)));
        break;
      case 'ecdsa-activate':
        result = await recordEcdsaActivation(this.database, wallet, this.writer, this.attempt,
          ecdsaSnapshotFixture(this.request, this.admittedAtMs, '3'.repeat(64)));
        break;
      default: throw new Error('Unexpected activation operation');
    }
    expect(result.ok).toBe(true);
    if (this.loseReply) {
      this.loseReply = false;
      throw new Error('Lost native activation reply');
    }
    return Response.json({ kind: 'activated' });
  }
}

function activationClock(admittedAtMs: number): number { return admittedAtMs + 400; }

export async function verifyActivationAssembly(database: D1DatabaseLike, request: WalletRelocationRequest, attempt: WalletRelocationAttempt) {
  const move = await readWalletRelocation(database, request);
  if (!move || move.progress.state !== 'cutover') throw new Error('Activation requires cutover');
  const home = move.destination;
  const writer = parseTenantRuntimeWriterV1('walletRuntime', relocationWriterVersion(home.databaseId, 'walletRuntime'), { accountId: home.accountId, databaseId: home.databaseId });
  const gatewayWriter = parseTenantRuntimeWriterV1('gateway', relocationWriterVersion(home.databaseId, 'gateway'), { accountId: home.accountId, databaseId: home.databaseId });
  const command = await WalletD1RelocationCommand.authorize(database, move.wallet, gatewayWriter, attempt, 'activate');
  if (!command.ok) throw new Error('Gateway activation authority missing');
  const gateway = new RegionalLifecycleParticipant(command.command, relocationAuthorizationManifest());
  const unused = new UnusedRegionalParticipant();
  const dispatch = new WalletRegionalDispatch({ WALLET_GATEWAY_US: unused, WALLET_GATEWAY_WEUR: unused,
    WALLET_GATEWAY_APAC: unused, WALLET_GATEWAY_OC: gateway });
  const authorization = new WalletAuthorizationRelocation(database, dispatch);
  const row = await queryD1One(database, `SELECT json_extract(value, '$.physicalResource') AS object
    FROM wallet_relocations, json_each(preparation_json, '$.receipts')
    WHERE move_id = ?1 AND json_extract(value, '$.participant') = 'router'`, [move.moveId]);
  if (typeof row?.object !== 'string') throw new Error('Prepared router object missing');
  const native = new ActivationRuntime(database, request, attempt, writer, move.admittedAtMs, row.object);
  const clock = activationClock.bind(null, move.admittedAtMs);
  const activation = new WalletRelocationActivation(database, authorization, native, gatewayWriter, clock);
  const context = { request, move, attempt };
  const verification = move.progress.destinationVerification;
  expect(await activation.activate(context, verification)).toEqual({ ok: false, code: 'receipt_conflict' });
  native.skipReceipt = false;
  expect(await activation.activate(context, verification)).toEqual({ ok: false, code: 'transport_unavailable' });
  const resumed = new WalletRelocationActivation(database, authorization, native, gatewayWriter, clock);
  const activated = await resumed.activate(context, verification);
  expect(activated.ok).toBe(true);
  if (!activated.ok) throw new Error('Destination activation failed');
  expect(native.calls).toEqual(['router-activate', 'router-activate', 'deriver-a-activate', 'deriver-b-activate', 'ed25519-activate', 'ecdsa-activate']);
  native.unavailable = true;
  gateway.corruptReceipt = true;
  expect(await resumed.activate(context, verification)).toEqual(activated);
  return activated.receipt;
}
