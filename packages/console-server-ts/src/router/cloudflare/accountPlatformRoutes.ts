import {
  ServiceProvisionCommandV1,
  type PlatformServiceIdV1,
} from '@seams-internal/console-shared/accountPlatform';
import {
  contractResult,
  exactKeys,
  integer,
  object,
  textValue,
} from '@seams-internal/console-shared/accountPlatform/boundary';
import {
  dispatchAccountServiceProvision,
  type AccountServiceProvisioningAdapterV1,
} from '../../accountPlatform/provisioning';
import type { AccountPlatformError } from '../../accountPlatform/types';
import type { ConsoleAuthClaims } from '../consoleAuth';
import type { AccountConsoleContext } from './context';
import { requireConsoleAuth } from './accountRoutes';
import { json, readJson } from './http';

function readChangeBody(input: unknown): {
  readonly operationId: string;
  readonly desiredRevision: number;
} {
  const body = object(input, 'body');
  exactKeys(body, ['operationId', 'desiredRevision']);
  return {
    operationId: textValue(body.operationId, 'operationId'),
    desiredRevision: integer(body.desiredRevision, 'desiredRevision', 1),
  };
}

function platformFailure(error: AccountPlatformError): Response {
  switch (error.code) {
    case 'scope_forbidden':
      return json({ ok: false, code: error.code }, { status: 403 });
    case 'instance_not_found':
      return json({ ok: false, code: error.code }, { status: 404 });
    default:
      return json({ ok: false, code: error.code }, { status: 409 });
  }
}

function provisioningAdapter(
  context: AccountConsoleContext,
  serviceId: PlatformServiceIdV1,
): AccountServiceProvisioningAdapterV1 | null {
  switch (serviceId) {
    case 'wallet':
      return context.walletProvisioning;
    case 'satyr':
      return context.satyrProvisioning;
  }
}

interface ServiceCatalogEntry {
  readonly serviceId: PlatformServiceIdV1;
  readonly availability:
    | { readonly kind: 'available'; readonly consoleHref: string }
    | { readonly kind: 'unavailable'; readonly consoleHref?: never };
}

function serviceCatalog(context: AccountConsoleContext): readonly ServiceCatalogEntry[] {
  const entries: ServiceCatalogEntry[] = [];
  for (const serviceId of ['wallet', 'satyr'] as const) {
    const adapter = provisioningAdapter(context, serviceId);
    entries.push(
      adapter
        ? { serviceId, availability: { kind: 'available', consoleHref: adapter.consoleHref } }
        : { serviceId, availability: { kind: 'unavailable' } },
    );
  }
  return entries;
}

async function changeService(
  context: AccountConsoleContext,
  claims: ConsoleAuthClaims,
  projectId: string,
  serviceId: PlatformServiceIdV1,
  commandName: 'enable' | 'disable' | 'archive',
): Promise<Response> {
  const platform = context.accountPlatform;
  if (!platform) return json({ ok: false, code: 'account_platform_unavailable' }, { status: 503 });
  const body = contractResult(readChangeBody, await readJson(context.request));
  if (body.kind === 'rejected') return json({ ok: false, ...body.error }, { status: 400 });
  const accessContext = { orgId: claims.orgId, actorUserId: claims.userId };
  const listed = await platform.listInstances(accessContext, projectId);
  if (listed.kind === 'rejected') return platformFailure(listed.error);
  let existing = null;
  for (const instance of listed.value) if (instance.serviceId === serviceId) existing = instance;
  const adapter = provisioningAdapter(context, serviceId);
  if (!existing && (commandName !== 'enable' || !adapter)) {
    return json({ ok: false, code: 'operation_unsupported' }, { status: 409 });
  }
  const scope = await platform.bindProjectBilling(accessContext, projectId);
  if (scope.kind === 'rejected') return platformFailure(scope.error);
  const binding = existing ? existing.command.binding : adapter?.createBinding(scope.value);
  if (!binding) return json({ ok: false, code: 'operation_unsupported' }, { status: 409 });
  const command = ServiceProvisionCommandV1.parse({
    version: 1,
    operationId: body.value.operationId,
    instanceId: existing ? existing.instanceId : `instance_${serviceId}_${projectId}`,
    desiredRevision: body.value.desiredRevision,
    command: commandName,
    binding,
  });
  if (command.kind === 'rejected') return json({ ok: false, ...command.error }, { status: 400 });
  const requested = await platform.requestProvision(accessContext, {
    scope: scope.value,
    command: command.value,
  });
  if (requested.kind === 'rejected') return platformFailure(requested.error);
  if (adapter && context.waitUntil) {
    context.waitUntil(
      dispatchAccountServiceProvision({
        platform,
        adapter,
        operationId: command.value.operationId,
      }),
    );
  }
  return json({
    ok: true,
    operation: {
      operationId: command.value.operationId,
      instanceId: command.value.instanceId,
      desiredRevision: command.value.desiredRevision,
    },
    instance: requested.value,
  });
}

export async function handleAccountPlatformRoutes(
  context: AccountConsoleContext,
): Promise<Response | null> {
  const matched = context.pathname.match(
    /^\/console\/projects\/([^/]+)\/services(?:\/(wallet|satyr)\/(enable|disable|archive))?$/,
  );
  if (!matched) return null;
  const auth = await requireConsoleAuth(context);
  if (!auth.ok) return auth.response;
  const projectId = decodeURIComponent(matched[1]);
  if (!context.accountPlatform)
    return json({ ok: false, code: 'account_platform_unavailable' }, { status: 503 });
  if (context.method === 'GET' && !matched[2]) {
    const instances = await context.accountPlatform.listInstances(
      { orgId: auth.claims.orgId, actorUserId: auth.claims.userId },
      projectId,
    );
    return instances.kind === 'accepted'
      ? json({ ok: true, services: serviceCatalog(context), instances: instances.value })
      : platformFailure(instances.error);
  }
  if (
    context.method === 'POST' &&
    (matched[2] === 'wallet' || matched[2] === 'satyr') &&
    (matched[3] === 'enable' || matched[3] === 'disable' || matched[3] === 'archive')
  ) {
    return changeService(context, auth.claims, projectId, matched[2], matched[3]);
  }
  return json({ ok: false, code: 'method_not_allowed' }, { status: 405 });
}
