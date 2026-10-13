import { createD1ConsoleAccountService } from '../../account/d1';
import { ConsoleAccountError } from '../../account/errors';
import type { AccountOrganizationDeletionPort, ConsoleAccountService } from '../../account/service';
import {
  createD1AccountPlatformService,
  type D1AccountPlatformService,
} from '../../accountPlatform/d1';
import { D1AccountServiceAccess } from '../../accountPlatform/serviceAccess';
import { D1AccountMembershipFacade } from '../../accountPlatform/membershipFacade';
import { createD1ConsoleAuditService } from '../../audit/d1';
import type { ConsoleAuditService } from '../../audit/service';
import type { ConsoleAuditCategory, ConsoleAuditEvidenceReferenceKind } from '../../audit/types';
import { createD1ConsoleBillingService } from '../../billing/d1';
import type { BillingProviderAdapters } from '../../billing/providers';
import type { ConsoleBillingService } from '../../billing/service';
import { D1BillingUsageService, type SatyrTestPricingPolicyV1 } from '../../billing/usage';
import { createD1ConsoleBillingPrepaidReservationService } from '../../billingPrepaidReservations/d1';
import type { ConsoleBillingPrepaidReservationService } from '../../billingPrepaidReservations/service';
import { queryD1One, type D1DatabaseLike } from '../../boundary/d1';
import type { Logger } from '../../boundary';
import {
  createInMemoryConsoleOnboardingService,
  type ConsoleOnboardingService,
} from '../../onboarding/service';
import { createD1ConsoleOnboardingWelcomeEmail } from '../../onboarding/welcomeEmail';
import { createD1ConsoleOrgProjectService } from '../../orgProjectEnv/d1';
import type { ConsoleOrgProjectService } from '../../orgProjectEnv/service';
import {
  createD1ConsoleOrganizationAccessService,
  type D1ConsoleOrganizationEmailOptions,
} from '../../teamRbac/d1';
import type {
  ConsoleOrganizationAccessService,
  OrganizationAccessContext,
} from '../../teamRbac/service';

export interface CloudflareD1AccountServiceBundleOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly externalDeletionGuard: AccountOrganizationDeletionPort | null;
  readonly ensureSchema?: boolean;
  readonly now?: () => Date;
  readonly logger?: Logger | null;
  readonly organizationEmail?: D1ConsoleOrganizationEmailOptions;
  readonly billingProviders?: Partial<BillingProviderAdapters>;
  readonly billingEmailConsoleBaseUrl?: string;
  readonly satyrTestPricing?: SatyrTestPricingPolicyV1;
  readonly onboardingEmail?: {
    readonly consoleBaseUrl: string;
    readonly docsBaseUrl: string;
  };
  readonly auditCategories?: readonly ConsoleAuditCategory[];
  readonly auditEvidenceReferenceKinds?: readonly ConsoleAuditEvidenceReferenceKind[];
}

export interface CloudflareD1AccountServiceBundle {
  readonly orgProjects: ConsoleOrgProjectService;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly accountPlatform: D1AccountPlatformService;
  readonly serviceAccess: D1AccountServiceAccess;
  readonly serviceMemberships: D1AccountMembershipFacade;
  readonly account: ConsoleAccountService;
  readonly onboarding: ConsoleOnboardingService;
  readonly audit: ConsoleAuditService;
  readonly billing: ConsoleBillingService;
  readonly funds: ConsoleBillingPrepaidReservationService;
  readonly billingUsage: D1BillingUsageService;
  readonly webhooks: null;
}

