CREATE TABLE billing_plan_base_collections (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  month_utc TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  provider_invoice_ref TEXT,
  status TEXT NOT NULL CHECK (status IN
    ('creating', 'draft', 'open', 'paid', 'void', 'uncollectible')),
  created_at_ms INTEGER NOT NULL,
  checked_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, month_utc),
  UNIQUE (namespace, idempotency_key),
  UNIQUE (namespace, provider_invoice_ref),
  FOREIGN KEY (namespace, org_id, month_utc)
    REFERENCES billing_plan_base_charges(namespace, org_id, month_utc),
  CHECK ((status = 'creating' AND provider_invoice_ref IS NULL)
    OR (status <> 'creating' AND provider_invoice_ref IS NOT NULL
      AND length(provider_invoice_ref) > 0))
);

CREATE INDEX billing_plan_base_collections_due_idx
  ON billing_plan_base_collections (namespace, status, checked_at_ms);
