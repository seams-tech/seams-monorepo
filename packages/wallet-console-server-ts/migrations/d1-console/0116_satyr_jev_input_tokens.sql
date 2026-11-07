-- Satyr Jev input tokens (Plan 88): a block-measured price for isolated test accounts,
-- one usage row per Jev feature-hour, and the funds meter for their reservations.
-- SQLite cannot widen a CHECK in place, so three tables are rebuilt with every row kept.
PRAGMA defer_foreign_keys = ON;
DROP VIEW billing_document_line_items;
DROP VIEW billing_charge_attributions;
DROP TRIGGER billing_postpaid_execution_reserved;

CREATE TABLE billing_price_definitions_jev (
    meter_id TEXT NOT NULL,
    version TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('fixed_measured', 'quoted_execution', 'block_measured')),
    currency TEXT NOT NULL CHECK (currency = 'USD'),
    unit_minor INTEGER,
    time_rule TEXT NOT NULL CHECK (time_rule IN ('occurred_at_utc_month', 'terminal_accepted_at', 'accepted_quote_at', 'hour_start_utc_month')),
    availability TEXT NOT NULL CHECK (availability IN ('customer_accounts', 'isolated_test_accounts')),
    block_units INTEGER,
    included_units INTEGER,
    PRIMARY KEY (meter_id, version),
    CHECK ((kind = 'fixed_measured' AND unit_minor > 0 AND block_units IS NULL AND included_units IS NULL)
      OR (kind = 'quoted_execution' AND unit_minor IS NULL AND block_units IS NULL AND included_units IS NULL)
      OR (kind = 'block_measured' AND unit_minor > 0 AND block_units > 0 AND included_units >= 0))
  );
INSERT INTO billing_price_definitions_jev (meter_id, version, kind, currency, unit_minor, time_rule, availability)
    SELECT meter_id, version, kind, currency, unit_minor, time_rule, availability FROM billing_price_definitions;
DROP TABLE billing_price_definitions;
ALTER TABLE billing_price_definitions_jev RENAME TO billing_price_definitions;

CREATE TRIGGER billing_prices_immutable_update BEFORE UPDATE ON billing_price_definitions
    BEGIN SELECT RAISE(ABORT, 'billing_price_immutable'); END;

CREATE TRIGGER billing_prices_immutable_delete BEFORE DELETE ON billing_price_definitions
    BEGIN SELECT RAISE(ABORT, 'billing_price_immutable'); END;

-- $0.084 per million input tokens, after 23,809,523 tokens ($1.00 of TypeSafe cost) each UTC month.
INSERT INTO billing_price_definitions (meter_id, version, kind, currency, unit_minor, time_rule, availability, block_units, included_units)
    VALUES ('satyr.jev_input_tokens', 'satyr-jev-input-tokens-v1', 'block_measured', 'USD', 84, 'hour_start_utc_month', 'isolated_test_accounts', 10000000, 23809523);

CREATE TABLE billing_usage_events_jev (
    namespace TEXT NOT NULL,
    producer_service_id TEXT NOT NULL CHECK (producer_service_id IN ('wallet', 'satyr')),
    producer_deployment_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    org_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    meter_id TEXT NOT NULL CHECK (meter_id IN ('wallet.monthly_active_resource', 'wallet.execution', 'satyr.completed_turn.test', 'satyr.jev_input_tokens')),
    quantity INTEGER NOT NULL CHECK ((meter_id = 'satyr.jev_input_tokens' AND quantity >= 0) OR quantity IN (0, 1)),
    unit TEXT NOT NULL CHECK (unit IN ('resource_month', 'execution', 'turn', 'input_token')),
    occurred_at_ms INTEGER NOT NULL,
    price_version TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, producer_service_id, producer_deployment_id, instance_id, event_id),
    FOREIGN KEY (namespace, instance_id) REFERENCES platform_service_instances(namespace, id),
    FOREIGN KEY (meter_id, price_version) REFERENCES billing_price_definitions(meter_id, version),
    FOREIGN KEY (namespace, producer_service_id, producer_deployment_id, instance_id, event_id)
      REFERENCES billing_usage_receipts(namespace, producer_service_id, producer_deployment_id, instance_id, event_id)
      DEFERRABLE INITIALLY DEFERRED
  );
INSERT INTO billing_usage_events_jev SELECT * FROM billing_usage_events;
DROP TABLE billing_usage_events;
ALTER TABLE billing_usage_events_jev RENAME TO billing_usage_events;

