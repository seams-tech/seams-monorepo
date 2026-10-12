import type { D1DatabaseLike, D1Row } from '@seams/wallet-server/cloud-host';
import type { WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import {
  decodeTenantDeploymentD1ResourcesV1,
  type TenantDeploymentD1ResourcesV1,
  type TenantDeploymentBindingRevision,
} from '@seams-internal/wallet-console-shared/tenant-deployment';
import { TenantDeploymentD1ResourceIdentityV1 } from './deploymentResource';

const WALLET_RUNTIME_INTERNAL_ORIGIN = 'https://wallet-runtime.internal';
export const TENANT_DEPLOYMENT_RUNTIME_INSPECTION_PATH_V1 =
  '/internal/wallet-runtime/v1/tenant-deployment/readiness';

export type TenantDeploymentRuntimeScopeV1 = {
  readonly namespace: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly environmentId: string;
};

export type TenantDeploymentRuntimeInspectionV1 = {
  readonly acknowledgedBindingRevision: TenantDeploymentBindingRevision;
  readonly sourceDurableWalletCount: number;
  readonly targetDurableWalletCount: number;
  readonly inFlightCeremonyCount: number;
};

export interface TenantDeploymentRuntimeInspectorV1 {
  readonly resources: TenantDeploymentD1ResourcesV1;
  inspect(input: {
    readonly bindingRevision: TenantDeploymentBindingRevision;
    readonly source: TenantDeploymentRuntimeScopeV1 | null;
    readonly target: TenantDeploymentRuntimeScopeV1;
  }): Promise<TenantDeploymentRuntimeInspectionV1>;
}

export function createD1TenantDeploymentRuntimeInspectorV1(options: {
  readonly database: D1DatabaseLike;
  readonly resource: TenantDeploymentD1ResourceIdentityV1;
  readonly now?: () => number;
}): TenantDeploymentRuntimeInspectorV1 {
  const now = options.now ?? Date.now;
  return {
    resources: [{ accountId: options.resource.accountId, databaseId: options.resource.databaseId }],
    async inspect(input) {
      assertNamespace(options.resource, input);
      const [sourceDurableWalletCount, targetDurableWalletCount, inFlightCeremonyCount] =
        await Promise.all([
          input.source ? countWallets(options.database, input.source) : Promise.resolve(0),
          countWallets(options.database, input.target),
          countInFlightCeremonies(options.database, input.target, now()),
        ]);
      return {
        acknowledgedBindingRevision: input.bindingRevision,
        sourceDurableWalletCount,
        targetDurableWalletCount,
        inFlightCeremonyCount,
      };
    },
  };
}

function assertNamespace(
  resource: TenantDeploymentD1ResourceIdentityV1,
  input: Parameters<TenantDeploymentRuntimeInspectorV1['inspect']>[0],
): void {
  if (
    input.target.namespace !== resource.namespace ||
    (input.source !== null && input.source.namespace !== resource.namespace)
  ) {
    throw new Error('Readiness scope belongs to another namespace');
  }
}

export function combineTenantDeploymentRuntimeInspectorsV1(
  inspectors: readonly [
    TenantDeploymentRuntimeInspectorV1,
    ...TenantDeploymentRuntimeInspectorV1[],
  ],
): TenantDeploymentRuntimeInspectorV1 {
  const runtimes = [...inspectors];
  const rawResources = [];
  for (const inspector of runtimes) rawResources.push(...inspector.resources);
  const resources = decodeTenantDeploymentD1ResourcesV1(rawResources);
  if (!resources.ok) throw new Error(resources.message);
  return {
    resources: resources.value,
    async inspect(input) {
      const pending = [];
      for (const inspector of runtimes) pending.push(inspector.inspect(input));
      const inspections = await Promise.all(pending);
      let sourceDurableWalletCount = 0;
      let targetDurableWalletCount = 0;
      let inFlightCeremonyCount = 0;
      for (const inspection of inspections) {
        if (inspection.acknowledgedBindingRevision !== input.bindingRevision) {
          throw new Error('Regional runtime acknowledged another deployment binding');
        }
        sourceDurableWalletCount += inspection.sourceDurableWalletCount;
        targetDurableWalletCount += inspection.targetDurableWalletCount;
        inFlightCeremonyCount += inspection.inFlightCeremonyCount;
      }
      return {
        acknowledgedBindingRevision: input.bindingRevision,
        sourceDurableWalletCount: parseCount(
          sourceDurableWalletCount,
          'regional source wallet count',
        ),
        targetDurableWalletCount: parseCount(
          targetDurableWalletCount,
          'regional target wallet count',
        ),
        inFlightCeremonyCount: parseCount(inFlightCeremonyCount, 'regional ceremony count'),
      };
    },
  };
}

type CountRow = D1Row & { readonly count?: unknown };

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((entry, index) => entry === sortedExpected[index])
  );
}

function requiredText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.trim() === value ? value : null;
}

function parseScope(value: unknown): TenantDeploymentRuntimeScopeV1 | null {
  const input = record(value);
  if (!input || !exactKeys(input, ['namespace', 'organizationId', 'projectId', 'environmentId'])) {
    return null;
  }
  const namespace = requiredText(input.namespace);
  const organizationId = requiredText(input.organizationId);
  const projectId = requiredText(input.projectId);
  const environmentId = requiredText(input.environmentId);
  return namespace && organizationId && projectId && environmentId
    ? { namespace, organizationId, projectId, environmentId }
    : null;
}

