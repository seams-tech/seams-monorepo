-- Preserve ledger identities, amounts, and provider operations while adding postpaid billing.
PRAGMA defer_foreign_keys = ON;
DROP TRIGGER IF EXISTS organizations_delete_retained_billing;
DROP TRIGGER IF EXISTS billing_funds_admission;
DROP VIEW billing_charge_attributions;
CREATE TABLE billing_ledger_entries_postpaid (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT NOT NULL,
  month_utc TEXT,
  related_invoice_id TEXT,
  related_purchase_id TEXT,
  source_event_id TEXT,
  actor_type TEXT NOT NULL,
  actor_user_id TEXT,
  reason_code TEXT,
  note TEXT,
  idempotency_key TEXT,
  created_at_ms INTEGER NOT NULL,
  payment_model TEXT NOT NULL DEFAULT 'prepaid' CHECK (payment_model IN ('prepaid', 'postpaid')),
  ingested_at_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (namespace, org_id, id),
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(id) > 0),
  CHECK (
    entry_type IN (
      'CREDIT_PURCHASE',
      'USAGE_DEBIT',
      'PRODUCT_EXECUTION_DEBIT',
      'MANUAL_ADJUSTMENT',
      'REFUND',
      'DISPUTE_OPENED',
      'DISPUTE_WON', 'PLAN_BASE_CHARGE', 'PLAN_USAGE_CHARGE', 'INVOICE_PAYMENT'
    )
  ),
  CHECK (
    (entry_type IN ('CREDIT_PURCHASE', 'DISPUTE_WON', 'INVOICE_PAYMENT') AND amount_minor > 0)
    OR (entry_type IN ('USAGE_DEBIT', 'PRODUCT_EXECUTION_DEBIT', 'DISPUTE_OPENED', 'REFUND', 'PLAN_BASE_CHARGE') AND amount_minor < 0)
    OR (entry_type IN ('MANUAL_ADJUSTMENT', 'PLAN_USAGE_CHARGE') AND amount_minor != 0)
  ),
  CHECK (currency = 'USD'),
  CHECK (length(description) > 0),
  CHECK (
    month_utc IS NULL
    OR (
      month_utc GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
      AND substr(month_utc, 6, 2) BETWEEN '01' AND '12'
    )
  ),
  CHECK (related_invoice_id IS NULL OR length(related_invoice_id) > 0),
  CHECK (related_purchase_id IS NULL OR length(related_purchase_id) > 0),
  CHECK (source_event_id IS NULL OR length(source_event_id) > 0),
  CHECK (actor_type IN ('USER', 'SYSTEM', 'PROVIDER')),
  CHECK (actor_user_id IS NULL OR length(actor_user_id) > 0),
  CHECK (reason_code IS NULL OR length(reason_code) > 0),
  CHECK (note IS NULL OR length(note) > 0),
  CHECK (idempotency_key IS NULL OR length(idempotency_key) > 0),
  CHECK (created_at_ms > 0)
);


INSERT INTO billing_ledger_entries_postpaid SELECT *, 'prepaid', created_at_ms FROM billing_ledger_entries;
CREATE TABLE billing_postings_preserved AS SELECT * FROM billing_ledger_postings;
DROP TABLE billing_ledger_postings;
DROP TABLE billing_ledger_entries;
ALTER TABLE billing_ledger_entries_postpaid RENAME TO billing_ledger_entries;
CREATE TABLE billing_ledger_postings (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ledger_entry_id TEXT NOT NULL,
  account_code TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, id),
  FOREIGN KEY (namespace, org_id, ledger_entry_id)
    REFERENCES billing_ledger_entries(namespace, org_id, id)
    ON DELETE CASCADE,
  CHECK (length(namespace) > 0),
  CHECK (length(org_id) > 0),
  CHECK (length(id) > 0),
  CHECK (length(ledger_entry_id) > 0),
  CHECK (
    account_code IN (
      'org_prepaid_liability', 'org_receivable',
      'stripe_cash_clearing',
      'revenue_usage',
      'revenue_product_execution',
      'manual_adjustment_clearing',
      'stripe_dispute_clearing'
    )
  ),
  CHECK (direction IN ('DEBIT', 'CREDIT')),
  CHECK (amount_minor > 0),
  CHECK (created_at_ms > 0)
);

