import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { D1WalletHomeDirectory } from '../../../packages/wallet-console-server-ts/src/walletPlacement/d1';
import { handleWalletHomeServiceRequest } from '../../../packages/wallet-console-server-ts/src/walletPlacement/service';
import {
  RegistrationSetupAllocation,
  WalletHome,
  WalletHomeCatalog,
  WalletOwnershipKey,
  WalletPlacementError,
  regionForRegistrationIngress,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/home';

const catalog = WalletHomeCatalog.parse([
  {
    region: 'US',
    accountId: '0123456789abcdef0123456789abcdef',
    databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
  {
    region: 'WEUR',
    accountId: '0123456789abcdef0123456789abcdef',
    databaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  },
  {
    region: 'APAC',
    accountId: '0123456789abcdef0123456789abcdef',
    databaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  },
]);
const catalogJson = JSON.stringify([
  catalog.select('US'),
  catalog.select('WEUR'),
  catalog.select('APAC'),
]);

export default {
  async fetch(request: Request, env: { CONSOLE_DB: D1DatabaseLike }): Promise<Response> {
    const serviceResponse = await handleWalletHomeServiceRequest(request, {
      database: env.CONSOLE_DB,
      catalogJson,
      scope: {
        namespace: 'shared',
        organizationId: 'owner',
        projectId: 'project',
        environmentId: 'test',
      },
      deploymentLane: 'test',
    });
    if (serviceResponse) return serviceResponse;
    const directory = new D1WalletHomeDirectory(env.CONSOLE_DB, catalog);
    const body = await request.json();
    try {
      if (body.action === 'select') {
        return Response.json({ region: regionForRegistrationIngress(request, 'WEUR') });
      }
      const wallet = WalletOwnershipKey.parse(body.wallet);
      if (body.action === 'find') {
        const assignment = await directory.find(wallet);
        return Response.json(assignment, { status: assignment ? 200 : 404 });
      }
      const home = WalletHome.parse(body.home);
      if (body.action === 'complete') {
        return Response.json(
          await directory.complete({
            wallet,
            home,
            registrationId: body.registrationId,
            requestDigest: body.requestDigest,
            outcome: body.outcome,
            nowMs: Date.now(),
          }),
        );
      }
      const selection =
        body.allocation === 'provided'
          ? { allocation: 'provided' as const, wallet }
          : { allocation: 'server_allocated' as const, candidate: wallet };
      if (body.allocation !== 'provided' && body.allocation !== 'server_allocated') {
        return Response.json({ code: 'invalid_input' }, { status: 400 });
      }
      const outcome = await directory.reserve({
        ...selection,
        proposedHome: home,
        proposedRegistrationAllocation: RegistrationSetupAllocation.parse(
          body.registrationAllocation,
        ),
        registrationId: body.registrationId,
        deploymentLane: 'test',
        requestDigest: body.requestDigest,
        nowMs: Date.now(),
      });
      if (new URL(request.url).searchParams.has('loseReply')) {
        return Response.json({ injected: 'lost_reply_after_commit' }, { status: 503 });
      }
      return Response.json(outcome, { status: outcome.ok ? 200 : 409 });
    } catch (error) {
      if (error instanceof WalletPlacementError) {
        return Response.json(
          { code: error.code },
          { status: error.code === 'invalid_input' ? 400 : 409 },
        );
      }
      throw error;
    }
  },
};
