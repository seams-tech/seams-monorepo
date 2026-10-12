import type { D1DatabaseLike, WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import { createD1ConsoleOrgProjectEnvService } from '../../packages/console-server-ts/src/orgProjectEnv/d1';
import type { ConsoleAuthClaims } from '../../packages/console-server-ts/src/router/consoleAuth';
import { createCloudflareConsoleRouter } from '../../packages/wallet-console-server-ts/src/router/cloudflare/createCloudflareConsoleRouter';
import { createWalletRuntimeOpsClient } from '../../packages/wallet-console-server-ts/src/serviceBinding/walletRuntimeOpsClient';
import { createD1ConsoleWalletService } from '../../packages/wallet-console-server-ts/src/wallets/d1';

interface Environment {
  CONSOLE_DB: D1DatabaseLike;
  WALLET_RUNTIME: WalletRuntimeServiceBinding;
  RPC: { fetch: typeof fetch };
  NAMESPACE: string;
  ORG_ID: string;
}

function ownerClaims(orgId: string): ConsoleAuthClaims {
  return {
    userId: 'wallet-owner',
    orgId,
    membershipId: 'wallet-owner-membership',
    authorizationVersion: 1,
    role: 'OWNER',
    adminPermissions: [],
    projectAccess: { kind: 'all' },
    platformSupport: false,
  };
}

let nowMs = Date.UTC(2026, 9, 2);

function now(): Date {
  return new Date(nowMs);
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
    if (pathname === '/fixture/seed') {
      const context = { orgId: env.ORG_ID, actorUserId: 'wallet-owner' };
      const organizations = await createD1ConsoleOrgProjectEnvService({
        database: env.CONSOLE_DB,
        namespace: env.NAMESPACE,
        ensureSchema: false,
        now,
      });
      await organizations.upsertOrganization(context, { name: 'Wallet identity acceptance' });
      const seeded = [];
      for (const projectId of ['project-a', 'project-b']) {
        const project = await organizations.createProject(context, {
          id: projectId,
          name: projectId,
        });
        const environments = await organizations.listEnvironments(context, {
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
    const handler = createCloudflareConsoleRouter({
      auth: { authenticate: () => ({ ok: true, claims: ownerClaims(env.ORG_ID) }) },
      wallets,
    });
    return handler(request);
  },
};
