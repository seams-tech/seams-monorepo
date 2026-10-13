import { ServiceProvisionCommandV1 } from '../../packages/console-shared-ts/src/accountPlatform';
import type { CloudflareD1AccountServiceBundle } from '../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { runAccountServiceProvisioning } from '../../packages/console-server-ts/src/accountPlatform/provisioning';
import type { OrganizationAccessContext } from '../../packages/console-server-ts/src/teamRbac/service';
import { WalletServiceProvisioningAdapter } from '../../packages/wallet-console-server-ts/src/accountPlatform/provisioning';
import type { ConsoleWalletEnvironmentService } from '../../packages/wallet-console-server-ts/src/environments/service';

/** Provision the same durable Wallet binding that the account API creates. */
export async function activateWalletProject(input: {
  readonly core: Pick<
    CloudflareD1AccountServiceBundle,
    'orgProjects' | 'billing' | 'accountPlatform'
  >;
  readonly walletEnvironments: ConsoleWalletEnvironmentService;
  readonly namespace: string;
  readonly deploymentId: string;
  readonly context: OrganizationAccessContext;
  readonly projectId: string;
}): Promise<void> {
  const adapter = new WalletServiceProvisioningAdapter({
    deploymentId: input.deploymentId,
    namespace: input.namespace,
    environments: input.walletEnvironments,
    orgProjects: input.core.orgProjects,
    billing: input.core.billing,
  });
  const scope = await input.core.accountPlatform.bindProjectBilling(input.context, input.projectId);
  if (scope.kind === 'rejected') throw new Error('Fixture project has no billing scope');
  const command = ServiceProvisionCommandV1.parse({
    version: 1,
    instanceId: `wallet:${input.projectId}`,
    operationId: `enable-wallet:${input.projectId}`,
    desiredRevision: 1,
    command: 'enable',
    binding: adapter.createBinding(scope.value),
  });
  if (command.kind === 'rejected') throw new Error('Fixture Wallet command is invalid');
  const requested = await input.core.accountPlatform.requestProvision(input.context, {
    scope: scope.value,
    command: command.value,
  });
  if (requested.kind === 'rejected') throw new Error('Fixture Wallet activation was rejected');
  const delivered = await runAccountServiceProvisioning({
    platform: input.core.accountPlatform,
    adapter,
    limit: 1,
  });
  if (delivered.delivered !== 1) throw new Error('Fixture Wallet activation did not finish');
}
