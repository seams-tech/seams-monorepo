import type { D1DatabaseLike, D1Row } from '@seams/wallet-server/cloud-host';
import type { WalletRuntimeServiceBinding } from '@seams/wallet-server/cloud-host';
import type { TenantDeploymentBindingRevision } from '@seams-internal/wallet-console-shared/tenant-deployment';

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
  inspect(input: {
    readonly bindingRevision: TenantDeploymentBindingRevision;
    readonly source: TenantDeploymentRuntimeScopeV1 | null;
    readonly target: TenantDeploymentRuntimeScopeV1;
  }): Promise<TenantDeploymentRuntimeInspectionV1>;
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
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Wallet runtime returned invalid ${label}`);
  }
  return count;
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
         FROM registration_ceremony_records
        WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
          AND expires_at_ms > ?5`,
    )
    .bind(scope.namespace, scope.organizationId, scope.projectId, scope.environmentId, nowMs)
    .first<CountRow>();
  return parseCount(row?.count ?? 0, 'in-flight ceremony count');
}

export function createTenantDeploymentRuntimeInspectionHandlerV1(options: {
  readonly database: D1DatabaseLike;
  readonly now?: () => number;
}): (request: Request) => Promise<Response | null> {
  const now = options.now ?? (() => Date.now());
  return async function handleTenantDeploymentRuntimeInspection(
    request: Request,
  ): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname !== TENANT_DEPLOYMENT_RUNTIME_INSPECTION_PATH_V1) return null;
    if (url.origin !== WALLET_RUNTIME_INTERNAL_ORIGIN) return null;
    if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
    const input = parseRequest(await request.json().catch(() => null));
    if (!input) return json({ ok: false, code: 'invalid_body' }, 400);
    const [sourceDurableWalletCount, targetDurableWalletCount, inFlightCeremonyCount] =
      await Promise.all([
        input.source ? countWallets(options.database, input.source) : Promise.resolve(0),
        countWallets(options.database, input.target),
        countInFlightCeremonies(options.database, input.target, now()),
      ]);
    return json({
      kind: 'tenant_deployment_runtime_inspection_v1',
      acknowledgedBindingRevision: input.bindingRevision,
      sourceDurableWalletCount,
      targetDurableWalletCount,
      inFlightCeremonyCount,
    });
  };
}

export function createTenantDeploymentRuntimeInspectionClientV1(
  binding: WalletRuntimeServiceBinding,
): TenantDeploymentRuntimeInspectorV1 {
  return {
    async inspect(input) {
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
        },
      );
      const body = record(await response.json().catch(() => null));
      if (!response.ok || !body) {
        throw new Error(`Wallet runtime readiness inspection returned HTTP ${response.status}`);
      }
      const revision = requiredText(body.acknowledgedBindingRevision);
      if (
        body.kind !== 'tenant_deployment_runtime_inspection_v1' ||
        revision !== input.bindingRevision
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
