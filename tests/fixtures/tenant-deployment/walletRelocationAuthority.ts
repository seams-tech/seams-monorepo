import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { D1WalletHomeDirectory } from '../../../packages/wallet-console-server-ts/src/walletPlacement/d1';
import {
  RegistrationSetupAllocation,
  WalletHome,
  WalletHomeCatalog,
  WalletOwnershipKey,
  WalletPlacementError,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/home';
import {
  WalletRelocationReceipt,
  WalletRelocationRequest,
  relocationTimestamp,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import {
  WalletRelocationAttempt,
  relocationAttemptId,
  relocationFailure,
  relocationPhase,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocationExecution';
import { D1WalletRelocations } from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocationStore';
import {
  D1WalletRoutes,
  WalletRouteLocator,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/walletRouteLocators';
import { parseTenantRuntimeWriterV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { handleWalletHomeServiceRequest } from '../../../packages/wallet-console-server-ts/src/walletPlacement/service';
import { readWalletPlacementStatus } from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocationStatus';
import {
  relocationResourceVerification,
  relocationWriterVersion,
} from './walletRelocationResources';
import { isTenantDeploymentStoreError } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/service';

function testCommand(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid test command');
  return raw as Record<string, unknown>;
}

export default {
  async fetch(
    request: Request,
    env: { CONSOLE_DB: D1DatabaseLike; CATALOG_JSON: string },
  ): Promise<Response> {
    const catalog = WalletHomeCatalog.parse(JSON.parse(env.CATALOG_JSON));
    const home = catalog.select('WEUR');
    const writerRole = request.headers.get('x-seams-writer-role') ?? 'gateway';
    const writerDatabaseId = request.headers.get('x-seams-writer-database') ?? home.databaseId;
    const serviceResponse = await handleWalletHomeServiceRequest(request, {
      database: env.CONSOLE_DB,
      writer: parseTenantRuntimeWriterV1(
        writerRole,
        request.headers.get('x-seams-writer-version') ??
          relocationWriterVersion(writerDatabaseId, writerRole),
        {
          accountId: request.headers.get('x-seams-writer-account') ?? home.accountId,
          databaseId: request.headers.get('x-seams-writer-database') ?? home.databaseId,
        },
      ),
      catalogJson: env.CATALOG_JSON,
      admittedResources: catalog.deploymentResources(),
      scope: {
        namespace: 'shared',
        organizationId: 'owner',
        projectId: 'project',
        environmentId: 'test',
      },
      environmentKey: 'test',
      deploymentLane: 'test',
    });
    if (serviceResponse) return serviceResponse;
    const body = testCommand(await request.json());
    const directory = new D1WalletHomeDirectory(env.CONSOLE_DB, catalog);
    const moves = new D1WalletRelocations(env.CONSOLE_DB, catalog);
    try {
      if (body.action === 'establish') {
        if (
          body.region !== 'US' &&
          body.region !== 'WEUR' &&
          body.region !== 'APAC' &&
          body.region !== 'OC'
        ) {
          throw new Error('Invalid test home');
        }
        if (typeof body.registrationId !== 'string' || typeof body.requestDigest !== 'string') {
          throw new Error('Invalid test registration identity');
        }
        const reserved = await directory.reserve({
          allocation: 'provided',
          wallet: WalletOwnershipKey.parse(body.wallet),
          proposedHome: catalog.select(body.region),
          registrationId: body.registrationId,
          proposedRegistrationAllocation: RegistrationSetupAllocation.parse(body.allocation),
          requestDigest: body.requestDigest,
          deploymentLane: 'test',
          nowMs: relocationTimestamp(body.nowMs),
        });
        if (!reserved.ok) return Response.json(reserved, { status: 409 });
        const assignment = reserved.assignment;
        return Response.json(
          await directory.complete({
            wallet: assignment.wallet,
            home: assignment.home,
            registrationId: assignment.registrationId,
            requestDigest: assignment.requestDigest,
            outcome: 'established',
            nowMs: relocationTimestamp(body.nowMs),
          }),
        );
      }
      if (body.action === 'home') {
        return Response.json(await directory.find(WalletOwnershipKey.parse(body.wallet)));
      }
      if (body.action === 'publish-route') {
        const wallet = WalletOwnershipKey.parse(body.wallet);
        const home = WalletHome.parse(body.home);
        const routes = new D1WalletRoutes(env.CONSOLE_DB, wallet);
        const writer = parseTenantRuntimeWriterV1('gateway', home.databaseId, {
          accountId: home.accountId,
          databaseId: home.databaseId,
        });
        return Response.json({
          published: await routes.publish(wallet, [WalletRouteLocator.parse(body.locator)], writer),
        });
      }
      const moveRequest = WalletRelocationRequest.parse(body.request);
      let result: unknown;
      switch (body.action) {
        case 'admit': {
          const placement = await readWalletPlacementStatus(env.CONSOLE_DB, moveRequest.wallet);
          let sourceHome = catalog.select('WEUR');
          if (placement.state === 'settled') sourceHome = placement.home;
          if (placement.state === 'moving') sourceHome = placement.move.source;
          const nowMs = relocationTimestamp(body.nowMs);
          const preparationAtMs = relocationTimestamp(body.preparationAtMs ?? nowMs);
          const preparedDestination =
            body.preparedDestination === undefined
              ? moveRequest.destination
              : WalletHome.parse(body.preparedDestination);
          result = await moves.admit(
            moveRequest,
            [
              relocationResourceVerification(
                sourceHome,
                moveRequest.wallet.namespace,
                preparationAtMs,
              ),
              relocationResourceVerification(
                preparedDestination,
                moveRequest.wallet.namespace,
                preparationAtMs,
              ),
            ],
            'test',
            nowMs,
          );
          break;
        }
        case 'status':
          result = await moves.find(moveRequest);
          break;
        case 'claim':
          result = await moves.claimAttempt(
            moveRequest,
            relocationPhase(body.phase),
            relocationAttemptId(body.attemptId),
            relocationTimestamp(body.nowMs),
          );
          break;
        case 'fail':
          result = await moves.failAttempt(
            moveRequest,
            WalletRelocationAttempt.parse(body.attempt),
            relocationFailure(body.code),
            relocationTimestamp(body.nowMs),
          );
          break;
        case 'resume':
          result = await moves.resumeAttempt(
            moveRequest,
            WalletRelocationAttempt.parse(body.attempt),
          );
          break;
        case 'fence':
          result = await moves.recordSourceFence(
            moveRequest,
            WalletRelocationAttempt.parse(body.attempt),
            WalletRelocationReceipt.parse(body.receipt, 'source_fence'),
          );
          break;
        case 'verify':
          result = await moves.recordDestinationVerification(
            moveRequest,
            WalletRelocationAttempt.parse(body.attempt),
            WalletRelocationReceipt.parse(body.receipt, 'destination_verification'),
          );
          break;
        case 'switch':
          result = await moves.switchOwnership(
            moveRequest,
            WalletRelocationAttempt.parse(body.attempt),
            relocationTimestamp(body.nowMs),
          );
          break;
        case 'activate':
          result = await moves.recordDestinationActivation(
            moveRequest,
            WalletRelocationAttempt.parse(body.attempt),
            WalletRelocationReceipt.parse(body.activation, 'destination_activation'),
          );
          break;
        case 'complete':
          result = await moves.complete(
            moveRequest,
            WalletRelocationAttempt.parse(body.attempt),
            WalletRelocationReceipt.parse(body.cleanup, 'source_cleanup'),
            relocationTimestamp(body.nowMs),
          );
          break;
        default:
          return Response.json({ code: 'unknown_test_operation' }, { status: 400 });
      }
      if (new URL(request.url).searchParams.has('loseReply')) {
        return Response.json({ code: 'injected_lost_reply' }, { status: 503 });
      }
      return Response.json(result);
    } catch (error) {
      if (isTenantDeploymentStoreError(error))
        return Response.json({ code: error.code }, { status: 409 });
      if (error instanceof WalletPlacementError)
        return Response.json({ code: error.code }, { status: 409 });
      throw error;
    }
  },
};
