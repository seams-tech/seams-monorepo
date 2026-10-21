import { formatD1ExecStatement, type D1DatabaseLike } from '../boundary/d1';

/**
 * Plan state, the card clock, verified payment methods, production usage counts,
 * and sent notices, per billing account. Migrations 0010 (Console core) and 0101
 * (Wallet Console) create the same objects on deployed databases.
 */
export const FREE_PLAN_D1_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS billing_free_plan_release (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    released_at_ms INTEGER NOT NULL CHECK (released_at_ms > 0)
  )`,
  `INSERT INTO billing_free_plan_release (id, released_at_ms)
    VALUES (1, unixepoch() * 1000) ON CONFLICT(id) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS billing_account_plans (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    plan TEXT NOT NULL CHECK (plan IN ('free', 'growth', 'enterprise')),
    free_started_at_ms INTEGER NOT NULL CHECK (free_started_at_ms > 0),
    plan_started_at_ms INTEGER,
    price_version TEXT,
    price_locked_until_ms INTEGER,
    production_state TEXT NOT NULL
      CHECK (production_state IN ('active', 'card_required', 'free_limit_reached')),
    production_state_changed_at_ms INTEGER NOT NULL,
    evaluation_due_at_ms INTEGER NOT NULL DEFAULT 0,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, org_id),
    UNIQUE (namespace, billing_account_id),
    FOREIGN KEY (namespace, org_id, billing_account_id)
      REFERENCES organization_billing_accounts(namespace, org_id, id),
    CHECK (
      (plan = 'free' AND plan_started_at_ms IS NULL AND price_version IS NULL
        AND price_locked_until_ms IS NULL)
      OR (plan = 'growth' AND plan_started_at_ms > 0 AND length(price_version) > 0
        AND price_locked_until_ms > plan_started_at_ms)
      OR (plan = 'enterprise' AND plan_started_at_ms > 0 AND length(price_version) > 0
        AND production_state = 'active')
    ),
    CHECK (plan = 'free' OR production_state <> 'free_limit_reached')
  )`,
  `CREATE TRIGGER IF NOT EXISTS billing_account_plans_price_lock
    BEFORE UPDATE OF price_version, price_locked_until_ms ON billing_account_plans
    WHEN OLD.plan = 'growth' AND OLD.price_locked_until_ms > NEW.updated_at_ms
      AND (NEW.price_version IS NOT OLD.price_version
        OR NEW.price_locked_until_ms IS NOT OLD.price_locked_until_ms)
    BEGIN SELECT RAISE(ABORT, 'billing_plan_price_locked'); END`,
  `INSERT INTO billing_account_plans
    (namespace, org_id, billing_account_id, plan, free_started_at_ms, production_state,
      production_state_changed_at_ms, updated_at_ms)
    SELECT a.namespace, a.org_id, a.id, 'free', r.released_at_ms, 'active', r.released_at_ms,
      r.released_at_ms
    FROM organization_billing_accounts a CROSS JOIN billing_free_plan_release r
    WHERE true
    ON CONFLICT(namespace, org_id) DO NOTHING`,
  `CREATE TRIGGER IF NOT EXISTS billing_account_plans_open_free
    AFTER INSERT ON organization_billing_accounts
    BEGIN
      INSERT INTO billing_account_plans
        (namespace, org_id, billing_account_id, plan, free_started_at_ms, production_state,
          production_state_changed_at_ms, updated_at_ms)
      SELECT NEW.namespace, NEW.org_id, NEW.id, 'free',
        MAX(COALESCE(o.created_at_ms, NEW.created_at_ms), r.released_at_ms), 'active',
        NEW.created_at_ms, NEW.created_at_ms
      FROM billing_free_plan_release r
      LEFT JOIN organizations o ON o.namespace = NEW.namespace AND o.id = NEW.org_id
      WHERE true
      ON CONFLICT(namespace, org_id) DO NOTHING;
    END`,
  `CREATE INDEX IF NOT EXISTS billing_account_plans_due_idx
    ON billing_account_plans (namespace, evaluation_due_at_ms, org_id)`,
  `CREATE TABLE IF NOT EXISTS billing_payment_customers (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider = 'stripe'),
    customer_ref TEXT NOT NULL CHECK (length(customer_ref) > 0),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
    PRIMARY KEY (namespace, org_id),
    UNIQUE (namespace, provider, customer_ref),
    FOREIGN KEY (namespace, org_id, billing_account_id)
      REFERENCES organization_billing_accounts(namespace, org_id, id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS billing_payment_customers_immutable
    BEFORE UPDATE ON billing_payment_customers
    BEGIN SELECT RAISE(ABORT, 'billing_payment_customer_immutable'); END`,
  `CREATE TABLE IF NOT EXISTS billing_card_setup_sessions (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    id TEXT NOT NULL CHECK (length(id) > 0),
    checkout_session_ref TEXT NOT NULL CHECK (length(checkout_session_ref) > 0),
    customer_ref TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'verified')),
    actor_user_id TEXT NOT NULL CHECK (length(actor_user_id) > 0),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, id),
    UNIQUE (namespace, checkout_session_ref),
    FOREIGN KEY (namespace, org_id) REFERENCES billing_payment_customers(namespace, org_id),
    CHECK (updated_at_ms >= created_at_ms)
  )`,
  `CREATE TABLE IF NOT EXISTS billing_payment_methods (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    provider_method_ref TEXT NOT NULL CHECK (length(provider_method_ref) > 0),
    brand TEXT NOT NULL CHECK (length(brand) > 0),
    last4 TEXT NOT NULL CHECK (last4 GLOB '[0-9][0-9][0-9][0-9]'),
    exp_month INTEGER NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
    exp_year INTEGER NOT NULL CHECK (exp_year >= 2000),
    status TEXT NOT NULL CHECK (status IN ('usable', 'removed')),
    verified_at_ms INTEGER NOT NULL CHECK (verified_at_ms > 0),
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, org_id),
    FOREIGN KEY (namespace, org_id) REFERENCES billing_payment_customers(namespace, org_id),
    CHECK (updated_at_ms >= verified_at_ms)
  )`,
  `CREATE TABLE IF NOT EXISTS billing_plan_usage_facts (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    month_utc TEXT NOT NULL CHECK (month_utc GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    kind TEXT NOT NULL CHECK (kind IN ('active_user', 'signature')),
    fact_key TEXT NOT NULL CHECK (length(fact_key) > 0),
    environment_id TEXT NOT NULL CHECK (length(environment_id) > 0),
    recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms > 0),
    PRIMARY KEY (namespace, org_id, month_utc, kind, fact_key),
    FOREIGN KEY (namespace, org_id, billing_account_id)
      REFERENCES organization_billing_accounts(namespace, org_id, id)
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS billing_plan_usage_months (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    month_utc TEXT NOT NULL,
    production_active_users INTEGER NOT NULL DEFAULT 0 CHECK (production_active_users >= 0),
    production_signatures INTEGER NOT NULL DEFAULT 0 CHECK (production_signatures >= 0),
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, org_id, month_utc)
  )`,
  `CREATE TRIGGER IF NOT EXISTS billing_plan_usage_facts_count
    AFTER INSERT ON billing_plan_usage_facts
    BEGIN
      INSERT INTO billing_plan_usage_months
        (namespace, org_id, billing_account_id, month_utc, production_active_users,
          production_signatures, updated_at_ms)
      VALUES (NEW.namespace, NEW.org_id, NEW.billing_account_id, NEW.month_utc,
        CASE NEW.kind WHEN 'active_user' THEN 1 ELSE 0 END,
        CASE NEW.kind WHEN 'signature' THEN 1 ELSE 0 END, NEW.recorded_at_ms)
      ON CONFLICT(namespace, org_id, month_utc) DO UPDATE SET
        production_active_users = production_active_users + excluded.production_active_users,
        production_signatures = production_signatures + excluded.production_signatures,
        updated_at_ms = MAX(updated_at_ms, excluded.updated_at_ms);
      UPDATE billing_account_plans SET evaluation_due_at_ms = 0
      WHERE namespace = NEW.namespace AND org_id = NEW.org_id AND evaluation_due_at_ms <> 0;
    END`,
  `CREATE TRIGGER IF NOT EXISTS billing_plan_usage_facts_retained
    BEFORE DELETE ON billing_plan_usage_facts
    BEGIN SELECT RAISE(ABORT, 'billing_plan_usage_fact_retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS organizations_delete_retained_free_plan
    BEFORE DELETE ON organizations
    WHEN EXISTS (SELECT 1 FROM billing_plan_usage_facts
        WHERE namespace = OLD.namespace AND org_id = OLD.id)
      OR EXISTS (SELECT 1 FROM billing_payment_customers
        WHERE namespace = OLD.namespace AND org_id = OLD.id)
    BEGIN SELECT RAISE(ABORT, 'organization_delete_has_billing_history'); END`,
  `CREATE TABLE IF NOT EXISTS billing_plan_notices (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    notice_key TEXT NOT NULL CHECK (length(notice_key) > 0),
    notice_kind TEXT NOT NULL CHECK (notice_kind IN
      ('card_reminder', 'card_required', 'free_limit_warning', 'free_limit_stop', 'growth_move')),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
    PRIMARY KEY (namespace, org_id, notice_key),
    FOREIGN KEY (namespace, org_id) REFERENCES billing_account_plans(namespace, org_id)
  )`,
]);

export async function ensureFreePlanD1Schema(database: D1DatabaseLike): Promise<void> {
  for (const statement of FREE_PLAN_D1_SCHEMA_SQL) {
    await database.exec(formatD1ExecStatement(statement));
  }
}
