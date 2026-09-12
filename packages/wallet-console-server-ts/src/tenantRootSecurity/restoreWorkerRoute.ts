import {
  base64UrlDecode,
  base64UrlEncode,
  type D1DatabaseLike,
} from '@seams/wallet-server/cloud-host';
import { decodeTenantRootIdentityWireV1 } from '@seams-internal/shared-ts/tenant-root';
import { isPlainObject } from '@seams-internal/shared-ts/utils/validation';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import { createD1TenantRootRestoreStoreV1 } from './restoreD1';
import { createTenantRootDestinationBootstrapClientV1 } from './destinationBootstrapClient';
import { createTenantRootRestoreControlPlaneClientV1 } from './tenantRootRestoreControlPlaneClient';
import { createTenantRootRestoreManifestClientV1 } from './tenantRootRestoreManifestClient';
import { createTenantRootRestoreConsoleRouteV1, TENANT_ROOT_RESTORE_PATH_V1 } from './restoreRoute';
import type { TenantRootAuditWriterV1 } from './custodyRoute';

interface RestoreWorkerOptions {
  readonly destinationJson: string | undefined;
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly router: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  readonly internalServiceAuthSecret: string;
  readonly grantKeyId: string;
  readonly grantSigningSeedB64u: string;
  readonly audit: TenantRootAuditWriterV1;
}

const RESTORE_TABLES = [
  'tenant_root_security_restore_state',
  'tenant_root_security_restore_import_keys',
  'tenant_root_security_restore_installed_imports',
  'tenant_root_security_restore_bootstrap_sessions',
  'tenant_root_security_restore_refresh_grants',
];

function unavailableRestoreRoute(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== TENANT_ROOT_RESTORE_PATH_V1 && !path.startsWith(`${TENANT_ROOT_RESTORE_PATH_V1}/`)) {
    return Promise.resolve(null);
  }
  return Promise.resolve(
    Response.json({ error: 'restore_destination_unavailable' }, { status: 503 }),
  );
}

class ReadyRestoreRoute {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly route: (request: Request) => Promise<Response | null>,
  ) {}

  async fetch(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    if (
      path !== TENANT_ROOT_RESTORE_PATH_V1 &&
      !path.startsWith(`${TENANT_ROOT_RESTORE_PATH_V1}/`)
    ) {
      return null;
    }
    const result = await this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?, ?)",
      )
      .bind(...RESTORE_TABLES)
      .first<{ count: number }>();
    if (result?.count !== RESTORE_TABLES.length) return unavailableRestoreRoute(request);
    return this.route(request);
  }
}

/** Provisioning supplies the exact logical identity and fresh destination lineage. */
export async function createTenantRootRestoreWorkerRouteV1(
  options: RestoreWorkerOptions,
): Promise<(request: Request) => Promise<Response | null>> {
  if (options.destinationJson === undefined || options.destinationJson.trim() === '') {
    return unavailableRestoreRoute;
  }
  const raw: unknown = JSON.parse(options.destinationJson);
  if (
    !isPlainObject(raw) ||
    Object.keys(raw).length !== 2 ||
    typeof raw.custodyLineageB64u !== 'string'
  ) {
    throw new Error('Restore destination must contain identity and custodyLineageB64u');
  }
  const identity = decodeTenantRootIdentityWireV1(raw.identity);
  const lineage = base64UrlDecode(raw.custodyLineageB64u);
  if (
    !identity.ok ||
    lineage.length !== 16 ||
    base64UrlEncode(lineage) !== raw.custodyLineageB64u
  ) {
    throw new Error('Restore destination identity or lineage is invalid');
  }
  let nonzero = false;
  for (const byte of lineage) nonzero ||= byte !== 0;
  if (!nonzero) throw new Error('Restore destination lineage must be nonzero');
  const bootstrap = createTenantRootDestinationBootstrapClientV1({
    routerFetch: options.router,
    internalServiceAuthSecret: options.internalServiceAuthSecret,
    identity: identity.value,
    custodyLineageB64u: raw.custodyLineageB64u,
  });
  const restore = createD1TenantRootRestoreStoreV1({
    database: options.database,
    namespace: options.namespace,
    orgId: identity.value.orgId,
    identityDigestB64u: await tenantRootIdentityDigestB64uV1(identity.value),
    destinationLineageB64u: raw.custodyLineageB64u,
    readDestination: bootstrap.readDestination.bind(bootstrap),
  });
  const manifest = createTenantRootRestoreManifestClientV1({
    routerFetch: options.router,
    internalServiceAuthSecret: options.internalServiceAuthSecret,
  });
  const client = createTenantRootRestoreControlPlaneClientV1({
    routerFetch: options.router,
    internalServiceAuthSecret: options.internalServiceAuthSecret,
    grantKeyId: options.grantKeyId,
    grantSigningSeedB64u: options.grantSigningSeedB64u,
  });
  const route = createTenantRootRestoreConsoleRouteV1({
    bootstrap,
    identity: identity.value,
    restore,
    controlPlane: {
      registerManifest: manifest.registerManifest.bind(manifest),
      issueRoleImportKey: client.issueRoleImportKey.bind(client),
      acceptRoleImport: client.acceptRoleImport.bind(client),
      issueRestoreRefreshGrant: client.issueRestoreRefreshGrant.bind(client),
      activate: client.activate.bind(client),
      cleanupSession: client.cleanupSession.bind(client),
      cleanupActivatedRoot: client.cleanupActivatedRoot.bind(client),
    },
    audit: options.audit,
  });
  const ready = new ReadyRestoreRoute(options.database, route);
  return ready.fetch.bind(ready);
}
