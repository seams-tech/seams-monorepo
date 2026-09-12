import type { CfExecutionContext, CfScheduledEvent } from '@seams/wallet-server/cloud-host';
import {
  handleSplitGatewayRequest,
  type CloudflareD1GatewayEnv,
} from '@seams/wallet-server/hosted-wallet-gateway';
import { runRouterAbPrewarmScheduledV1 } from '@seams/wallet-server/cloud-host';
import { resolveEmailOtpDeliveryProviderFromEnv } from '../../email/otp/emailOtpProviders';

// The split Wallet Gateway entrypoint (R105 Phase 4). Bindings: SIGNER_DB,
// MPC_ROUTER, SIGNING_WORKER, and the private WALLET_CONSOLE service binding.
// No CONSOLE_DB, no /console/* routes, no Console cron; deploying this
// entrypoint IS the gateway half of the cutover.

async function fetch(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
): Promise<Response> {
  return await handleSplitGatewayRequest(request, env, ctx, {
    emailOtpDeliveryProvider: resolveEmailOtpDeliveryProviderFromEnv(env),
  });
}

async function scheduled(
  event: CfScheduledEvent,
  env: CloudflareD1GatewayEnv,
  _ctx: CfExecutionContext,
): Promise<void> {
  await runRouterAbPrewarmScheduledV1(event, env);
}

export default { fetch, scheduled };
