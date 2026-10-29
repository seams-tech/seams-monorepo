import type {
  RouterApiProjectEnvironment,
  RouterApiProjectEnvironmentResolver,
} from '@seams/wallet-server/cloud-host';
import { queryD1All, type D1DatabaseLike } from '@seams-internal/console-server/boundary/index';
import { ADMITTED_WALLET_ENVIRONMENTS_FROM_SQL } from '../accountPlatform/admission';
import { parseEnvironmentRow } from '../environments/d1';
import type { ConsoleWalletEnvironment } from '../environments/types';

export function walletProjectEnvironment(
  environment: ConsoleWalletEnvironment,
): RouterApiProjectEnvironment {
  return {
    externalAuth: environment.externalAuth,
    id: environment.id,
    projectId: environment.projectId,
    key: environment.key,
    signingRootVersion: environment.signingRootVersion,
    status: environment.status,
  };
}

interface WalletProjectEnvironmentResolverOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly deploymentId: string;
}

export function createWalletProjectEnvironmentResolver(
  options: WalletProjectEnvironmentResolverOptions,
): RouterApiProjectEnvironmentResolver {
  return new WalletProjectEnvironmentResolver(options);
}

class WalletProjectEnvironmentResolver implements RouterApiProjectEnvironmentResolver {
  constructor(private readonly options: WalletProjectEnvironmentResolverOptions) {}

  async listEnvironments(
    context: Parameters<RouterApiProjectEnvironmentResolver['listEnvironments']>[0],
    filters: Parameters<RouterApiProjectEnvironmentResolver['listEnvironments']>[1],
  ): Promise<RouterApiProjectEnvironment[]> {
    const values: unknown[] = [
      this.options.namespace,
      this.options.deploymentId,
      this.options.namespace,
      context.orgId,
    ];
    let scopeFilter = '';
    if (context.projectId) {
      values.push(context.projectId);
      scopeFilter += ` AND e.project_id = ?${values.length}`;
    }
    if (context.environmentId) {
      values.push(context.environmentId);
      scopeFilter += ` AND e.id = ?${values.length}`;
    }
    const status = filters?.status;
    if (status === 'ACTIVE' || status === 'DISABLED' || status === 'ARCHIVED') {
      values.push(status);
      scopeFilter += ` AND e.status = ?${values.length}`;
    }
    const rows = await queryD1All(
      this.options.database,
      `SELECT e.* ${ADMITTED_WALLET_ENVIRONMENTS_FROM_SQL}
       AND e.org_id = ?4${scopeFilter}
       ORDER BY CASE e.env_key WHEN 'prod' THEN 0 WHEN 'staging' THEN 1 ELSE 2 END,
         e.updated_at_ms DESC, e.created_at_ms DESC`,
      values,
    );
    return rows.map(toProjectEnvironment);
  }
}

function toProjectEnvironment(
  row: Parameters<typeof parseEnvironmentRow>[0],
): RouterApiProjectEnvironment {
  return walletProjectEnvironment(parseEnvironmentRow(row));
}