INSERT INTO billing_ledger_postings SELECT * FROM billing_postings_preserved;
DROP TABLE billing_postings_preserved;
CREATE UNIQUE INDEX billing_ledger_entries_idempotency_uidx
  ON billing_ledger_entries (namespace, org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX billing_ledger_entries_org_created_idx
  ON billing_ledger_entries (namespace, org_id, created_at_ms DESC, id DESC);

CREATE INDEX billing_ledger_entries_org_month_idx
  ON billing_ledger_entries (namespace, org_id, month_utc, entry_type);

CREATE UNIQUE INDEX billing_ledger_entries_type_source_uidx
  ON billing_ledger_entries (namespace, org_id, entry_type, source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE INDEX billing_ledger_postings_entry_idx
  ON billing_ledger_postings (namespace, org_id, ledger_entry_id);

CREATE VIEW IF NOT EXISTS billing_charge_attributions AS
    SELECT e.namespace, r.ledger_entry_id, e.org_id, e.project_id, e.billing_account_id, e.instance_id,
      e.producer_service_id AS service_id, e.meter_id, e.price_version, e.quantity, e.unit
    FROM billing_usage_events e
    JOIN billing_usage_receipts r USING (namespace, producer_service_id, producer_deployment_id, instance_id, event_id)
    WHERE e.meter_id = 'wallet.monthly_active_resource' AND r.outcome = 'charged'
    UNION ALL
    SELECT c.namespace, c.ledger_entry_id, c.org_id, c.project_id, c.billing_account_id, c.instance_id,
        CASE   c.meter_id WHEN 'wallet.execution' THEN 'wallet' ELSE 'satyr'   END   AS service_id,
      c.meter_id, c.price_version, 1 AS quantity,
        CASE   c.meter_id WHEN 'wallet.execution' THEN 'execution' ELSE 'turn'   END   AS unit
    FROM billing_execution_charges c WHERE c.ledger_entry_id IS NOT NULL;
CREATE TRIGGER billing_ledger_entries_balanced_postings
AFTER INSERT ON billing_ledger_entries
BEGIN
  INSERT INTO billing_ledger_postings (
    namespace,
    org_id,
    id,
    ledger_entry_id,
    account_code,
    direction,
    amount_minor,
    created_at_ms
  )
  VALUES
    (
      NEW.namespace,
      NEW.org_id,
      NEW.id || ':debit',
      NEW.id,
        CASE
        WHEN NEW.amount_minor < 0 THEN   CASE   NEW.payment_model WHEN 'postpaid' THEN 'org_receivable' ELSE 'org_prepaid_liability'   END
        WHEN NEW.entry_type IN ('CREDIT_PURCHASE', 'REFUND', 'INVOICE_PAYMENT') THEN 'stripe_cash_clearing'
        WHEN NEW.entry_type IN ('DISPUTE_OPENED', 'DISPUTE_WON') THEN 'stripe_dispute_clearing'
        WHEN NEW.entry_type IN ('USAGE_DEBIT', 'PLAN_BASE_CHARGE', 'PLAN_USAGE_CHARGE') THEN 'revenue_usage'
        ELSE 'manual_adjustment_clearing'
        END  ,
      'DEBIT',
      ABS(NEW.amount_minor),
      NEW.created_at_ms
    ),
    (
      NEW.namespace,
      NEW.org_id,
      NEW.id || ':credit',
      NEW.id,
        CASE
        WHEN NEW.amount_minor > 0 THEN   CASE   NEW.payment_model WHEN 'postpaid' THEN 'org_receivable' ELSE 'org_prepaid_liability'   END
        WHEN NEW.entry_type IN ('CREDIT_PURCHASE', 'REFUND', 'INVOICE_PAYMENT') THEN 'stripe_cash_clearing'
        WHEN NEW.entry_type IN ('DISPUTE_OPENED', 'DISPUTE_WON') THEN 'stripe_dispute_clearing'
        WHEN NEW.entry_type IN ('USAGE_DEBIT', 'PLAN_BASE_CHARGE', 'PLAN_USAGE_CHARGE') THEN 'revenue_usage'
        WHEN NEW.entry_type = 'MANUAL_ADJUSTMENT' THEN 'manual_adjustment_clearing'
        ELSE 'revenue_product_execution'
        END  ,
      'CREDIT',
      ABS(NEW.amount_minor),
      NEW.created_at_ms
    );
  END  ;


CREATE TRIGGER organizations_delete_retained_billing
BEFORE DELETE ON organizations
WHEN EXISTS (SELECT 1 FROM billing_ledger_entries WHERE namespace = OLD.namespace AND org_id = OLD.id)
 OR EXISTS (SELECT 1 FROM billing_credit_purchases WHERE namespace = OLD.namespace AND org_id = OLD.id)
 OR EXISTS (SELECT 1 FROM billing_refunds WHERE namespace = OLD.namespace AND org_id = OLD.id)
 OR EXISTS (SELECT 1 FROM billing_disputes WHERE namespace = OLD.namespace AND org_id = OLD.id)
 OR EXISTS (SELECT 1 FROM invoices WHERE namespace = OLD.namespace AND org_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'organization_delete_has_billing_history');
  END  ;
CREATE TRIGGER IF NOT EXISTS billing_funds_admission
    BEFORE INSERT ON billing_funds_reservations
    WHEN NEW.status = 'reserved'
    BEGIN
      SELECT RAISE(ABORT, 'funds_scope_forbidden') WHERE NOT EXISTS (
        SELECT 1 FROM platform_service_instances i
        JOIN organizations o ON o.namespace = i.namespace AND o.id = i.org_id
        JOIN projects p ON p.namespace = i.namespace AND p.id = i.project_id AND p.org_id = i.org_id
        WHERE i.namespace = NEW.namespace AND i.id = NEW.instance_id AND i.org_id = NEW.org_id
          AND i.project_id = NEW.project_id AND i.billing_account_id = NEW.billing_account_id
          AND i.service_id = NEW.service_id AND i.deployment_id = NEW.deployment_id
          AND i.phase = 'active' AND i.desired_state = 'enabled' AND i.observed_state = 'active'
          AND i.observed_revision = i.desired_revision AND o.status = 'ACTIVE' AND p.status = 'ACTIVE'
      );
      SELECT RAISE(ABORT, 'funds_insufficient') WHERE NEW.requested_minor >
        COALESCE((SELECT SUM(  CASE   direction WHEN 'CREDIT' THEN amount_minor ELSE -amount_minor   END  )
          FROM billing_ledger_postings WHERE namespace = NEW.namespace AND org_id = NEW.org_id
            AND account_code = 'org_prepaid_liability'), 0)
        - COALESCE((SELECT SUM(requested_minor) FROM billing_funds_reservations
          WHERE namespace = NEW.namespace AND billing_account_id = NEW.billing_account_id
            AND status IN ('reserved', 'indeterminate')), 0)
        - COALESCE((SELECT SUM(amount_minor) FROM billing_refunds
          WHERE namespace = NEW.namespace AND org_id = NEW.org_id AND origin = 'console'
            AND status IN ('requested', 'provider_pending')), 0);
      END  ;
CREATE TABLE billing_payment_policies (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL,
  payment_model TEXT NOT NULL CHECK (payment_model IN ('prepaid', 'postpaid')),
  credit_limit_minor INTEGER, approved_by TEXT, approved_at_ms INTEGER,
  PRIMARY KEY(namespace, org_id),
  FOREIGN KEY(namespace, org_id) REFERENCES organization_billing_accounts(namespace, org_id),
  CHECK ((payment_model = 'prepaid' AND credit_limit_minor IS NULL AND approved_by IS NULL AND approved_at_ms IS NULL)
    OR (payment_model = 'postpaid' AND credit_limit_minor >= 0 AND length(approved_by) > 0 AND approved_at_ms > 0))
);
INSERT INTO billing_payment_policies(namespace, org_id, payment_model)
SELECT namespace, org_id, 'prepaid' FROM organization_billing_accounts;
CREATE TRIGGER billing_payment_policy_open AFTER INSERT ON organization_billing_accounts BEGIN
  INSERT INTO billing_payment_policies(namespace, org_id, payment_model) VALUES(NEW.namespace, NEW.org_id, 'prepaid');
  END  ;
ALTER TABLE billing_funds_reservations ADD COLUMN payment_model TEXT NOT NULL DEFAULT 'prepaid'
  CHECK (payment_model IN ('prepaid', 'postpaid'));
CREATE TRIGGER billing_funds_model_immutable BEFORE UPDATE OF payment_model ON billing_funds_reservations
  WHEN NEW.payment_model <> OLD.payment_model
  BEGIN SELECT RAISE(ABORT, 'funds_operation_conflict');   END  ;
CREATE TABLE billing_monthly_closes (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, month_utc TEXT NOT NULL,
  cutoff_ms INTEGER NOT NULL, amount_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('building', 'zero', 'carried', 'collectible')),
  PRIMARY KEY(namespace, org_id, month_utc),
  FOREIGN KEY(namespace, org_id) REFERENCES organization_billing_accounts(namespace, org_id)
);
CREATE TABLE billing_monthly_invoice_items (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, month_utc TEXT NOT NULL,
  ledger_entry_id TEXT NOT NULL, amount_minor INTEGER NOT NULL,
  description TEXT NOT NULL, usage_month_utc TEXT NOT NULL,
  PRIMARY KEY(namespace, org_id, ledger_entry_id),
  FOREIGN KEY(namespace, org_id, month_utc) REFERENCES billing_monthly_closes(namespace, org_id, month_utc),
  FOREIGN KEY(namespace, org_id, ledger_entry_id) REFERENCES billing_ledger_entries(namespace, org_id, id)
);
CREATE TRIGGER billing_monthly_snapshot_retained BEFORE DELETE ON billing_monthly_invoice_items
  BEGIN SELECT RAISE(ABORT, 'billing_snapshot_immutable');   END  ;
CREATE TRIGGER billing_monthly_snapshot_immutable BEFORE UPDATE ON billing_monthly_invoice_items
  BEGIN SELECT RAISE(ABORT, 'billing_snapshot_immutable');   END  ;
CREATE TRIGGER billing_monthly_close_sealed BEFORE UPDATE ON billing_monthly_closes
  WHEN OLD.status <> 'building'
  BEGIN SELECT RAISE(ABORT, 'billing_snapshot_immutable');   END  ;
CREATE TRIGGER billing_monthly_close_retained BEFORE DELETE ON billing_monthly_closes
  BEGIN SELECT RAISE(ABORT, 'billing_snapshot_immutable');   END  ;
CREATE TABLE billing_monthly_collections (
  namespace TEXT NOT NULL, org_id TEXT NOT NULL, month_utc TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, provider_invoice_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('creating','draft','open','paid','void','uncollectible')),
  created_at_ms INTEGER NOT NULL, checked_at_ms INTEGER NOT NULL,
  first_failed_at_ms INTEGER, hosted_invoice_url TEXT,
  PRIMARY KEY(namespace, org_id, month_utc),
  UNIQUE(namespace, idempotency_key), UNIQUE(namespace, provider_invoice_ref),
  FOREIGN KEY(namespace, org_id) REFERENCES organization_billing_accounts(namespace, org_id),
  CHECK ((status = 'creating' AND provider_invoice_ref IS NULL) OR (status <> 'creating' AND length(provider_invoice_ref) > 0))
);
INSERT INTO billing_monthly_collections(namespace,org_id,month_utc,idempotency_key,provider_invoice_ref,status,created_at_ms,checked_at_ms)
SELECT * FROM billing_plan_base_collections;
DROP TABLE billing_plan_base_collections;
CREATE INDEX billing_monthly_collections_due_idx ON billing_monthly_collections(namespace,status,checked_at_ms);

