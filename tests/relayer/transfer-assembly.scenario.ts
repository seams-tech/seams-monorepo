import { expect } from '@playwright/test';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { WalletRelocationRequest } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import type { WalletRelocationAttempt } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationExecution';
import { readWalletRelocation } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationStore';
import { WalletRelocationTransfer } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationTransfer';
import { RuntimeRelocationTransfer } from '../../packages/wallet-console-server-ts/src/walletPlacement/runtimeRelocationTransfer';
import { WalletAuthorizationRelocation } from '../../packages/wallet-console-server-ts/src/walletPlacement/authorizationRelocation';
import { WalletRegionalDispatch } from '../../packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
import { WalletD1RelocationCommand } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationCommands';
import { parseTenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { relocationWriterVersion } from '../fixtures/tenant-deployment/walletRelocationResources';
import { RegionalAuthorizationParticipant, UnusedRegionalParticipant } from './authorization-transfer.scenario';
import { presignSnapshotFixture } from '../fixtures/tenant-deployment/walletRelocationPreparation';
import { transferParticipantFixture, TransferParticipant } from './runtime-transfer.scenario';

type Participant = 'router' | 'deriver-a' | 'deriver-b' | 'ed25519' | 'ecdsa' | 'presign';
class RegionalTransferRuntime {
  constructor(readonly participants: ReadonlyMap<Participant, TransferParticipant>) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    for (const [participant, transport] of this.participants) {
      if (path.includes(`/${participant}-`)) return transport.fetch(request);
    }
    throw new Error('Unexpected regional participant');
  }
}

function transferClock(admittedAtMs: number): number {
  return admittedAtMs + 200;
}

export async function verifyTransferAssembly(database: D1DatabaseLike, request: WalletRelocationRequest, attempt: WalletRelocationAttempt) {
  const move = await readWalletRelocation(database, request);
  if (!move || move.progress.state !== 'copying') throw new Error('Transfer requires a copying move');
  const sourceWriter = parseTenantRuntimeWriterV1('gateway', relocationWriterVersion(move.source.databaseId, 'gateway'), {
    accountId: move.source.accountId, databaseId: move.source.databaseId,
  });
  const destinationWriter = parseTenantRuntimeWriterV1('gateway', relocationWriterVersion(move.destination.databaseId, 'gateway'), {
    accountId: move.destination.accountId, databaseId: move.destination.databaseId,
  });
  const source = await WalletD1RelocationCommand.authorize(database, move.wallet, sourceWriter, attempt, 'export');
  const destination = await WalletD1RelocationCommand.authorize(database, move.wallet, destinationWriter, attempt, 'import_authorization');
  if (!source.ok || !destination.ok) throw new Error('Transfer authority is unavailable');
  const sender = new RegionalAuthorizationParticipant(source.command);
  const receiver = new RegionalAuthorizationParticipant(destination.command);
  const unused = new UnusedRegionalParticipant();
  const gateways = new WalletRegionalDispatch({ WALLET_GATEWAY_US: unused, WALLET_GATEWAY_WEUR: sender,
    WALLET_GATEWAY_APAC: unused, WALLET_GATEWAY_OC: receiver });
  const authorization = new WalletAuthorizationRelocation(database, gateways);
  const participants = new Map<Participant, TransferParticipant>();
  const names: readonly Exclude<Participant, 'presign'>[] = ['router', 'deriver-a', 'deriver-b', 'ed25519', 'ecdsa'];
  for (const name of names) {
    const participant = await transferParticipantFixture(request, move.admittedAtMs, { participant: name });
    participant.corruptStatus = false;
    participants.set(name, participant);
  }
  const session = presignSnapshotFixture(request, move.admittedAtMs, '5'.repeat(64));
  const sessionParticipant = await transferParticipantFixture(request, move.admittedAtMs, { participant: 'presign', session: {
    presignSessionId: session.command.presign_session_id, serverPresignatureId: session.command.server_presignature_id,
  } });
  sessionParticipant.corruptStatus = false;
  participants.set('presign', sessionParticipant);
  const corrupted = participants.get('ecdsa');
  if (!corrupted) throw new Error('ECDSA participant is required');
  corrupted.corruptReceipt = true;
  const regional = new RegionalTransferRuntime(participants);
  const native = new RuntimeRelocationTransfer(regional, regional);
  const clock = transferClock.bind(null, move.admittedAtMs);
  const transfer = new WalletRelocationTransfer(database, authorization, native, sourceWriter, destinationWriter, clock);
  const context = { request, move, attempt };
  let rejected = false;
  for (let step = 0; step < 24; step += 1) {
    const result = await transfer.transfer(context, move.progress.sourceFence);
    if (result.state === 'failed' && result.code === 'content_conflict') {
      rejected = true;
      break;
    }
    if (result.state === 'failed') expect(result.code).toBe('transport_unavailable');
    else expect(result.state).toBe('pending');
  }
  expect(rejected).toBe(true);
  expect(await database.prepare("SELECT COUNT(*) AS count FROM wallet_relocation_stage_receipts WHERE move_id = ? AND kind = 'destination_verification'")
    .bind(move.moveId).first<number>('count')).toBe(0);
  corrupted.corruptReceipt = false;
  const verified = await transfer.transfer(context, move.progress.sourceFence);
  expect(verified.state).toBe('verified');
  if (verified.state !== 'verified') throw new Error('Destination did not verify');
  expect(verified.receipt.manifestDigest).toBe(move.progress.sourceFence.manifestDigest);
  for (const participant of participants.values()) participant.unavailable = true;
  receiver.corruptReceipt = true;
  const restarted = new WalletRelocationTransfer(database, authorization, native, sourceWriter, destinationWriter, clock);
  expect(await restarted.transfer(context, move.progress.sourceFence)).toEqual(verified);
  return verified.receipt;
}
