import {
  ServiceProvisionCommandV1,
  ServiceTenantBindingV1,
  readSatyrInstanceReleaseRequestV1,
  type SatyrInstanceReleaseRequestV1,
  type SatyrInstanceReleaseV1,
} from '@seams-internal/console-shared/accountPlatform';
import type { CloudflareD1AccountServiceBundle } from '../router/cloudflare/d1AccountServices';
import {
  dispatchAccountServiceProvision,
  type AccountServiceProvisioningAdapterV1,
} from './provisioning';
import type { AccountServiceInstanceV1 } from './types';

function accepted(value: SatyrInstanceReleaseV1): Response {
  return Response.json({ kind: 'accepted', value }, { headers: { 'Cache-Control': 'no-store' } });
}

function rejected(code: string, status: number): Response {
  return Response.json(
    { kind: 'rejected', error: { code } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** The native binding that the instance holds, once Satyr has confirmed one. */
function boundBinding(instance: AccountServiceInstanceV1): ServiceTenantBindingV1 | null {
  const state = instance.state;
  switch (state.kind) {
    case 'active':
    case 'archived':
      return state.binding;
    case 'disabled':
      if (state.shutdown.kind === 'confirmed') return state.shutdown.receipt.binding;
      return state.target instanceof ServiceTenantBindingV1 ? state.target : null;
    case 'failed':
      return state.target instanceof ServiceTenantBindingV1 ? state.target : null;
    case 'provisioning':
      return null;
  }
}

/**
 * Called only by the private Satyr binding after Satyr deleted an organisation
 * for good. Each call moves the instance one step through the ordinary signed
 * commands: active to disabled, then disabled to archived. Satyr confirms each
 * command with its receipt, and reports again until the answer is `released`.
 */
export class SatyrInstanceRelease {
  constructor(
    private readonly services: CloudflareD1AccountServiceBundle,
    private readonly provisioning: AccountServiceProvisioningAdapterV1,
    private readonly waitUntil: (work: Promise<unknown>) => void,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return rejected('method_not_allowed', 405);
    let input: SatyrInstanceReleaseRequestV1;
    try {
      const text = await request.text();
      if (text.length > 4_096) return rejected('invalid_body', 400);
      input = readSatyrInstanceReleaseRequestV1(JSON.parse(text));
    } catch {
      return rejected('invalid_body', 400);
    }
    try {
      return await this.release(input);
    } catch {
      return rejected('authority_unavailable', 503);
    }
  }

  private async release(input: SatyrInstanceReleaseRequestV1): Promise<Response> {
    const authority = this.provisioning.authority;
    if (authority.serviceId !== 'satyr') return rejected('scope_forbidden', 403);
    const platform = this.services.accountPlatform;
    const found = await platform.resolveServiceProducerInstance(authority, input.instanceId);
    if (found.kind === 'rejected') return rejected('instance_ineligible', 404);
    const instance = found.value;
    const binding = boundBinding(instance);
    if (
      binding === null ||
      binding.nativeScope.serviceId !== 'satyr' ||
      binding.nativeScope.nativeOrganizationId !== input.nativeOrganizationId
    )
      return rejected('scope_forbidden', 403);
    const state = instance.state;
    let command: 'disable' | 'archive';
    switch (state.kind) {
      case 'archived':
        return accepted({ state: 'released' });
      case 'active':
        command = 'disable';
        break;
      case 'disabled':
        if (state.shutdown.kind === 'pending') {
          this.dispatch(state.operationId);
          return accepted({ state: 'releasing' });
        }
        command = 'archive';
        break;
      case 'failed':
        if (state.command === 'enable') return rejected('operation_conflict', 409);
        command = state.command;
        break;
      case 'provisioning':
        return rejected('operation_conflict', 409);
    }
    const actorUserId = await platform.releaseActor(authority, instance.instanceId);
    if (actorUserId === null) return rejected('scope_forbidden', 403);
    const desiredRevision = state.desiredRevision + 1;
    const parsed = ServiceProvisionCommandV1.parse({
      version: 1,
      operationId: `satyr_release:${instance.instanceId}:${desiredRevision}`,
      instanceId: instance.instanceId,
      desiredRevision,
      command,
      binding,
    });
    if (parsed.kind === 'rejected') return rejected('invalid_body', 400);
    const requested = await platform.requestProvision(
      { orgId: instance.scope.organizationId, actorUserId },
      { scope: instance.scope, command: parsed.value },
    );
    if (requested.kind === 'rejected')
      return requested.error.code === 'scope_forbidden'
        ? rejected('scope_forbidden', 403)
        : rejected('operation_conflict', 409);
    this.dispatch(parsed.value.operationId);
    return accepted({ state: 'releasing' });
  }

  private dispatch(operationId: string): void {
    this.waitUntil(
      dispatchAccountServiceProvision({
        platform: this.services.accountPlatform,
        adapter: this.provisioning,
        operationId,
      }),
    );
  }
}