CREATE TABLE billing_signing_credit_grants (
 namespace TEXT NOT NULL,org_id TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT NOT NULL,environment_id TEXT NOT NULL,
 deployment_lane TEXT NOT NULL,region TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity>0),expires_at_ms INTEGER NOT NULL,created_at_ms INTEGER NOT NULL,
 plan TEXT NOT NULL CHECK(plan IN ('growth','pro')),price_version TEXT NOT NULL,
 sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0,1)),admitted_count INTEGER,settled_count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(namespace,org_id,id),CHECK(settled_count>=0 AND settled_count<=capacity),
 CHECK((sealed=0 AND admitted_count IS NULL) OR (sealed=1 AND admitted_count>=settled_count AND admitted_count<=capacity)),
 FOREIGN KEY(namespace,org_id) REFERENCES organization_billing_accounts(namespace,org_id)
);
CREATE TABLE billing_signing_credit_receipts (
 namespace TEXT NOT NULL,org_id TEXT NOT NULL,signature_id TEXT NOT NULL,grant_id TEXT NOT NULL,
 environment_id TEXT NOT NULL,wallet_id TEXT NOT NULL CHECK(length(wallet_id)>0),outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','failed')),completed_at_ms INTEGER NOT NULL,
 PRIMARY KEY(namespace,org_id,signature_id),
 FOREIGN KEY(namespace,org_id,grant_id) REFERENCES billing_signing_credit_grants(namespace,org_id,id)
);
CREATE TRIGGER billing_signing_credit_failed AFTER INSERT ON billing_signing_credit_receipts WHEN NEW.outcome='failed' BEGIN
 UPDATE billing_signing_credit_grants SET settled_count=settled_count+1 WHERE namespace=NEW.namespace AND org_id=NEW.org_id AND id=NEW.grant_id;
  END  ;
CREATE TRIGGER billing_signing_credit_settled AFTER INSERT ON billing_plan_usage_facts WHEN NEW.kind='signature' BEGIN
 UPDATE billing_signing_credit_grants SET settled_count=settled_count+1
 WHERE namespace=NEW.namespace AND org_id=NEW.org_id AND id=(SELECT grant_id FROM billing_signing_credit_receipts r
 WHERE r.namespace=NEW.namespace AND r.org_id=NEW.org_id AND r.environment_id||':'||r.signature_id=NEW.fact_key AND outcome='succeeded');
  END  ;
CREATE TRIGGER billing_signing_credit_receipt_immutable BEFORE UPDATE ON billing_signing_credit_receipts BEGIN SELECT RAISE(ABORT,'credit_receipt_immutable');   END  ;
CREATE TRIGGER billing_signing_credit_receipt_retained BEFORE DELETE ON billing_signing_credit_receipts BEGIN SELECT RAISE(ABORT,'credit_receipt_immutable');   END  ;


CREATE TABLE billing_invoice_payments (
 namespace TEXT NOT NULL,org_id TEXT NOT NULL,invoice_ref TEXT NOT NULL,payment_ref TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 PRIMARY KEY(namespace,invoice_ref,payment_ref),
 FOREIGN KEY(namespace,invoice_ref) REFERENCES billing_monthly_collections(namespace,provider_invoice_ref)
);
CREATE TABLE billing_invoice_disputes (
 namespace TEXT NOT NULL,org_id TEXT NOT NULL,dispute_ref TEXT NOT NULL,payment_ref TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 status TEXT NOT NULL CHECK(status IN ('open','won','lost')),created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(namespace,dispute_ref)
);
CREATE TRIGGER billing_invoice_dispute_exact BEFORE INSERT ON billing_invoice_disputes
WHEN EXISTS(SELECT 1 FROM billing_invoice_disputes d WHERE d.namespace=NEW.namespace AND d.dispute_ref=NEW.dispute_ref
 AND (d.org_id<>NEW.org_id OR d.payment_ref<>NEW.payment_ref OR d.amount_minor<>NEW.amount_minor))
