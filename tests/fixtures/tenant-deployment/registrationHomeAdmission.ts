import {
  parseWalletId,
  parseWebAuthnRpId,
  type D1DatabaseLike,
  type WalletRegistrationReservationAuthority,
} from '@seams/wallet-server/cloud-host';
import { ConsoleRegistrationHomeAdmission } from '../../../packages/wallet-console-server-ts/src/walletPlacement/registrationAdmission';
import { parseTenantRuntimeWriterV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
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
      writer: parseTenantRuntimeWriterV1('gateway', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
        accountId:
          request.headers.get('x-seams-writer-account') ?? '0123456789abcdef0123456789abcdef',
        databaseId:
          request.headers.get('x-seams-writer-database') ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
      database: this.database,
      catalogJson: this.catalogJson,
      admittedResources: WalletHomeCatalog.parse(
        JSON.parse(this.catalogJson),
      ).deploymentResources(),
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
  return gatewayAdmission(input).reserve(gatewaySetupInput(input));
}

export function gatewaySetupInput(input: {
  operationId: string;
  origin: string;
}): Parameters<WalletRegistrationReservationAuthority['reserve']>[0] {
  const rpId = parseWebAuthnRpId('wallet.test');
  if (!rpId.ok) throw new Error(rpId.error.message);
  return {
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
  };
}

type GatewayAdmissionInput = {
  database: D1DatabaseLike;
  catalogJson: string;
  region: WalletRegion;
  localRegion: WalletRegion;
};

function gatewayAdmission(input: GatewayAdmissionInput): ConsoleRegistrationHomeAdmission {
  const localResource = WalletHomeCatalog.parse(JSON.parse(input.catalogJson)).select(
    input.localRegion,
  );
  return new ConsoleRegistrationHomeAdmission({
    service: new ConsoleBinding(input.database, input.catalogJson),
    writer: parseTenantRuntimeWriterV1('gateway', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      accountId: localResource.accountId,
      databaseId: localResource.databaseId,
    }),
    scope,
    environmentKey: 'test',
    localResource,
    catalogJson: input.catalogJson,
    ingressRegion: input.region,
  });
}

export async function registrationLifecycleFromGateway(
  input: GatewayAdmissionInput & {
    ceremonyId: string;
    walletId: string;
    operation: { kind: 'assert' } | { kind: 'complete'; outcome: 'established' | 'cancelled' };
  },
): Promise<Awaited<ReturnType<WalletRegistrationReservationAuthority['admitHome']>>> {
  const walletId = parseWalletId(input.walletId);
  if (!walletId.ok) throw new Error(walletId.error.message);
  const authority = gatewayAdmission(input);
  const subject = { ceremonyId: input.ceremonyId, walletId: walletId.value };
  switch (input.operation.kind) {
    case 'assert':
      return authority.admitHome(subject);
    case 'complete':
      return authority.complete({ ...subject, outcome: input.operation.outcome });
  }
}
