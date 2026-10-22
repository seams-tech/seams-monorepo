CREATE TABLE billing_plan_base_charges (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  month_utc TEXT NOT NULL,
  plan TEXT NOT NULL,
  price_version TEXT NOT NULL,
  period_start_ms INTEGER NOT NULL,
  period_end_ms INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, month_utc),
  FOREIGN KEY (namespace, org_id) REFERENCES billing_account_plans(namespace, org_id),
  CHECK (plan IN ('growth', 'pro')),
  CHECK (month_utc GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  CHECK (length(price_version) > 0),
  CHECK (period_start_ms > 0 AND period_end_ms > period_start_ms),
  CHECK (amount_minor > 0),
  CHECK (created_at_ms > 0)
);

CREATE TRIGGER billing_account_plans_paid_insert_requires_start
BEFORE INSERT ON billing_account_plans
WHEN NEW.plan IN ('growth', 'pro')
BEGIN
  SELECT RAISE(ABORT, 'paid_plan_must_start_from_free');
END;

CREATE TRIGGER billing_account_plans_require_base_charge
BEFORE UPDATE OF plan, plan_started_at_ms, price_version ON billing_account_plans
WHEN NEW.plan IN ('growth', 'pro')
  AND (OLD.plan IS NOT NEW.plan
    OR OLD.plan_started_at_ms IS NOT NEW.plan_started_at_ms
    OR OLD.price_version IS NOT NEW.price_version)
  AND NOT EXISTS (
    SELECT 1 FROM billing_plan_base_charges AS charge
    WHERE charge.namespace = NEW.namespace
      AND charge.org_id = NEW.org_id
      AND charge.plan = NEW.plan
      AND charge.price_version = NEW.price_version
      AND charge.period_start_ms = NEW.plan_started_at_ms
  )
BEGIN
  SELECT RAISE(ABORT, 'paid_plan_base_charge_required');
END;