BEGIN SELECT RAISE(ABORT,'invoice_dispute_conflict');   END  ;
CREATE TRIGGER billing_invoice_dispute_opened AFTER INSERT ON billing_invoice_disputes BEGIN
 INSERT INTO billing_ledger_entries(namespace,org_id,id,entry_type,amount_minor,currency,description,month_utc,source_event_id,actor_type,created_at_ms,payment_model,ingested_at_ms)
 VALUES(NEW.namespace,NEW.org_id,'invoice-dispute:'||NEW.dispute_ref||':opened','DISPUTE_OPENED',-NEW.amount_minor,'USD','Stripe invoice payment disputed',strftime('%Y-%m',NEW.created_at_ms/1000,'unixepoch'),NEW.dispute_ref,'PROVIDER',NEW.created_at_ms,'postpaid',NEW.created_at_ms);
 INSERT INTO billing_ledger_entries(namespace,org_id,id,entry_type,amount_minor,currency,description,month_utc,source_event_id,actor_type,created_at_ms,payment_model,ingested_at_ms)
 SELECT NEW.namespace,NEW.org_id,'invoice-dispute:'||NEW.dispute_ref||':won','DISPUTE_WON',NEW.amount_minor,'USD','Stripe invoice dispute won',strftime('%Y-%m',NEW.created_at_ms/1000,'unixepoch'),NEW.dispute_ref,'PROVIDER',NEW.created_at_ms,'postpaid',NEW.created_at_ms WHERE NEW.status='won';
  END  ;
CREATE TRIGGER billing_invoice_dispute_won AFTER UPDATE OF status ON billing_invoice_disputes WHEN NEW.status='won' AND OLD.status<>'won' BEGIN
 INSERT INTO billing_ledger_entries(namespace,org_id,id,entry_type,amount_minor,currency,description,month_utc,source_event_id,actor_type,created_at_ms,payment_model,ingested_at_ms)
 VALUES(NEW.namespace,NEW.org_id,'invoice-dispute:'||NEW.dispute_ref||':won','DISPUTE_WON',NEW.amount_minor,'USD','Stripe invoice dispute won',strftime('%Y-%m',NEW.created_at_ms/1000,'unixepoch'),NEW.dispute_ref,'PROVIDER',NEW.created_at_ms,'postpaid',NEW.created_at_ms);
  END  ;

CREATE VIEW billing_postpaid_exposure AS
SELECT p.namespace, p.org_id, p.credit_limit_minor,
  COALESCE((SELECT SUM(  CASE   direction WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor   END  )
    FROM billing_ledger_postings l WHERE l.namespace=p.namespace AND l.org_id=p.org_id AND l.account_code='org_receivable'),0)
  + MAX(0,COALESCE((SELECT SUM( CASE direction WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END )
    FROM billing_ledger_postings l WHERE l.namespace=p.namespace AND l.org_id=p.org_id AND l.account_code='org_prepaid_liability'),0)) AS unpaid_minor,
  COALESCE((SELECT SUM(requested_minor) FROM billing_funds_reservations r
    WHERE r.namespace=p.namespace AND r.org_id=p.org_id AND r.status IN ('reserved','indeterminate')),0)
  + COALESCE((SELECT SUM(  CASE   sealed WHEN 1 THEN admitted_count ELSE capacity   END  -settled_count) FROM billing_signing_credit_grants g WHERE g.namespace=p.namespace AND g.org_id=p.org_id),0) AS reserved_minor,
  (SELECT MIN(first_failed_at_ms) FROM billing_monthly_collections c WHERE c.namespace=p.namespace AND c.org_id=p.org_id AND c.status<>'paid') AS first_failed_at_ms,
  EXISTS(SELECT 1 FROM billing_monthly_collections c WHERE c.namespace=p.namespace AND c.org_id=p.org_id AND c.status IN ('void','uncollectible')) OR EXISTS(SELECT 1 FROM billing_invoice_disputes d WHERE d.namespace=p.namespace AND d.org_id=p.org_id AND d.status<>'won') OR EXISTS(SELECT 1 FROM billing_disputes d WHERE d.namespace=p.namespace AND d.org_id=p.org_id AND d.status<>'won') AS collection_blocked
FROM billing_payment_policies p WHERE p.payment_model='postpaid';
CREATE TRIGGER billing_postpaid_base_charge AFTER INSERT ON billing_plan_base_charges
WHEN EXISTS(SELECT 1 FROM billing_payment_policies p WHERE p.namespace=NEW.namespace AND p.org_id=NEW.org_id AND p.payment_model='postpaid')
BEGIN
  INSERT INTO billing_ledger_entries(namespace,org_id,id,entry_type,amount_minor,currency,description,month_utc,source_event_id,actor_type,reason_code,created_at_ms,payment_model,ingested_at_ms)
  VALUES(NEW.namespace,NEW.org_id,'plan-base:'||NEW.month_utc,'PLAN_BASE_CHARGE',-NEW.amount_minor,'USD',
    'Seams '||NEW.plan||' base fee ('||NEW.price_version||')',NEW.month_utc,'plan-base:'||NEW.month_utc,'SYSTEM','plan_base_charge',NEW.period_start_ms,'postpaid',NEW.created_at_ms);

 INSERT INTO billing_plan_paid_usage(namespace,org_id,month_utc,plan,price_version,active_users,signatures,updated_at_ms)
 SELECT NEW.namespace,NEW.org_id,NEW.month_utc,NEW.plan,NEW.price_version,
 COALESCE(u.production_active_users,0),COALESCE(u.production_signatures,0),NEW.created_at_ms
 FROM billing_payment_policies p LEFT JOIN billing_plan_usage_months u
 ON u.namespace=p.namespace AND u.org_id=p.org_id AND u.month_utc=NEW.month_utc
 WHERE p.namespace=NEW.namespace AND p.org_id=NEW.org_id AND p.payment_model='postpaid'
 ON CONFLICT(namespace,org_id,month_utc) DO NOTHING;
  END  ;
PRAGMA defer_foreign_keys = OFF;

