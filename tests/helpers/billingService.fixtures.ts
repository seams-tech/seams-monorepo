import {
  ServiceProvisionCommandV1,
  ServiceTenantBindingV1,
  parseServiceProvisionReceiptV1,
  type PlatformResult,
} from '../../packages/console-shared-ts/src/accountPlatform';
import type { ServiceProducerAuthorityV1 } from '../../packages/console-server-ts/src/accountPlatform/types';
import type { CloudflareD1AccountServiceBundle } from '../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
export function acceptedBillingResult<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}
export async function enableBillingService(
  core: CloudflareD1AccountServiceBundle,
  context: { readonly orgId: string; readonly actorUserId: string },
  projectId: string,
  authority: ServiceProducerAuthorityV1,
  namespace: string,
): Promise<string> {
  const scope = acceptedBillingResult(
    await core.accountPlatform.bindProjectBilling(context, projectId),
  );
  const instanceId = `${authority.serviceId}:${projectId}`;
  const nativeScope =
    authority.serviceId === 'wallet'
      ? {
          serviceId: 'wallet',
          deploymentId: authority.deploymentId,
          namespace,
          nativeOrganizationId: context.orgId,
          nativeProjectId: projectId,
        }
      : {
          serviceId: 'satyr',
          deploymentId: authority.deploymentId,
          nativeOrganizationId: `native:${projectId}`,
        };
  const binding = acceptedBillingResult(
    ServiceTenantBindingV1.parse({ instanceId, scope, nativeScope }),
  );
  const command = acceptedBillingResult(
    ServiceProvisionCommandV1.parse({
      version: 1,
      operationId: `enable:${instanceId}`,
      instanceId,
      desiredRevision: 1,
      command: 'enable',
      binding: {
        kind: 'attach_existing_scope',
        nativeScope,
        authorityEvidence: { sourceRecordId: `native:${instanceId}`, sourceDigest: 'a'.repeat(64) },
      },
    }),
  );
  acceptedBillingResult(await core.accountPlatform.requestProvision(context, { scope, command }));
  acceptedBillingResult(
    await core.accountPlatform.acknowledgeProvision(
      authority,
      acceptedBillingResult(
        parseServiceProvisionReceiptV1({
          version: 1,
          operationId: command.operationId,
          instanceId,
          desiredRevision: 1,
          result: 'active',
          binding,
        }),
      ),
    ),
  );
  return instanceId;
}
