import type {
  PlanUsageRecordingResultV1,
  PlatformPlanUsageEventV1,
} from '@seams-internal/console-shared/accountPlatform';
import type { ServiceProducerAuthorityV1 } from '../accountPlatform/types';
import { secureRandomBase36 } from '../boundary';
import {
  d1ChangedRows,
  d1Integer,
  queryD1All,
  queryD1One,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1ResultLike,
  type D1Row,
} from '../boundary/d1';
import { createConsoleEmailOutboxInsertStatement } from '../email/d1';
import { buildFreePlanNoticeEmailV1 } from '../email/templates';
import { ConsoleBillingError } from './errors';
import {
  FREE_PLAN_CARD_GRACE_DAYS,
  FREE_PLAN_CARD_REMINDER_DAYS,
  FREE_PLAN_LIMITS_V1,
  SELF_SERVE_PLAN_PRICES_V1,
  WALLET_GROWTH_PLAN_PRICE_V1,
  evaluateFreePlan,
  freePlanCardDeadlineMs,
  freePlanNoticeKey,
  monthUtcOf,
  paymentMethodState,
  type BillingPlanKindV1,
  type BillingPlanV1,
  type FreePlanBannerV1,
  type FreePlanEvaluationV1,
  type FreePlanNoticeV1,
  type PaymentMethodStateV1,
  type ProductionStateV1,
  type SelfServePlanKindV1,
} from './freePlan';
import { ensureFreePlanD1Schema } from './freePlanSchema';
import {
  resolveBillingProviderAdapters,
  assertBillingProviderAvailable,
  type BillingProviderAdapters,
} from './providers';
import { getConsoleBillingD1Runtime } from './d1';
import { buildCardSetupReturnUrls, type ConsoleBillingService } from './service';
import type { StripeCardSetupWebhookEventV1 } from './stripeWebhook';

const DAY_MS = 86_400_000;
const MAX_PASS_LIMIT = 200;

export interface D1FreePlanServiceOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly ensureSchema?: boolean;
  readonly now?: () => Date;
  readonly providers?: Partial<BillingProviderAdapters>;
  /** Without a base URL the service records notices and banners but queues no email. */
  readonly emailConsoleBaseUrl?: string;
  readonly consoleBaseUrl?: string;
}

export interface FreePlanContextV1 {
  readonly orgId: string;
  readonly actorUserId: string;
}

export interface BillingPlanViewV1 {
  readonly plan: BillingPlanKindV1;
  readonly freeStartedAt: string;
  readonly cardDeadlineAt: string | null;
  readonly planStartedAt: string | null;
  readonly priceVersion: string | null;
  readonly productionState: ProductionStateV1;
  readonly card: PaymentMethodStateV1;
  readonly usage: {
    readonly monthUtc: string;
    readonly productionActiveUsers: number;
    readonly productionSignatures: number;
    readonly limits: typeof FREE_PLAN_LIMITS_V1;
  };
  readonly banners: readonly FreePlanBannerV1[];
}

export interface CardSetupSessionV1 {
  readonly checkoutSessionId: string;
  readonly url: string;
  readonly expiresAt: string;
}

export interface FreePlanPassResultV1 {
  readonly evaluated: number;
  readonly movedToGrowth: number;
  readonly failures: readonly { readonly orgId: string; readonly message: string }[];
}

interface AccountSnapshot {
  readonly orgId: string;
  readonly organizationName: string;
  readonly plan: BillingPlanV1;
  readonly productionState: ProductionStateV1;
  readonly card: PaymentMethodStateV1;
  readonly usage: {
    readonly monthUtc: string;
    readonly productionActiveUsers: number;
    readonly productionSignatures: number;
  };
}