class D1AccountOrganizationDeletion implements AccountOrganizationDeletionPort {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly namespace: string,
    private readonly platform: D1AccountPlatformService,
    private readonly external: AccountOrganizationDeletionPort | null,
  ) {}

  async assertOrganizationCanBeDeleted(ctx: OrganizationAccessContext): Promise<void> {
    try {
      await this.platform.assertOrganizationCanBeDeleted(ctx);
    } catch (error) {
      if (error instanceof Error && error.message === 'service_instances_exist') {
        throw new ConsoleAccountError(
          'organization_delete_has_service_instances',
          409,
          'Service instances retain this organization and its billing history',
        );
      }
      throw error;
    }
    const history = await queryD1One(
      this.database,
      `SELECT 1 AS retained WHERE
         EXISTS (SELECT 1 FROM billing_ledger_entries WHERE namespace = ?1 AND org_id = ?2)
         OR EXISTS (SELECT 1 FROM billing_credit_purchases WHERE namespace = ?1 AND org_id = ?2)
         OR EXISTS (SELECT 1 FROM billing_refunds WHERE namespace = ?1 AND org_id = ?2)
         OR EXISTS (SELECT 1 FROM billing_disputes WHERE namespace = ?1 AND org_id = ?2)
         OR EXISTS (SELECT 1 FROM invoices WHERE namespace = ?1 AND org_id = ?2)
         OR EXISTS (SELECT 1 FROM billing_funds_reservations WHERE namespace = ?1 AND org_id = ?2)`,
      [this.namespace, ctx.orgId],
    );
    if (history) {
      throw new ConsoleAccountError(
        'organization_delete_has_billing_history',
        409,
        'Billing records retain this organization',
      );
    }
    if (this.external) await this.external.assertOrganizationCanBeDeleted(ctx);
  }
}

/** Builds the account authority without Wallet services or bindings. */
export async function createCloudflareD1AccountServiceBundle(
  options: CloudflareD1AccountServiceBundleOptions,
): Promise<CloudflareD1AccountServiceBundle> {
  const namespace = options.namespace.trim();
  if (!namespace) throw new Error('D1 account storage namespace is required');
  const orgProjects = await createD1ConsoleOrgProjectService({
    database: options.database,
    namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
  });
  const organizationAccess = await createD1ConsoleOrganizationAccessService({
    database: options.database,
    namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
    email: options.organizationEmail,
  });
  const accountPlatform = createD1AccountPlatformService({
    database: options.database,
    namespace,
    organizationAccess,
    now: options.now,
  });
  if (options.ensureSchema !== false) await accountPlatform.ensureSchema();
  const serviceAccess = new D1AccountServiceAccess({
    database: options.database,
    namespace,
    platform: accountPlatform,
    organizationAccess,
    now: options.now,
  });
  if (options.ensureSchema !== false) await serviceAccess.ensureSchema();
  const serviceMemberships = new D1AccountMembershipFacade({
    database: options.database,
    namespace,
    organizationAccess,
    access: serviceAccess,
    now: options.now,
  });
  const audit = await createD1ConsoleAuditService({
    database: options.database,
    namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
    additionalCategories: options.auditCategories,
    additionalEvidenceReferenceKinds: options.auditEvidenceReferenceKinds,
  });
  const billing = await createD1ConsoleBillingService({
    database: options.database,
    ensureSchema: options.ensureSchema,
    namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
    providers: options.billingProviders,
    emailConsoleBaseUrl: options.billingEmailConsoleBaseUrl,
  });
  const funds = await createD1ConsoleBillingPrepaidReservationService({
    database: options.database,
    namespace,
    platform: accountPlatform,
    billing,
    now: options.now,
    ensureSchema: options.ensureSchema,
  });
  const billingUsage = new D1BillingUsageService({
    billing,
    database: options.database,
    namespace,
    funds,
    satyrTestPricing: options.satyrTestPricing ?? { kind: 'disabled' },
    now: options.now,
  });
  if (options.ensureSchema !== false) await billingUsage.ensureSchema();
  const welcomeEmail = options.onboardingEmail
    ? createD1ConsoleOnboardingWelcomeEmail({
        database: options.database,
        namespace,
        consoleBaseUrl: options.onboardingEmail.consoleBaseUrl,
        docsBaseUrl: options.onboardingEmail.docsBaseUrl,
        now: options.now,
      })
    : null;
  const onboarding = createInMemoryConsoleOnboardingService({
    orgProjectEnv: orgProjects,
    organizationAccess,
    welcomeEmail,
    logger: options.logger,
  });
  const account = await createD1ConsoleAccountService({
    database: options.database,
    namespace,
    ensureSchema: options.ensureSchema,
    now: options.now,
    orgProjectEnv: orgProjects,
    organizationAccess,
    deletion: new D1AccountOrganizationDeletion(
      options.database,
      namespace,
      accountPlatform,
      options.externalDeletionGuard,
    ),
  });
  return {
    orgProjects,
    organizationAccess,
    accountPlatform,
    serviceAccess,
    serviceMemberships,
    account,
    onboarding,
    audit,
    billing,
    funds,
    billingUsage,
    webhooks: null,
  };
}
