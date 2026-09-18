CREATE TABLE IF NOT EXISTS tenant_deployment_bindings (
  deployment_lane TEXT NOT NULL,
  revision TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  binding_json TEXT NOT NULL,
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  tenant_root_identity_digest_b64u TEXT NOT NULL,
  custody_lineage_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  runtime_policy_digest_b64u TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
  PRIMARY KEY (deployment_lane, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_deployment_bindings_revision_unique
  ON tenant_deployment_bindings(revision);

CREATE INDEX IF NOT EXISTS tenant_deployment_bindings_environment_lookup
  ON tenant_deployment_bindings(namespace, org_id, project_id, environment_id, created_at_ms DESC);

CREATE TRIGGER IF NOT EXISTS tenant_deployment_bindings_immutable_update
BEFORE UPDATE ON tenant_deployment_bindings
BEGIN
  SELECT RAISE(ABORT, 'tenant deployment bindings are immutable');
END;

CREATE TRIGGER IF NOT EXISTS tenant_deployment_bindings_immutable_delete
BEFORE DELETE ON tenant_deployment_bindings
BEGIN
  SELECT RAISE(ABORT, 'tenant deployment bindings are immutable');
END;

CREATE TABLE IF NOT EXISTS active_tenant_deployment_bindings (
  deployment_lane TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  previous_revision TEXT,
  activation_sequence INTEGER NOT NULL CHECK (activation_sequence > 0),
  activated_at_ms INTEGER NOT NULL CHECK (activated_at_ms > 0),
  FOREIGN KEY (deployment_lane, revision)
    REFERENCES tenant_deployment_bindings(deployment_lane, revision)
);

CREATE TABLE IF NOT EXISTS tenant_deployment_cutovers (
  operation_id TEXT PRIMARY KEY,
  deployment_lane TEXT NOT NULL,
  state_kind TEXT NOT NULL CHECK (
    state_kind IN (
      'planning',
      'awaiting_tenant_root',
      'awaiting_browser_credential',
      'ready',
      'active',
      'failed'
    )
  ),
  state_json TEXT NOT NULL,
  record_revision INTEGER NOT NULL CHECK (record_revision > 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS tenant_deployment_cutovers_lane_updated
  ON tenant_deployment_cutovers(deployment_lane, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS tenant_deployment_activations (
  operation_id TEXT PRIMARY KEY,
  deployment_lane TEXT NOT NULL,
  binding_revision TEXT NOT NULL,
  expected_previous_revision TEXT,
  expected_activation_sequence INTEGER,
  activation_sequence INTEGER NOT NULL CHECK (activation_sequence > 0),
  activated_at_ms INTEGER NOT NULL CHECK (activated_at_ms > 0),
  expected_cutover_record_revision INTEGER NOT NULL CHECK (expected_cutover_record_revision > 0),
  ready_state_json TEXT NOT NULL,
  active_state_json TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  CHECK (
    (expected_previous_revision IS NULL AND expected_activation_sequence IS NULL) OR
    (expected_previous_revision IS NOT NULL AND expected_activation_sequence > 0)
  ),
  FOREIGN KEY (deployment_lane, binding_revision)
    REFERENCES tenant_deployment_bindings(deployment_lane, revision),
  FOREIGN KEY (operation_id) REFERENCES tenant_deployment_cutovers(operation_id)
);

CREATE TRIGGER IF NOT EXISTS tenant_deployment_activation_validate
BEFORE INSERT ON tenant_deployment_activations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_deployment_cutovers
    WHERE operation_id = NEW.operation_id
      AND deployment_lane = NEW.deployment_lane
      AND state_kind = 'ready'
      AND record_revision = NEW.expected_cutover_record_revision
      AND state_json = NEW.ready_state_json
      AND json_extract(state_json, '$.binding.revision') = NEW.binding_revision
  ) THEN RAISE(ABORT, 'tenant deployment cutover is not ready') END;
  SELECT CASE WHEN NOT (
    (NEW.expected_previous_revision IS NULL AND NOT EXISTS (
      SELECT 1 FROM active_tenant_deployment_bindings
      WHERE deployment_lane = NEW.deployment_lane
    )) OR EXISTS (
      SELECT 1 FROM active_tenant_deployment_bindings
      WHERE deployment_lane = NEW.deployment_lane
        AND revision = NEW.expected_previous_revision
        AND activation_sequence = NEW.expected_activation_sequence
    )
  ) THEN RAISE(ABORT, 'tenant deployment active pointer changed') END;
  SELECT CASE WHEN NOT (
    json_extract(NEW.active_state_json, '$.kind') = 'active' AND
    json_extract(NEW.active_state_json, '$.operationId') = NEW.operation_id AND
    json_extract(NEW.active_state_json, '$.deploymentLane') = NEW.deployment_lane AND
    json_extract(NEW.active_state_json, '$.binding.revision') = NEW.binding_revision AND
    json_extract(NEW.active_state_json, '$.activationReceipt.bindingRevision') = NEW.binding_revision AND
    json_extract(NEW.active_state_json, '$.activationReceipt.previousRevision') IS NEW.expected_previous_revision AND
    json_extract(NEW.active_state_json, '$.activationReceipt.activationSequence') = NEW.activation_sequence AND
    json_extract(NEW.active_state_json, '$.activationReceipt.activatedAtMs') = NEW.activated_at_ms AND
    json(NEW.receipt_json) = json_extract(NEW.active_state_json, '$.activationReceipt')
  ) THEN RAISE(ABORT, 'tenant deployment activation state is invalid') END;
END;

CREATE TRIGGER IF NOT EXISTS tenant_deployment_activation_apply
AFTER INSERT ON tenant_deployment_activations
BEGIN
  INSERT OR IGNORE INTO active_tenant_deployment_bindings (
    deployment_lane, revision, previous_revision, activation_sequence, activated_at_ms
  ) VALUES (
    NEW.deployment_lane, NEW.binding_revision, NULL, NEW.activation_sequence, NEW.activated_at_ms
  );
  UPDATE active_tenant_deployment_bindings
  SET previous_revision = NEW.expected_previous_revision,
      revision = NEW.binding_revision,
      activation_sequence = NEW.activation_sequence,
      activated_at_ms = NEW.activated_at_ms
  WHERE deployment_lane = NEW.deployment_lane
    AND NEW.expected_previous_revision IS NOT NULL;
  UPDATE tenant_deployment_cutovers
  SET state_kind = 'active', state_json = NEW.active_state_json,
      record_revision = record_revision + 1, updated_at_ms = NEW.activated_at_ms
  WHERE operation_id = NEW.operation_id;
END;

CREATE TRIGGER IF NOT EXISTS tenant_deployment_activations_immutable_update
BEFORE UPDATE ON tenant_deployment_activations
BEGIN
  SELECT RAISE(ABORT, 'tenant deployment activations are immutable');
END;

CREATE TRIGGER IF NOT EXISTS tenant_deployment_activations_immutable_delete
BEFORE DELETE ON tenant_deployment_activations
BEGIN
  SELECT RAISE(ABORT, 'tenant deployment activations are immutable');
END;