interface NoticeRecipient {
  readonly membershipId: string;
  readonly email: string;
  readonly displayName: string;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function positiveMs(value: unknown, field: string): number {
  const ms = d1Integer(value, -1);
  if (ms <= 0) throw new Error(`Stored ${field} is invalid`);
  return ms;
}

function parsePlan(row: D1Row): BillingPlanV1 {
  const freeStartedAtMs = positiveMs(row.free_started_at_ms, 'free_started_at_ms');
  switch (row.plan) {
    case 'free':
      return { kind: 'free', freeStartedAtMs };
    case 'growth':
    case 'pro':
      return {
        kind: row.plan,
        freeStartedAtMs,
        startedAtMs: positiveMs(row.plan_started_at_ms, 'plan_started_at_ms'),
        priceVersion: requiredText(row.price_version, 'price_version'),
      };
    case 'enterprise':
      return {
        kind: 'enterprise',
        freeStartedAtMs,
        startedAtMs: positiveMs(row.plan_started_at_ms, 'plan_started_at_ms'),
        priceVersion: requiredText(row.price_version, 'price_version'),
      };
    default:
      throw new Error('Stored billing plan is invalid');
  }
}

function parseProductionState(value: unknown): ProductionStateV1 {
  switch (value) {
    case 'active':
    case 'card_required':
    case 'free_limit_reached':
      return value;
    default:
      throw new Error('Stored production state is invalid');
  }
}

function parseCard(row: D1Row, nowMs: number): PaymentMethodStateV1 {
  if (row.card_status === null || row.card_status === undefined) return { kind: 'none' };
  if (row.card_status !== 'usable' && row.card_status !== 'removed') {
    throw new Error('Stored payment method status is invalid');
  }
  return paymentMethodState(
    {
      status: row.card_status,
      brand: requiredText(row.card_brand, 'brand'),
      last4: requiredText(row.card_last4, 'last4'),
      expMonth: d1Integer(row.card_exp_month),
      expYear: d1Integer(row.card_exp_year),
    },
    nowMs,
  );
}

/** The next time a free account can change without a usage or card event. */
function nextEvaluationMs(plan: BillingPlanV1, nowMs: number): number {
  const now = new Date(nowMs);
  let next = Math.min(nowMs + DAY_MS, Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  if (plan.kind === 'free') {
    for (const day of [...FREE_PLAN_CARD_REMINDER_DAYS, FREE_PLAN_CARD_GRACE_DAYS]) {
      const at = plan.freeStartedAtMs + day * DAY_MS;
      if (at > nowMs) next = Math.min(next, at);
    }
  }
  return next;
}

/** A card is usable through the last day of its expiry month, as `paymentMethodState` decides. */
const USABLE_CARD_SQL = `EXISTS (SELECT 1 FROM billing_payment_methods m
  WHERE m.namespace = billing_account_plans.namespace AND m.org_id = billing_account_plans.org_id
    AND m.status = 'usable' AND m.exp_year * 12 + m.exp_month - 1 >= ?)`;

function currentCardMonthIndex(nowMs: number): number {
  const now = new Date(nowMs);
  return now.getUTCFullYear() * 12 + now.getUTCMonth();
}

function parseStartPlan(value: unknown): SelfServePlanKindV1 | null {
  if (value === null || value === undefined) return null;
  if (value === 'growth' || value === 'pro') return value;
  throw new Error('Stored card setup start plan is invalid');
}

/** Only a Free account starts a paid plan; a second start finds no Free row and changes nothing. */
function refusePlanStart(current: BillingPlanV1['kind'], plan: SelfServePlanKindV1): never {
  if (current === plan) {
    throw new ConsoleBillingError('plan_already_active', 409, `The organization is on ${plan}`);
  }
  throw new ConsoleBillingError(
    'plan_change_unsupported',
    409,
    `The organization is on ${current}; only a Free organization can start ${plan}`,
  );
}

export class D1FreePlanService {
  private readonly database: D1DatabaseLike;
  private readonly namespace: string;
  private readonly clock: () => Date;
  private readonly providers: BillingProviderAdapters;
  private readonly emailConsoleBaseUrl: string | null;
  private readonly consoleBaseUrl: string | undefined;

  private constructor(options: D1FreePlanServiceOptions) {
    this.database = options.database;
    this.namespace = requiredText(options.namespace, 'namespace');
    this.clock = options.now ?? (() => new Date());
    this.providers = resolveBillingProviderAdapters(options.providers);
    this.emailConsoleBaseUrl = options.emailConsoleBaseUrl?.trim() || null;
    this.consoleBaseUrl = options.consoleBaseUrl || options.emailConsoleBaseUrl;
  }

  static async create(options: D1FreePlanServiceOptions): Promise<D1FreePlanService> {
    if (options.ensureSchema) await ensureFreePlanD1Schema(options.database);
    return new D1FreePlanService(options);
  }

  async getPlan(ctx: Pick<FreePlanContextV1, 'orgId'>): Promise<BillingPlanViewV1> {
    const nowMs = this.clock().getTime();
    const snapshot = await this.loadSnapshot(ctx.orgId, nowMs);
    if (!snapshot) {
      throw new ConsoleBillingError(
        'billing_account_missing',
        404,
        'The organization has no billing account yet',
      );
    }
    return this.view(snapshot, evaluateFreePlan({ ...snapshot, nowMs }), nowMs);
  }

  /** With `startPlan`, the verified card also starts that plan, in the same transaction. */
  async startCardSetup(
    ctx: FreePlanContextV1,
    startPlan: SelfServePlanKindV1 | null = null,
  ): Promise<CardSetupSessionV1> {
    assertBillingProviderAvailable(this.providers);
    const now = this.clock();
    if (startPlan) {
      const snapshot = await this.loadSnapshot(ctx.orgId, now.getTime());
      if (snapshot && snapshot.plan.kind !== 'free') refusePlanStart(snapshot.plan.kind, startPlan);
    }
    const account = await queryD1One(
      this.database,
      'SELECT id FROM organization_billing_accounts WHERE namespace = ? AND org_id = ?',
      [this.namespace, ctx.orgId],
    );
    if (!account) {
      throw new ConsoleBillingError(
        'billing_account_missing',
        409,
        'The organization has no billing account yet',
      );
    }
    const billingAccountId = requiredText(account.id, 'billing account id');
    const customerRef = await this.ensureCustomer(ctx.orgId, billingAccountId, now);
    const setupId = `cset_${now.getTime().toString(36)}_${secureRandomBase36(12, 'card setup id')}`;
    const urls = buildCardSetupReturnUrls(this.consoleBaseUrl, startPlan);
    const session = await this.providers.stripe.createCardSetupSession({
      setupId,
      orgId: ctx.orgId,
      billingAccountId,
      customerRef,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
      now,
      startPlan,
    });
    await this.database
      .prepare(
        `INSERT INTO billing_card_setup_sessions
          (namespace, org_id, billing_account_id, id, checkout_session_ref, customer_ref, status,
            actor_user_id, start_plan, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      )
      .bind(
        this.namespace,
        ctx.orgId,
        billingAccountId,
        setupId,
        session.id,
        customerRef,
        requiredText(ctx.actorUserId, 'actorUserId'),
        startPlan,
        now.getTime(),
        now.getTime(),
      )
      .run();
    return { checkoutSessionId: session.id, url: session.url, expiresAt: session.expiresAt };
  }

  /** Starts a paid plan with the usable card on file; the card setup path does the same. */
  async startPlan(
    ctx: Pick<FreePlanContextV1, 'orgId'>,
    plan: SelfServePlanKindV1,
  ): Promise<BillingPlanViewV1> {
    const nowMs = this.clock().getTime();
    const snapshot = await this.loadSnapshot(ctx.orgId, nowMs);
    if (!snapshot) {
      throw new ConsoleBillingError(
        'billing_account_missing',
        409,
        'The organization has no billing account yet',
      );
    }
    if (snapshot.plan.kind !== 'free') refusePlanStart(snapshot.plan.kind, plan);
    if (snapshot.card.kind !== 'usable') {
      throw new ConsoleBillingError('card_required', 409, `Add a card to start ${plan}`);
    }
    const [started] = await this.database.batch<D1ResultLike>([
      this.startPlanStatement(ctx.orgId, plan, nowMs),
    ]);
    if (!started || d1ChangedRows(started) !== 1) {
      const current = await this.loadSnapshot(ctx.orgId, nowMs);
      refusePlanStart(current?.plan.kind ?? 'free', plan);
    }
    await this.evaluate(ctx.orgId);
    return await this.getPlan(ctx);
  }

  /** A browser return proves nothing; the server-side Stripe lookup verifies the card. */
  async reconcileCardSetup(
    ctx: Pick<FreePlanContextV1, 'orgId'>,
    checkoutSessionId: string,
  ): Promise<{ readonly verified: boolean; readonly plan: BillingPlanViewV1 }> {
    const row = await queryD1One(
      this.database,
      `SELECT org_id, customer_ref, start_plan FROM billing_card_setup_sessions
       WHERE namespace = ? AND checkout_session_ref = ? AND org_id = ?`,
      [this.namespace, requiredText(checkoutSessionId, 'checkoutSessionId'), ctx.orgId],
    );
    if (!row) {
      throw new ConsoleBillingError('card_setup_not_found', 404, 'Card setup session not found');
    }
    const verified = await this.verifyCardSetup(
      ctx.orgId,
      checkoutSessionId,
      requiredText(row.customer_ref, 'customer_ref'),
      parseStartPlan(row.start_plan),
    );
    return { verified, plan: await this.getPlan(ctx) };
  }

  async handleWebhookEvent(event: StripeCardSetupWebhookEventV1): Promise<{ accepted: boolean }> {
    switch (event.kind) {
      case 'setup_completed': {
        const row = await queryD1One(
          this.database,
          `SELECT org_id, customer_ref, start_plan FROM billing_card_setup_sessions
           WHERE namespace = ? AND checkout_session_ref = ?`,
          [this.namespace, event.checkoutSessionId],
        );
        if (!row) return { accepted: false };
        const orgId = requiredText(row.org_id, 'org_id');
        if (event.orgId && event.orgId !== orgId) {
          throw new ConsoleBillingError(
            'card_setup_conflict',
            409,
            'Stripe setup event names another organization',
          );
        }
        const verified = await this.verifyCardSetup(
          orgId,
          event.checkoutSessionId,
          requiredText(row.customer_ref, 'customer_ref'),
          parseStartPlan(row.start_plan),
        );
        return { accepted: verified };
      }
      case 'payment_method_detached': {
        const nowMs = this.clock().getTime();
        const removed = await queryD1All(
          this.database,
          `UPDATE billing_payment_methods SET status = 'removed', updated_at_ms = MAX(updated_at_ms, ?)
           WHERE namespace = ? AND provider_method_ref = ? AND status = 'usable'
           RETURNING org_id`,
          [nowMs, this.namespace, event.paymentMethodRef],
        );
        for (const record of removed) await this.evaluate(requiredText(record.org_id, 'org_id'));
        return { accepted: removed.length > 0 };
      }
      default:
        return assertNever(event);
    }
  }

  /** Counts one production fact per key and month. A replayed event counts nothing. */
  async recordProductionUsage(
    authority: ServiceProducerAuthorityV1,
    event: PlatformPlanUsageEventV1,
  ): Promise<PlanUsageRecordingResultV1> {
    const instance = await queryD1One(
      this.database,
      `SELECT i.org_id, i.billing_account_id FROM platform_service_instances i
       WHERE i.namespace = ? AND i.id = ? AND i.service_id = ? AND i.deployment_id = ?`,
      [this.namespace, event.instanceId, authority.serviceId, authority.deploymentId],
    );
    if (!instance) return { kind: 'rejected', error: { code: 'scope_forbidden' } };
    if (!event.measure.environmentId.endsWith(':prod')) {
      return { kind: 'accepted', value: { kind: 'not_production' } };
    }
    const occurredAtMs = Date.parse(event.occurredAt);
    const factKey =
      event.measure.kind === 'production_active_user'
        ? `${event.measure.environmentId}:${event.measure.userKey}`
        : `${event.measure.environmentId}:${event.measure.signatureId}`;
    const result = await this.database
      .prepare(
        `INSERT INTO billing_plan_usage_facts
          (namespace, org_id, billing_account_id, month_utc, kind, fact_key, environment_id,
            recorded_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(
        this.namespace,
        requiredText(instance.org_id, 'org_id'),
        requiredText(instance.billing_account_id, 'billing_account_id'),
        monthUtcOf(occurredAtMs),
        event.measure.kind === 'production_active_user' ? 'active_user' : 'signature',
        factKey,
        event.measure.environmentId,
        occurredAtMs,
      )
      .run();
    return {
      kind: 'accepted',
      value: { kind: d1ChangedRows(result) === 1 ? 'counted' : 'already_counted' },
    };
  }

  /** Evaluates accounts whose usage or card changed, and accounts at a day or month boundary. */
  async runScheduledPass(input: { readonly limit: number }): Promise<FreePlanPassResultV1> {
    const limit = Math.min(Math.max(1, Math.floor(input.limit)), MAX_PASS_LIMIT);
    const nowMs = this.clock().getTime();
    const due = await queryD1All(
      this.database,
      `SELECT org_id FROM billing_account_plans
       WHERE namespace = ? AND evaluation_due_at_ms <= ?
       ORDER BY evaluation_due_at_ms, org_id LIMIT ?`,
      [this.namespace, nowMs, limit],
    );
    let evaluated = 0;
    let movedToGrowth = 0;
    const failures: { orgId: string; message: string }[] = [];
    for (const row of due) {
      const orgId = requiredText(row.org_id, 'org_id');
      try {
        const outcome = await this.evaluate(orgId);
        evaluated += 1;
        if (outcome === 'moved_to_growth') movedToGrowth += 1;
      } catch (error) {
        failures.push({ orgId, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { evaluated, movedToGrowth, failures };
  }

  private async ensureCustomer(
    orgId: string,
    billingAccountId: string,
    now: Date,
  ): Promise<string> {
    const existing = await queryD1One(
      this.database,
      'SELECT customer_ref FROM billing_payment_customers WHERE namespace = ? AND org_id = ?',
      [this.namespace, orgId],
    );
    if (existing) return requiredText(existing.customer_ref, 'customer_ref');
    const customerRef = await this.providers.stripe.createCustomer({ orgId, billingAccountId });
    await this.database
      .prepare(
        `INSERT INTO billing_payment_customers
          (namespace, org_id, billing_account_id, provider, customer_ref, created_at_ms)
         VALUES (?, ?, ?, 'stripe', ?, ?) ON CONFLICT(namespace, org_id) DO NOTHING`,
      )
      .bind(this.namespace, orgId, billingAccountId, customerRef, now.getTime())
      .run();
    const stored = await queryD1One(
      this.database,
      'SELECT customer_ref FROM billing_payment_customers WHERE namespace = ? AND org_id = ?',
      [this.namespace, orgId],
    );
    return requiredText(stored?.customer_ref, 'customer_ref');
  }

  /**
   * Stores the verified card and, for a setup that starts a plan, starts it in the same
   * batch. A replayed verification finds no Free row, so the plan starts once.
   */
  private async verifyCardSetup(
    orgId: string,
    checkoutSessionId: string,
    customerRef: string,
    startPlan: SelfServePlanKindV1 | null,
  ): Promise<boolean> {
    const lookup = await this.providers.stripe.getCardSetupSession({ checkoutSessionId });
    if (lookup.kind !== 'verified') return false;
    if (lookup.customerRef !== customerRef || (lookup.orgId !== null && lookup.orgId !== orgId)) {
      throw new ConsoleBillingError(
        'card_setup_conflict',
        409,
        'Stripe setup session belongs to another billing account',
      );
    }
    await this.providers.stripe.setDefaultPaymentMethod({
      customerRef,
      paymentMethodRef: lookup.card.id,
    });
    const nowMs = this.clock().getTime();
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE billing_card_setup_sessions SET status = 'verified', updated_at_ms = MAX(updated_at_ms, ?)
           WHERE namespace = ? AND checkout_session_ref = ? AND org_id = ?`,
        )
        .bind(nowMs, this.namespace, checkoutSessionId, orgId),
      this.database
        .prepare(
          `INSERT INTO billing_payment_methods
            (namespace, org_id, billing_account_id, provider_method_ref, brand, last4, exp_month,
              exp_year, status, verified_at_ms, updated_at_ms)
           SELECT c.namespace, c.org_id, c.billing_account_id, ?, ?, ?, ?, ?, 'usable', ?, ?
           FROM billing_payment_customers c WHERE c.namespace = ? AND c.org_id = ?
           ON CONFLICT(namespace, org_id) DO UPDATE SET
             provider_method_ref = excluded.provider_method_ref, brand = excluded.brand,
             last4 = excluded.last4, exp_month = excluded.exp_month, exp_year = excluded.exp_year,
             status = 'usable', verified_at_ms = excluded.verified_at_ms,
             updated_at_ms = excluded.updated_at_ms
           WHERE billing_payment_methods.provider_method_ref <> excluded.provider_method_ref
             OR billing_payment_methods.status <> 'usable'`,
        )
        .bind(
          lookup.card.id,
          lookup.card.brand,
          lookup.card.last4,
          lookup.card.expMonth,
          lookup.card.expYear,
          nowMs,
          nowMs,
          this.namespace,
          orgId,
        ),
      ...(startPlan ? [this.startPlanStatement(orgId, startPlan, nowMs)] : []),
    ]);
    await this.evaluate(orgId);
    return true;
  }

  /** Plan, pinned price version, and production state change in one statement. */
  private startPlanStatement(
    orgId: string,
    plan: SelfServePlanKindV1,
    nowMs: number,
  ): D1PreparedStatementLike {
    return this.database
      .prepare(
        `UPDATE billing_account_plans SET plan = ?, plan_started_at_ms = ?, price_version = ?,
           production_state = 'active',
           production_state_changed_at_ms = CASE WHEN production_state = 'active'
             THEN production_state_changed_at_ms ELSE ? END,
           evaluation_due_at_ms = 0, updated_at_ms = ?
         WHERE namespace = ? AND org_id = ? AND plan = 'free' AND ${USABLE_CARD_SQL}`,
      )
      .bind(
        plan,
        nowMs,
        SELF_SERVE_PLAN_PRICES_V1[plan].version,
        nowMs,
        nowMs,
        this.namespace,
        orgId,
        currentCardMonthIndex(nowMs),
      );
  }

  private async loadSnapshot(orgId: string, nowMs: number): Promise<AccountSnapshot | null> {
    const row = await queryD1One(
      this.database,
      `SELECT p.*, o.name AS organization_name,
          m.status AS card_status, m.brand AS card_brand, m.last4 AS card_last4,
          m.exp_month AS card_exp_month, m.exp_year AS card_exp_year,
          COALESCE(u.production_active_users, 0) AS production_active_users,
          COALESCE(u.production_signatures, 0) AS production_signatures
       FROM billing_account_plans p
       JOIN organizations o ON o.namespace = p.namespace AND o.id = p.org_id
       LEFT JOIN billing_payment_methods m ON m.namespace = p.namespace AND m.org_id = p.org_id
       LEFT JOIN billing_plan_usage_months u ON u.namespace = p.namespace AND u.org_id = p.org_id
         AND u.month_utc = ?
       WHERE p.namespace = ? AND p.org_id = ?`,
      [monthUtcOf(nowMs), this.namespace, orgId],
    );
    if (!row) return null;
    return {
      orgId,
      organizationName: requiredText(row.organization_name, 'organization name'),
      plan: parsePlan(row),
      productionState: parseProductionState(row.production_state),
      card: parseCard(row, nowMs),
      usage: {
        monthUtc: monthUtcOf(nowMs),
        productionActiveUsers: d1Integer(row.production_active_users),
        productionSignatures: d1Integer(row.production_signatures),
      },
    };
  }

  private view(
    snapshot: AccountSnapshot,
    evaluation: FreePlanEvaluationV1,
    nowMs: number,
  ): BillingPlanViewV1 {
    const plan = snapshot.plan;
    const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);
    return {
      plan: plan.kind,
      freeStartedAt: new Date(plan.freeStartedAtMs).toISOString(),
      cardDeadlineAt: plan.kind === 'free' ? iso(freePlanCardDeadlineMs(plan)) : null,
      planStartedAt: iso(plan.startedAtMs),
      priceVersion: plan.priceVersion ?? null,
      // The persisted state is what admission enforces; the view never claims otherwise.
      productionState: snapshot.productionState,
      card: snapshot.card,
      usage: { ...snapshot.usage, monthUtc: monthUtcOf(nowMs), limits: FREE_PLAN_LIMITS_V1 },
      banners: evaluation.banners,
    };
  }

  private async evaluate(orgId: string): Promise<'moved_to_growth' | 'stayed' | 'missing'> {
    const nowMs = this.clock().getTime();
    const snapshot = await this.loadSnapshot(orgId, nowMs);
    if (!snapshot) return 'missing';
    const evaluation = evaluateFreePlan({ ...snapshot, nowMs });
    const recipients = await this.loadRecipients(orgId);
    const statements: D1PreparedStatementLike[] = [];
    if (evaluation.kind === 'move_to_growth') {
      // Plan, pinned price version, and production state change in one statement.
      statements.push(
        this.database
          .prepare(
            `UPDATE billing_account_plans SET plan = 'growth', plan_started_at_ms = ?,
               price_version = ?, production_state = 'active',
               production_state_changed_at_ms = CASE WHEN production_state = 'active'
                 THEN production_state_changed_at_ms ELSE ? END,
               evaluation_due_at_ms = ?, updated_at_ms = ?
             WHERE namespace = ? AND org_id = ? AND plan = 'free' AND ${USABLE_CARD_SQL}`,
          )
          .bind(
            nowMs,
            WALLET_GROWTH_PLAN_PRICE_V1.version,
            nowMs,
            nextEvaluationMs(snapshot.plan, nowMs),
            nowMs,
            this.namespace,
            orgId,
            currentCardMonthIndex(nowMs),
          ),
      );
      for (const notice of evaluation.notices) {
        statements.push(
          ...(await this.noticeStatements(snapshot, notice, recipients, nowMs, true)),
        );
      }
    } else {
      statements.push(
        this.database
          .prepare(
            `UPDATE billing_account_plans SET production_state = ?,
               production_state_changed_at_ms = CASE WHEN production_state = ?
                 THEN production_state_changed_at_ms ELSE ? END,
               evaluation_due_at_ms = ?, updated_at_ms = MAX(updated_at_ms, ?)
             WHERE namespace = ? AND org_id = ?`,
          )
          .bind(
            evaluation.productionState,
            evaluation.productionState,
            nowMs,
            nextEvaluationMs(snapshot.plan, nowMs),
            nowMs,
            this.namespace,
            orgId,
          ),
      );
      for (const notice of evaluation.notices) {
        statements.push(
          ...(await this.noticeStatements(snapshot, notice, recipients, nowMs, false)),
        );
      }
    }
    const results = await this.database.batch<D1ResultLike>(statements);
    if (evaluation.kind === 'move_to_growth') {
      const moved = results[0];
      return moved && d1ChangedRows(moved) === 1 ? 'moved_to_growth' : 'stayed';
    }
    return 'stayed';
  }

  /**
   * The notice row is the send-once record. Each email is guarded by the statement before
   * it, so a notice that already exists queues no email. The move notice is also guarded
   * by the plan update, so it is queued only when the move commits.
   */
  private async noticeStatements(
    snapshot: AccountSnapshot,
    notice: FreePlanNoticeV1,
    recipients: readonly NoticeRecipient[],
    nowMs: number,
    guardedByPrevious: boolean,
  ): Promise<D1PreparedStatementLike[]> {
    const key = freePlanNoticeKey(notice);
    const statements: D1PreparedStatementLike[] = [
      this.database
        .prepare(
          `INSERT INTO billing_plan_notices
            (namespace, org_id, notice_key, notice_kind, payload_json, created_at_ms)
           SELECT ?, ?, ?, ?, ?, ? WHERE ${guardedByPrevious ? 'changes() = 1' : 'true'}
           ON CONFLICT DO NOTHING`,
        )
        .bind(this.namespace, snapshot.orgId, key, notice.kind, JSON.stringify(notice), nowMs),
    ];
    if (!this.emailConsoleBaseUrl) return statements;
    const template = buildFreePlanNoticeEmailV1({
      organizationName: snapshot.organizationName,
      consoleBaseUrl: this.emailConsoleBaseUrl,
      notice,
    });
    const createdAt = new Date(nowMs);
    for (const recipient of recipients) {
      const dedupeKey = `billing:free-plan:${key}:member:${recipient.membershipId}`;
      statements.push(
        await createConsoleEmailOutboxInsertStatement({
          database: this.database,
          namespace: this.namespace,
          email: {
            outboxId: `email:${dedupeKey}`,
            dedupeKey,
            orgId: snapshot.orgId,
            recipient: { email: recipient.email, displayName: recipient.displayName },
            template,
            createdAt,
            availableAt: createdAt,
          },
          insertGuard: 'PREVIOUS_STATEMENT_CHANGED_ONE',
        }),
      );
    }
    return statements;
  }

  /** Owners and administrators with billing management receive billing notices. */
  private async loadRecipients(orgId: string): Promise<NoticeRecipient[]> {
    if (!this.emailConsoleBaseUrl) return [];
    const rows = await queryD1All(
      this.database,
      `SELECT m.id AS membership_id, lower(trim(m.email)) AS email,
          COALESCE(NULLIF(TRIM(m.display_name), ''), m.email) AS display_name
       FROM organization_memberships m
       WHERE m.namespace = ? AND m.org_id = ? AND m.kind = 'ACTIVE'
         AND (m.role = 'OWNER' OR (m.role = 'ADMIN' AND EXISTS (
           SELECT 1 FROM organization_admin_permissions a
           WHERE a.namespace = m.namespace AND a.org_id = m.org_id AND a.membership_id = m.id
             AND a.permission = 'billing.manage')))
       ORDER BY m.created_at_ms, m.id`,
      [this.namespace, orgId],
    );
    const recipients: NoticeRecipient[] = [];
    for (const row of rows) {
      const membershipId = String(row.membership_id || '').trim();
      const email = String(row.email || '').trim();
      const displayName = String(row.display_name || '').trim();
      if (membershipId && email && displayName)
        recipients.push({ membershipId, email, displayName });
    }
    return recipients;
  }
}

/** The free plan service shares the D1 billing service's database, clock, and providers. */
export async function freePlanServiceForBilling(
  billing: ConsoleBillingService | null | undefined,
): Promise<D1FreePlanService | null> {
  const runtime = getConsoleBillingD1Runtime(billing);
  if (!runtime) return null;
  return await D1FreePlanService.create({
    database: runtime.database,
    namespace: runtime.namespace,
    now: runtime.now,
    providers: runtime.providers,
    ...(runtime.emailConsoleBaseUrl ? { emailConsoleBaseUrl: runtime.emailConsoleBaseUrl } : {}),
    ...(runtime.consoleBaseUrl ? { consoleBaseUrl: runtime.consoleBaseUrl } : {}),
  });
}

export async function createD1FreePlanService(
  options: D1FreePlanServiceOptions,
): Promise<D1FreePlanService> {
  return await D1FreePlanService.create(options);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled card setup event: ${JSON.stringify(value)}`);
}
