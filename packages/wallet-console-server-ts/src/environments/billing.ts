import { getBillingLiveEnvironmentReadiness } from '@seams-internal/wallet-console-server/environments/readiness';
import type { ConsoleBillingService } from '@seams-internal/console-server/billing/service';
import type { ConsoleWalletEnvironmentContext, ConsoleWalletEnvironmentService } from './service';
import type { ConsoleWalletEnvironment } from './types';

export async function provisionWalletProjectEnvironments(input: {
  environments: ConsoleWalletEnvironmentService;
  billing: ConsoleBillingService;
  context: ConsoleWalletEnvironmentContext;
  projectId: string;
}): Promise<ConsoleWalletEnvironment[]> {
  const readiness = await getBillingLiveEnvironmentReadiness(input.billing, input.context);
  return input.environments.provisionProjectEnvironments(input.context, {
    projectId: input.projectId,
    liveAccess: readiness.canUseLiveEnvironments ? 'enabled' : 'disabled',
  });
}
