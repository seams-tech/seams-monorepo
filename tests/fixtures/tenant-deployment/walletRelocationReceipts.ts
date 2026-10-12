import { WalletAuthorizationManifest } from '../../../packages/wallet-console-server-ts/src/walletPlacement/authorizationManifest';
import { WalletHome } from '../../../packages/wallet-console-server-ts/src/walletPlacement/home';
import {
  WalletRelocationReceipt,
  WalletRelocationRequest,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocation';

type ReceiptKind = WalletRelocationReceipt['kind'];

// These receipts exercise directory persistence, not authenticated custody role execution.
function syntheticReceipt<Kind extends ReceiptKind>(
  kind: Kind,
  request: WalletRelocationRequest,
  home: WalletHome,
  generation: number,
  recordedAtMs: number,
  manifestDigest: string,
): WalletRelocationReceipt<Kind> {
  return WalletRelocationReceipt.parse(
    {
      kind,
      wallet: request.wallet,
      moveId: request.moveId,
      home,
      generation,
      recordedAtMs,
      manifestDigest,
      participants: {
        gateway: 'a'.repeat(64),
        walletRuntime: 'b'.repeat(64),
        router: 'c'.repeat(64),
        deriverA: 'd'.repeat(64),
        deriverB: 'e'.repeat(64),
        signingWorker: 'f'.repeat(64),
        presignSessions: '0'.repeat(64),
      },
    },
    kind,
  );
}

export function relocationSourceFence(
  request: WalletRelocationRequest,
  source: WalletHome,
  recordedAtMs: number,
  manifestDigest: string,
) {
  return syntheticReceipt(
    'source_fence',
    request,
    source,
    request.expectedGeneration,
    recordedAtMs,
    manifestDigest,
  );
}

export function relocationDestinationVerification(
  request: WalletRelocationRequest,
  recordedAtMs: number,
  manifestDigest: string,
) {
  return syntheticReceipt(
    'destination_verification',
    request,
    request.destination,
    request.expectedGeneration + 1,
    recordedAtMs,
    manifestDigest,
  );
}

export function relocationDestinationActivation(
  request: WalletRelocationRequest,
  recordedAtMs: number,
  manifestDigest: string,
) {
  return syntheticReceipt(
    'destination_activation',
    request,
    request.destination,
    request.expectedGeneration + 1,
    recordedAtMs,
    manifestDigest,
  );
}

export function relocationSourceCleanup(
  request: WalletRelocationRequest,
  source: WalletHome,
  recordedAtMs: number,
  manifestDigest: string,
) {
  return syntheticReceipt(
    'source_cleanup',
    request,
    source,
    request.expectedGeneration,
    recordedAtMs,
    manifestDigest,
  );
}

export function relocationAuthorizationManifest(digestHex = '6'.repeat(64)) {
  return WalletAuthorizationManifest.parse({
    schemaJson: JSON.stringify([
      { table: 'wallet_authorities', columns: ['authority_id'], keyColumns: ['authority_id'] },
    ]),
    chunkCount: 2,
    recordCount: 1,
    digestHex,
  });
}
