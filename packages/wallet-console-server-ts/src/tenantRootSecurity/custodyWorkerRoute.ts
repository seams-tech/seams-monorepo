import { BACKUP_ACCESS_PATH, handleBackupAccess } from './backupAccessRoute';
import { readRecoveryDownloadHolders } from './custodyService';
import { CLI_ENROLLMENT_PATH, handleCliEnrollment } from './cliEnrollmentRoute';
import { TenantRootCustodyControlPlaneClientV1 } from './tenantRootCustodyControlPlaneClient';
import {
  tenantRootRecipientEnrolmentV1,
  recipientPairMatchesStagedV1,
  commitTenantRootRecipientPairV1,
} from './recipients';
import {
  base64UrlDecode,
  base64UrlEncode,
  type D1DatabaseLike,
} from '@seams/wallet-server/cloud-host';
import { isPlainObject } from '@seams/wallet-server/cloud-host';
import {
  tenantRootRecoveryGovernanceDigestB64uV1,
  tenantRootDownloadableRecoverySetV1,
  type TenantRootIdentityV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import type { ConsoleOrganizationAccessService } from '@seams-internal/console-server/teamRbac/service';
import {
  createAuthorizedTenantRootCustodyHandlerV1,
  isTenantRootCustodyPathV1,
} from './custodyRoute';
import { createD1TenantRootCustodyStoreV1 } from './custodyD1';
import { createD1TenantRootOperationStoreV1 } from './d1';
import type { TenantRootSecurityStateReaderV1 } from './consoleRoute';
import type { TenantRootAuditWriterV1 } from './audit';
import {
  guardTenantRootSecurityRequestV1,
  tenantRootSecurityJson,
  type TenantRootSecurityGuardDependenciesV1,
} from './routeGuard';
import { TenantRootRecoveryGenerationV1 } from './tenantRootRecoveryGeneration';

type Fetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
type Certificates = {
  readonly a: readonly string[];
  readonly b: readonly string[];
  readonly controlPlane: readonly string[];
};
type Recovery =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'ready';
      readonly certificates: Certificates;
      readonly controlPlane: Fetcher;
      readonly a: Fetcher;
      readonly b: Fetcher;
    };

export interface TenantRootCustodyWorkerOptionsV1 extends TenantRootSecurityGuardDependenciesV1 {
  readonly backupIntervalMs?: number;
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly state: TenantRootSecurityStateReaderV1;
  readonly organizationAccess: Pick<ConsoleOrganizationAccessService, 'lookupAuthorization'>;
  readonly audit: TenantRootAuditWriterV1;
  readonly internalServiceAuthSecret: string;
  readonly certificatesJson: string | undefined;
  readonly controlPlane: Fetcher | undefined;
  readonly deriverA: Fetcher | undefined;
  readonly deriverB: Fetcher | undefined;
}

function certificateChain(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8)
    throw new Error('Recovery certificate chain must contain one to eight certificates');
  const chain: string[] = [];
  for (const item of value) {
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length > 32768 ||
      base64UrlEncode(base64UrlDecode(item)) !== item
    )
      throw new Error('Recovery certificate is not bounded canonical base64url');
    chain.push(item);
  }
  return chain;
}

function recoveryConfiguration(options: TenantRootCustodyWorkerOptionsV1): Recovery {
  if (options.certificatesJson === undefined || options.certificatesJson.trim() === '')
    return { kind: 'unavailable' };
  const value: unknown = JSON.parse(options.certificatesJson);
  if (!isPlainObject(value) || Object.keys(value).length !== 3)
    throw new Error('Recovery certificates require a, b and controlPlane chains');
  if (
    options.controlPlane === undefined ||
    options.deriverA === undefined ||
    options.deriverB === undefined
  )
    throw new Error(
      'Recovery certificates require control-plane and both Deriver service bindings',
    );
  return {
    kind: 'ready',
    certificates: {
      a: certificateChain(value.a),
      b: certificateChain(value.b),
      controlPlane: certificateChain(value.controlPlane),
    },
    controlPlane: options.controlPlane,
    a: options.deriverA,
    b: options.deriverB,
  };
}

