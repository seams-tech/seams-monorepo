import { canDownloadRecoveryArtifact, type RecoveryDownloadHolders } from './custodyService';
import { TenantRootSecurityStateUnavailableError } from './stateReader';
import type {
  TenantRootIdentityV1,
  TenantRootRecoveryGovernanceV1,
  TenantRootSecurityStatusV1,
} from '@seams-internal/wallet-console-shared/tenant-root';

import {
  guardTenantRootSecurityRequestV1,
  tenantRootSecurityJson,
  type TenantRootSecurityGuardDependenciesV1,
} from './routeGuard';
import type { TenantRootOperationStoreV1 } from './service';

/**
 * The Derivation root security console surface: status reads only.
 *
 * Rotation is a mutation on `POST /console/tenant-root/refresh`, which is the
 * sole rotation engine. This route reports what that engine recorded — polling
 * a rotation reads its durable operation by the same operationId the caller
 * submitted, so a reload sees the operation's real state.
 *
 * Authentication, route policy, fresh step-up, and scope resolution are the
 * shared guard's job.
 */

export const TENANT_ROOT_SECURITY_STATUS_PATH_V1 = '/console/tenant-root/security/status';
export const TENANT_ROOT_SECURITY_ROTATION_PATH_V1 = '/console/tenant-root/security/rotation';
export const TENANT_ROOT_SECURITY_RESTORE_STATE_PATH_V1 = '/console/tenant-root/security/restore';
export const TENANT_ROOT_SECURITY_TRUST_PATH_V1 = '/console/tenant-root/security/trust';

/** The redacted state the control plane publishes for one environment. */
export interface TenantRootSecurityStateReaderV1 {
  readStatus(input: { readonly identity: TenantRootIdentityV1 }): Promise<{
    readonly status: TenantRootSecurityStatusV1;
    readonly recoveryDownloadHolders: RecoveryDownloadHolders;
    readonly recoveryEnrollment: 'pending' | 'ready_to_commit' | 'committed';
    readonly identityDigestB64u: string;
    readonly custodyLineageB64u: string;
    readonly governance: TenantRootRecoveryGovernanceV1 | null;
    readonly governanceDigestB64u: string;
    readonly rootCommitmentB64u: string;
  }>;
}

/** Everything the security route needs. */
export interface TenantRootSecurityConsoleRouteDependenciesV1 extends TenantRootSecurityGuardDependenciesV1 {
  readonly state: TenantRootSecurityStateReaderV1;
  /**
   * Builds the operation store for one resolved tenant root.
   *
   * The store scopes every row to a tenant, so it cannot be built once at
   * mount: the tenant is only known after the guard resolves the request.
   */
  readonly operations: (scope: {
    readonly orgId: string;
    readonly identityDigestB64u: string;
    readonly custodyLineageB64u: string;
  }) => Pick<TenantRootOperationStoreV1, 'findByIdempotencyKey'>;
}

/** Creates the Derivation root security console route. */
export function createTenantRootSecurityConsoleRouteV1(
  dependencies: TenantRootSecurityConsoleRouteDependenciesV1,
): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const url = new URL(request.url);
    if (
      url.pathname !== TENANT_ROOT_SECURITY_STATUS_PATH_V1 &&
      url.pathname !== TENANT_ROOT_SECURITY_ROTATION_PATH_V1 &&
      url.pathname !== TENANT_ROOT_SECURITY_RESTORE_STATE_PATH_V1 &&
      url.pathname !== TENANT_ROOT_SECURITY_TRUST_PATH_V1
    ) {
      return null;
    }
    // Restore mutations belong to the destination route and its bootstrap
    // authority; a console session never reaches them through here.
    if (url.pathname === TENANT_ROOT_SECURITY_RESTORE_STATE_PATH_V1 && request.method !== 'GET') {
      return null;
    }

    const guarded = await guardTenantRootSecurityRequestV1(dependencies, request, url);
    if (!guarded.ok) return guarded.response;
    const { identity } = guarded.request;

    try {
      const state = await dependencies.state.readStatus({ identity });

      if (request.method === 'GET') {
        switch (url.pathname) {
          case TENANT_ROOT_SECURITY_ROTATION_PATH_V1: {
            // The rotation's own operationId identifies it. Polling reads the
            // durable record the refresh route wrote, so a reload sees the
            // operation's real state rather than a client-side guess.
            const operationId = url.searchParams.get('operationId');
            if (operationId === null || operationId.trim() === '') {
              return tenantRootSecurityJson({ ok: false, code: 'operation_id_required' }, 400);
            }
            const entry = await dependencies
              .operations({
                orgId: identity.orgId,
                identityDigestB64u: state.identityDigestB64u,
                custodyLineageB64u: state.custodyLineageB64u,
              })
              .findByIdempotencyKey(operationId);
            return tenantRootSecurityJson({
              ok: true,
              operation:
                entry === null
                  ? null
                  : {
                      operationId,
                      status: entry.status,
                      failureCode: entry.failureCode,
                      acceptedResult:
                        entry.acceptedResultJson === null
                          ? null
                          : (JSON.parse(entry.acceptedResultJson) as unknown),
                    },
            });
          }
          case TENANT_ROOT_SECURITY_RESTORE_STATE_PATH_V1:
            return tenantRootSecurityJson({ ok: true, restore: state.status.restore });
          case TENANT_ROOT_SECURITY_TRUST_PATH_V1:
            return tenantRootSecurityJson({ ok: true, trustLevel: state.status.trustLevel });
          default:
            return tenantRootSecurityJson({
              ok: true,
              status: state.status,
              recoveryEnrollment: state.recoveryEnrollment,
              recoveryDownloadAccess: {
                deriverA: canDownloadRecoveryArtifact(
                  state.recoveryDownloadHolders,
                  'deriver_a_package',
                  guarded.request.actorUserId,
                ),
                deriverB: canDownloadRecoveryArtifact(
                  state.recoveryDownloadHolders,
                  'deriver_b_package',
                  guarded.request.actorUserId,
                ),
              },
            });
        }
      }
      // Rotation is a mutation on POST /console/tenant-root/refresh, which is
      // the sole rotation engine. This route reads; it never mutates.
      return tenantRootSecurityJson(
        {
          ok: false,
          code: 'method_not_allowed',
          message: 'Rotation is started at /console/tenant-root/refresh',
        },
        405,
      );
    } catch (error: unknown) {
      if (error instanceof TenantRootSecurityStateUnavailableError) {
        return tenantRootSecurityJson({ ok: false, code: error.code, message: error.message }, 404);
      }
      return tenantRootSecurityJson(
        {
          ok: false,
          code: 'tenant_root_security_operation_failed',
          message: error instanceof Error ? error.message : 'Tenant-root security operation failed',
        },
        502,
      );
    }
  };
}