CREATE TRIGGER billing_usage_events_scope_guard BEFORE INSERT ON billing_usage_events
    WHEN NOT EXISTS (SELECT 1 FROM platform_service_instances i WHERE i.namespace = NEW.namespace AND i.id = NEW.instance_id
      AND i.org_id = NEW.org_id AND i.project_id = NEW.project_id AND i.billing_account_id = NEW.billing_account_id
      AND i.service_id = NEW.producer_service_id AND i.deployment_id = NEW.producer_deployment_id
      AND EXISTS (SELECT 1 FROM platform_provision_receipts r JOIN platform_provision_operations o
        ON o.namespace = r.namespace AND o.id = r.operation_id
        WHERE o.namespace = i.namespace AND o.instance_id = i.id AND r.result = 'active' AND r.disposition = 'applied')
      AND ((i.service_id = 'wallet' AND EXISTS (SELECT 1 FROM wallet_service_bindings w WHERE w.namespace = i.namespace AND w.instance_id = i.id))
        OR (i.service_id = 'satyr' AND EXISTS (SELECT 1 FROM satyr_service_bindings s WHERE s.namespace = i.namespace AND s.instance_id = i.id))))
    BEGIN SELECT RAISE(ABORT, 'usage_scope_forbidden'); END;

CREATE TRIGGER billing_usage_events_conflict BEFORE INSERT ON billing_usage_events
    WHEN EXISTS (SELECT 1 FROM billing_usage_events e WHERE e.namespace = NEW.namespace AND e.producer_service_id = NEW.producer_service_id
      AND e.producer_deployment_id = NEW.producer_deployment_id AND e.instance_id = NEW.instance_id AND e.event_id = NEW.event_id
      AND e.payload_digest <> NEW.payload_digest)
    BEGIN SELECT RAISE(ABORT, 'usage_event_conflict'); END;

CREATE TRIGGER billing_usage_events_immutable_update BEFORE UPDATE ON billing_usage_events
    BEGIN SELECT RAISE(ABORT, 'usage_event_immutable'); END;

CREATE TRIGGER billing_usage_events_immutable_delete BEFORE DELETE ON billing_usage_events
    BEGIN SELECT RAISE(ABORT, 'usage_event_immutable'); END;

CREATE TABLE billing_execution_charges_jev (
    namespace TEXT NOT NULL,
    charge_id TEXT NOT NULL,
    reservation_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    meter_id TEXT NOT NULL CHECK (meter_id IN ('wallet.execution', 'satyr.completed_turn.test', 'satyr.jev_input_tokens')),
    execution_id TEXT NOT NULL,
    ledger_entry_id TEXT,
    source_event_id TEXT NOT NULL,
    price_version TEXT NOT NULL,
    settled_minor INTEGER NOT NULL CHECK (settled_minor >= 0),
    source_record_id TEXT NOT NULL,
    source_evidence_digest TEXT NOT NULL,
    terminal_outcome TEXT NOT NULL CHECK (terminal_outcome IN ('settled', 'released')),
    occurred_at_ms INTEGER NOT NULL,
    payload_digest TEXT NOT NULL,
    PRIMARY KEY (namespace, charge_id),
    UNIQUE (namespace, instance_id, meter_id, execution_id),
    UNIQUE (namespace, reservation_id),
    FOREIGN KEY (namespace, reservation_id) REFERENCES billing_funds_terminal_receipts(namespace, reservation_id),
    FOREIGN KEY (namespace, org_id, ledger_entry_id) REFERENCES billing_ledger_entries(namespace, org_id, id)
      DEFERRABLE INITIALLY DEFERRED,
    CHECK ((terminal_outcome = 'released' AND settled_minor = 0 AND ledger_entry_id IS NULL)
      OR (terminal_outcome = 'settled' AND ((settled_minor = 0 AND ledger_entry_id IS NULL)
        OR (settled_minor > 0 AND ledger_entry_id IS NOT NULL))))
  );
INSERT INTO billing_execution_charges_jev SELECT * FROM billing_execution_charges;
DROP TABLE billing_execution_charges;
ALTER TABLE billing_execution_charges_jev RENAME TO billing_execution_charges;

CREATE TRIGGER billing_execution_charges_immutable_update
    BEFORE UPDATE ON billing_execution_charges
    BEGIN SELECT RAISE(ABORT, 'funds_operation_conflict'); END;

