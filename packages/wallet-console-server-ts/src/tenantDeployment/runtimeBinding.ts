import { decodeTenantDeploymentBindingV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';
import type { TenantDeploymentBindingV1 } from './types';
import type { TenantDeploymentBindingReaderV1 } from './types';
import { TenantDeploymentStoreError } from './service';

export const TENANT_DEPLOYMENT_INTERNAL_ORIGIN_V1 = 'https://tenant-deployment.internal';
export const TENANT_DEPLOYMENT_INTERNAL_ACTIVE_PATH_V1 = '/internal/tenant-deployment/v1/active';
export const TENANT_DEPLOYMENT_INTERNAL_SETUP_ADMISSION_PATH_V1 =
  '/internal/tenant-deployment/v1/setup-admission';

export interface TenantDeploymentSetupAdmissionReaderV1 {
  isSetupQuiesced(deploymentLane: string): Promise<boolean>;
}

export interface TenantDeploymentServiceBindingV1 {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export type TenantDeploymentRuntimeEnvironmentV1 = Readonly<Record<string, unknown>> & {
  readonly WALLET_CONSOLE: TenantDeploymentServiceBindingV1;
  readonly SEAMS_TENANT_DEPLOYMENT_LANE: string;
};

export type BoundTenantDeploymentRuntimeEnvironmentV1<
  TEnvironment extends TenantDeploymentRuntimeEnvironmentV1,
> = TEnvironment & {
  readonly SEAMS_TENANT_STORAGE_NAMESPACE: string;
  readonly SEAMS_STAGING_ORG_ID: string;
  readonly SEAMS_STAGING_PROJECT_ID: string;
  readonly SEAMS_STAGING_ENV_ID: string;
};

function requiredDeploymentLane(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new TenantDeploymentStoreError('invalid_input', 'deployment lane is invalid');
  }
  return value;
}

function internalActiveBindingRequest(): Request {
  return new Request(
    `${TENANT_DEPLOYMENT_INTERNAL_ORIGIN_V1}${TENANT_DEPLOYMENT_INTERNAL_ACTIVE_PATH_V1}`,
    { headers: { Accept: 'application/json' } },
  );
}

export function createTenantDeploymentInternalBindingHandlerV1(options: {
  readonly deploymentLane: string;
  readonly reader: TenantDeploymentBindingReaderV1;
  readonly setupAdmission: TenantDeploymentSetupAdmissionReaderV1;
}): (request: Request) => Promise<Response | null> {
  const deploymentLane = requiredDeploymentLane(options.deploymentLane);
  return async function tenantDeploymentInternalBindingHandler(
    request: Request,
  ): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.origin !== TENANT_DEPLOYMENT_INTERNAL_ORIGIN_V1) return null;
    if (
      url.pathname !== TENANT_DEPLOYMENT_INTERNAL_ACTIVE_PATH_V1 &&
      url.pathname !== TENANT_DEPLOYMENT_INTERNAL_SETUP_ADMISSION_PATH_V1
    )
      return null;
    if (request.method !== 'GET') {
      return new Response(null, {
        status: 405,
        headers: { Allow: 'GET', 'Cache-Control': 'no-store' },
      });
    }
    if (url.pathname === TENANT_DEPLOYMENT_INTERNAL_SETUP_ADMISSION_PATH_V1) {
      const quiesced = await options.setupAdmission.isSetupQuiesced(deploymentLane);
      return Response.json(
        {
          kind: 'tenant_deployment_setup_admission_v1',
          allowed: !quiesced,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const binding = await options.reader.resolveActiveBinding(deploymentLane);
    if (!binding) {
      return Response.json(
        { ok: false, code: 'tenant_deployment_unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return Response.json(binding, { headers: { 'Cache-Control': 'no-store' } });
  };
}

export async function resolveTenantDeploymentSetupAdmissionFromServiceV1(input: {
  readonly deploymentLane: string;
  readonly service: TenantDeploymentServiceBindingV1;
}): Promise<boolean> {
  requiredDeploymentLane(input.deploymentLane);
  const response = await input.service.fetch(
    new Request(
      `${TENANT_DEPLOYMENT_INTERNAL_ORIGIN_V1}${TENANT_DEPLOYMENT_INTERNAL_SETUP_ADMISSION_PATH_V1}`,
      { headers: { Accept: 'application/json' } },
    ),
  );
  const body: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !('kind' in body) ||
    body.kind !== 'tenant_deployment_setup_admission_v1' ||
    !('allowed' in body) ||
    typeof body.allowed !== 'boolean'
  ) {
    throw new TenantDeploymentStoreError(
      'invalid_record',
      'tenant deployment setup admission service returned an invalid response',
    );
  }
  return body.allowed;
}

export async function resolveActiveTenantDeploymentFromServiceV1(input: {
  readonly deploymentLane: string;
  readonly service: TenantDeploymentServiceBindingV1;
}): Promise<TenantDeploymentBindingV1 | null> {
  const deploymentLane = requiredDeploymentLane(input.deploymentLane);
  const response = await input.service.fetch(internalActiveBindingRequest());
  if (response.status === 503) {
    const body: unknown = await response.json().catch(() => null);
    if (
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      'code' in body &&
      body.code === 'tenant_deployment_unavailable'
    ) {
      return null;
    }
    throw new TenantDeploymentStoreError(
      'invalid_record',
      'active tenant deployment service returned an invalid unavailable response',
    );
  }
  if (!response.ok) {
    throw new TenantDeploymentStoreError(
      'invalid_record',
      `active tenant deployment lookup failed with HTTP ${response.status}`,
    );
  }
  const decoded = await decodeTenantDeploymentBindingV1(await response.json());
  if (!decoded.ok || decoded.value.deploymentLane !== deploymentLane) {
    throw new TenantDeploymentStoreError(
      'invalid_record',
      'active tenant deployment lookup returned an invalid binding',
    );
  }
  return decoded.value;
}

export function bindTenantDeploymentToRuntimeEnvironmentV1<
  TEnvironment extends TenantDeploymentRuntimeEnvironmentV1,
>(
  env: TEnvironment,
  binding: TenantDeploymentBindingV1,
): BoundTenantDeploymentRuntimeEnvironmentV1<TEnvironment> {
  if (binding.deploymentLane !== env.SEAMS_TENANT_DEPLOYMENT_LANE) {
    throw new TenantDeploymentStoreError(
      'invalid_record',
      'active tenant deployment belongs to another lane',
    );
  }
  return {
    ...env,
    SEAMS_TENANT_STORAGE_NAMESPACE: binding.tenant.namespace,
    // @seams/wallet-server consumes these names at its request boundary.
    SEAMS_STAGING_ORG_ID: binding.tenant.organizationId,
    SEAMS_STAGING_PROJECT_ID: binding.tenant.projectId,
    SEAMS_STAGING_ENV_ID: binding.tenant.environmentId,
  };
}

export async function resolveBoundTenantDeploymentRuntimeEnvironmentV1<
  TEnvironment extends TenantDeploymentRuntimeEnvironmentV1,
>(env: TEnvironment): Promise<BoundTenantDeploymentRuntimeEnvironmentV1<TEnvironment> | null> {
  const binding = await resolveActiveTenantDeploymentFromServiceV1({
    deploymentLane: env.SEAMS_TENANT_DEPLOYMENT_LANE,
    service: env.WALLET_CONSOLE,
  });
  return binding ? bindTenantDeploymentToRuntimeEnvironmentV1(env, binding) : null;
}
