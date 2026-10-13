import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { queryD1One } from '@seams/wallet-server/cloud-host';
import type { D1AccountPlatformService } from '@seams-internal/console-server/accountPlatform/d1';
import type { ServiceProducerAuthorityV1 } from '@seams-internal/console-server/accountPlatform/types';
import type { ConsoleBillingPrepaidReservationService } from '@seams-internal/console-server/billingPrepaidReservations/service';
import type { D1BillingUsageService } from '@seams-internal/console-server/billing/usage';
import { SponsorshipPrepaidBalanceEnforcementError } from './prepaidBalance';

export interface WalletExecutionFundsOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly deploymentId: string;
  readonly platform: D1AccountPlatformService;
  readonly reservations: ConsoleBillingPrepaidReservationService;
  readonly usage: D1BillingUsageService;
}

/** Resolve a native Wallet environment before the shared authority admits a hold. */
export class WalletExecutionFunds {
  readonly authority: ServiceProducerAuthorityV1;
  readonly reservations: ConsoleBillingPrepaidReservationService;
  readonly usage: D1BillingUsageService;

  constructor(private readonly options: WalletExecutionFundsOptions) {
    this.authority = Object.freeze({ serviceId: 'wallet', deploymentId: options.deploymentId });
    this.reservations = options.reservations;
    this.usage = options.usage;
  }

  async resolveInstance(orgId: string, environmentId: string) {
    const environment = await queryD1One(
      this.options.database,
      `SELECT project_id FROM environments
       WHERE namespace = ? AND org_id = ? AND id = ? AND status = 'ACTIVE'`,
      [this.options.namespace, orgId, environmentId],
    );
    if (!environment || typeof environment.project_id !== 'string') {
      throw new SponsorshipPrepaidBalanceEnforcementError(
        'scope_forbidden',
        403,
        'Wallet execution environment is unavailable',
      );
    }
    const instance = await this.options.platform.resolveWalletServiceProducerInstance(
      this.authority,
      {
        namespace: this.options.namespace,
        nativeOrganizationId: orgId,
        nativeProjectId: environment.project_id,
      },
    );
    if (instance.kind === 'rejected') {
      throw new SponsorshipPrepaidBalanceEnforcementError(
        instance.error.code,
        403,
        'Wallet service instance is unavailable',
      );
    }
    return instance.value;
  }
}
