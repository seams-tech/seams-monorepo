import {
  createCloudflareD1RouterAbNormalSigningAdmissionStore,
  queryD1One,
  type D1DatabaseLike,
} from '@seams/wallet-server/cloud-host';
import type { TenantDeploymentD1ResourceIdentityV1 } from './deploymentResource';
import { D1RegionalDeploymentAdmission } from './regionalAdmission';
import { parseTenantRuntimeWriterV1 } from './resourceVerification';
import type { TenantDeploymentServiceBindingV1 } from './runtimeBinding';
import type { WalletRegion } from '../walletPlacement/home';

const ADMISSION_ORIGIN = 'https://wallet-runtime.internal';
const ADMISSION_PATH = '/internal/tenant-deployment/v1/production-admission';
const REGIONS = ['US', 'WEUR', 'APAC', 'OC'] as const;
const REPUSH_AFTER_MS = 3_600_000;

/** Whether a production lane admits new sign-ups and signatures. */
export type ProductionNewWork = 'open' | 'paused';

export interface ProductionAdmission {
  readonly newWork: ProductionNewWork;
  readonly revision: number;
}

function parseAdmission(raw: unknown): ProductionAdmission | null {
  if (!raw || typeof raw !== 'object' || !('newWork' in raw) || !('revision' in raw)) return null;
  const { newWork, revision } = raw;
  if (newWork !== 'open' && newWork !== 'paused') return null;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0) return null;
  return { newWork, revision };
}

/** A paused lane tells the client to retry signing no sooner than this. */
const PAUSED_RETRY_AFTER_MS = 3_600_000;

/**
 * Installs the Console's decision as the production project's signing policy. The
 * existing normal-signing admission reads that policy in its single credential query and
 * refuses with `project_policy_rejected`; recovery and key export do not read it. A
 * development lane never pauses. This endpoint is exposed only by Wallet Runtime's
 * private service binding.
 */
export async function handleRegionalProductionAdmission(
  request: Request,
  input: {
    readonly database: D1DatabaseLike;
    readonly resource: TenantDeploymentD1ResourceIdentityV1;
    readonly versionId: unknown;
    readonly deploymentLane: string;
  },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ADMISSION_PATH) return null;
  if (url.origin !== ADMISSION_ORIGIN) return new Response(null, { status: 404 });
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const raw: unknown = await request.json().catch(() => null);
  const admission = parseAdmission(raw);
  const lane =
    raw && typeof raw === 'object' && 'deploymentLane' in raw ? raw.deploymentLane : null;
  if (!admission || lane !== input.deploymentLane) {
    return Response.json({ ok: false }, { status: 400 });
  }
  const writer = parseTenantRuntimeWriterV1('walletRuntime', input.versionId, {
    accountId: input.resource.accountId,
    databaseId: input.resource.databaseId,
  });
  const binding = await new D1RegionalDeploymentAdmission(
    input.database,
    input.resource,
  ).resolveRuntimeBinding(input.deploymentLane, writer);
  if (!binding) return Response.json({ ok: false }, { status: 503 });
  if (binding.mode.environment !== 'production') {
    return Response.json({ ok: true, newWork: 'open', revision: admission.revision });
  }
  const store = createCloudflareD1RouterAbNormalSigningAdmissionStore({
    database: input.database,
    storageNamespace: input.resource.namespace,
    now: () => admission.revision,
  });
  // The signing runtime policy scope names the environment by its key, as registration does.
  const scope = {
    orgId: binding.tenant.organizationId,
    projectId: binding.tenant.projectId,
    envId: 'prod',
    signingRootVersion: binding.tenantRoot.signingRootVersion,
  };
  await store.setProjectPolicy(
    scope,
    admission.newWork === 'paused'
      ? { kind: 'rejected', retryAfterMs: PAUSED_RETRY_AFTER_MS }
      : { kind: 'allowed' },
  );
  return Response.json({ ok: true, ...admission });
}

/**
 * The decision for the lane's active binding: a production environment whose
 * organization's Free plan state is not active pauses new work. Development never pauses.
 */
export async function readLaneProductionAdmission(
  database: D1DatabaseLike,
  deploymentLane: string,
): Promise<
  ProductionAdmission & {
    readonly pushed: ProductionAdmission | null;
    readonly pushedAtMs: number;
  }
> {
  const row = await queryD1One(
    database,
    `SELECT binding.environment_id, plan.production_state, plan.production_state_changed_at_ms,
        pushed.new_work AS pushed_new_work, pushed.revision AS pushed_revision,
        pushed.pushed_at_ms
     FROM active_tenant_deployment_bindings active
     JOIN tenant_deployment_bindings binding
       ON binding.deployment_lane = active.deployment_lane AND binding.revision = active.revision
     LEFT JOIN billing_account_plans plan
       ON plan.namespace = binding.namespace AND plan.org_id = binding.org_id
     LEFT JOIN regional_production_admission_pushes pushed
       ON pushed.deployment_lane = active.deployment_lane
     WHERE active.deployment_lane = ?1`,
    [deploymentLane],
  );
  const pushed =
    row?.pushed_new_work == null
      ? null
      : parseAdmission({ newWork: row.pushed_new_work, revision: row.pushed_revision });
  const production =
    typeof row?.environment_id === 'string' && row.environment_id.endsWith(':prod');
  const paused =
    production &&
    (row?.production_state === 'card_required' || row?.production_state === 'free_limit_reached');
  const changedAtMs = Number(row?.production_state_changed_at_ms);
  return {
    newWork: paused ? 'paused' : 'open',
    revision: Number.isSafeInteger(changedAtMs) && changedAtMs > 0 ? changedAtMs : 1,
    pushed,
    pushedAtMs: Number(row?.pushed_at_ms) || 0,
  };
}

/**
 * Pushes the lane's decision to every regional runtime when it differs from the last
 * push. Each push is retryable; the Console records a push only after all regions accept it.
 */
export async function syncRegionalProductionAdmission(input: {
  readonly database: D1DatabaseLike;
  readonly deploymentLane: string;
  readonly runtimes: Readonly<Record<WalletRegion, TenantDeploymentServiceBindingV1>>;
  readonly nowMs: number;
}): Promise<'unchanged' | 'pushed'> {
  const decision = await readLaneProductionAdmission(input.database, input.deploymentLane);
  // A periodic re-push repairs a runtime that an overlapping, older push overwrote.
  if (
    decision.pushed &&
    decision.pushed.newWork === decision.newWork &&
    decision.pushed.revision === decision.revision &&
    input.nowMs - decision.pushedAtMs < REPUSH_AFTER_MS
  ) {
    return 'unchanged';
  }
  for (const region of REGIONS) {
    const response = await input.runtimes[region].fetch(
      new Request(`${ADMISSION_ORIGIN}${ADMISSION_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deploymentLane: input.deploymentLane,
          newWork: decision.newWork,
          revision: decision.revision,
        }),
      }),
    );
    const stored = parseAdmission(await response.json().catch(() => null));
    if (!response.ok || !stored || stored.revision !== decision.revision) {
      throw new Error(`Regional production admission push failed for ${region}`);
    }
  }
  await input.database
    .prepare(
      `INSERT INTO regional_production_admission_pushes
        (deployment_lane, new_work, revision, pushed_at_ms)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(deployment_lane) DO UPDATE SET new_work = excluded.new_work,
         revision = excluded.revision, pushed_at_ms = excluded.pushed_at_ms`,
    )
    .bind(input.deploymentLane, decision.newWork, decision.revision, input.nowMs)
    .run();
  return 'pushed';
}
