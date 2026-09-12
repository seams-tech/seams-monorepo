import {
  coerceRouterLogger,
  getRouterApiRouteExtensionRoutes,
  matchesRouteDefinitionRequest,
  type CfExecutionContext,
  type RouterApiRouteExtension,
} from '@seams/wallet-server/cloud-host';
import { WALLET_CONSOLE_SERVICE_ORIGIN_V1 } from '@seams/wallet-server/cloud-host';

export function createWalletConsoleRelayHandler(
  extensions: readonly RouterApiRouteExtension[],
): (request: Request, ctx?: CfExecutionContext) => Promise<Response | null> {
  const logger = coerceRouterLogger(undefined);
  return async function handleWalletConsoleRelayRequest(
    request: Request,
    ctx?: CfExecutionContext,
  ): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.origin !== WALLET_CONSOLE_SERVICE_ORIGIN_V1) return null;
    for (const extension of extensions) {
      const routes = getRouterApiRouteExtensionRoutes(extension, 'fetch');
      const route = routes.find((candidate) =>
        matchesRouteDefinitionRequest(candidate, request.method, url.pathname),
      );
      if (!route) continue;
      return await extension.handleFetchRoute({
        request,
        route,
        pathname: url.pathname,
        method: request.method,
        logger,
        runtime: ctx
          ? { kind: 'background', waitUntil: ctx.waitUntil.bind(ctx) }
          : { kind: 'inline' },
      });
    }
    return null;
  };
}
