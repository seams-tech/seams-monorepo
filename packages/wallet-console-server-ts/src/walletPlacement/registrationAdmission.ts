import type { WalletLifecycleRoutingPublisher } from '@seams/wallet-server/cloud-host';
import type { WalletRecoveryRoutingPublication } from '@seams/wallet-server/cloud-host';
import type { WalletRouteLocator } from './walletRouteLocators';
import type { WalletSessionLocatorPublication } from '@seams/wallet-server/cloud-host';
import type { SessionLocator } from './sessionLocators';
import {
  parseWalletRegistrationSetupReservation,
  proposeWalletRegistrationSetup,
  walletRegistrationSetupRequestDigest,
  type WalletRegistrationReservationAuthority,
} from '@seams/wallet-server/cloud-host';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import {
  RegistrationSetupAllocation,
  WalletHomeCatalog,
  WalletPlacementError,
  WalletOwnershipKey,
  type WalletRegion,
  type WalletHome,
  type WalletHomeAssignment,
} from './home';
import { WalletHomeServiceClient } from './serviceClient';

type SetupInput = Parameters<WalletRegistrationReservationAuthority['reserve']>[0];
type SetupResult = Awaited<ReturnType<WalletRegistrationReservationAuthority['reserve']>>;

type ResolvedSetupHome =
  | { readonly ok: true; readonly assignment: WalletHomeAssignment }
  | { readonly ok: false; readonly code: string; readonly message: string };

export class ConsoleRegistrationHomeAdmission implements WalletRegistrationReservationAuthority {
  private lastReservation: {
    operationId: string;
    digest: string;
    result: ResolvedSetupHome;
  } | null = null;

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

  private client(): WalletHomeServiceClient {
    return new WalletHomeServiceClient(
      this.options.service,
      this.options.writer,
      this.options.scope,
      WalletHomeCatalog.parse(JSON.parse(this.options.catalogJson)),
    );
  }

  async publishLifecycle(
    input: Parameters<WalletLifecycleRoutingPublisher['publishLifecycle']>[0],
  ) {
    return this.client().publishLifecycle(input);
  }

  async publishRecovery(input: WalletRecoveryRoutingPublication) {
    return this.client().publishRecovery(input);
  }

  async findRoute(locator: WalletRouteLocator): Promise<WalletHomeAssignment | null> {
    return this.client().findRoute(locator);
  }

  async publish(input: WalletSessionLocatorPublication): Promise<void> {
    await this.client().publish(input);
  }

  async findSession(locator: SessionLocator): Promise<WalletHomeAssignment | null> {
    return this.client().findSession(locator);
  }

  async resolveSetup(input: SetupInput): Promise<ResolvedSetupHome> {
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
    const digest = await walletRegistrationSetupRequestDigest(scope.namespace, input);
    if (
      this.lastReservation?.operationId === input.request.registrationOperationId &&
      this.lastReservation.digest === digest
    ) {
      return this.lastReservation.result;
    }
    const client = this.client();
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
    const requestDigest = digest;
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
    const resolved: ResolvedSetupHome = result.ok
      ? { ok: true, assignment: result.assignment }
      : { ok: false, code: result.code, message: 'Registration reservation was rejected' };
    this.lastReservation = {
      operationId: input.request.registrationOperationId,
      digest,
      result: resolved,
    };
    return resolved;
  }

  isLocal(home: WalletHome): boolean {
    return (
      home.accountId === this.options.localResource.accountId &&
      home.databaseId === this.options.localResource.databaseId
    );
  }

  async reserve(input: SetupInput): Promise<SetupResult> {
    const result = await this.resolveSetup(input);
    if (!result.ok) return result;
    const assignment = result.assignment;
    if (assignment.state === 'cancelled') {
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
      lifecycle: assignment.state,
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
  async findHome(
    locator: { kind: 'ceremony'; ceremonyId: string } | { kind: 'wallet'; walletId: string },
  ): Promise<WalletHomeAssignment | null> {
    const client = this.client();
    switch (locator.kind) {
      case 'ceremony':
        return client.findByCeremony(locator.ceremonyId);
      case 'wallet':
        return client.find(
          WalletOwnershipKey.parse({ ...this.options.scope, walletId: locator.walletId }),
        );
    }
  }

  async admitHome(
    input: Parameters<WalletRegistrationReservationAuthority['admitHome']>[0],
  ): Promise<Awaited<ReturnType<WalletRegistrationReservationAuthority['admitHome']>>> {
    const client = this.client();
    const assignment = await client.findByCeremony(input.ceremonyId);
    if (
      !assignment ||
      assignment.state === 'cancelled' ||
      assignment.wallet.walletId !== input.walletId ||
      assignment.home.accountId !== this.options.localResource.accountId ||
      assignment.home.databaseId !== this.options.localResource.databaseId
    ) {
      return {
        ok: false,
        code: 'wallet_home_unavailable',
        message: 'Registration home is unavailable',
      };
    }
    return { ok: true };
  }

  async complete(
    input: Parameters<WalletRegistrationReservationAuthority['complete']>[0],
  ): Promise<Awaited<ReturnType<WalletRegistrationReservationAuthority['admitHome']>>> {
    const client = this.client();
    const assignment = await client.findByCeremony(input.ceremonyId);
    if (
      !assignment ||
      assignment.wallet.walletId !== input.walletId ||
      assignment.home.accountId !== this.options.localResource.accountId ||
      assignment.home.databaseId !== this.options.localResource.databaseId
    ) {
      return {
        ok: false,
        code: 'home_conflict',
        message: 'Registration completion does not match the local wallet home',
      };
    }
    if (assignment.state === input.outcome) return { ok: true };
    if (assignment.state !== 'reserved')
      return {
        ok: false,
        code: 'registration_conflict',
        message: 'Registration terminal outcome conflicts with its reservation',
      };
    try {
      await client.complete({
        wallet: assignment.wallet,
        home: assignment.home,
        registrationId: assignment.registrationId,
        requestDigest: assignment.requestDigest,
        outcome: input.outcome,
      });
    } catch (error) {
      if (error instanceof WalletPlacementError)
        return { ok: false, code: error.code, message: error.message };
      throw error;
    }
    return { ok: true };
  }
}
