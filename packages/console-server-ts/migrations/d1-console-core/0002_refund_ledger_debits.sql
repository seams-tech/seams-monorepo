-- Refunds debit prepaid credit. Preserve entries and postings while replacing the CHECK constraint.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE billing_ledger_entries_refund_fix (
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
      'DISPUTE_WON'
    )
  ),
  CHECK (
    (entry_type IN ('CREDIT_PURCHASE', 'DISPUTE_WON') AND amount_minor > 0)
    OR (entry_type IN ('USAGE_DEBIT', 'PRODUCT_EXECUTION_DEBIT', 'DISPUTE_OPENED', 'REFUND') AND amount_minor < 0)
    OR (entry_type = 'MANUAL_ADJUSTMENT' AND amount_minor != 0)
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

INSERT INTO billing_ledger_entries_refund_fix
SELECT namespace, org_id, id, entry_type, CASE WHEN entry_type = 'REFUND' THEN -ABS(amount_minor) ELSE amount_minor END, currency, description, month_utc, related_invoice_id, related_purchase_id, source_event_id, actor_type, actor_user_id, reason_code, note, idempotency_key, created_at_ms
FROM billing_ledger_entries;

CREATE TABLE billing_refund_postings_backup AS SELECT * FROM billing_ledger_postings;
DROP TABLE billing_ledger_postings;
DROP TABLE billing_ledger_entries;
ALTER TABLE billing_ledger_entries_refund_fix RENAME TO billing_ledger_entries;

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
      'org_prepaid_liability',
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

INSERT INTO billing_ledger_postings
SELECT p.namespace, p.org_id, p.id, p.ledger_entry_id, p.account_code,
  CASE WHEN e.entry_type = 'REFUND' AND p.account_code = 'org_prepaid_liability' THEN 'DEBIT'
       WHEN e.entry_type = 'REFUND' AND p.account_code = 'stripe_cash_clearing' THEN 'CREDIT'
       ELSE p.direction END,
  p.amount_minor, p.created_at_ms
FROM billing_refund_postings_backup p
JOIN billing_ledger_entries e
  ON e.namespace = p.namespace AND e.org_id = p.org_id AND e.id = p.ledger_entry_id;
DROP TABLE billing_refund_postings_backup;

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
        WHEN NEW.amount_minor < 0 THEN 'org_prepaid_liability'
        WHEN NEW.entry_type IN ('CREDIT_PURCHASE', 'REFUND') THEN 'stripe_cash_clearing'
        WHEN NEW.entry_type IN ('DISPUTE_OPENED', 'DISPUTE_WON') THEN 'stripe_dispute_clearing'
        WHEN NEW.entry_type = 'USAGE_DEBIT' THEN 'revenue_usage'
        ELSE 'manual_adjustment_clearing'
      END,
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
        WHEN NEW.amount_minor > 0 THEN 'org_prepaid_liability'
        WHEN NEW.entry_type IN ('CREDIT_PURCHASE', 'REFUND') THEN 'stripe_cash_clearing'
        WHEN NEW.entry_type IN ('DISPUTE_OPENED', 'DISPUTE_WON') THEN 'stripe_dispute_clearing'
        WHEN NEW.entry_type = 'USAGE_DEBIT' THEN 'revenue_usage'
        WHEN NEW.entry_type = 'MANUAL_ADJUSTMENT' THEN 'manual_adjustment_clearing'
        ELSE 'revenue_product_execution'
      END,
      'CREDIT',
      ABS(NEW.amount_minor),
      NEW.created_at_ms
    );
END;

PRAGMA defer_foreign_keys = OFF;
