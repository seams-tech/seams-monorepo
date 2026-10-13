import type {
  PlatformScopeV1,
  ServiceBindingRequestV1,
} from '@seams-internal/console-shared/accountPlatform';
import type { D1AccountPlatformService } from './d1';
import type { ServiceProvisionAdapterV1, ServiceProvisionDeliveryV1 } from './types';

export interface AccountServiceProvisioningAdapterV1 extends ServiceProvisionAdapterV1 {
  readonly consoleHref: string;
  createBinding(scope: PlatformScopeV1): ServiceBindingRequestV1;
}

export interface ProvisioningDispatchReportV1 {
  readonly delivered: number;
  readonly failed: number;
  readonly pending: number;
}

async function deliverProvisioning(
  platform: D1AccountPlatformService,
  adapter: AccountServiceProvisioningAdapterV1,
  delivery: ServiceProvisionDeliveryV1,
): Promise<'delivered' | 'failed' | 'pending'> {
  let result;
  try {
    result = await adapter.provision(delivery);
  } catch {
    await platform.deferProvision(adapter.authority, delivery.command.operationId);
    return 'pending';
  }
  if (result.kind === 'accepted') {
    const acknowledgement = await platform.acknowledgeProvision(adapter.authority, result.value);
    if (acknowledgement.kind === 'accepted') return 'delivered';
    await platform.deferProvision(adapter.authority, delivery.command.operationId);
    return 'pending';
  }
  if (result.error.code === 'unavailable') {
    await platform.deferProvision(adapter.authority, delivery.command.operationId);
    return 'pending';
  }
  const failure = await platform.failProvision(adapter.authority, {
    operationId: delivery.command.operationId,
    failureCode: result.error.code,
  });
  if (failure.kind === 'accepted') return 'failed';
  await platform.deferProvision(adapter.authority, delivery.command.operationId);
  return 'pending';
}

/** Each command remains durable until its matching acknowledgement or failure is recorded. */
export async function runAccountServiceProvisioning(input: {
  readonly platform: D1AccountPlatformService;
  readonly adapter: AccountServiceProvisioningAdapterV1;
  readonly limit: number;
}): Promise<ProvisioningDispatchReportV1> {
  const deliveries = await input.platform.pendingProvision(input.adapter.authority, input.limit);
  let delivered = 0;
  let failed = 0;
  let pending = 0;
  for (const delivery of deliveries) {
    const outcome = await deliverProvisioning(input.platform, input.adapter, delivery);
    switch (outcome) {
      case 'delivered':
        delivered += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      case 'pending':
        pending += 1;
        break;
    }
  }
  return { delivered, failed, pending };
}

export async function dispatchAccountServiceProvision(input: {
  readonly platform: D1AccountPlatformService;
  readonly adapter: AccountServiceProvisioningAdapterV1;
  readonly operationId: string;
}): Promise<void> {
  const delivery = await input.platform.pendingProvisionOperation(
    input.adapter.authority,
    input.operationId,
  );
  if (delivery) await deliverProvisioning(input.platform, input.adapter, delivery);
}
