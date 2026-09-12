import type { CfExecutionContext } from '@seams/wallet-server/cloud-host';
import {
  handleSplitGatewayWalletRuntimeRequest,
  type CloudflareD1GatewayEnv,
} from '@seams/wallet-server/hosted-wallet-gateway';
import type { WalletControlRuntimeBindings } from '@seams/wallet-server/cloud-host';
import { resolveEmailOtpDeliveryProviderFromEnv } from '../../email/otp/emailOtpProviders';

type CloudflareWalletRuntimeEnv = CloudflareD1GatewayEnv & WalletControlRuntimeBindings;

async function fetch(
  request: Request,
  env: CloudflareWalletRuntimeEnv,
  _ctx: CfExecutionContext,
): Promise<Response> {
  const response = await handleSplitGatewayWalletRuntimeRequest(request, env, {
    emailOtpDeliveryProvider: resolveEmailOtpDeliveryProviderFromEnv(env),
  });
  return response ?? new Response('Not found', { status: 404 });
}

export default { fetch };
