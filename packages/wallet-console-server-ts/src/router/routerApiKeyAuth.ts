import { isApiCredentialScope } from '@seams-internal/wallet-console-shared/apiKeyScopes';
import type { ConsoleApiKeyService } from '@seams-internal/wallet-console-server/apiKeys/index';
import type { ConsoleApiKey } from '@seams-internal/wallet-console-server/apiKeys/index';
import type { ConsoleBillingService } from '@seams-internal/console-server/billing/index';
import type { ConsoleWalletEnvironmentService } from '@seams-internal/wallet-console-server/environments/index';
import type { ConsoleWalletService } from '../wallets';
import type { ConsoleWalletEnvironment } from '../environments/types';
import {
  isWalletProjectAdmitted,
  type WalletOperationAdmissionV1,
} from './projectEnvironmentAdapter';
import type {
  RouterApiKeyAuthAdapter,
  RouterApiKeyAuthRequest,
  RouterApiKeyAuthResult,
  RouterApiKeyPrincipal,
  RouterApiPublishableKeyAuthAdapter,
  RouterApiPublishableKeyAuthRequest,
  RouterApiPublishableKeyAuthResult,
  RouterApiUsageMeterAdapter,
  RouterApiUsageMeterEvent,
} from '@seams/wallet-server/cloud-host';

export interface WalletApiCredentialAdmissionV1 extends WalletOperationAdmissionV1 {
  readonly environments: ConsoleWalletEnvironmentService;
}

function toPrincipal(
  apiKey: ConsoleApiKey,
  environment: ConsoleWalletEnvironment,
): RouterApiKeyPrincipal {
  return {
    apiKeyId: apiKey.id,
    orgId: apiKey.orgId,
    environmentId: apiKey.environmentId,
    projectId: environment.projectId,
    scopes: (apiKey.scopes || []).filter(isApiCredentialScope),
  };
}

async function admittedCredentialEnvironment(
  apiKey: ConsoleApiKey,
  admission: WalletApiCredentialAdmissionV1,
): Promise<ConsoleWalletEnvironment | null> {
  const environments = await admission.environments.listEnvironments({
    orgId: apiKey.orgId,
    actorUserId: 'relay-api-key',
  });
  for (const environment of environments) {
    if (environment.id !== apiKey.environmentId) continue;
    return (await isWalletProjectAdmitted(admission, apiKey.orgId, environment.projectId))
      ? environment
      : null;
  }
  return null;
}

async function upsertProjectedWallet(input: {
  readonly wallets: ConsoleWalletService;
  readonly orgId: string;
  readonly actorUserId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly walletId: string;
  readonly occurredAt: string;
}): Promise<void> {
  if (!input.wallets.upsertWallet) {
    throw new Error('Console wallet projection is not configured');
  }
  await input.wallets.upsertWallet(
    {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      environmentId: input.environmentId,
    },
    {
      id: input.walletId,
      projectId: input.projectId,
      environmentId: input.environmentId,
      userId: input.walletId,
      externalRefId: input.walletId,
      address: input.walletId,
      chain: 'Multichain',
      walletType: 'EOA',
      status: 'ACTIVE',
      policyId: null,
      balanceMinor: 0,
      lastActivityAt: input.occurredAt,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    },
  );
}

class ConsoleRouterApiKeyAuthAdapter implements RouterApiKeyAuthAdapter {
  private readonly authenticateApiKey: NonNullable<ConsoleApiKeyService['authenticateApiKey']>;

  constructor(
    apiKeys: ConsoleApiKeyService,
    private readonly admission: WalletApiCredentialAdmissionV1,
  ) {
    const authenticateApiKey = apiKeys.authenticateApiKey;
    if (typeof authenticateApiKey !== 'function') {
      throw new Error(
        'ConsoleApiKeyService.authenticateApiKey is required for Router API key auth',
      );
    }
    this.authenticateApiKey = authenticateApiKey.bind(apiKeys);
  }

  async authenticate(input: RouterApiKeyAuthRequest): Promise<RouterApiKeyAuthResult> {
    const result = await this.authenticateApiKey(input);
    if (!result.ok) return result;
    const environment = await admittedCredentialEnvironment(result.apiKey, this.admission);
    if (!environment)
      return {
        ok: false,
        status: 403,
        code: 'secret_key_environment_mismatch',
        message: 'Wallet service is unavailable for this environment',
      };
    return { ok: true, principal: toPrincipal(result.apiKey, environment) };
  }
}

