ALTER TABLE platform_provision_operations ADD COLUMN next_attempt_at_ms INTEGER NOT NULL DEFAULT 0;
CREATE INDEX platform_provision_pending ON platform_provision_operations
  (namespace, service_id, deployment_id, next_attempt_at_ms, created_at_ms, id) WHERE status = 'pending';
