import {
  parseWalletRegistrationSetupReservation,
  proposeWalletRegistrationSetup,
  walletRegistrationSetupRequestDigest,
  type WalletRegistrationSetupReservationPort,
} from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/homeVerification';
import {
  RegistrationSetupAllocation,
  WalletHomeCatalog,
  WalletOwnershipKey,
  type WalletRegion,
} from './home';
import { WalletHomeServiceClient } from './serviceClient';

type SetupInput = Parameters<WalletRegistrationSetupReservationPort['reserve']>[0];
type SetupResult = Awaited<ReturnType<WalletRegistrationSetupReservationPort['reserve']>>;

export class ConsoleRegistrationHomeAdmission implements WalletRegistrationSetupReservationPort {
  constructor(
    private readonly options: {
      readonly service: { fetch(request: Request): Promise<Response> };
      readonly writer: TenantRuntimeWriterV1;
      readonly scope: {
        readonly namespace: string;
        readonly organizationId: string;
        readonly projectId: string;
        readonly environmentId: string;
      };
      readonly localResource: { readonly accountId: string; readonly databaseId: string };
      readonly catalogJson: string;
      readonly ingressRegion: WalletRegion;
    },
  ) {}

  async reserve(input: SetupInput): Promise<SetupResult> {
    const scope = this.options.scope;
    const policy = input.runtimePolicyScope;
    if (
      !policy ||
      input.orgId !== scope.organizationId ||
      policy.orgId !== scope.organizationId ||
      policy.projectId !== scope.projectId ||
      policy.envId !== scope.environmentId
    ) {
      return {
        ok: false,
        code: 'scope_conflict',
        message: 'Registration scope differs from the authenticated deployment',
      };
    }
    const catalog = WalletHomeCatalog.parse(JSON.parse(this.options.catalogJson));
    const client = new WalletHomeServiceClient(
      this.options.service,
      this.options.writer,
      scope,
      catalog,
    );
    const proposed = proposeWalletRegistrationSetup(input);
    const wallet = WalletOwnershipKey.parse({
      namespace: scope.namespace,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      walletId: proposed.walletId,
    });
    const allocation = RegistrationSetupAllocation.parse({
      ceremonyId: proposed.ceremonyId,
      preparationId: proposed.preparationId,
      walletAuthorityId: proposed.walletAuthorityId,
      deviceId: proposed.deviceId,
      walletAuthMethodId: proposed.walletAuthMethodId,
    });
    const requestDigest = await walletRegistrationSetupRequestDigest(scope.namespace, input);
    const common = {
      ingressRegion: this.options.ingressRegion,
      registrationId: input.request.registrationOperationId,
      requestDigest,
      proposedRegistrationAllocation: allocation,
    };
    const result =
      input.request.wallet?.kind === 'provided'
        ? await client.reserve({ ...common, allocation: 'provided', wallet })
        : await client.reserve({ ...common, allocation: 'server_allocated', candidate: wallet });
    if (!result.ok)
      return { ok: false, code: result.code, message: 'Registration reservation was rejected' };
    const assignment = result.assignment;
    if (assignment.state !== 'reserved') {
      return {
        ok: false,
        code: 'registration_closed',
        message: 'Registration reservation is already closed',
      };
    }
    if (
      assignment.home.accountId !== this.options.localResource.accountId ||
      assignment.home.databaseId !== this.options.localResource.databaseId
    ) {
      return {
        ok: false,
        code: 'registration_home_unavailable',
        message: `Registration requires its reserved ${assignment.home.region} home`,
      };
    }
    const stored = assignment.registrationAllocation;
    return {
      ok: true,
      reservation: parseWalletRegistrationSetupReservation({
        walletId: assignment.wallet.walletId,
        ceremonyId: stored.ceremonyId,
        preparationId: stored.preparationId,
        walletAuthorityId: stored.walletAuthorityId,
        deviceId: stored.deviceId,
        walletAuthMethodId: stored.walletAuthMethodId,
        reservedAtMs: assignment.reservedAtMs,
      }),
    };
  }
}
