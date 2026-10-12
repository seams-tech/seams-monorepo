-- Admit the current writer in the same transaction as its registration mutation.
-- The trigger stores no rows. A failed check aborts the complete D1 batch.
CREATE TABLE console_deployment_write_checks (
  deployment_lane TEXT NOT NULL,
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  writer_role TEXT NOT NULL CHECK (writer_role IN ('gateway', 'walletRuntime')),
  writer_version TEXT NOT NULL,
  resources_json TEXT NOT NULL
);

CREATE TRIGGER console_deployment_write_authorized
BEFORE INSERT ON console_deployment_write_checks
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM active_tenant_deployment_bindings WHERE deployment_lane = NEW.deployment_lane
  ) THEN RAISE(ABORT, 'console_deployment_unavailable') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM active_tenant_deployment_bindings AS active
    JOIN tenant_deployment_bindings AS binding
      ON binding.deployment_lane = active.deployment_lane AND binding.revision = active.revision
    JOIN tenant_deployment_activations AS activation
      ON activation.deployment_lane = active.deployment_lane
      AND activation.binding_revision = active.revision
      AND activation.activation_sequence = active.activation_sequence,
    json_each(activation.resource_verifications_json) AS proof
    WHERE active.deployment_lane = NEW.deployment_lane
      AND binding.namespace = NEW.namespace AND binding.org_id = NEW.organization_id
      AND binding.project_id = NEW.project_id AND binding.environment_id = NEW.environment_id
      AND json_extract(proof.value, '$.resource.accountId') = NEW.account_id
      AND json_extract(proof.value, '$.resource.databaseId') = NEW.database_id
      AND json_extract(proof.value, '$.authority.kind') = 'cloudflare'
      AND json_extract(proof.value, '$.authority.' || NEW.writer_role || '.versionId') = NEW.writer_version
  ) THEN RAISE(ABORT, 'console_deployment_writer_unauthorized') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM active_tenant_deployment_bindings AS active
    JOIN tenant_deployment_bindings AS binding
      ON binding.deployment_lane = active.deployment_lane AND binding.revision = active.revision
    WHERE active.deployment_lane = NEW.deployment_lane
      AND json_extract(binding.binding_json, '$.resources') = NEW.resources_json
  ) THEN RAISE(ABORT, 'console_deployment_resources_unverified') END;
  SELECT RAISE(IGNORE);
END;
