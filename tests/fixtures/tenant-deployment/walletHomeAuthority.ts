import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { D1WalletHomeDirectory } from '../../../packages/wallet-console-server-ts/src/walletPlacement/d1';
import {
  WalletHome,
  WalletOwnershipKey,
  WalletPlacementError,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/home';

export default {
  async fetch(request: Request, env: { CONSOLE_DB: D1DatabaseLike }): Promise<Response> {
    const directory = new D1WalletHomeDirectory(env.CONSOLE_DB);
    const body = await request.json();
    try {
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
            outcome: body.outcome,
            nowMs: Date.now(),
          }),
        );
      }
      const outcome = await directory.reserve({
        wallet,
        proposedHome: home,
        registrationId: body.registrationId,
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
