import { parseWebAuthnRpId, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { ConsoleRegistrationHomeAdmission } from '../../../packages/wallet-console-server-ts/src/walletPlacement/registrationAdmission';
import { parseTenantRuntimeWriterV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/homeVerification';
import {
  WalletHomeCatalog,
  type WalletRegion,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { handleWalletHomeServiceRequest } from '../../../packages/wallet-console-server-ts/src/walletPlacement/service';

const scope = {
  namespace: 'shared',
  organizationId: 'owner',
  projectId: 'project',
  environmentId: 'test',
};

class ConsoleBinding {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly catalogJson: string,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const response = await handleWalletHomeServiceRequest(request, {
      database: this.database,
      catalogJson: this.catalogJson,
      scope,
      deploymentLane: 'test',
    });
    if (!response) throw new Error('Unexpected placement service route');
    return response;
  }
}

async function unexpectedSigning(): Promise<string> {
  throw new Error('Reservation must not mint a setup token');
}

export async function reserveFromGateway(input: {
  database: D1DatabaseLike;
  catalogJson: string;
  region: WalletRegion;
  localRegion: WalletRegion;
  operationId: string;
  origin: string;
}) {
  const rpId = parseWebAuthnRpId('wallet.test');
  if (!rpId.ok) throw new Error(rpId.error.message);
  const admission = new ConsoleRegistrationHomeAdmission({
    service: new ConsoleBinding(input.database, input.catalogJson),
    writer: parseTenantRuntimeWriterV1('gateway', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    scope,
    localResource: WalletHomeCatalog.parse(JSON.parse(input.catalogJson)).select(input.localRegion),
    catalogJson: input.catalogJson,
    ingressRegion: input.region,
  });
  return admission.reserve({
    orgId: 'owner',
    expectedOrigin: input.origin,
    runtimePolicyScope: {
      orgId: 'owner',
      projectId: 'project',
      envId: 'test',
      signingRootVersion: 'default',
    },
    signer: { signJwt: unexpectedSigning },
    request: {
      registrationOperationId: input.operationId,
      wallet: { kind: 'server_allocated' },
      authMethod: { kind: 'passkey', rpId: rpId.value },
      signerSelection: {
        kind: 'signer_set',
        signers: [
          {
            kind: 'near_ed25519',
            accountProvisioning: {
              kind: 'implicit_account',
              accountIdSource: 'ed25519_public_key',
            },
            participantIds: [1, 2],
            signerSlot: 0,
            derivationVersion: 1,
          },
        ],
      },
    },
  });
}
