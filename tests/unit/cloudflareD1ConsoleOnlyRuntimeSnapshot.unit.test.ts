import { expect, test } from '@playwright/test';
import { createCloudflareD1ConsoleOnlyServiceBundle } from '../../packages/wallet-console-server-ts/src/router/cloudflare/d1ConsoleServices';
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
    await bundle.orgProjectEnv.upsertOrganization(context, {
      name: 'Console-only snapshot organization',
    });
    await bundle.orgProjectEnv.createProject(context, {
      id: 'proj_console_only_snapshot',
      name: 'Console-only snapshot project',
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
