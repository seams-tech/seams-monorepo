import {
  parseWalletId,
  digestOpaqueValue,
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
import { SessionLocator } from '../../../packages/wallet-console-server-ts/src/walletPlacement/sessionLocators';

/** The tenant that registers. The default is the shared development tenant on lane `test`. */
export interface RegistrationTenantFixture {
  readonly scope: {
    readonly namespace: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly environmentId: string;
  };
  readonly environmentKey: string;
  readonly deploymentLane: string;
}

const DEFAULT_TENANT: RegistrationTenantFixture = {
  scope: {
    namespace: 'shared',
    organizationId: 'owner',
    projectId: 'project',
    environmentId: 'project:dev',
  },
  environmentKey: 'test',
  deploymentLane: 'test',
};

class ConsoleBinding {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly catalogJson: string,
    private readonly tenant: RegistrationTenantFixture,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const response = await handleWalletHomeServiceRequest(request, {
      writer: parseTenantRuntimeWriterV1(
        'gateway',
        request.headers.get('x-seams-writer-version') ??
          request.headers.get('x-seams-writer-database') ??
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        {
          accountId:
            request.headers.get('x-seams-writer-account') ?? '0123456789abcdef0123456789abcdef',
          databaseId:
            request.headers.get('x-seams-writer-database') ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ),
      database: this.database,
      catalogJson: this.catalogJson,
      admittedResources: WalletHomeCatalog.parse(
        JSON.parse(this.catalogJson),
      ).deploymentResources(),
      scope: this.tenant.scope,
      environmentKey: this.tenant.environmentKey,
      deploymentLane: this.tenant.deploymentLane,
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
  tenant?: RegistrationTenantFixture;
}) {
  return gatewayAdmission(input).reserve(gatewaySetupInput(input));
}

export function gatewaySetupInput(input: {
  operationId: string;
  origin: string;
  tenant?: RegistrationTenantFixture;
}): Parameters<WalletRegistrationReservationAuthority['reserve']>[0] {
  const rpId = parseWebAuthnRpId('wallet.test');
  if (!rpId.ok) throw new Error(rpId.error.message);
  const tenant = input.tenant ?? DEFAULT_TENANT;
  return {
    orgId: tenant.scope.organizationId,
    expectedOrigin: input.origin,
    runtimePolicyScope: {
      orgId: tenant.scope.organizationId,
      projectId: tenant.scope.projectId,
      envId: tenant.environmentKey,
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
            signerSlot: 1,
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
  tenant?: RegistrationTenantFixture;
};

function gatewayAdmission(input: GatewayAdmissionInput): ConsoleRegistrationHomeAdmission {
  const tenant = input.tenant ?? DEFAULT_TENANT;
  const localResource = WalletHomeCatalog.parse(JSON.parse(input.catalogJson)).select(
    input.localRegion,
  );
  return new ConsoleRegistrationHomeAdmission({
    service: new ConsoleBinding(input.database, input.catalogJson, tenant),
    writer: parseTenantRuntimeWriterV1('gateway', localResource.databaseId, {
      accountId: localResource.accountId,
      databaseId: localResource.databaseId,
    }),
    scope: tenant.scope,
    environmentKey: tenant.environmentKey,
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
): Promise<Awaited<ReturnType<WalletRegistrationReservationAuthority['admitHome' | 'complete']>>> {
  const walletId = parseWalletId(input.walletId);
  if (!walletId.ok) throw new Error(walletId.error.message);
  const authority = gatewayAdmission(input);
  const subject = { ceremonyId: input.ceremonyId, walletId: walletId.value };
  switch (input.operation.kind) {
    case 'assert':
      return authority.admitHome(subject);
    case 'complete':
      if (input.operation.outcome === 'cancelled') {
        return authority.complete({ ...subject, outcome: 'cancelled' });
      }
      return authority.complete({
        ...subject,
        outcome: 'established',
        session: await registrationSessionLocator(walletId.value),
      });
  }
}

/** The Gateway's scheduled delivery of completed signatures, through the Console route. */
export async function publishSignaturesFromGateway(
  input: GatewayAdmissionInput & {
    signatures: readonly { readonly signatureId: string; readonly completedAtMs: number }[];
  },
): Promise<void> {
  await gatewayAdmission(input).publishSignatures(input.signatures);
}

/** An unlock publishes a fresh credential session for an established wallet. */
export async function unlockFromGateway(
  input: GatewayAdmissionInput & { walletId: string; sessionLabel: string },
): Promise<void> {
  const walletId = parseWalletId(input.walletId);
  if (!walletId.ok) throw new Error(walletId.error.message);
  await gatewayAdmission(input).publish({
    kind: 'credential',
    walletId: walletId.value,
    digest: await digestOpaqueValue(`${walletId.value}:${input.sessionLabel}`),
    expiresAtMs: 4_102_444_800_000,
  });
}

export async function registrationSessionLocator(wallet: string) {
  const walletId = parseWalletId(wallet);
  if (!walletId.ok) throw new Error(walletId.error.message);
  return {
    kind: 'credential' as const,
    walletId: walletId.value,
    digest: await digestOpaqueValue(walletId.value),
    // Exact retries retain the expiry of the original committed session.
    expiresAtMs: 4_102_444_800_000,
  };
}

export async function registrationCompletionSession(wallet: string) {
  const session = await registrationSessionLocator(wallet);
  return { locator: SessionLocator.credential(session.digest), expiresAtMs: session.expiresAtMs };
}
