import { formatD1ExecStatement, type D1DatabaseLike } from '../boundary/d1';

export const BILLING_USAGE_D1_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS billing_price_definitions (
    meter_id TEXT NOT NULL,
    version TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('fixed_measured', 'quoted_execution')),
    currency TEXT NOT NULL CHECK (currency = 'USD'),
    unit_minor INTEGER,
    time_rule TEXT NOT NULL CHECK (time_rule IN ('occurred_at_utc_month', 'terminal_accepted_at', 'accepted_quote_at')),
    availability TEXT NOT NULL CHECK (availability IN ('customer_accounts', 'isolated_test_accounts')),
    PRIMARY KEY (meter_id, version),
    CHECK ((kind = 'fixed_measured' AND unit_minor > 0) OR (kind = 'quoted_execution' AND unit_minor IS NULL))
  )`,
  `CREATE TRIGGER IF NOT EXISTS billing_prices_immutable_update BEFORE UPDATE ON billing_price_definitions
    BEGIN SELECT RAISE(ABORT, 'billing_price_immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_prices_immutable_delete BEFORE DELETE ON billing_price_definitions
    BEGIN SELECT RAISE(ABORT, 'billing_price_immutable'); END`,
  `CREATE TABLE IF NOT EXISTS billing_isolated_test_accounts (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    PRIMARY KEY (namespace, org_id),
    FOREIGN KEY (namespace, org_id) REFERENCES organizations(namespace, id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS billing_test_accounts_immutable_update BEFORE UPDATE ON billing_isolated_test_accounts
    BEGIN SELECT RAISE(ABORT, 'billing_test_account_immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_test_accounts_immutable_delete BEFORE DELETE ON billing_isolated_test_accounts
    BEGIN SELECT RAISE(ABORT, 'billing_test_account_immutable'); END`,
  `INSERT INTO billing_price_definitions (meter_id, version, kind, currency, unit_minor, time_rule, availability)
    VALUES ('wallet.monthly_active_resource', 'wallet-monthly-active-resource-v1', 'fixed_measured', 'USD', 300, 'occurred_at_utc_month', 'customer_accounts')
    ON CONFLICT(meter_id, version) DO NOTHING`,
  `INSERT INTO billing_price_definitions (meter_id, version, kind, currency, unit_minor, time_rule, availability)
    VALUES ('satyr.completed_turn.test', 'satyr-completed-turn-test-v1', 'fixed_measured', 'USD', 1, 'terminal_accepted_at', 'isolated_test_accounts')
    ON CONFLICT(meter_id, version) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS billing_wallet_execution_quotes (
    namespace TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    meter_id TEXT NOT NULL DEFAULT 'wallet.execution' CHECK (meter_id = 'wallet.execution'),
    quote_version TEXT NOT NULL,
    quoted_at_ms INTEGER NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    source_record_id TEXT NOT NULL,
    source_digest TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    PRIMARY KEY (namespace, instance_id, execution_id),
    FOREIGN KEY (namespace, instance_id) REFERENCES platform_service_instances(namespace, id),
    FOREIGN KEY (meter_id, quote_version) REFERENCES billing_price_definitions(meter_id, version)
  )`,
  `CREATE TRIGGER IF NOT EXISTS billing_wallet_quotes_conflict BEFORE INSERT ON billing_wallet_execution_quotes
    WHEN EXISTS (SELECT 1 FROM billing_wallet_execution_quotes q WHERE q.namespace = NEW.namespace AND q.instance_id = NEW.instance_id
      AND q.execution_id = NEW.execution_id AND q.payload_digest <> NEW.payload_digest)
    BEGIN SELECT RAISE(ABORT, 'wallet_quote_conflict'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_wallet_quotes_immutable_update BEFORE UPDATE ON billing_wallet_execution_quotes
    BEGIN SELECT RAISE(ABORT, 'wallet_quote_immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_wallet_quotes_immutable_delete BEFORE DELETE ON billing_wallet_execution_quotes
    BEGIN SELECT RAISE(ABORT, 'wallet_quote_immutable'); END`,
  `CREATE TABLE IF NOT EXISTS billing_usage_events (
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
    meter_id TEXT NOT NULL CHECK (meter_id IN ('wallet.monthly_active_resource', 'wallet.execution', 'satyr.completed_turn.test')),
    quantity INTEGER NOT NULL CHECK (quantity IN (0, 1)),
    unit TEXT NOT NULL CHECK (unit IN ('resource_month', 'execution', 'turn')),
    occurred_at_ms INTEGER NOT NULL,
    price_version TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, producer_service_id, producer_deployment_id, instance_id, event_id),
    FOREIGN KEY (namespace, instance_id) REFERENCES platform_service_instances(namespace, id),
    FOREIGN KEY (meter_id, price_version) REFERENCES billing_price_definitions(meter_id, version),
    FOREIGN KEY (namespace, producer_service_id, producer_deployment_id, instance_id, event_id)
      REFERENCES billing_usage_receipts(namespace, producer_service_id, producer_deployment_id, instance_id, event_id)
      DEFERRABLE INITIALLY DEFERRED
  )`,
  `CREATE TRIGGER IF NOT EXISTS billing_usage_events_scope_guard BEFORE INSERT ON billing_usage_events
    WHEN NOT EXISTS (SELECT 1 FROM platform_service_instances i WHERE i.namespace = NEW.namespace AND i.id = NEW.instance_id
      AND i.org_id = NEW.org_id AND i.project_id = NEW.project_id AND i.billing_account_id = NEW.billing_account_id
      AND i.service_id = NEW.producer_service_id AND i.deployment_id = NEW.producer_deployment_id
      AND EXISTS (SELECT 1 FROM platform_provision_receipts r JOIN platform_provision_operations o
        ON o.namespace = r.namespace AND o.id = r.operation_id
        WHERE o.namespace = i.namespace AND o.instance_id = i.id AND r.result = 'active' AND r.disposition = 'applied')
      AND ((i.service_id = 'wallet' AND EXISTS (SELECT 1 FROM wallet_service_bindings w WHERE w.namespace = i.namespace AND w.instance_id = i.id))
        OR (i.service_id = 'satyr' AND EXISTS (SELECT 1 FROM satyr_service_bindings s WHERE s.namespace = i.namespace AND s.instance_id = i.id))))
    BEGIN SELECT RAISE(ABORT, 'usage_scope_forbidden'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_usage_events_conflict BEFORE INSERT ON billing_usage_events
    WHEN EXISTS (SELECT 1 FROM billing_usage_events e WHERE e.namespace = NEW.namespace AND e.producer_service_id = NEW.producer_service_id
      AND e.producer_deployment_id = NEW.producer_deployment_id AND e.instance_id = NEW.instance_id AND e.event_id = NEW.event_id
      AND e.payload_digest <> NEW.payload_digest)
    BEGIN SELECT RAISE(ABORT, 'usage_event_conflict'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_usage_events_immutable_update BEFORE UPDATE ON billing_usage_events
    BEGIN SELECT RAISE(ABORT, 'usage_event_immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_usage_events_immutable_delete BEFORE DELETE ON billing_usage_events
    BEGIN SELECT RAISE(ABORT, 'usage_event_immutable'); END`,
  `CREATE TABLE IF NOT EXISTS billing_usage_receipts (
    namespace TEXT NOT NULL,
    producer_service_id TEXT NOT NULL,
    producer_deployment_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('charged', 'meter_already_counted', 'nonbillable_outcome')),
    charge_id TEXT,
    ledger_entry_id TEXT,
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    price_version TEXT NOT NULL,
    PRIMARY KEY (namespace, producer_service_id, producer_deployment_id, instance_id, event_id),
    FOREIGN KEY (namespace, producer_service_id, producer_deployment_id, instance_id, event_id)
      REFERENCES billing_usage_events(namespace, producer_service_id, producer_deployment_id, instance_id, event_id),
    FOREIGN KEY (namespace, org_id, ledger_entry_id) REFERENCES billing_ledger_entries(namespace, org_id, id),
    CHECK ((outcome = 'charged' AND charge_id IS NOT NULL AND ledger_entry_id IS NOT NULL AND amount_minor > 0)
      OR (outcome <> 'charged' AND charge_id IS NULL AND ledger_entry_id IS NULL AND amount_minor = 0))
  )`,
  `CREATE TRIGGER IF NOT EXISTS billing_usage_receipts_immutable_update BEFORE UPDATE ON billing_usage_receipts
    BEGIN SELECT RAISE(ABORT, 'usage_receipt_immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_usage_receipts_immutable_delete BEFORE DELETE ON billing_usage_receipts
    BEGIN SELECT RAISE(ABORT, 'usage_receipt_immutable'); END`,
  `INSERT INTO organization_billing_accounts (namespace, org_id, id, currency, created_at_ms)
    SELECT namespace, id, 'payer:' || id, 'USD', created_at_ms FROM organizations WHERE true
    ON CONFLICT(namespace, org_id) DO NOTHING`,
  `CREATE VIEW IF NOT EXISTS billing_charge_attributions AS
    SELECT e.namespace, r.ledger_entry_id, e.org_id, e.project_id, e.billing_account_id, e.instance_id,
      e.producer_service_id AS service_id, e.meter_id, e.price_version, e.quantity, e.unit
    FROM billing_usage_events e
    JOIN billing_usage_receipts r USING (namespace, producer_service_id, producer_deployment_id, instance_id, event_id)
    WHERE e.meter_id = 'wallet.monthly_active_resource' AND r.outcome = 'charged'
    UNION ALL
    SELECT c.namespace, c.ledger_entry_id, c.org_id, c.project_id, c.billing_account_id, c.instance_id,
      CASE c.meter_id WHEN 'wallet.execution' THEN 'wallet' ELSE 'satyr' END AS service_id,
      c.meter_id, c.price_version, 1 AS quantity,
      CASE c.meter_id WHEN 'wallet.execution' THEN 'execution' ELSE 'turn' END AS unit
    FROM billing_execution_charges c WHERE c.ledger_entry_id IS NOT NULL`,
]);

export async function ensureBillingUsageD1Schema(database: D1DatabaseLike): Promise<void> {
  await database.exec(BILLING_USAGE_D1_SCHEMA_SQL.map(formatD1ExecStatement).join('\n'));
}