DROP TRIGGER billing_funds_admission;
CREATE TRIGGER billing_funds_admission
    BEFORE INSERT ON billing_funds_reservations
    WHEN NEW.status = 'reserved'
    BEGIN
      SELECT RAISE(ABORT, 'funds_scope_forbidden') WHERE NOT EXISTS (
        SELECT 1 FROM platform_service_instances i
        JOIN organizations o ON o.namespace = i.namespace AND o.id = i.org_id
        JOIN projects p ON p.namespace = i.namespace AND p.id = i.project_id AND p.org_id = i.org_id
        WHERE i.namespace = NEW.namespace AND i.id = NEW.instance_id AND i.org_id = NEW.org_id
          AND i.project_id = NEW.project_id AND i.billing_account_id = NEW.billing_account_id
          AND i.service_id = NEW.service_id AND i.deployment_id = NEW.deployment_id
          AND i.phase = 'active' AND i.desired_state = 'enabled' AND i.observed_state = 'active'
          AND i.observed_revision = i.desired_revision AND o.status = 'ACTIVE' AND p.status = 'ACTIVE'
      );
      SELECT RAISE(ABORT, 'funds_insufficient') WHERE NEW.payment_model = 'prepaid' AND NEW.requested_minor >
        COALESCE((SELECT SUM(  CASE   direction WHEN 'CREDIT' THEN amount_minor ELSE -amount_minor   END  )
          FROM billing_ledger_postings WHERE namespace = NEW.namespace AND org_id = NEW.org_id
            AND account_code = 'org_prepaid_liability'), 0)
        - COALESCE((SELECT SUM(requested_minor) FROM billing_funds_reservations
          WHERE namespace = NEW.namespace AND billing_account_id = NEW.billing_account_id
            AND status IN ('reserved', 'indeterminate')), 0)
        - COALESCE((SELECT SUM(amount_minor) FROM billing_refunds
          WHERE namespace = NEW.namespace AND org_id = NEW.org_id AND origin = 'console'
            AND status IN ('requested', 'provider_pending')), 0);
      SELECT RAISE(ABORT, 'funds_insufficient') WHERE NEW.payment_model = 'postpaid' AND (
        NOT EXISTS (SELECT 1 FROM billing_payment_methods m WHERE m.namespace=NEW.namespace AND m.org_id=NEW.org_id
          AND m.status='usable' AND m.exp_year * 12 + m.exp_month - 1 >=
            CAST(strftime('%Y', NEW.created_at_ms / 1000, 'unixepoch') AS INTEGER) * 12 + CAST(strftime('%m', NEW.created_at_ms / 1000, 'unixepoch') AS INTEGER) - 1)
        OR NOT EXISTS (SELECT 1 FROM billing_postpaid_exposure e WHERE e.namespace=NEW.namespace AND e.org_id=NEW.org_id
          AND e.credit_limit_minor > 0 AND NEW.requested_minor <= e.credit_limit_minor - e.unpaid_minor - e.reserved_minor
          AND e.collection_blocked=0 AND (e.first_failed_at_ms IS NULL OR NEW.created_at_ms < e.first_failed_at_ms + 604800000))
        OR EXISTS (SELECT 1 FROM billing_account_plans p WHERE p.namespace=NEW.namespace AND p.org_id=NEW.org_id
          AND p.plan IN ('growth','pro') AND NOT EXISTS (SELECT 1 FROM billing_plan_base_charges c
            WHERE c.namespace=p.namespace AND c.org_id=p.org_id AND c.month_utc=strftime('%Y-%m', NEW.created_at_ms / 1000, 'unixepoch')))
      );
      SELECT RAISE(ABORT, 'funds_operation_conflict') WHERE NEW.payment_model <>
        (SELECT payment_model FROM billing_payment_policies WHERE namespace=NEW.namespace AND org_id=NEW.org_id);
      END  ;

CREATE TABLE billing_credit_limit_changes (
 namespace TEXT NOT NULL, org_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 credit_limit_minor INTEGER NOT NULL CHECK(credit_limit_minor>=0), actor_user_id TEXT NOT NULL,
 reason TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(namespace,operation_id),
 FOREIGN KEY(namespace,org_id) REFERENCES organization_billing_accounts(namespace,org_id)
);
CREATE TRIGGER billing_credit_changes_retained BEFORE DELETE ON billing_credit_limit_changes
 BEGIN SELECT RAISE(ABORT,'billing_credit_change_immutable');   END  ;
CREATE TRIGGER billing_credit_changes_immutable BEFORE UPDATE ON billing_credit_limit_changes
 BEGIN SELECT RAISE(ABORT,'billing_credit_change_immutable');   END  ;
CREATE TRIGGER billing_postpaid_conversion BEFORE UPDATE OF payment_model ON billing_payment_policies
WHEN OLD.payment_model <> NEW.payment_model BEGIN
 SELECT RAISE(ABORT,'postpaid_conversion_ineligible') WHERE NEW.payment_model<>'postpaid' OR NEW.credit_limit_minor<=0
 OR NOT EXISTS(SELECT 1 FROM billing_payment_methods m WHERE m.namespace=NEW.namespace AND m.org_id=NEW.org_id AND m.status='usable'
   AND m.exp_year * 12 + m.exp_month - 1 >= CAST(strftime('%Y',NEW.approved_at_ms/1000,'unixepoch') AS INTEGER)*12 + CAST(strftime('%m',NEW.approved_at_ms/1000,'unixepoch') AS INTEGER)-1)
 OR COALESCE((SELECT SUM(  CASE   direction WHEN 'CREDIT' THEN amount_minor ELSE -amount_minor   END  ) FROM billing_ledger_postings
   WHERE namespace=NEW.namespace AND org_id=NEW.org_id AND account_code='org_prepaid_liability'),0)<>0
 OR EXISTS(SELECT 1 FROM billing_funds_reservations WHERE namespace=NEW.namespace AND org_id=NEW.org_id AND status IN ('reserved','indeterminate'))
 OR EXISTS(SELECT 1 FROM billing_refunds WHERE namespace=NEW.namespace AND org_id=NEW.org_id AND status IN ('requested','provider_pending'))
 OR EXISTS(SELECT 1 FROM billing_disputes WHERE namespace=NEW.namespace AND org_id=NEW.org_id AND status<>'won')
 OR EXISTS(SELECT 1 FROM billing_credit_purchases WHERE namespace=NEW.namespace AND org_id=NEW.org_id AND status='PENDING')
 OR EXISTS(SELECT 1 FROM billing_plan_base_charges b LEFT JOIN billing_monthly_collections c USING(namespace,org_id,month_utc)
   WHERE b.namespace=NEW.namespace AND b.org_id=NEW.org_id AND (c.status IS NULL OR c.status<>'paid'));
  END  ;
ALTER TABLE billing_account_plans ADD COLUMN downgrade_at_ms INTEGER;
CREATE TRIGGER billing_postpaid_execution_reserved BEFORE INSERT ON billing_ledger_entries
WHEN NEW.payment_model='postpaid' AND NEW.entry_type='PRODUCT_EXECUTION_DEBIT'
AND NOT EXISTS(SELECT 1 FROM billing_execution_charges c JOIN billing_funds_reservations r ON r.namespace=c.namespace AND r.id=c.reservation_id
 WHERE c.namespace=NEW.namespace AND c.org_id=NEW.org_id AND c.ledger_entry_id=NEW.id AND r.payment_model='postpaid' AND c.settled_minor<=r.requested_minor)
BEGIN SELECT RAISE(ABORT,'postpaid_execution_requires_reservation');   END  ;