async function readCurrentRoot(
  state: TenantRootSecurityStateReaderV1,
  identity: TenantRootIdentityV1,
  lineage: string,
) {
  const current = await state.readStatus({ identity });
  if (current.custodyLineageB64u !== lineage) throw new Error('Active custody lineage changed');
  return {
    lifecycleRevision: current.status.lifecycleRevision,
    rootCommitmentB64u: current.rootCommitmentB64u,
  };
}

/** Both console Workers resolve custody only after authenticating the tenant scope. */
export class TenantRootCustodyWorkerRouteV1 implements TenantRootSecurityStateReaderV1 {
  private readonly recovery: Recovery;
  constructor(private readonly options: TenantRootCustodyWorkerOptionsV1) {
    this.recovery = recoveryConfiguration(options);
  }

  private store(
    identity: TenantRootIdentityV1,
    identityDigestB64u: string,
    custodyLineageB64u: string,
  ) {
    return createD1TenantRootCustodyStoreV1({
      database: this.options.database,
      namespace: this.options.namespace,
      orgId: identity.orgId,
      identityDigestB64u,
      custodyLineageB64u,
      readRoot: readCurrentRoot.bind(undefined, this.options.state, identity, custodyLineageB64u),
    });
  }

  async isOrganizationOwner(input: {
    readonly orgId: string;
    readonly userId: string;
  }): Promise<boolean> {
    const access = await this.options.organizationAccess.lookupAuthorization(input);
    return access?.kind === 'authorized' && access.role === 'OWNER';
  }

  async readStatus(input: {
    readonly identity: TenantRootIdentityV1;
  }): ReturnType<TenantRootSecurityStateReaderV1['readStatus']> {
    const current = await this.options.state.readStatus(input);
    const store = this.store(
      input.identity,
      current.identityDigestB64u,
      current.custodyLineageB64u,
    );
    const custody = await store.readState();
    const committable = commitTenantRootRecipientPairV1({
      staged: custody.stagedRecipients,
      previousPair:
        tenantRootDownloadableRecoverySetV1(custody.backup)?.recipientPair ?? custody.recipientPair,
    });
    return {
      recoveryDownloadHolders: await readRecoveryDownloadHolders(store, custody.backup),
      recoveryEnrollment:
        committable.ok &&
        custody.recipientPair !== null &&
        recipientPairMatchesStagedV1(custody.recipientPair, custody.stagedRecipients)
          ? 'committed'
          : committable.ok
            ? 'ready_to_commit'
            : 'pending',
      status: {
        identity: current.status.identity,
        custodyLineageId: current.status.custodyLineageId,
        lifecycleRevision: custody.lifecycleRevision,
        operationalShares: current.status.operationalShares,
        recoveryBackup:
          custody.backup.status === 'not_configured' && custody.governance !== null
            ? {
                status: 'recipients_pending',
                governance: custody.governance,
                enrolled: tenantRootRecipientEnrolmentV1(custody.stagedRecipients),
              }
            : custody.backup,
        restore: current.status.restore,
        trustLevel: current.status.trustLevel,
      },
      identityDigestB64u: current.identityDigestB64u,
      custodyLineageB64u: current.custodyLineageB64u,
      governance: custody.governance,
      governanceDigestB64u: await tenantRootRecoveryGovernanceDigestB64uV1(custody.governance),
      rootCommitmentB64u: custody.rootCommitmentB64u,
    };
  }

  private async cliCustody(identity: TenantRootIdentityV1) {
    const current = await this.options.state.readStatus({ identity });
    return this.store(identity, current.identityDigestB64u, current.custodyLineageB64u);
  }

  private async cliOwner(orgId: string, actorUserId: string): Promise<boolean> {
    return this.isOrganizationOwner({ orgId, userId: actorUserId });
  }

