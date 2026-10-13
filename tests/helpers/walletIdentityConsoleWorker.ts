import type { D1DatabaseLike, WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import { createCloudflareD1AccountServiceBundle } from '../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { createD1ConsoleWalletEnvironmentService } from '../../packages/wallet-console-server-ts/src/environments/d1';
import type { ConsoleAuthClaims } from '../../packages/console-server-ts/src/router/consoleAuth';
import { createCloudflareConsoleRouter } from '../../packages/wallet-console-server-ts/src/router/cloudflare/createCloudflareConsoleRouter';
import { createWalletRuntimeOpsClient } from '../../packages/wallet-console-server-ts/src/serviceBinding/walletRuntimeOpsClient';
import { createD1ConsoleWalletService } from '../../packages/wallet-console-server-ts/src/wallets/d1';
import { activateWalletProject } from './accountWalletProject.fixtures';
import { consoleAuthorizationClaims } from './consoleAuthorization.fixtures';
import { createD1ConsoleOrganizationAccessService } from '../../packages/console-server-ts/src/teamRbac/d1';

interface Environment {
  CONSOLE_DB: D1DatabaseLike;
  WALLET_RUNTIME: WalletRuntimeServiceBinding;
  RPC: { fetch: typeof fetch };
  NAMESPACE: string;
  ORG_ID: string;
}

async function ownerClaims(env: Environment): Promise<ConsoleAuthClaims> {
  const access = await createD1ConsoleOrganizationAccessService({
    database: env.CONSOLE_DB,
    namespace: env.NAMESPACE,
    ensureSchema: false,
  });
  const authorization = await access.lookupAuthorization({
    orgId: env.ORG_ID,
    userId: 'wallet-owner',
  });
  if (!authorization || authorization.kind === 'denied')
    throw new Error('Wallet identity fixture has no owner authorization');
  return consoleAuthorizationClaims({
    authorization,
    platformSupport: false,
    email: 'owner@wallet-identity.example',
    name: 'Wallet identity owner',
    provider: 'oidc',
    projectId: null,
    sessionId: null,
  });
}

let nowMs = Date.UTC(2026, 9, 2);

function now(): Date {
  return new Date(nowMs);
}

async function seedAccount(env: Environment) {
  const core = await createCloudflareD1AccountServiceBundle({
    database: env.CONSOLE_DB,
    namespace: env.NAMESPACE,
    externalDeletionGuard: null,
    now,
  });
  await core.account.createOrganization(
    {
      userId: 'wallet-owner',
      email: 'owner@wallet-identity.example',
      name: 'Wallet identity owner',
      provider: 'oidc',
      orgId: null,
      projectId: null,
      platformSupport: false,
    },
    { id: env.ORG_ID, name: 'Wallet identity acceptance' },
  );
  return core;
}

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const runtime = createWalletRuntimeOpsClient(env.WALLET_RUNTIME);
    const wallets = await createD1ConsoleWalletService({
      database: env.CONSOLE_DB,
      namespace: env.NAMESPACE,
      ensureSchema: false,
      now,
      balanceReader: {
        resolveWalletIdentities: runtime.getWalletIdentities,
        fetchImpl: env.RPC.fetch.bind(env.RPC),
      },
    });
    const pathname = new URL(request.url).pathname;
    if (pathname === '/fixture/advance-clock') {
      nowMs += 5 * 60 * 1_000 + 1;
      return Response.json({ nowMs });
    }
    if (pathname === '/fixture/seed-owner') {
      await seedAccount(env);
      return Response.json({ ok: true });
    }
    if (pathname === '/fixture/seed') {
      const context = { orgId: env.ORG_ID, actorUserId: 'wallet-owner' };
      const core = await seedAccount(env);
      const walletEnvironments = await createD1ConsoleWalletEnvironmentService({
        database: env.CONSOLE_DB,
        namespace: env.NAMESPACE,
        ensureSchema: false,
        now,
      });
      const seeded = [];
      for (const projectId of ['project-a', 'project-b']) {
        const project = await core.orgProjects.createProject(context, {
          id: projectId,
          name: projectId,
        });
        await activateWalletProject({
          core,
          walletEnvironments,
          namespace: env.NAMESPACE,
          deploymentId: 'wallet-identity-acceptance',
          context,
          projectId: project.id,
        });
        const environments = await walletEnvironments.listEnvironments(context, {
          projectId: project.id,
        });
        for (const environment of environments) {
          if (
            environment.key === 'prod' ||
            (projectId === 'project-b' && environment.key !== 'dev')
          )
            continue;
          const wallet = await wallets.upsertWallet!(context, {
            id: 'shared-wallet',
            projectId: project.id,
            environmentId: environment.id,
            userId: 'wallet-owner',
            externalRefId: 'shared-wallet',
            address: 'shared-wallet',
            chain: 'Multichain',
            createdAt: now().toISOString(),
          });
          seeded.push({ wallet, envKey: environment.key });
        }
      }
      return Response.json(seeded);
    }
    const claims = await ownerClaims(env);
    const handler = createCloudflareConsoleRouter({
      auth: { authenticate: () => ({ ok: true, claims }) },
      wallets,
    });
    return handler(request);
  },
};