CREATE TABLE billing_plan_paid_usage (
 namespace TEXT NOT NULL,org_id TEXT NOT NULL,month_utc TEXT NOT NULL,
 plan TEXT NOT NULL CHECK(plan IN ('growth','pro')),price_version TEXT NOT NULL,
 active_users INTEGER NOT NULL CHECK(active_users>=0),signatures INTEGER NOT NULL CHECK(signatures>=0),
 revision INTEGER NOT NULL DEFAULT 0,
 charged_minor INTEGER NOT NULL DEFAULT 0 CHECK(charged_minor>=0),updated_at_ms INTEGER NOT NULL,
 PRIMARY KEY(namespace,org_id,month_utc)
);
CREATE TRIGGER billing_plan_paid_active_user AFTER INSERT ON billing_plan_usage_facts WHEN NEW.kind='active_user' BEGIN
 INSERT INTO billing_plan_paid_usage(namespace,org_id,month_utc,plan,price_version,active_users,signatures,updated_at_ms)
 SELECT NEW.namespace,NEW.org_id,NEW.month_utc,p.plan,p.price_version,1,0,NEW.recorded_at_ms
 FROM billing_account_plans p JOIN billing_payment_policies policy USING(namespace,org_id)
 WHERE p.namespace=NEW.namespace AND p.org_id=NEW.org_id AND p.plan IN ('growth','pro') AND policy.payment_model='postpaid'
 ON CONFLICT(namespace,org_id,month_utc) DO UPDATE SET active_users=active_users+1,
 revision=revision+1,updated_at_ms=MAX(updated_at_ms,excluded.updated_at_ms);
  END  ;
CREATE TRIGGER billing_plan_paid_signature AFTER INSERT ON billing_plan_usage_facts WHEN NEW.kind='signature' BEGIN
 INSERT INTO billing_plan_paid_usage(namespace,org_id,month_utc,plan,price_version,active_users,signatures,updated_at_ms)
 SELECT NEW.namespace,NEW.org_id,NEW.month_utc,g.plan,g.price_version,0,1,NEW.recorded_at_ms
 FROM billing_signing_credit_receipts r JOIN billing_signing_credit_grants g
 ON g.namespace=r.namespace AND g.org_id=r.org_id AND g.id=r.grant_id
 WHERE r.namespace=NEW.namespace AND r.org_id=NEW.org_id AND r.environment_id||':'||r.signature_id=NEW.fact_key AND r.outcome='succeeded'
 ON CONFLICT(namespace,org_id,month_utc) DO UPDATE SET signatures=signatures+1,
 revision=revision+1,updated_at_ms=MAX(updated_at_ms,excluded.updated_at_ms);
  END  ;
CREATE VIEW billing_plan_usage_costs AS
SELECT u.namespace,u.org_id,u.month_utc,u.price_version,
 COALESCE(u.active_users,0) AS active_users,COALESCE(u.signatures,0) AS signatures,
 (MAX(0,COALESCE(u.active_users,0)-  CASE   u.plan WHEN 'growth' THEN 5000 ELSE 100000   END  )
    *   CASE   u.plan WHEN 'growth' THEN 4000 ELSE 3500   END
  + MAX(0,COALESCE(u.signatures,0)-COALESCE(u.active_users,0)*300)
    *   CASE   u.plan WHEN 'growth' THEN 50 ELSE 40   END   + 9999) / 10000 AS amount_minor
FROM billing_plan_paid_usage u;
CREATE TRIGGER billing_plan_usage_accrue_insert AFTER INSERT ON billing_plan_paid_usage BEGIN
 INSERT INTO billing_ledger_entries(namespace,org_id,id,entry_type,amount_minor,currency,description,month_utc,actor_type,reason_code,created_at_ms,payment_model,ingested_at_ms)
 SELECT NEW.namespace,NEW.org_id,'plan-usage:'||NEW.month_utc||':'||NEW.revision,
 'PLAN_USAGE_CHARGE',NEW.charged_minor-c.amount_minor,'USD','Wallet plan usage ('||c.price_version||')',NEW.month_utc,'SYSTEM','plan_usage',NEW.updated_at_ms,'postpaid',NEW.updated_at_ms
 FROM billing_plan_usage_costs c WHERE c.namespace=NEW.namespace AND c.org_id=NEW.org_id AND c.month_utc=NEW.month_utc AND c.amount_minor<>NEW.charged_minor;
 UPDATE billing_plan_paid_usage SET charged_minor=(SELECT amount_minor FROM billing_plan_usage_costs c WHERE c.namespace=NEW.namespace AND c.org_id=NEW.org_id AND c.month_utc=NEW.month_utc)
 WHERE namespace=NEW.namespace AND org_id=NEW.org_id AND month_utc=NEW.month_utc
 AND EXISTS(SELECT 1 FROM billing_plan_usage_costs c WHERE c.namespace=NEW.namespace AND c.org_id=NEW.org_id AND c.month_utc=NEW.month_utc);
   END  ;
CREATE TRIGGER billing_plan_usage_accrue_update AFTER UPDATE OF signatures,active_users ON billing_plan_paid_usage BEGIN
 INSERT INTO billing_ledger_entries(namespace,org_id,id,entry_type,amount_minor,currency,description,month_utc,actor_type,reason_code,created_at_ms,payment_model,ingested_at_ms)
 SELECT NEW.namespace,NEW.org_id,'plan-usage:'||NEW.month_utc||':'||NEW.revision,
 'PLAN_USAGE_CHARGE',NEW.charged_minor-c.amount_minor,'USD','Wallet plan usage ('||c.price_version||')',NEW.month_utc,'SYSTEM','plan_usage',NEW.updated_at_ms,'postpaid',NEW.updated_at_ms
 FROM billing_plan_usage_costs c WHERE c.namespace=NEW.namespace AND c.org_id=NEW.org_id AND c.month_utc=NEW.month_utc AND c.amount_minor<>NEW.charged_minor;
 UPDATE billing_plan_paid_usage SET charged_minor=(SELECT amount_minor FROM billing_plan_usage_costs c WHERE c.namespace=NEW.namespace AND c.org_id=NEW.org_id AND c.month_utc=NEW.month_utc)
 WHERE namespace=NEW.namespace AND org_id=NEW.org_id AND month_utc=NEW.month_utc
 AND EXISTS(SELECT 1 FROM billing_plan_usage_costs c WHERE c.namespace=NEW.namespace AND c.org_id=NEW.org_id AND c.month_utc=NEW.month_utc);
   END  ;
CREATE TRIGGER billing_signing_credit_receipt_exact BEFORE INSERT ON billing_signing_credit_receipts
WHEN EXISTS(SELECT 1 FROM billing_signing_credit_receipts r WHERE r.namespace=NEW.namespace AND r.org_id=NEW.org_id AND r.signature_id=NEW.signature_id
 AND (r.grant_id<>NEW.grant_id OR r.wallet_id<>NEW.wallet_id OR r.environment_id<>NEW.environment_id OR r.outcome<>NEW.outcome OR r.completed_at_ms<>NEW.completed_at_ms))
