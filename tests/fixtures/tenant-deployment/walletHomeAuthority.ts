import { parseTenantRuntimeWriterV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { reserveFromGateway, registrationLifecycleFromGateway } from './registrationHomeAdmission';
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
      writer: parseTenantRuntimeWriterV1('gateway', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
        accountId:
          request.headers.get('x-seams-writer-account') ?? '0123456789abcdef0123456789abcdef',
        databaseId:
          request.headers.get('x-seams-writer-database') ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
      database: env.CONSOLE_DB,
      catalogJson,
      admittedResources: catalog.deploymentResources(),
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
      if (body.action === 'registration-lifecycle') {
        try {
          const result = await registrationLifecycleFromGateway({
            database: env.CONSOLE_DB,
            catalogJson,
            admittedResources: catalog.deploymentResources(),
            region: body.region,
            localRegion: body.localRegion,
            ceremonyId: body.ceremonyId,
            walletId: body.walletId,
            operation: body.operation,
          });
          if (!result.ok) return Response.json(result, { status: 409 });
        } catch (error) {
          return Response.json(
            { ok: false, message: error instanceof Error ? error.message : String(error) },
            { status: 409 },
          );
        }
        return new URL(request.url).searchParams.has('loseReply')
          ? Response.json({ injected: 'lost_terminal_reply' }, { status: 503 })
          : Response.json({ ok: true });
      }
      if (body.action === 'admit') {
        const result = await reserveFromGateway({
          database: env.CONSOLE_DB,
          catalogJson,
          admittedResources: catalog.deploymentResources(),
          region: body.region,
          localRegion: body.localRegion,
          operationId: body.operationId,
          origin: body.origin,
        });
        if (new URL(request.url).searchParams.has('loseReply')) {
          return Response.json({ injected: 'lost_admission_reply' }, { status: 503 });
        }
        return Response.json(result);
      }
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
