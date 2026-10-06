import type { WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import {
  parseTenantRuntimeWriterV1,
  type TenantDeploymentResourceVerificationsV1,
} from '../tenantDeployment/resourceVerification';
import { DeriverRelocationPreparation } from './deriverPreparation';
import { GatewayRelocationPreparation } from './gatewayPreparation';
import { WalletPlacementError, type WalletHome, type WalletRegion } from './home';
import { PresignRelocationPreparation } from './presignPreparation';
import { WalletRegionalDispatch } from './regionalDispatch';
import type { WalletRelocationRequest } from './relocation';
import type { WalletRelocationParticipants } from './relocationPreparation';
import { RouterRelocationPreparation } from './routerPreparation';
import { RuntimeRelocationPreparation } from './runtimePreparation';
import { SigningWorkerRelocationPreparation } from './signingWorkerPreparation';

export type WalletRelocationBindings = {
  readonly gateways: WalletRegionalDispatch;
  readonly runtimes: Readonly<Record<WalletRegion, WalletRuntimeServiceBinding>>;
};

// Construct participants without network calls. The journal checks resource freshness
// before invoking them, after unchanged-home and exact-replay handling.
export function createWalletRelocationParticipants(input: {
  readonly request: WalletRelocationRequest;
  readonly source: WalletHome;
  readonly verifications: TenantDeploymentResourceVerificationsV1;
  readonly clock: () => number;
} & WalletRelocationBindings): WalletRelocationParticipants {
  const destination = input.request.destination;
  const proof = input.verifications.find(matchesDestination.bind(null, destination));
  if (!proof || proof.authority.kind !== 'cloudflare') {
    throw new WalletPlacementError('invalid_input', 'Relocation requires a verified Runtime deployment');
  }
  const writer = parseTenantRuntimeWriterV1('walletRuntime', proof.authority.walletRuntime.versionId, {
    accountId: destination.accountId, databaseId: destination.databaseId,
  });
  const sourceRuntime = input.runtimes[input.source.region];
  const destinationRuntime = input.runtimes[destination.region];
  return {
    gateway: new GatewayRelocationPreparation(input.source, destination, input.gateways, input.clock),
    walletRuntime: new RuntimeRelocationPreparation(writer, destinationRuntime, input.clock),
    router: new RouterRelocationPreparation(destination, destinationRuntime, input.clock),
    deriverA: new DeriverRelocationPreparation('deriverA', destination, sourceRuntime, destinationRuntime, input.clock),
    deriverB: new DeriverRelocationPreparation('deriverB', destination, sourceRuntime, destinationRuntime, input.clock),
    signingWorker: new SigningWorkerRelocationPreparation(destination, destinationRuntime, input.clock),
    presignSessions: new PresignRelocationPreparation(destination, sourceRuntime, destinationRuntime, input.clock),
  };
}

function matchesDestination(home: WalletHome, proof: TenantDeploymentResourceVerificationsV1[number]): boolean {
  return proof.resource.accountId === home.accountId && proof.resource.databaseId === home.databaseId;
}