BEGIN SELECT RAISE(ABORT,'signing_credit_receipt_conflict');   END  ;
CREATE TRIGGER billing_postpaid_base_admission BEFORE INSERT ON billing_plan_base_charges
WHEN NOT EXISTS(SELECT 1 FROM billing_plan_base_charges b WHERE b.namespace=NEW.namespace AND b.org_id=NEW.org_id AND b.month_utc=NEW.month_utc)
AND EXISTS(SELECT 1 FROM billing_payment_policies p WHERE p.namespace=NEW.namespace AND p.org_id=NEW.org_id AND payment_model='postpaid')
BEGIN
 SELECT RAISE(ABORT,'postpaid_base_credit_exhausted') WHERE NOT EXISTS(SELECT 1 FROM billing_postpaid_exposure e
 WHERE e.namespace=NEW.namespace AND e.org_id=NEW.org_id AND NEW.amount_minor<=e.credit_limit_minor-e.unpaid_minor-e.reserved_minor
 AND e.collection_blocked=0 AND (e.first_failed_at_ms IS NULL OR NEW.created_at_ms<e.first_failed_at_ms+604800000));
  END  ;

CREATE VIEW billing_documents AS
 SELECT i.*,NULL AS hosted_invoice_url FROM invoices i
 UNION ALL
 SELECT c.namespace,c.org_id,'monthly:'||c.org_id||':'||c.month_utc,'MONTHLY_INVOICE',
     CASE   p.status WHEN 'paid' THEN 'PAID' WHEN 'void' THEN 'VOID' WHEN 'uncollectible' THEN 'UNCOLLECTIBLE' ELSE 'OPEN'   END  ,
   'USD',c.amount_minor,  CASE   p.status WHEN 'paid' THEN c.amount_minor ELSE 0   END  ,c.month_utc,c.cutoff_ms,
   p.first_failed_at_ms+604800000,p.hosted_invoice_url
 FROM billing_monthly_closes c LEFT JOIN billing_monthly_collections p USING(namespace,org_id,month_utc)
 WHERE c.status='collectible';
CREATE VIEW billing_document_line_items AS
 SELECT * FROM invoice_line_items
 UNION ALL
 SELECT i.namespace,i.org_id,
   'monthly-item:'||i.month_utc||':'||i.usage_month_utc||':'||l.entry_type||':'||COALESCE(a.project_id,'account')||':'||COALESCE(a.price_version,'plan'),
   'monthly:'||i.org_id||':'||i.month_utc,i.month_utc,
     CASE   l.entry_type WHEN 'PRODUCT_EXECUTION_DEBIT' THEN 'PRODUCT_EXECUTION_DEBIT' WHEN 'PLAN_BASE_CHARGE' THEN 'PLAN_BASE_FEE' WHEN 'PLAN_USAGE_CHARGE' THEN 'PLAN_SIGNING_USAGE' ELSE 'MANUAL_ADJUSTMENT'   END  ,
     CASE   l.entry_type WHEN 'PRODUCT_EXECUTION_DEBIT' THEN COALESCE(a.service_id,'Product')||' execution / '||COALESCE(a.project_id,'organization')||' / '||COALESCE(a.price_version,'accepted quote')
     ELSE MAX(l.description)   END  ||' [usage month '||i.usage_month_utc||']',
   1,SUM(i.amount_minor),SUM(i.amount_minor),MAX(c.cutoff_ms)
 FROM billing_monthly_invoice_items i JOIN billing_monthly_closes c USING(namespace,org_id,month_utc)
 JOIN billing_ledger_entries l ON l.namespace=i.namespace AND l.org_id=i.org_id AND l.id=i.ledger_entry_id
 LEFT JOIN billing_charge_attributions a ON a.namespace=l.namespace AND a.org_id=l.org_id AND a.ledger_entry_id=l.id
 GROUP BY i.namespace,i.org_id,i.month_utc,i.usage_month_utc,l.entry_type,a.project_id,a.service_id,a.price_version
 HAVING SUM(i.amount_minor)<>0;

CREATE TRIGGER billing_signing_credit_evaluate AFTER UPDATE OF sealed,settled_count ON billing_signing_credit_grants BEGIN
 UPDATE billing_account_plans SET evaluation_due_at_ms=0 WHERE namespace=NEW.namespace AND org_id=NEW.org_id;
  END  ;

CREATE TABLE billing_invoice_credits (
 namespace TEXT NOT NULL,org_id TEXT NOT NULL,credit_entry_id TEXT NOT NULL,invoice_ref TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),idempotency_key TEXT NOT NULL,created_at_ms INTEGER NOT NULL,
 provider_credit_note_ref TEXT,
 PRIMARY KEY(namespace,org_id,credit_entry_id,invoice_ref),UNIQUE(namespace,idempotency_key),UNIQUE(namespace,provider_credit_note_ref),
 FOREIGN KEY(namespace,org_id,credit_entry_id) REFERENCES billing_ledger_entries(namespace,org_id,id),
 FOREIGN KEY(namespace,invoice_ref) REFERENCES billing_monthly_collections(namespace,provider_invoice_ref)
);
CREATE TRIGGER billing_invoice_credit_identity BEFORE UPDATE ON billing_invoice_credits
WHEN NEW.namespace<>OLD.namespace OR NEW.org_id<>OLD.org_id OR NEW.credit_entry_id<>OLD.credit_entry_id OR NEW.invoice_ref<>OLD.invoice_ref
 OR NEW.amount_minor<>OLD.amount_minor OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.created_at_ms<>OLD.created_at_ms
 OR (OLD.provider_credit_note_ref IS NOT NULL AND NEW.provider_credit_note_ref IS NOT OLD.provider_credit_note_ref)
BEGIN SELECT RAISE(ABORT,'invoice_credit_immutable');   END  ;
CREATE TRIGGER billing_invoice_credit_retained BEFORE DELETE ON billing_invoice_credits
BEGIN SELECT RAISE(ABORT,'invoice_credit_immutable');   END  ;

