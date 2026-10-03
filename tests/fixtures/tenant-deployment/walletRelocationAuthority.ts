import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { D1WalletHomeDirectory } from '../../../packages/wallet-console-server-ts/src/walletPlacement/d1';
import {
  RegistrationSetupAllocation,
  WalletHomeCatalog,
  WalletOwnershipKey,
  WalletPlacementError,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/home';
import {
  WalletRelocationReceipt,
  WalletRelocationRequest,
  relocationTimestamp,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import { D1WalletRelocations } from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocationStore';

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
    const body = testCommand(await request.json());
    const catalog = WalletHomeCatalog.parse(JSON.parse(env.CATALOG_JSON));
    const directory = new D1WalletHomeDirectory(env.CONSOLE_DB, catalog);
    const moves = new D1WalletRelocations(env.CONSOLE_DB, catalog);
    try {
      if (body.action === 'establish') {
        if (body.region !== 'US' && body.region !== 'WEUR' && body.region !== 'APAC') {
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
      const moveRequest = WalletRelocationRequest.parse(body.request);
      let result: unknown;
      switch (body.action) {
        case 'admit':
          result = await moves.admit(moveRequest, relocationTimestamp(body.nowMs));
          break;
        case 'status':
          result = await moves.find(moveRequest);
          break;
        case 'fence':
          result = await moves.recordSourceFence(
            moveRequest,
            WalletRelocationReceipt.parse(body.receipt, 'source_fence'),
          );
          break;
        case 'verify':
          result = await moves.recordDestinationVerification(
            moveRequest,
            WalletRelocationReceipt.parse(body.receipt, 'destination_verification'),
          );
          break;
        case 'switch':
          result = await moves.switchOwnership(moveRequest, relocationTimestamp(body.nowMs));
          break;
        case 'complete':
          result = await moves.complete(moveRequest, relocationTimestamp(body.nowMs));
          break;
        default:
          return Response.json({ code: 'unknown_test_operation' }, { status: 400 });
      }
      if (new URL(request.url).searchParams.has('loseReply')) {
        return Response.json({ code: 'injected_lost_reply' }, { status: 503 });
      }
      return Response.json(result);
    } catch (error) {
      if (error instanceof WalletPlacementError)
        return Response.json({ code: error.code }, { status: 409 });
      throw error;
    }
  },
};
