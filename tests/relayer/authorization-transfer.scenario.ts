import type { WalletAuthorizationManifest } from '../../packages/wallet-console-server-ts/src/walletPlacement/authorizationManifest';
import { expect } from '@playwright/test';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { parseTenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { WalletAuthorizationRelocation } from '../../packages/wallet-console-server-ts/src/walletPlacement/authorizationRelocation';
import type {
  WalletHome,
  WalletOwnershipKey,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { WalletRegionalDispatch } from '../../packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
import { WalletD1RelocationCommand } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationCommands';
import type { WalletRelocationAttempt } from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationExecution';
import { relocationWriterVersion } from '../fixtures/tenant-deployment/walletRelocationResources';

// The real journal supplies commands. These regional participants simulate durable
// acknowledgements and lost responses; storage restoration has its own public E2E.
export class RegionalAuthorizationParticipant {
  nextIndex = 0;
  verified = false;
  loseNextAcknowledgement = true;
  corruptReceipt = false;
  readonly exported: number[] = [];
  constructor(private readonly command: WalletD1RelocationCommand) {}

  async fetch(request: Request): Promise<Response> {
    expect(request.headers.get('x-seams-wallet-forwarded')).toBe('1');
    const body = await request.json();
    expect(body.walletId).toBe(this.command.wallet.walletId);
    const commandDigest = this.corruptReceipt ? '0'.repeat(64) : await this.command.digest();
    const path = new URL(request.url).pathname;
    const operation = this.command.operation;
    if (operation.kind === 'export') {
      expect(path.endsWith('/export')).toBe(true);
      this.exported.push(body.index);
      return Response.json({
        kind: 'authorization_chunk',
        commandDigest,
        chunk: {
          index: body.index,
          chunkJson: JSON.stringify({ value: body.index }),
          digestHex: '6'.repeat(64),
        },
      });
    }
    if (operation.kind !== 'import_authorization') throw new Error('Unexpected command');
    if (path.endsWith('/prepare'))
      return Response.json({
        kind: 'authorization_prepared',
        commandDigest,
        progress: this.verified
          ? { state: 'verified', digestHex: operation.manifest.digestHex }
          : {
              state: 'receiving',
              nextIndex: this.nextIndex,
              chunkCount: operation.manifest.chunkCount,
            },
      });
    if (path.endsWith('/accept')) {
      expect(body.chunk.index).toBe(this.nextIndex);
      this.nextIndex += 1;
      if (this.loseNextAcknowledgement) {
        this.loseNextAcknowledgement = false;
        throw new Error('Lost response after durable acceptance');
      }
      return Response.json({
        kind: 'authorization_chunk_accepted',
        commandDigest,
        digestHex: body.chunk.digestHex,
      });
    }
    expect(path.endsWith('/verify')).toBe(true);
    expect(this.nextIndex).toBe(operation.manifest.chunkCount);
    this.verified = true;
    return Response.json({
      kind: 'authorization_verified',
      commandDigest,
      digestHex: operation.manifest.digestHex,
    });
  }
}

export class UnusedRegionalParticipant {
  async fetch(): Promise<Response> {
    throw new Error('Transfer selected an unrelated region');
  }
}

export async function verifyAuthorizationRegionalTransfer(
  database: D1DatabaseLike,
  wallet: WalletOwnershipKey,
  attempt: WalletRelocationAttempt,
  source: WalletHome,
  destination: WalletHome,
) {
  const sourceWriter = parseTenantRuntimeWriterV1(
    'gateway',
    relocationWriterVersion(source.databaseId, 'gateway'),
    { accountId: source.accountId, databaseId: source.databaseId },
  );
  const destinationWriter = parseTenantRuntimeWriterV1(
    'gateway',
    relocationWriterVersion(destination.databaseId, 'gateway'),
    { accountId: destination.accountId, databaseId: destination.databaseId },
  );
  const sourceCommand = await WalletD1RelocationCommand.authorize(
    database,
    wallet,
    sourceWriter,
    attempt,
    'export',
  );
  const destinationCommand = await WalletD1RelocationCommand.authorize(
    database,
    wallet,
    destinationWriter,
    attempt,
    'import_authorization',
  );
  if (!sourceCommand.ok || !destinationCommand.ok) throw new Error('Missing real journal commands');
  const sender = new RegionalAuthorizationParticipant(sourceCommand.command);
  const receiver = new RegionalAuthorizationParticipant(destinationCommand.command);
  const transport = new WalletRegionalDispatch({
    WALLET_GATEWAY_US: new UnusedRegionalParticipant(),
    WALLET_GATEWAY_WEUR: sender,
    WALLET_GATEWAY_APAC: new UnusedRegionalParticipant(),
    WALLET_GATEWAY_OC: receiver,
  });
  const first = new WalletAuthorizationRelocation(database, transport);
  expect(await first.transfer(wallet, attempt, sourceWriter, destinationWriter)).toEqual({
    state: 'failed',
    code: 'transport_unavailable',
  });
  expect(receiver.nextIndex).toBe(1);
  const restarted = new WalletAuthorizationRelocation(database, transport);
  receiver.corruptReceipt = true;
  expect(await restarted.transfer(wallet, attempt, sourceWriter, destinationWriter)).toEqual({
    state: 'failed',
    code: 'receipt_conflict',
  });
  expect(sender.exported).toEqual([0]);
  receiver.corruptReceipt = false;
  expect(await restarted.transfer(wallet, attempt, sourceWriter, destinationWriter)).toEqual({
    state: 'advanced',
    nextIndex: 2,
  });
  expect(sender.exported).toEqual([0, 1]);
  expect(await restarted.transfer(wallet, attempt, sourceWriter, destinationWriter)).toEqual({
    state: 'verified',
    digestHex: '6'.repeat(64),
  });
  expect(
    await new WalletAuthorizationRelocation(database, transport).transfer(
      wallet,
      attempt,
      sourceWriter,
      destinationWriter,
    ),
  ).toEqual({ state: 'verified', digestHex: '6'.repeat(64) });
  expect(sender.exported).toEqual([0, 1]);
  return {
    actualConsoleCommands: true,
    simulatedRegionalParticipants: true,
    lostAcknowledgementResumedAtNextChunk: true,
    corruptReceiptRejected: true,
    verifiedRetrySkippedSourceExport: true,
  };
}

export class RegionalLifecycleParticipant {
  pendingReason: 'ceremonies_unsettled' | 'operations_unsettled' = 'ceremonies_unsettled';
  corruptReceipt = false;
  pending = true;
  constructor(
    private readonly command: WalletD1RelocationCommand,
    private readonly manifest: WalletAuthorizationManifest,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const operation = this.command.operation.kind;
    expect(new URL(request.url).pathname.endsWith(`/${operation}`)).toBe(true);
    const commandDigest = this.corruptReceipt ? '0'.repeat(64) : await this.command.digest();
    switch (operation) {
      case 'freeze':
        return Response.json(
          this.pending
            ? { kind: 'authorization_pending', commandDigest, reason: this.pendingReason }
            : {
                kind: 'authorization_frozen',
                commandDigest,
                manifest: this.manifest,
                retiredAtMs: 100,
                frozenAtMs: 101,
              },
        );
      case 'activate':
        return Response.json({
          kind: 'authorization_activated',
          commandDigest,
          digestHex: this.manifest.digestHex,
          activatedAtMs: 102,
        });
      case 'cleanup':
        return Response.json({
          kind: 'authorization_cleanup',
          commandDigest,
          progress: this.pending ? { state: 'cleaning' } : { state: 'cleaned', completedAtMs: 103 },
        });
      default:
        throw new Error('Unexpected lifecycle command');
    }
  }
}

export async function verifyAuthorizationRegionalLifecycle(
  database: D1DatabaseLike,
  wallet: WalletOwnershipKey,
  attempt: WalletRelocationAttempt,
  home: WalletHome,
  operation: 'freeze' | 'activate' | 'cleanup',
  manifest: WalletAuthorizationManifest,
) {
  const writer = parseTenantRuntimeWriterV1(
    'gateway',
    relocationWriterVersion(home.databaseId, 'gateway'),
    {
      accountId: home.accountId,
      databaseId: home.databaseId,
    },
  );
  const authorized = await WalletD1RelocationCommand.authorize(
    database,
    wallet,
    writer,
    attempt,
    operation,
  );
  if (!authorized.ok) throw new Error('Missing lifecycle command');
  const participant = new RegionalLifecycleParticipant(authorized.command, manifest);
  const transport = new WalletRegionalDispatch({
    WALLET_GATEWAY_US: new UnusedRegionalParticipant(),
    WALLET_GATEWAY_WEUR: home.region === 'WEUR' ? participant : new UnusedRegionalParticipant(),
    WALLET_GATEWAY_APAC: new UnusedRegionalParticipant(),
    WALLET_GATEWAY_OC: home.region === 'OC' ? participant : new UnusedRegionalParticipant(),
  });
  const adapter = new WalletAuthorizationRelocation(database, transport);
  participant.corruptReceipt = true;
  expect(await adapter[operation](wallet, attempt, writer)).toEqual({
    state: 'failed',
    code: 'receipt_conflict',
  });
  participant.corruptReceipt = false;
  if (operation !== 'activate')
    expect(await adapter[operation](wallet, attempt, writer)).toEqual({ state: 'pending' });
  if (operation === 'freeze') {
    participant.pendingReason = 'operations_unsettled';
    expect(await adapter.freeze(wallet, attempt, writer)).toEqual({ state: 'pending' });
  }
  participant.pending = false;
  const result = await adapter[operation](wallet, attempt, writer);
  switch (operation) {
    case 'freeze':
      expect(result).toEqual({ state: 'frozen', manifest, retiredAtMs: 100, frozenAtMs: 101 });
      break;
    case 'activate':
      expect(result).toEqual({
        state: 'activated',
        digestHex: manifest.digestHex,
        activatedAtMs: 102,
      });
      break;
    case 'cleanup':
      expect(result).toEqual({ state: 'cleaned', completedAtMs: 103 });
      break;
  }
  expect(
    await new WalletAuthorizationRelocation(database, transport)[operation](
      wallet,
      attempt,
      writer,
    ),
  ).toEqual(result);
  return {
    regionalLifecycle: operation,
    actualConsoleCommand: true,
    simulatedParticipant: true,
    corruptReceiptRejected: true,
    restartReplay: true,
  };
}