function parseRequest(value: unknown): {
  readonly bindingRevision: TenantDeploymentBindingRevision;
  readonly source: TenantDeploymentRuntimeScopeV1 | null;
  readonly target: TenantDeploymentRuntimeScopeV1;
} | null {
  const input = record(value);
  if (!input || !exactKeys(input, ['kind', 'bindingRevision', 'source', 'target'])) return null;
  const bindingRevision = requiredText(input.bindingRevision);
  const target = parseScope(input.target);
  const source = input.source === null ? null : parseScope(input.source);
  if (
    input.kind !== 'tenant_deployment_runtime_inspection_request_v1' ||
    !bindingRevision?.startsWith('tdb_') ||
    !target ||
    (input.source !== null && !source)
  ) {
    return null;
  }
  return {
    bindingRevision: `tdb_${bindingRevision.slice(4)}`,
    source,
    target,
  };
}

function parseCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Wallet runtime returned invalid ${label}`);
  }
  return value;
}

async function countWallets(
  database: D1DatabaseLike,
  scope: TenantDeploymentRuntimeScopeV1,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS count
         FROM wallets
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4`,
    )
    .bind(scope.namespace, scope.organizationId, scope.projectId, scope.environmentId)
    .first<CountRow>();
  return parseCount(row?.count ?? 0, 'durable wallet count');
}

async function countInFlightCeremonies(
  database: D1DatabaseLike,
  scope: TenantDeploymentRuntimeScopeV1,
  nowMs: number,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS count
         FROM registration_ceremony_records AS ceremony
        WHERE ceremony.namespace = ?1 AND ceremony.org_id = ?2
          AND ceremony.project_id = ?3 AND ceremony.env_id = ?4
          AND ceremony.expires_at_ms > ?5
          AND NOT EXISTS (
            SELECT 1 FROM wallet_execution_generations AS execution
             WHERE execution.namespace = ceremony.namespace
               AND execution.org_id = ceremony.org_id
               AND execution.project_id = ceremony.project_id
               AND execution.env_id = ceremony.env_id
               AND execution.origin = 'registration'
               AND execution.origin_id = json_extract(ceremony.record_json, '$.registrationCeremonyId')
               AND execution.registration_completion IN ('established', 'cancelled')
          )`,
    )
    .bind(scope.namespace, scope.organizationId, scope.projectId, scope.environmentId, nowMs)
    .first<CountRow>();
  return parseCount(row?.count ?? 0, 'in-flight ceremony count');
}

export function createTenantDeploymentRuntimeInspectionHandlerV1(options: {
  readonly database: D1DatabaseLike;
  readonly resource: TenantDeploymentD1ResourceIdentityV1;
  readonly now?: () => number;
}): (request: Request) => Promise<Response | null> {
  const inspector = createD1TenantDeploymentRuntimeInspectorV1(options);
  return async function handleTenantDeploymentRuntimeInspection(
    request: Request,
  ): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname !== TENANT_DEPLOYMENT_RUNTIME_INSPECTION_PATH_V1) return null;
    if (url.origin !== WALLET_RUNTIME_INTERNAL_ORIGIN) return null;
    if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
    const input = parseRequest(await request.json().catch(() => null));
    if (!input) return json({ ok: false, code: 'invalid_body' }, 400);
    if (
      input.target.namespace !== options.resource.namespace ||
      (input.source !== null && input.source.namespace !== options.resource.namespace)
    ) {
      return json({ ok: false, code: 'namespace_mismatch' }, 409);
    }
    const inspection = await inspector.inspect(input);
    return json({
      kind: 'tenant_deployment_runtime_inspection_v1',
      resource: options.resource,
      ...inspection,
    });
  };
}

export function createTenantDeploymentRuntimeInspectionClientV1(
  binding: WalletRuntimeServiceBinding,
  resource: TenantDeploymentD1ResourceIdentityV1,
): TenantDeploymentRuntimeInspectorV1 {
  return {
    resources: [{ accountId: resource.accountId, databaseId: resource.databaseId }],
    async inspect(input) {
      assertNamespace(resource, input);
      const response = await binding.fetch(
        `${WALLET_RUNTIME_INTERNAL_ORIGIN}${TENANT_DEPLOYMENT_RUNTIME_INSPECTION_PATH_V1}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'tenant_deployment_runtime_inspection_request_v1',
            bindingRevision: input.bindingRevision,
            source: input.source,
            target: input.target,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const body = record(await response.json().catch(() => null));
      if (!response.ok || !body) {
        throw new Error(`Wallet runtime readiness inspection returned HTTP ${response.status}`);
      }
      const revision = requiredText(body.acknowledgedBindingRevision);
      if (
        body.kind !== 'tenant_deployment_runtime_inspection_v1' ||
        revision !== input.bindingRevision ||
        !resource.matches(TenantDeploymentD1ResourceIdentityV1.parse(body.resource))
      ) {
        throw new Error('Wallet runtime returned an invalid readiness inspection');
      }
      return {
        acknowledgedBindingRevision: input.bindingRevision,
        sourceDurableWalletCount: parseCount(
          body.sourceDurableWalletCount,
          'source durable wallet count',
        ),
        targetDurableWalletCount: parseCount(
          body.targetDurableWalletCount,
          'target durable wallet count',
        ),
        inFlightCeremonyCount: parseCount(body.inFlightCeremonyCount, 'in-flight ceremony count'),
      };
    },
  };
}
