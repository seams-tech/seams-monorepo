import { expect } from '@playwright/test';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { parseTenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { WalletAuthorizationTransfer } from '../../packages/wallet-console-server-ts/src/walletPlacement/authorizationTransfer';
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
class RegionalAuthorizationParticipant {
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

class UnusedRegionalParticipant {
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
  const first = new WalletAuthorizationTransfer(database, transport);
  expect(await first.advance(wallet, attempt, sourceWriter, destinationWriter)).toEqual({
    state: 'failed',
    code: 'transport_unavailable',
  });
  expect(receiver.nextIndex).toBe(1);
  const restarted = new WalletAuthorizationTransfer(database, transport);
  receiver.corruptReceipt = true;
  expect(await restarted.advance(wallet, attempt, sourceWriter, destinationWriter)).toEqual({
    state: 'failed',
    code: 'receipt_conflict',
  });
  expect(sender.exported).toEqual([0]);
  receiver.corruptReceipt = false;
  expect(await restarted.advance(wallet, attempt, sourceWriter, destinationWriter)).toEqual({
    state: 'advanced',
    nextIndex: 2,
  });
  expect(sender.exported).toEqual([0, 1]);
  expect(await restarted.advance(wallet, attempt, sourceWriter, destinationWriter)).toEqual({
    state: 'verified',
    digestHex: '6'.repeat(64),
  });
  expect(
    await new WalletAuthorizationTransfer(database, transport).advance(
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