CREATE TRIGGER billing_paid_usage_price BEFORE INSERT ON billing_plan_paid_usage
WHEN EXISTS(SELECT 1 FROM billing_plan_paid_usage u WHERE u.namespace=NEW.namespace AND u.org_id=NEW.org_id AND u.month_utc=NEW.month_utc AND (u.plan<>NEW.plan OR u.price_version<>NEW.price_version))
BEGIN SELECT RAISE(ABORT,'billing_month_price_conflict');   END  ;
CREATE TRIGGER billing_base_price_matches_usage BEFORE INSERT ON billing_plan_base_charges
WHEN EXISTS(SELECT 1 FROM billing_plan_paid_usage u WHERE u.namespace=NEW.namespace AND u.org_id=NEW.org_id AND u.month_utc=NEW.month_utc AND (u.plan<>NEW.plan OR u.price_version<>NEW.price_version))
BEGIN SELECT RAISE(ABORT,'billing_month_price_conflict');   END  ;
CREATE TRIGGER billing_signing_credit_admission BEFORE INSERT ON billing_signing_credit_grants BEGIN
 SELECT RAISE(ABORT,'signing_credit_unavailable') WHERE NOT EXISTS(
 SELECT 1 FROM billing_postpaid_exposure e JOIN billing_account_plans p USING(namespace,org_id)
 JOIN organizations o ON o.namespace=p.namespace AND o.id=p.org_id
 JOIN projects project ON project.namespace=p.namespace AND project.org_id=p.org_id AND project.id=NEW.project_id
 WHERE e.namespace=NEW.namespace AND e.org_id=NEW.org_id AND e.credit_limit_minor>0
 AND NEW.capacity<=e.credit_limit_minor-e.unpaid_minor-e.reserved_minor AND e.collection_blocked=0
 AND (e.first_failed_at_ms IS NULL OR NEW.created_at_ms<e.first_failed_at_ms+604800000)
 AND p.plan=NEW.plan AND p.price_version=NEW.price_version AND o.status='ACTIVE' AND project.status='ACTIVE'
 AND (p.downgrade_at_ms IS NULL OR NEW.created_at_ms<p.downgrade_at_ms)
 AND EXISTS(SELECT 1 FROM billing_plan_base_charges b WHERE b.namespace=p.namespace AND b.org_id=p.org_id AND b.month_utc=strftime('%Y-%m',NEW.created_at_ms/1000,'unixepoch'))
 AND EXISTS(SELECT 1 FROM billing_payment_methods m WHERE m.namespace=p.namespace AND m.org_id=p.org_id AND m.status='usable'
 AND m.exp_year*12+m.exp_month-1>=CAST(strftime('%Y',NEW.created_at_ms/1000,'unixepoch') AS INTEGER)*12+CAST(strftime('%m',NEW.created_at_ms/1000,'unixepoch') AS INTEGER)-1));
  END  ;

CREATE TRIGGER billing_mau_credit_insert BEFORE INSERT ON billing_plan_paid_usage
WHEN NEW.active_users>0
BEGIN
 SELECT RAISE(ABORT,'billing_mau_credit_exhausted') WHERE ((MAX(0,NEW.active_users-  CASE   NEW.plan WHEN 'growth' THEN 5000 ELSE 100000   END  )*  CASE   NEW.plan WHEN 'growth' THEN 4000 ELSE 3500   END   + MAX(0,NEW.signatures-NEW.active_users*300)*  CASE   NEW.plan WHEN 'growth' THEN 50 ELSE 40   END   + 9999)/10000)>0 AND NOT EXISTS(
 SELECT 1 FROM billing_postpaid_exposure e WHERE e.namespace=NEW.namespace AND e.org_id=NEW.org_id AND e.credit_limit_minor>0
 AND ((MAX(0,NEW.active_users-  CASE   NEW.plan WHEN 'growth' THEN 5000 ELSE 100000   END  )*  CASE   NEW.plan WHEN 'growth' THEN 4000 ELSE 3500   END   + MAX(0,NEW.signatures-NEW.active_users*300)*  CASE   NEW.plan WHEN 'growth' THEN 50 ELSE 40   END   + 9999)/10000)-0<=e.credit_limit_minor-e.unpaid_minor-e.reserved_minor
 AND EXISTS(SELECT 1 FROM billing_plan_base_charges base WHERE base.namespace=NEW.namespace AND base.org_id=NEW.org_id AND base.month_utc=NEW.month_utc)
 AND e.collection_blocked=0 AND (e.first_failed_at_ms IS NULL OR NEW.updated_at_ms<e.first_failed_at_ms+604800000)
 AND EXISTS(SELECT 1 FROM billing_payment_methods m WHERE m.namespace=NEW.namespace AND m.org_id=NEW.org_id AND status='usable'
 AND m.exp_year*12+m.exp_month-1>=CAST(strftime('%Y',NEW.updated_at_ms/1000,'unixepoch') AS INTEGER)*12+CAST(strftime('%m',NEW.updated_at_ms/1000,'unixepoch') AS INTEGER)-1));
  END  ;

CREATE TRIGGER billing_mau_credit_update BEFORE UPDATE OF active_users ON billing_plan_paid_usage
WHEN NEW.active_users>OLD.active_users
BEGIN
 SELECT RAISE(ABORT,'billing_mau_credit_exhausted') WHERE ((MAX(0,NEW.active_users-  CASE   NEW.plan WHEN 'growth' THEN 5000 ELSE 100000   END  )*  CASE   NEW.plan WHEN 'growth' THEN 4000 ELSE 3500   END   + MAX(0,NEW.signatures-NEW.active_users*300)*  CASE   NEW.plan WHEN 'growth' THEN 50 ELSE 40   END   + 9999)/10000)>OLD.charged_minor AND NOT EXISTS(
 SELECT 1 FROM billing_postpaid_exposure e WHERE e.namespace=NEW.namespace AND e.org_id=NEW.org_id AND e.credit_limit_minor>0
 AND ((MAX(0,NEW.active_users-  CASE   NEW.plan WHEN 'growth' THEN 5000 ELSE 100000   END  )*  CASE   NEW.plan WHEN 'growth' THEN 4000 ELSE 3500   END   + MAX(0,NEW.signatures-NEW.active_users*300)*  CASE   NEW.plan WHEN 'growth' THEN 50 ELSE 40   END   + 9999)/10000)-OLD.charged_minor<=e.credit_limit_minor-e.unpaid_minor-e.reserved_minor
 AND EXISTS(SELECT 1 FROM billing_plan_base_charges base WHERE base.namespace=NEW.namespace AND base.org_id=NEW.org_id AND base.month_utc=NEW.month_utc)
 AND e.collection_blocked=0 AND (e.first_failed_at_ms IS NULL OR NEW.updated_at_ms<e.first_failed_at_ms+604800000)
 AND EXISTS(SELECT 1 FROM billing_payment_methods m WHERE m.namespace=NEW.namespace AND m.org_id=NEW.org_id AND status='usable'
 AND m.exp_year*12+m.exp_month-1>=CAST(strftime('%Y',NEW.updated_at_ms/1000,'unixepoch') AS INTEGER)*12+CAST(strftime('%m',NEW.updated_at_ms/1000,'unixepoch') AS INTEGER)-1));
  END  ;
