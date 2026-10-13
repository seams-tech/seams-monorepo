import type { ConsoleOrgProjectService } from '@seams-internal/console-server/orgProjectEnv';
import type {
  ConsoleWalletEnvironmentService,
  ConsoleWalletEnvironmentContext,
} from '../environments';
import type { ConsoleRuntimeSnapshotService } from '../runtimeSnapshots';
import type { ConsolePolicyService } from '../policies';
import { ensureTempoTestnetOnboardingPolicyForEnvironment } from './onboarding';
import type { ConsoleGasSponsorshipPolicyProjection } from './types';
import { resolveConsoleRuntimeSnapshotPayload } from '@seams-internal/wallet-console-server/router/runtimeSnapshotPayload';

function toSnapshotContext(ctx: ConsoleWalletEnvironmentContext) {
  return {
    orgId: ctx.orgId,
    actorUserId: ctx.actorUserId,
  };
}

async function publishCurrentEnvironmentSnapshot(input: {
  ctx: ConsoleWalletEnvironmentContext;
  environment: { id: string; projectId: string };
  runtimeSnapshots: ConsoleRuntimeSnapshotService;
  policies: ConsolePolicyService;
}): Promise<void> {
  const payload = await resolveConsoleRuntimeSnapshotPayload({
    orgId: input.ctx.orgId,
    actorUserId: input.ctx.actorUserId,
    environmentId: input.environment.id,
    projectId: input.environment.projectId,
    policies: input.policies,
  });
  await input.runtimeSnapshots.publishSnapshot(toSnapshotContext(input.ctx), {
    environmentId: input.environment.id,
    projectId: input.environment.projectId,
    payload,
  });
}

async function seedEnvironment(input: {
  ctx: ConsoleWalletEnvironmentContext;
  environment: { id: string; projectId: string; status?: string };
  policies: ConsolePolicyService;
  runtimeSnapshots: ConsoleRuntimeSnapshotService;
  faucetContractAddress: `0x${string}`;
}): Promise<ConsoleGasSponsorshipPolicyProjection> {
  const policy = await ensureTempoTestnetOnboardingPolicyForEnvironment({
    policies: input.policies,
    ctx: {
      orgId: input.ctx.orgId,
      actorUserId: input.ctx.actorUserId,
    },
    projectId: input.environment.projectId,
    environmentId: input.environment.id,
    contractAddress: input.faucetContractAddress,
  });
  await publishCurrentEnvironmentSnapshot({
    ctx: input.ctx,
    environment: input.environment,
    runtimeSnapshots: input.runtimeSnapshots,
    policies: input.policies,
  });
  return policy;
}

export function createConsoleWalletEnvironmentServiceWithTempoOnboardingSponsorship(input: {
  base: ConsoleWalletEnvironmentService;
  policies: ConsolePolicyService;
  runtimeSnapshots: ConsoleRuntimeSnapshotService;
  faucetContractAddress: `0x${string}`;
}): ConsoleWalletEnvironmentService {
  return {
    ...input.base,
    async provisionProjectEnvironments(ctx, request) {
      const environments = await input.base.provisionProjectEnvironments(ctx, request);
      for (const environment of environments) {
        if (environment.status === 'ARCHIVED') continue;
        await seedEnvironment({
          ctx,
          environment,
          policies: input.policies,
          runtimeSnapshots: input.runtimeSnapshots,
          faucetContractAddress: input.faucetContractAddress,
        });
      }
      return environments;
    },
    async createEnvironment(ctx, request) {
      const environment = await input.base.createEnvironment(ctx, request);
      await seedEnvironment({
        ctx,
        environment,
        policies: input.policies,
        runtimeSnapshots: input.runtimeSnapshots,
        faucetContractAddress: input.faucetContractAddress,
      });
      return environment;
    },
  };
}

export async function ensureTempoOnboardingSponsorshipForExistingEnvironments(input: {
  walletEnvironments: ConsoleWalletEnvironmentService;
  policies: ConsolePolicyService;
  runtimeSnapshots: ConsoleRuntimeSnapshotService;
  ctx: ConsoleWalletEnvironmentContext;
  faucetContractAddress: `0x${string}`;
  projectId?: string;
}): Promise<readonly ConsoleGasSponsorshipPolicyProjection[]> {
  const environments = await input.walletEnvironments.listEnvironments(input.ctx, {
    ...(input.projectId ? { projectId: input.projectId } : {}),
  });
  const policies: ConsoleGasSponsorshipPolicyProjection[] = [];
  for (const environment of environments) {
    if (environment.status === 'ARCHIVED') continue;
    policies.push(
      await seedEnvironment({
        ctx: input.ctx,
        environment,
        policies: input.policies,
        runtimeSnapshots: input.runtimeSnapshots,
        faucetContractAddress: input.faucetContractAddress,
      }),
    );
  }
  return policies;
}

export async function ensureTempoOnboardingSponsorshipForAllOrganizations(input: {
  orgProjectEnv: ConsoleOrgProjectService;
  walletEnvironments: ConsoleWalletEnvironmentService;
  policies: ConsolePolicyService;
  runtimeSnapshots: ConsoleRuntimeSnapshotService;
  faucetContractAddress: `0x${string}`;
  actorUserId?: string;
}): Promise<void> {
  const organizations = await input.orgProjectEnv.searchOrganizations({ query: '', limit: 1_000 });
  for (const organization of organizations) {
    await ensureTempoOnboardingSponsorshipForExistingEnvironments({
      walletEnvironments: input.walletEnvironments,
      policies: input.policies,
      runtimeSnapshots: input.runtimeSnapshots,
      ctx: {
        orgId: organization.id,
        actorUserId: String(input.actorUserId || 'tempo-onboarding-seed'),
      },
      faucetContractAddress: input.faucetContractAddress,
    });
  }
}
