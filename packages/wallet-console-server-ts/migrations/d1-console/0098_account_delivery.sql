ALTER TABLE platform_provision_operations ADD COLUMN next_attempt_at_ms INTEGER NOT NULL DEFAULT 0;
CREATE INDEX platform_provision_pending ON platform_provision_operations
  (namespace, service_id, deployment_id, next_attempt_at_ms, created_at_ms, id) WHERE status = 'pending';
CREATE INDEX wallet_monthly_usage_pending ON wallet_monthly_usage_outbox
  (namespace, deployment_id, event_id) WHERE delivery_status = 'pending';

-- The immutable payload is the retained fact. Shared billing owns canonical event digests.
DROP TRIGGER wallet_monthly_usage_outbox_immutable;
ALTER TABLE wallet_monthly_usage_outbox DROP COLUMN payload_digest;
CREATE TRIGGER wallet_monthly_usage_outbox_immutable
BEFORE UPDATE OF namespace, deployment_id, event_id, native_org_id, source_record_id, instance_id, payload_json
ON wallet_monthly_usage_outbox
BEGIN SELECT RAISE(ABORT, 'wallet_monthly_usage_fact_immutable'); END;
