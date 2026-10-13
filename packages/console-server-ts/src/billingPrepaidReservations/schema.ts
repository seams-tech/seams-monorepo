import { formatD1ExecStatement, type D1DatabaseLike } from '../boundary/d1';

export const BILLING_FUNDS_D1_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS billing_funds_reservations (
    namespace TEXT NOT NULL,
    id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    service_id TEXT NOT NULL CHECK (service_id IN ('wallet', 'satyr')),
    deployment_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    reserve_operation_id TEXT NOT NULL,
    requested_minor INTEGER NOT NULL CHECK (requested_minor >= 0),
    price_version TEXT NOT NULL,
    reserve_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('reserved', 'indeterminate', 'settled', 'released')),
    indeterminate_operation_id TEXT,
    indeterminate_digest TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    reconciliation_due_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, id),
    UNIQUE (namespace, instance_id, execution_id),
    UNIQUE (namespace, reserve_operation_id),
    FOREIGN KEY (namespace, instance_id) REFERENCES platform_service_instances(namespace, id),
    FOREIGN KEY (namespace, org_id, project_id, billing_account_id)
      REFERENCES project_billing_bindings(namespace, org_id, project_id, billing_account_id),
    CHECK ((indeterminate_operation_id IS NULL AND indeterminate_digest IS NULL)
      OR (indeterminate_operation_id IS NOT NULL AND indeterminate_digest IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS billing_funds_reservations_payer_holds
    ON billing_funds_reservations(namespace, billing_account_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS billing_funds_wallet_org_execution
    ON billing_funds_reservations(namespace, org_id, execution_id)
    WHERE service_id = 'wallet'`,
  `CREATE TABLE IF NOT EXISTS billing_funds_transition_checks (
    valid INTEGER NOT NULL CONSTRAINT funds_operation_conflict CHECK (valid = 1)
  )`,
  `CREATE TABLE IF NOT EXISTS billing_funds_terminal_receipts (
    namespace TEXT NOT NULL,
    reservation_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    payload_digest TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('settled', 'released')),
    reconciled INTEGER NOT NULL CHECK (reconciled IN (0, 1)),
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, reservation_id),
    UNIQUE (namespace, operation_id),
    FOREIGN KEY (namespace, reservation_id) REFERENCES billing_funds_reservations(namespace, id)
  )`,
  `CREATE TABLE IF NOT EXISTS billing_execution_charges (
    namespace TEXT NOT NULL,
    charge_id TEXT NOT NULL,
    reservation_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    meter_id TEXT NOT NULL CHECK (meter_id IN ('wallet.execution', 'satyr.completed_turn.test')),
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
  )`,
  `CREATE TRIGGER IF NOT EXISTS billing_funds_admission
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
        COALESCE((SELECT SUM(CASE direction WHEN 'CREDIT' THEN amount_minor ELSE -amount_minor END)
          FROM billing_ledger_postings WHERE namespace = NEW.namespace AND org_id = NEW.org_id
            AND account_code = 'org_prepaid_liability'), 0)
        - COALESCE((SELECT SUM(requested_minor) FROM billing_funds_reservations
          WHERE namespace = NEW.namespace AND billing_account_id = NEW.billing_account_id
            AND status IN ('reserved', 'indeterminate')), 0)
        - COALESCE((SELECT SUM(amount_minor) FROM billing_refunds
          WHERE namespace = NEW.namespace AND org_id = NEW.org_id AND origin = 'console'
            AND status IN ('requested', 'provider_pending')), 0);
    END`,
  `CREATE TRIGGER IF NOT EXISTS billing_funds_identity_immutable
    BEFORE UPDATE ON billing_funds_reservations
    WHEN NEW.namespace <> OLD.namespace OR NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id
      OR NEW.project_id <> OLD.project_id OR NEW.billing_account_id <> OLD.billing_account_id
      OR NEW.instance_id <> OLD.instance_id OR NEW.service_id <> OLD.service_id
      OR NEW.deployment_id <> OLD.deployment_id OR NEW.execution_id <> OLD.execution_id
      OR NEW.reserve_operation_id <> OLD.reserve_operation_id OR NEW.requested_minor <> OLD.requested_minor
      OR NEW.price_version <> OLD.price_version OR NEW.reserve_digest <> OLD.reserve_digest
      OR NEW.created_at_ms <> OLD.created_at_ms OR NEW.reconciliation_due_at_ms <> OLD.reconciliation_due_at_ms
    BEGIN SELECT RAISE(ABORT, 'funds_operation_conflict'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_funds_status_guard
    BEFORE UPDATE OF status ON billing_funds_reservations
    WHEN NEW.status <> OLD.status
    BEGIN
      SELECT RAISE(ABORT, 'funds_operation_conflict') WHERE NOT (
        (OLD.status = 'reserved' AND NEW.status = 'indeterminate'
          AND NEW.indeterminate_operation_id IS NOT NULL AND NEW.indeterminate_digest IS NOT NULL)
        OR (OLD.status IN ('reserved','indeterminate') AND NEW.status IN ('settled','released')
          AND EXISTS (SELECT 1 FROM billing_funds_terminal_receipts t
            WHERE t.namespace = NEW.namespace AND t.reservation_id = NEW.id AND t.outcome = NEW.status))
      );
    END`,
  `CREATE TRIGGER IF NOT EXISTS billing_funds_terminal_guard
    BEFORE INSERT ON billing_funds_terminal_receipts
    BEGIN
      SELECT RAISE(ABORT, 'funds_operation_conflict') WHERE NOT EXISTS (
        SELECT 1 FROM billing_funds_reservations r WHERE r.namespace = NEW.namespace AND r.id = NEW.reservation_id
          AND r.execution_id = json_extract(NEW.payload_json, '$.executionId')
          AND r.status IN ('reserved', 'indeterminate')
      );
      SELECT RAISE(ABORT, 'funds_execution_unreconciled') WHERE NEW.reconciled = 0 AND EXISTS (
        SELECT 1 FROM billing_funds_reservations r WHERE r.namespace = NEW.namespace
          AND r.id = NEW.reservation_id AND r.status = 'indeterminate'
      );
    END`,
  `CREATE TRIGGER IF NOT EXISTS billing_funds_terminal_applied
    AFTER INSERT ON billing_funds_terminal_receipts
    BEGIN
      UPDATE billing_funds_reservations SET status = NEW.outcome, updated_at_ms = NEW.created_at_ms
        WHERE namespace = NEW.namespace AND id = NEW.reservation_id;
    END`,
  `CREATE TRIGGER IF NOT EXISTS billing_funds_terminal_immutable_update
    BEFORE UPDATE ON billing_funds_terminal_receipts
    BEGIN SELECT RAISE(ABORT, 'funds_operation_conflict'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_funds_terminal_immutable_delete
    BEFORE DELETE ON billing_funds_terminal_receipts
    BEGIN SELECT RAISE(ABORT, 'funds_operation_conflict'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_execution_charges_immutable_update
    BEFORE UPDATE ON billing_execution_charges
    BEGIN SELECT RAISE(ABORT, 'funds_operation_conflict'); END`,
  `CREATE TRIGGER IF NOT EXISTS billing_execution_charges_immutable_delete
    BEFORE DELETE ON billing_execution_charges
    BEGIN SELECT RAISE(ABORT, 'funds_operation_conflict'); END`,
] as const);

export async function ensureBillingFundsD1Schema(database: D1DatabaseLike): Promise<void> {
  for (const statement of BILLING_FUNDS_D1_SCHEMA_SQL)
    await database.exec(formatD1ExecStatement(statement));
}