class ConsoleRouterApiPublishableKeyAuthAdapter implements RouterApiPublishableKeyAuthAdapter {
  private readonly authenticatePublishableKey: NonNullable<
    ConsoleApiKeyService['authenticatePublishableKey']
  >;

  constructor(
    apiKeys: ConsoleApiKeyService,
    private readonly admission: WalletApiCredentialAdmissionV1,
    private readonly deferUsageWrite?: (write: Promise<unknown>) => void,
  ) {
    const authenticatePublishableKey = apiKeys.authenticatePublishableKey;
    if (typeof authenticatePublishableKey !== 'function') {
      throw new Error(
        'ConsoleApiKeyService.authenticatePublishableKey is required for Router API publishable key auth',
      );
    }
    this.authenticatePublishableKey = authenticatePublishableKey.bind(apiKeys);
  }

  async authenticate(
    input: RouterApiPublishableKeyAuthRequest,
  ): Promise<RouterApiPublishableKeyAuthResult> {
    const result = await this.authenticatePublishableKey({
      deferUsageWrite: this.deferUsageWrite,
      secret: input.secret,
      origin: input.origin,
      environmentId: input.environmentId,
    });
    if (!result.ok) return result;
    const environment = await admittedCredentialEnvironment(result.apiKey, this.admission);
    if (!environment)
      return {
        ok: false,
        status: 403,
        code: 'publishable_key_environment_mismatch',
        message: 'Wallet service is unavailable for this environment',
      };
    return { ok: true, principal: toPrincipal(result.apiKey, environment) };
  }
}

class ConsoleRouterApiBillingUsageMeterAdapter implements RouterApiUsageMeterAdapter {
  constructor(
    private readonly billing: ConsoleBillingService,
    private readonly options: {
      walletEnvironments?: ConsoleWalletEnvironmentService | null;
      wallets?: ConsoleWalletService | null;
    },
  ) {}

  async recordEvent(input: RouterApiUsageMeterEvent): Promise<void> {
    await this.billing.recordUsageEvent(
      {
        orgId: input.orgId,
        actorUserId: 'relay-api-key',
      },
      {
        resourceId: input.walletId,
        shouldCount: input.action !== 'wallet_created' && input.succeeded,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}),
      },
    );
    if (input.action === 'wallet_created' && input.succeeded) {
      await this.recordWalletProjection(input);
    }
  }

  private async recordWalletProjection(input: RouterApiUsageMeterEvent): Promise<void> {
    const walletEnvironments = this.options.walletEnvironments || null;
    const walletService = this.options.wallets || null;
    if (!walletEnvironments || !walletService?.upsertWallet) return;
    const envs = await walletEnvironments.listEnvironments({
      orgId: input.orgId,
      actorUserId: 'relay-api-key',
    });
    const environment = envs.find((entry) => entry.id === input.environmentId) || null;
    if (!environment) return;
    const nowIso = String(input.occurredAt || '').trim() || new Date().toISOString();
    await upsertProjectedWallet({
      wallets: walletService,
      orgId: input.orgId,
      actorUserId: 'relay-api-key',
      projectId: environment.projectId,
      environmentId: environment.id,
      walletId: input.walletId,
      occurredAt: nowIso,
    });
  }
}

export function createRouterApiKeyAuthAdapter(
  apiKeys: ConsoleApiKeyService,
  admission: WalletApiCredentialAdmissionV1,
): RouterApiKeyAuthAdapter {
  return new ConsoleRouterApiKeyAuthAdapter(apiKeys, admission);
}

export function createRouterApiPublishableKeyAuthAdapter(
  apiKeys: ConsoleApiKeyService,
  admission: WalletApiCredentialAdmissionV1,
  deferUsageWrite?: (write: Promise<unknown>) => void,
): RouterApiPublishableKeyAuthAdapter {
  return new ConsoleRouterApiPublishableKeyAuthAdapter(apiKeys, admission, deferUsageWrite);
}

export function createRouterApiBillingUsageMeterAdapter(
  billing: ConsoleBillingService,
  options: {
    walletEnvironments?: ConsoleWalletEnvironmentService | null;
    wallets?: ConsoleWalletService | null;
  } = {},
): RouterApiUsageMeterAdapter {
  return new ConsoleRouterApiBillingUsageMeterAdapter(billing, options);
}
