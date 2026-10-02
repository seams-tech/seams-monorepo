import { TenantDeploymentStoreError } from './service';
import { decodeTenantDeploymentD1ResourceV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';

// Provider resource identity is independent of its serving region and deployment lane.
export class TenantDeploymentD1ResourceIdentityV1 {
  readonly #validated = true;

  private constructor(
    readonly namespace: string,
    readonly accountId: string,
    readonly databaseId: string,
  ) {}

  static parse(raw: unknown): TenantDeploymentD1ResourceIdentityV1 {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('namespace' in raw) ||
      !('accountId' in raw) ||
      !('databaseId' in raw) ||
      Object.keys(raw).length !== 3
    ) {
      throw new TenantDeploymentStoreError('invalid_input', 'deployment D1 resource is invalid');
    }
    const namespace = parseNamespace(raw.namespace);
    const resource = decodeTenantDeploymentD1ResourceV1({
      accountId: raw.accountId,
      databaseId: raw.databaseId,
    });
    if (!resource.ok) throw new TenantDeploymentStoreError('invalid_input', resource.message);
    const home = new TenantDeploymentD1ResourceIdentityV1(
      namespace,
      resource.value.accountId,
      resource.value.databaseId,
    );
    Object.freeze(home);
    return home;
  }

  matches(other: TenantDeploymentD1ResourceIdentityV1): boolean {
    return (
      this.#validated &&
      other.#validated &&
      this.namespace === other.namespace &&
      this.accountId === other.accountId &&
      this.databaseId === other.databaseId
    );
  }
}

function parseNamespace(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.trim() !== raw) {
    throw new TenantDeploymentStoreError('invalid_input', 'namespace is invalid');
  }
  return raw;
}
