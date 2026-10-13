import { expect, test } from '@playwright/test';
import { createCloudflareD1ConsoleOnlyServiceBundle } from '../../packages/wallet-console-server-ts/src/router/cloudflare/d1ConsoleServices';
import { createCloudflareD1AccountServiceBundle } from '../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { createD1ConsoleWalletEnvironmentService } from '../../packages/wallet-console-server-ts/src/environments/d1';
import { activateWalletProject } from '../helpers/accountWalletProject.fixtures';
import { createInMemoryConsoleApiKeyService } from '../../packages/wallet-console-server-ts/src/apiKeys';
import { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from '../../packages/wallet-console-shared-ts/src/apiKeyScopes';
import { createInMemoryConsolePolicyService } from '../../packages/wallet-console-server-ts/src/policies';
import { createInMemoryConsoleRuntimeSnapshotService } from '../../packages/wallet-console-server-ts/src/runtimeSnapshots';
import { createProductionTenantDeploymentReadinessAdapterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/productionReadiness';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '../../packages/wallet-console-shared-ts/src/tenant-root';
import type { SponsoredEvmCallExecutorConfig } from '../../packages/wallet-console-server-ts/src/sponsorship/evmExecutorTypes';
import {
  applyD1MigrationFiles,
  cleanupTemporaryD1Database,
  createTemporaryD1Database,
  listD1MigrationFiles,
} from '../helpers/sqliteD1';

function createSponsoredEvmCallExecutorConfig(): SponsoredEvmCallExecutorConfig {
  return {
    executorsByChain: new Map([
      [
        42_431,
        {
          chainId: 42_431,
          rpcUrl: 'https://rpc.example.test',
          sponsorAddress: '0x2222222222222222222222222222222222222222',
          sponsorPrivateKeyHex:
            '0x1111111111111111111111111111111111111111111111111111111111111111',
          maxPriorityFeePerGasFloor: 2_000_000_000n,
          maxFeePerGasFloor: 40_000_000_000n,
        },
      ],
    ]),
  };
}

test('Console-only publishable key creation publishes the initial runtime snapshot', async () => {
  const consoleTemp = createTemporaryD1Database();

  try {
    await applyD1MigrationFiles(consoleTemp.database, listD1MigrationFiles('d1-console'));
    const bundle = await createCloudflareD1ConsoleOnlyServiceBundle({
      bindings: {
        consoleDatabase: consoleTemp.database,
      },
      route: {
        namespace: 'console-only-runtime-snapshot',
        deploymentId: 'console-only-runtime-snapshot',
      },
      adapters: {
        ensureSchema: false,
        sponsoredEvmCallConfig: createSponsoredEvmCallExecutorConfig(),
      },
    });
    const context = {
      orgId: 'org_console_only_snapshot',
      actorUserId: 'system:test',
    };
    await bundle.account.createOrganization(
      {
        userId: context.actorUserId,
        email: 'snapshot-owner@example.test',
        name: 'Snapshot owner',
        provider: 'oidc',
        orgId: null,
        projectId: null,
        platformSupport: false,
      },
      { id: context.orgId, name: 'Console-only snapshot organization' },
    );
    await bundle.orgProjects.createProject(context, {
      id: 'proj_console_only_snapshot',
      name: 'Console-only snapshot project',
    });
    await activateWalletProject({
      core: bundle,
      walletEnvironments: bundle.walletEnvironments,
      namespace: 'console-only-runtime-snapshot',
      deploymentId: bundle.walletProvisioning.authority.deploymentId,
      context,
      projectId: 'proj_console_only_snapshot',
    });
    const environmentId = 'proj_console_only_snapshot:dev';

    await bundle.apiKeys.createApiKey(context, {
      kind: 'publishable_key',
      name: 'Managed deployment production-testnet',
      environmentId,
      allowedOrigins: ['https://wallet.example.test', 'https://sign.example.test'],
      rateLimitBucket: 'managed-registration',
      quotaBucket: 'included-registration',
    });

    await expect(
      bundle.runtimeSnapshots.getLatestSnapshot(context, {
        environmentId,
        projectId: 'proj_console_only_snapshot',
      }),
    ).resolves.toMatchObject({
      environmentId,
      projectId: 'proj_console_only_snapshot',
      version: 1,
    });
  } finally {
    cleanupTemporaryD1Database(consoleTemp.tempDir);
  }
});

test('tenant deployment candidate creation publishes a missing initial runtime snapshot', async () => {
  const now = () => new Date('2026-09-18T00:00:00.000Z');
  const consoleTemp = createTemporaryD1Database();
  try {
    await applyD1MigrationFiles(consoleTemp.database, listD1MigrationFiles('d1-console'));
    const core = await createCloudflareD1AccountServiceBundle({
      database: consoleTemp.database,
      namespace: 'candidate-snapshot',
      externalDeletionGuard: null,
      ensureSchema: false,
      now,
    });
    const walletEnvironments = await createD1ConsoleWalletEnvironmentService({
      database: consoleTemp.database,
      namespace: 'candidate-snapshot',
      ensureSchema: false,
      now,
    });
    const apiKeys = createInMemoryConsoleApiKeyService({
      scopeValidation: WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
      now,
    });
    const policies = createInMemoryConsolePolicyService({ now });
    const runtimeSnapshots = createInMemoryConsoleRuntimeSnapshotService({ now });
    const context = {
      orgId: 'org_candidate_snapshot',
      actorUserId: 'system:test',
    };
    await core.account.createOrganization(
      {
        userId: context.actorUserId,
        email: 'candidate-owner@example.test',
        name: 'Candidate owner',
        provider: 'oidc',
        orgId: null,
        projectId: null,
        platformSupport: false,
      },
      { id: context.orgId, name: 'Candidate snapshot organization' },
    );
    await core.orgProjects.createProject(context, {
      id: 'proj_candidate_snapshot',
      name: 'Candidate snapshot project',
    });
    await activateWalletProject({
      core,
      walletEnvironments,
      namespace: 'candidate-snapshot',
      deploymentId: 'candidate-snapshot',
      context,
      projectId: 'proj_candidate_snapshot',
    });
    const environmentId = 'proj_candidate_snapshot:dev';
    const environment = (
      await walletEnvironments.listEnvironments(context, {
        projectId: 'proj_candidate_snapshot',
        status: 'ACTIVE',
      })
    ).find((candidate) => candidate.id === environmentId);
    if (!environment) throw new Error('test environment was not created');
    const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
      orgId: context.orgId,
      projectId: environment.projectId,
      envId: environment.id,
      signingRootId: `${environment.projectId}:${environment.key}`,
      signingRootVersion: environment.signingRootVersion,
    });
    if (!identity.ok) throw new Error(`Invalid candidate identity: ${identity.error}`);
    const credential = await apiKeys.createApiKey(context, {
      kind: 'publishable_key',
      name: 'Managed deployment production-testnet',
      environmentId,
      allowedOrigins: ['https://wallet.example.test', 'https://sign.example.test'],
      rateLimitBucket: 'managed-registration',
      quotaBucket: 'included-registration',
    });
    const adapter = createProductionTenantDeploymentReadinessAdapterV1({
      namespace: 'candidate-snapshot',
      deploymentLane: 'production-testnet',
      walletEnvironments,
      apiKeys,
      policies,
      runtimeSnapshots,
      tenantRootState: {
        async readStatus() {
          throw new Error('candidate creation must not inspect the active root');
        },
      },
      bindings: {
        async readActiveScope() {
          return null;
        },
      },
      walletRuntime: {
        resources: [
          {
            accountId: '0123456789abcdef0123456789abcdef',
            databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        async inspect() {
          throw new Error('candidate creation must not inspect the Wallet runtime');
        },
      },
      now: () => now().getTime(),
    });

    const binding = await adapter.buildCandidate({
      namespace: 'candidate-snapshot',
      resources: [
        {
          accountId: '0123456789abcdef0123456789abcdef',
          databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
      identity: identity.value,
      activeTenantRoot: {
        identityDigestB64u: 'root-digest',
        custodyLineageId: 'root-lineage',
        signingRootId: identity.value.signingRootId,
        signingRootVersion: identity.value.signingRootVersion,
      },
      credentialId: credential.apiKey.id,
      publishableKey: credential.secret,
      surfaces: {
        applicationOrigin: 'https://wallet.example.test',
        hostedWalletOrigin: 'https://sign.example.test',
        gatewayOrigin: 'https://api.example.test',
        relyingPartyId: 'sign.example.test',
      },
    });

    expect(binding.runtimePolicyDigestB64u).not.toBe('');
    await expect(
      runtimeSnapshots.getLatestSnapshot(context, {
        environmentId,
        projectId: environment.projectId,
      }),
    ).resolves.toMatchObject({
      environmentId,
      projectId: environment.projectId,
      version: 1,
    });
  } finally {
    cleanupTemporaryD1Database(consoleTemp.tempDir);
  }
});
