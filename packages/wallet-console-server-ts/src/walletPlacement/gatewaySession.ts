import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { decodeTenantDeploymentBindingV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';
import type { TenantDeploymentBindingV1 } from '../tenantDeployment/types';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import {
  type TenantDeploymentServiceBindingV1,
} from '../tenantDeployment/runtimeBinding';
import { forwardTenantDeploymentD1Timing } from '../tenantDeployment/bindingTiming';
import { D1WalletHomeDirectory } from './d1';
import { WalletHomeCatalog } from './home';
import { D1WalletSessionLocators, SessionLocator } from './sessionLocators';
import { assignmentFromResponse } from './serviceClient';
import { WALLET_HOME_SERVICE_BASE_PATH, WALLET_HOME_SERVICE_ORIGIN } from './service';
import { readRequestSessionLocator, type SessionHomeResolution } from './regionalDispatch';

export const GATEWAY_SESSION_PATH = `${WALLET_HOME_SERVICE_BASE_PATH}/gateway-session`;

// The Console entrypoint has already checked this writer against the active binding.
export async function gatewaySessionResponse(
  request: Request,
  binding: TenantDeploymentBindingV1,
  database: D1DatabaseLike,
  catalogJson: string,
): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  let locator: SessionLocator;
  try {
    locator = SessionLocator.parse(await request.json());
  } catch {
    return Response.json({ ok: false, code: 'invalid_body' }, { status: 400 });
  }
  const catalog = WalletHomeCatalog.parse(JSON.parse(catalogJson));
  if (!catalog.matchesResources(binding.resources)) {
    return Response.json({ ok: false, code: 'wallet_home_resources_unverified' }, { status: 503 });
  }
  const directory = new D1WalletHomeDirectory(database, catalog);
  const sessions = new D1WalletSessionLocators(database, binding.tenant, directory);
  const assignment = await sessions.find(locator);
  return Response.json(
    { binding, locator, assignment },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

type GatewayDeploymentResolution =
  | {
      readonly kind: 'ready';
      readonly binding: TenantDeploymentBindingV1;
      readonly session: Exclude<SessionHomeResolution, { kind: 'rejected' }>;
    }
  | { readonly kind: 'rejected'; readonly response: Response };

function rejected(
  status: number,
  code: string,
): Extract<GatewayDeploymentResolution, { kind: 'rejected' }> {
  return {
    kind: 'rejected',
    response: Response.json(
      { ok: false, authenticated: false, code },
      { status, headers: { 'Cache-Control': 'no-store' } },
    ),
  };
}

export async function resolveGatewayDeployment(input: {
  readonly request: Request;
  readonly binding: TenantDeploymentBindingV1;
  readonly writer: TenantRuntimeWriterV1;
  readonly deploymentLane: string;
  readonly service: TenantDeploymentServiceBindingV1;
  readonly catalogJson: string;
  readonly timingHeaders: Headers;
}): Promise<GatewayDeploymentResolution> {
  const session = await readRequestSessionLocator(input.request);
  if (session.kind === 'rejected') return session;
  if (session.kind === 'absent') {
    return { kind: 'ready', binding: input.binding, session };
  }
  try {
    const response = await input.service.fetch(
      new Request(`${WALLET_HOME_SERVICE_ORIGIN}${GATEWAY_SESSION_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-seams-writer-role': input.writer.role,
          'x-seams-writer-version': input.writer.versionId,
          'x-seams-writer-account': input.writer.resource.accountId,
          'x-seams-writer-database': input.writer.resource.databaseId,
        },
        body: JSON.stringify(session.locator),
      }),
    );
    forwardTenantDeploymentD1Timing(response.headers, input.timingHeaders);
    if (!response.ok) return rejected(503, 'wallet_home_unavailable');
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('binding' in body) ||
      !('locator' in body) ||
      !('assignment' in body)
    )
      return rejected(503, 'wallet_home_unavailable');
    const binding = await decodeTenantDeploymentBindingV1(body.binding);
    if (
      !binding.ok ||
      binding.value.deploymentLane !== input.deploymentLane ||
      binding.value.revision !== input.binding.revision ||
      !session.locator.matches(SessionLocator.parse(body.locator))
    )
      return rejected(503, 'wallet_home_unavailable');
    const catalog = WalletHomeCatalog.parse(JSON.parse(input.catalogJson));
    if (!catalog.matchesResources(binding.value.resources))
      return rejected(503, 'wallet_home_unavailable');
    if (body.assignment === null) return rejected(401, 'unauthorized');
    const assignment = assignmentFromResponse(body.assignment, binding.value.tenant, catalog);
    if (assignment.state === 'cancelled') return rejected(401, 'unauthorized');
    return { kind: 'ready', binding: binding.value, session: { kind: 'resolved', assignment } };
  } catch {
    return rejected(503, 'wallet_home_unavailable');
  }
}
