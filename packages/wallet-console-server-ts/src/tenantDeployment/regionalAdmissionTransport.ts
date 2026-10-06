import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { decodeTenantDeploymentBindingV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';
import {
  D1RegionalDeploymentAdmission,
  type RegionalDeploymentAdmission,
  type RegionalDeploymentInstaller,
} from './regionalAdmission';
import { TenantDeploymentD1ResourceIdentityV1 } from './deploymentResource';
import { storedRuntimeVersionMatches, parseTenantRuntimeWriterV1 } from './resourceVerification';
import type { TenantDeploymentServiceBindingV1 } from './runtimeBinding';
import type { WalletHomeCatalog, WalletRegion } from '../walletPlacement/home';

const ADMISSION_ORIGIN = 'https://wallet-runtime.internal';
const ADMISSION_PATH = '/internal/tenant-deployment/v1/regional-admission';
type AdmissionAction = 'prepare' | 'activate';

// This endpoint is exposed only by Wallet Runtime's private service binding.
export async function handleRegionalDeploymentAdmission(
  request: Request,
  database: D1DatabaseLike,
  resource: TenantDeploymentD1ResourceIdentityV1,
  versionId: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ADMISSION_PATH) return null;
  if (url.origin !== ADMISSION_ORIGIN) return new Response(null, { status: 404 });
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  try {
    const writer = parseTenantRuntimeWriterV1('walletRuntime', versionId, {
      accountId: resource.accountId,
      databaseId: resource.databaseId,
    });
    const raw: unknown = await request.json();
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('action' in raw) ||
      (raw.action !== 'prepare' && raw.action !== 'activate') ||
      !('binding' in raw) ||
      !('activationSequence' in raw) ||
      typeof raw.activationSequence !== 'number' ||
      !Number.isSafeInteger(raw.activationSequence) ||
      raw.activationSequence <= 0 ||
      !('resourceVerificationsJson' in raw) ||
      typeof raw.resourceVerificationsJson !== 'string'
    ) {
      return Response.json({ ok: false }, { status: 400 });
    }
    const binding = await decodeTenantDeploymentBindingV1(raw.binding);
    if (!binding.ok || !storedRuntimeVersionMatches(raw.resourceVerificationsJson, writer)) {
      return Response.json({ ok: false }, { status: 403 });
    }
    const admission: RegionalDeploymentAdmission = {
      binding: binding.value,
      activationSequence: raw.activationSequence,
      resourceVerificationsJson: raw.resourceVerificationsJson,
    };
    const local = new D1RegionalDeploymentAdmission(database, resource);
    switch (raw.action) {
      case 'prepare':
        await local.prepare(admission);
        break;
      case 'activate':
        await local.activate(admission);
        break;
    }
    return Response.json({
      ok: true,
      revision: binding.value.revision,
      activationSequence: admission.activationSequence,
    });
  } catch {
    return Response.json({ ok: false }, { status: 409 });
  }
}

export class RegionalDeploymentServiceInstaller implements RegionalDeploymentInstaller {
  constructor(
    private readonly catalog: WalletHomeCatalog,
    private readonly runtimes: Readonly<Record<WalletRegion, TenantDeploymentServiceBindingV1>>,
  ) {}

  async prepare(admission: RegionalDeploymentAdmission): Promise<void> {
    await this.send('prepare', admission);
  }

  async activate(admission: RegionalDeploymentAdmission): Promise<void> {
    await this.send('activate', admission);
  }

  private async send(
    action: AdmissionAction,
    admission: RegionalDeploymentAdmission,
  ): Promise<void> {
    let covered = 0;
    for (const region of ['US', 'WEUR', 'APAC', 'OC'] as const) {
      if (admission.binding.resources.some(matchesHome.bind(null, this.catalog.select(region)))) {
        covered += 1;
      }
    }
    if (covered !== admission.binding.resources.length) {
      throw new Error('Regional deployment resources differ from the runtime catalog');
    }
    // Sequential dispatch makes partial failure explicit. Every operation is retryable.
    for (const region of ['US', 'WEUR', 'APAC', 'OC'] as const) {
      const home = this.catalog.select(region);
      if (!admission.binding.resources.some(matchesHome.bind(null, home))) continue;
      const response = await this.runtimes[region].fetch(
        new Request(`${ADMISSION_ORIGIN}${ADMISSION_PATH}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            binding: admission.binding,
            activationSequence: admission.activationSequence,
            resourceVerificationsJson: admission.resourceVerificationsJson,
          }),
        }),
      );
      const raw: unknown = await response.json();
      if (
        !response.ok ||
        !raw ||
        typeof raw !== 'object' ||
        !('ok' in raw) ||
        raw.ok !== true ||
        !('revision' in raw) ||
        raw.revision !== admission.binding.revision ||
        !('activationSequence' in raw) ||
        raw.activationSequence !== admission.activationSequence
      ) {
        throw new Error(`Regional deployment ${action} failed for ${region}`);
      }
    }
  }
}

function matchesHome(
  home: { readonly accountId: string; readonly databaseId: string },
  resource: { readonly accountId: string; readonly databaseId: string },
): boolean {
  return home.accountId === resource.accountId && home.databaseId === resource.databaseId;
}
