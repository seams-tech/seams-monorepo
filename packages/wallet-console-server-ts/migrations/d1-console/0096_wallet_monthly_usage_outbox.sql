CREATE TABLE wallet_monthly_usage_outbox (
  namespace TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  native_org_id TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_digest TEXT NOT NULL,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'delivered')),
  PRIMARY KEY (namespace, deployment_id, event_id),
  UNIQUE (namespace, deployment_id, native_org_id, source_record_id)
);

CREATE TRIGGER wallet_monthly_usage_outbox_immutable
BEFORE UPDATE OF namespace, deployment_id, event_id, native_org_id, source_record_id,
  instance_id, payload_json, payload_digest ON wallet_monthly_usage_outbox
BEGIN
  SELECT RAISE(ABORT, 'wallet_monthly_usage_fact_immutable');
END;

CREATE TRIGGER wallet_monthly_usage_outbox_retained
BEFORE DELETE ON wallet_monthly_usage_outbox
BEGIN
  SELECT RAISE(ABORT, 'wallet_monthly_usage_fact_retained');
END;
