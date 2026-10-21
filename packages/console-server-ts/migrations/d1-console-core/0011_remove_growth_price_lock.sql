-- Growth has no price lock (docs/feat-6-pricing-conversion-funnel.md, decision 6).
-- Rebuild billing_account_plans without price_locked_until_ms, its CHECK terms, and the
-- billing_account_plans_price_lock trigger. Plan rows and sent notices are preserved.
-- billing_plan_notices references the plans table, so it moves through a backup, and the
-- two triggers whose bodies write the plans table are recreated after the rename.
PRAGMA defer_foreign_keys = ON;

DROP TRIGGER IF EXISTS billing_account_plans_price_lock;
DROP TRIGGER IF EXISTS billing_account_plans_open_free;
DROP TRIGGER IF EXISTS billing_plan_usage_facts_count;

CREATE TABLE billing_plan_notices_price_lock_backup AS SELECT * FROM billing_plan_notices;
DROP TABLE billing_plan_notices;

CREATE TABLE billing_account_plans_no_lock (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  billing_account_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'growth', 'enterprise')),
  free_started_at_ms INTEGER NOT NULL CHECK (free_started_at_ms > 0),
  plan_started_at_ms INTEGER,
  price_version TEXT,
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
    (plan = 'free' AND plan_started_at_ms IS NULL AND price_version IS NULL)
    OR (plan = 'growth' AND plan_started_at_ms > 0 AND length(price_version) > 0)
    OR (plan = 'enterprise' AND plan_started_at_ms > 0 AND length(price_version) > 0
      AND production_state = 'active')
  ),
  CHECK (plan = 'free' OR production_state <> 'free_limit_reached')
);

INSERT INTO billing_account_plans_no_lock
  (namespace, org_id, billing_account_id, plan, free_started_at_ms, plan_started_at_ms,
    price_version, production_state, production_state_changed_at_ms, evaluation_due_at_ms,
    updated_at_ms)
  SELECT namespace, org_id, billing_account_id, plan, free_started_at_ms, plan_started_at_ms,
    price_version, production_state, production_state_changed_at_ms, evaluation_due_at_ms,
    updated_at_ms
  FROM billing_account_plans;
DROP TABLE billing_account_plans;
ALTER TABLE billing_account_plans_no_lock RENAME TO billing_account_plans;

CREATE INDEX billing_account_plans_due_idx
  ON billing_account_plans (namespace, evaluation_due_at_ms, org_id);

CREATE TABLE billing_plan_notices (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  notice_key TEXT NOT NULL CHECK (length(notice_key) > 0),
  notice_kind TEXT NOT NULL CHECK (notice_kind IN
    ('card_reminder', 'card_required', 'free_limit_warning', 'free_limit_stop', 'growth_move')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
  PRIMARY KEY (namespace, org_id, notice_key),
  FOREIGN KEY (namespace, org_id) REFERENCES billing_account_plans(namespace, org_id)
);

INSERT INTO billing_plan_notices SELECT * FROM billing_plan_notices_price_lock_backup;
DROP TABLE billing_plan_notices_price_lock_backup;

CREATE TRIGGER billing_account_plans_open_free
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
  END;

CREATE TRIGGER billing_plan_usage_facts_count
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
  END;
