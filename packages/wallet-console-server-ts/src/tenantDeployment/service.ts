import type { TenantDeploymentBindingStoreV1 } from './types';

export type TenantDeploymentStoreErrorCodeV1 =
  | 'invalid_input'
  | 'invalid_record'
  | 'binding_conflict'
  | 'binding_not_found'
  | 'activation_conflict'
  | 'readiness_invalid'
  | 'cutover_conflict'
  | 'cutover_not_found';

export class TenantDeploymentStoreError extends Error {
  readonly code: TenantDeploymentStoreErrorCodeV1;
  readonly statusCode: 400 | 404 | 409 | 500;

  constructor(code: TenantDeploymentStoreErrorCodeV1, message: string) {
    super(message);
    this.name = 'TenantDeploymentStoreError';
    this.code = code;
    this.statusCode = tenantDeploymentStoreErrorStatus(code);
  }
}

function tenantDeploymentStoreErrorStatus(
  code: TenantDeploymentStoreErrorCodeV1,
): 400 | 404 | 409 | 500 {
  switch (code) {
    case 'invalid_input':
    case 'readiness_invalid':
      return 400;
    case 'binding_not_found':
    case 'cutover_not_found':
      return 404;
    case 'binding_conflict':
    case 'activation_conflict':
    case 'cutover_conflict':
      return 409;
    case 'invalid_record':
      return 500;
  }
}

export function isTenantDeploymentStoreError(error: unknown): error is TenantDeploymentStoreError {
  return error instanceof TenantDeploymentStoreError;
}

export type TenantDeploymentServiceV1 = TenantDeploymentBindingStoreV1;
