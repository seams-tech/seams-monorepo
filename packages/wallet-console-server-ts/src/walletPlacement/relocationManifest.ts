import type { WalletAuthorizationManifest } from './authorizationManifest';
import type { WalletRelocation, WalletRelocationReceipt } from './relocation';
import { preparationEvidenceDigest } from './relocationPreparation';

type Snapshot = { readonly receiptJson: string };
export type NativeRelocationSnapshots = {
  readonly router: Snapshot;
  readonly deriverA: Snapshot;
  readonly deriverB: Snapshot;
  readonly ed25519: Snapshot;
  readonly ecdsa: Snapshot;
};

export async function relocationParticipantDigests(
  authorization: WalletAuthorizationManifest, snapshots: NativeRelocationSnapshots, presignReceiptsJson: string,
): Promise<WalletRelocationReceipt['participants']> {
  return {
    gateway: authorization.digestHex,
    walletRuntime: await preparationEvidenceDigest(['seams/relocation/runtime-source/v1', authorization,
      snapshots.router, snapshots.deriverA, snapshots.deriverB, snapshots.ed25519, snapshots.ecdsa]),
    router: await preparationEvidenceDigest(['seams/relocation/router-source/v1', snapshots.router]),
    deriverA: await preparationEvidenceDigest(['seams/relocation/deriver-a-source/v1', snapshots.deriverA]),
    deriverB: await preparationEvidenceDigest(['seams/relocation/deriver-b-source/v1', snapshots.deriverB]),
    signingWorker: await preparationEvidenceDigest(['seams/relocation/signing-worker-source/v1', snapshots.ed25519, snapshots.ecdsa]),
    presignSessions: await preparationEvidenceDigest(['seams/relocation/presign-source/v1', presignReceiptsJson]),
  };
}

export function relocationManifestDigest(move: WalletRelocation, participants: WalletRelocationReceipt['participants']): Promise<string> {
  return preparationEvidenceDigest([
    'seams/wallet-relocation/source-manifest/v1', move.requestDigest,
    move.source, move.destination, move.sourceGeneration, move.destinationGeneration, participants,
  ]);
}