CREATE TRIGGER billing_execution_charges_immutable_delete
    BEFORE DELETE ON billing_execution_charges
    BEGIN SELECT RAISE(ABORT, 'funds_operation_conflict'); END;

CREATE TABLE billing_jev_hours (
    namespace TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    feature TEXT NOT NULL CHECK (feature IN ('mail_classification', 'related_cases', 'screen_relevance')),
    hour_start_ms INTEGER NOT NULL CHECK (hour_start_ms >= 0 AND hour_start_ms % 3600000 = 0),
    org_id TEXT NOT NULL,
    month_utc TEXT NOT NULL CHECK (month_utc = strftime('%Y-%m', hour_start_ms / 1000, 'unixepoch')),
    execution_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    producer_service_id TEXT NOT NULL DEFAULT 'satyr' CHECK (producer_service_id = 'satyr'),
    producer_deployment_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    PRIMARY KEY (namespace, instance_id, feature, hour_start_ms),
    UNIQUE (namespace, instance_id, execution_id),
    FOREIGN KEY (namespace, producer_service_id, producer_deployment_id, instance_id, event_id)
      REFERENCES billing_usage_events(namespace, producer_service_id, producer_deployment_id, instance_id, event_id)
  );

CREATE INDEX billing_jev_hours_month ON billing_jev_hours(namespace, org_id, month_utc);

CREATE TRIGGER billing_jev_hours_conflict BEFORE INSERT ON billing_jev_hours
    WHEN EXISTS (SELECT 1 FROM billing_jev_hours h WHERE h.namespace = NEW.namespace AND h.instance_id = NEW.instance_id
      AND h.feature = NEW.feature AND h.hour_start_ms = NEW.hour_start_ms AND h.payload_digest <> NEW.payload_digest)
    BEGIN SELECT RAISE(ABORT, 'usage_event_conflict'); END;

CREATE TRIGGER billing_jev_hours_immutable_update BEFORE UPDATE ON billing_jev_hours
    BEGIN SELECT RAISE(ABORT, 'usage_event_immutable'); END;

CREATE TRIGGER billing_jev_hours_immutable_delete BEFORE DELETE ON billing_jev_hours
    BEGIN SELECT RAISE(ABORT, 'usage_event_immutable'); END;

CREATE VIEW billing_charge_attributions AS
    SELECT e.namespace, r.ledger_entry_id, e.org_id, e.project_id, e.billing_account_id, e.instance_id,
      e.producer_service_id AS service_id, e.meter_id, e.price_version, e.quantity, e.unit
    FROM billing_usage_events e
    JOIN billing_usage_receipts r USING (namespace, producer_service_id, producer_deployment_id, instance_id, event_id)
    WHERE e.meter_id = 'wallet.monthly_active_resource' AND r.outcome = 'charged'
    UNION ALL
    SELECT c.namespace, c.ledger_entry_id, c.org_id, c.project_id, c.billing_account_id, c.instance_id,
      CASE c.meter_id WHEN 'wallet.execution' THEN 'wallet' ELSE 'satyr' END AS service_id,
      c.meter_id, c.price_version,
      CASE c.meter_id WHEN 'satyr.jev_input_tokens' THEN (SELECT h.input_tokens FROM billing_jev_hours h
        WHERE h.namespace = c.namespace AND h.instance_id = c.instance_id AND h.execution_id = c.execution_id) ELSE 1 END AS quantity,
      CASE c.meter_id WHEN 'wallet.execution' THEN 'execution' WHEN 'satyr.jev_input_tokens' THEN 'input_token' ELSE 'turn' END AS unit
    FROM billing_execution_charges c WHERE c.ledger_entry_id IS NOT NULL;

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

CREATE TRIGGER billing_postpaid_execution_reserved BEFORE INSERT ON billing_ledger_entries
WHEN NEW.payment_model='postpaid' AND NEW.entry_type='PRODUCT_EXECUTION_DEBIT'
AND NOT EXISTS(SELECT 1 FROM billing_execution_charges c JOIN billing_funds_reservations r ON r.namespace=c.namespace AND r.id=c.reservation_id
 WHERE c.namespace=NEW.namespace AND c.org_id=NEW.org_id AND c.ledger_entry_id=NEW.id AND r.payment_model='postpaid' AND c.settled_minor<=r.requested_minor)
BEGIN SELECT RAISE(ABORT,'postpaid_execution_requires_reservation');   END  ;
PRAGMA defer_foreign_keys = OFF;