  private async backupControlPlane(identity: TenantRootIdentityV1) {
    if (this.recovery.kind !== 'ready') throw new Error('Recovery unavailable');
    const current = await this.options.state.readStatus({ identity });
    return new TenantRootRecoveryGenerationV1({
      database: this.options.database,
      namespace: this.options.namespace,
      identity,
      identityDigestB64u: current.identityDigestB64u,
      custodyLineageB64u: current.custodyLineageB64u,
      custody: await this.cliCustody(identity),
      controlPlaneFetch: this.recovery.controlPlane,
      derivers: { a: this.recovery.a, b: this.recovery.b },
      internalServiceAuthSecret: this.options.internalServiceAuthSecret,
      certificates: this.recovery.certificates,
    });
  }

  async fetch(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(`${BACKUP_ACCESS_PATH}/`)) {
      return handleBackupAccess(
        {
          auth: this.options.auth,
          orgProjectEnv: this.options.orgProjectEnv,
          stepUp: this.options.stepUp,
          database: this.options.database,
          namespace: this.options.namespace,
          audit: this.options.audit,
          custody: this.cliCustody.bind(this),
          isOwner: this.cliOwner.bind(this),
          controlPlane: this.backupControlPlane.bind(this),
        },
        request,
      );
    }
    if (url.pathname.startsWith(`${CLI_ENROLLMENT_PATH}/`)) {
      if (this.recovery.kind !== 'ready')
        return tenantRootSecurityJson({ ok: false, code: 'tenant_root_recovery_unavailable' }, 503);
      return handleCliEnrollment(
        {
          auth: this.options.auth,
          orgProjectEnv: this.options.orgProjectEnv,
          stepUp: this.options.stepUp,
          database: this.options.database,
          namespace: this.options.namespace,
          audit: this.options.audit,
          custody: this.cliCustody.bind(this),
          isOwner: this.cliOwner.bind(this),
          controlPlane: new TenantRootCustodyControlPlaneClientV1({
            controlPlaneFetch: this.recovery.controlPlane,
            internalServiceAuthSecret: this.options.internalServiceAuthSecret,
          }),
        },
        request,
      );
    }
    if (!isTenantRootCustodyPathV1(url.pathname)) return null;
    const guarded = await guardTenantRootSecurityRequestV1(this.options, request, url);
    if (!guarded.ok) return guarded.response;
    if (this.recovery.kind === 'unavailable')
      return tenantRootSecurityJson({ ok: false, code: 'tenant_root_recovery_unavailable' }, 503);
    const { identity } = guarded.request;
    try {
      const current = await this.options.state.readStatus({ identity });
      const custody = this.store(identity, current.identityDigestB64u, current.custodyLineageB64u);
      const controlPlane = new TenantRootRecoveryGenerationV1({
        database: this.options.database,
        namespace: this.options.namespace,
        identity,
        identityDigestB64u: current.identityDigestB64u,
        custodyLineageB64u: current.custodyLineageB64u,
        custody,
        controlPlaneFetch: this.recovery.controlPlane,
        derivers: { a: this.recovery.a, b: this.recovery.b },
        internalServiceAuthSecret: this.options.internalServiceAuthSecret,
        certificates: this.recovery.certificates,
      });
      const handler = createAuthorizedTenantRootCustodyHandlerV1({
        auth: this.options.auth,
        orgProjectEnv: this.options.orgProjectEnv,
        stepUp: this.options.stepUp,
        custody,
        controlPlane,
        audit: this.options.audit,
        membership: this,
        operations: createD1TenantRootOperationStoreV1({
          backupIntervalMs: this.options.backupIntervalMs ?? 600_000,
          database: this.options.database,
          namespace: this.options.namespace,
          orgId: identity.orgId,
          identityDigestB64u: current.identityDigestB64u,
          custodyLineageB64u: current.custodyLineageB64u,
        }),
      });
      return handler(request, guarded.request);
    } catch (error: unknown) {
      return tenantRootSecurityJson(
        {
          ok: false,
          code: 'tenant_root_custody_unavailable',
          message: error instanceof Error ? error.message : 'Recovery custody is unavailable',
        },
        503,
      );
    }
  }
}
