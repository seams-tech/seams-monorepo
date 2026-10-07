-- Unfinished moves must retain their admitted transfer format.
CREATE TABLE wallet_relocation_authorization_upgrade_guard (
  pending_count INTEGER NOT NULL CHECK (pending_count = 0)
);
INSERT INTO wallet_relocation_authorization_upgrade_guard
  SELECT COUNT(*) FROM wallet_relocations WHERE state != 'completed';
DROP TABLE wallet_relocation_authorization_upgrade_guard;

ALTER TABLE wallet_relocations ADD COLUMN authorization_manifest_json TEXT
  CHECK (authorization_manifest_json IS NULL OR
    (json_valid(authorization_manifest_json) AND json_type(authorization_manifest_json) = 'object'));

CREATE TRIGGER wallet_relocations_authorization_manifest_admission
BEFORE INSERT ON wallet_relocations WHEN NEW.authorization_manifest_json IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'authorization_manifest_requires_source_capture'); END;

CREATE TRIGGER wallet_relocations_authorization_manifest_immutable
BEFORE UPDATE OF authorization_manifest_json ON wallet_relocations
WHEN (OLD.authorization_manifest_json IS NOT NULL AND NEW.authorization_manifest_json IS NOT OLD.authorization_manifest_json)
  OR (OLD.authorization_manifest_json IS NULL AND NEW.authorization_manifest_json IS NOT NULL AND OLD.state != 'freezing')
BEGIN SELECT RAISE(ABORT, 'authorization_manifest_immutable'); END;

DROP TRIGGER wallet_relocations_transition;
CREATE TRIGGER wallet_relocations_transition
BEFORE UPDATE ON wallet_relocations
BEGIN
  SELECT CASE WHEN NEW.namespace != OLD.namespace OR NEW.organization_id != OLD.organization_id OR
    NEW.project_id != OLD.project_id OR NEW.environment_id != OLD.environment_id OR
    NEW.wallet_id != OLD.wallet_id OR NEW.move_id != OLD.move_id OR NEW.request_digest != OLD.request_digest OR
    NEW.authority_id != OLD.authority_id OR NEW.source_region != OLD.source_region OR
    NEW.source_account_id != OLD.source_account_id OR NEW.source_database_id != OLD.source_database_id OR
    NEW.destination_region != OLD.destination_region OR NEW.destination_account_id != OLD.destination_account_id OR
    NEW.destination_database_id != OLD.destination_database_id OR NEW.source_generation != OLD.source_generation OR
    NEW.destination_generation != OLD.destination_generation OR NEW.admitted_at_ms != OLD.admitted_at_ms OR
    (OLD.source_fence_json IS NOT NULL AND NEW.source_fence_json IS NOT OLD.source_fence_json) OR
    (OLD.destination_verification_json IS NOT NULL AND NEW.destination_verification_json IS NOT OLD.destination_verification_json) OR
    (OLD.cutover_at_ms IS NOT NULL AND NEW.cutover_at_ms IS NOT OLD.cutover_at_ms) OR
    (OLD.completed_at_ms IS NOT NULL AND NEW.completed_at_ms IS NOT OLD.completed_at_ms) OR
    (OLD.destination_activation_json IS NOT NULL AND NEW.destination_activation_json IS NOT OLD.destination_activation_json) OR
    (OLD.source_cleanup_json IS NOT NULL AND NEW.source_cleanup_json IS NOT OLD.source_cleanup_json) OR NOT (
      (OLD.state = 'freezing' AND NEW.state = 'freezing'
        AND OLD.execution_state = 'running' AND NEW.execution_state = 'running'
        AND NEW.authorization_manifest_json IS NOT NULL
        AND (OLD.authorization_manifest_json IS NULL OR NEW.authorization_manifest_json IS OLD.authorization_manifest_json)
        AND NEW.execution_revision = OLD.execution_revision AND NEW.execution_run = OLD.execution_run
        AND NEW.execution_attempt = OLD.execution_attempt AND NEW.execution_attempt_id = OLD.execution_attempt_id
        AND NEW.execution_started_at_ms = OLD.execution_started_at_ms
        AND NEW.execution_error IS OLD.execution_error AND NEW.execution_retry_at_ms IS OLD.execution_retry_at_ms
        AND NEW.source_fence_json IS OLD.source_fence_json
        AND NEW.destination_verification_json IS OLD.destination_verification_json
        AND NEW.destination_activation_json IS OLD.destination_activation_json
        AND NEW.source_cleanup_json IS OLD.source_cleanup_json
        AND NEW.cutover_at_ms IS OLD.cutover_at_ms AND NEW.completed_at_ms IS OLD.completed_at_ms) OR
      (OLD.execution_state = 'running' AND NEW.execution_revision = OLD.execution_revision + 1
        AND NEW.execution_run = OLD.execution_run AND NEW.execution_attempt = 0 AND (
          (OLD.state = 'freezing' AND NEW.state = 'copying' AND NEW.execution_state = 'ready') OR
          (OLD.state = 'copying' AND NEW.state = 'verified' AND NEW.execution_state = 'ready') OR
          (OLD.state = 'verified' AND NEW.state = 'cutover' AND NEW.execution_state = 'ready') OR
          (OLD.state = 'cutover' AND NEW.state = 'completed' AND NEW.execution_state IS NULL
            AND OLD.destination_activation_json IS NOT NULL)
        )) OR
      (OLD.state = 'cutover' AND NEW.state = 'cutover'
        AND OLD.destination_activation_json IS NULL AND NEW.destination_activation_json IS NOT NULL
        AND OLD.execution_state = 'running' AND NEW.execution_state = 'running'
        AND NEW.execution_revision = OLD.execution_revision AND NEW.execution_run = OLD.execution_run
        AND NEW.execution_attempt = OLD.execution_attempt AND NEW.execution_attempt_id = OLD.execution_attempt_id
        AND NEW.execution_started_at_ms = OLD.execution_started_at_ms
        AND NEW.execution_error IS OLD.execution_error AND NEW.execution_retry_at_ms IS OLD.execution_retry_at_ms
        AND NEW.source_fence_json IS OLD.source_fence_json
        AND NEW.destination_verification_json IS OLD.destination_verification_json
        AND NEW.source_cleanup_json IS OLD.source_cleanup_json
        AND NEW.cutover_at_ms IS OLD.cutover_at_ms AND NEW.completed_at_ms IS OLD.completed_at_ms) OR
      (OLD.state = NEW.state AND OLD.state != 'completed'
        AND NEW.source_fence_json IS OLD.source_fence_json
        AND NEW.destination_verification_json IS OLD.destination_verification_json
        AND NEW.destination_activation_json IS OLD.destination_activation_json
        AND NEW.source_cleanup_json IS OLD.source_cleanup_json
        AND NEW.cutover_at_ms IS OLD.cutover_at_ms
        AND NEW.completed_at_ms IS OLD.completed_at_ms AND (
          (OLD.execution_state IN ('ready', 'retry_wait') AND NEW.execution_state = 'running'
            AND NEW.execution_run = OLD.execution_run
            AND NEW.execution_revision = OLD.execution_revision + 1
            AND NEW.execution_attempt = OLD.execution_attempt + 1
            AND NEW.execution_attempt_id IS NOT OLD.execution_attempt_id
            AND (OLD.execution_state = 'ready' OR NEW.execution_started_at_ms >= OLD.execution_retry_at_ms)) OR
          (OLD.execution_state = 'running' AND NEW.execution_state IN ('retry_wait', 'blocked')
            AND NEW.execution_revision = OLD.execution_revision AND NEW.execution_run = OLD.execution_run
            AND NEW.execution_attempt = OLD.execution_attempt
            AND NEW.execution_attempt_id = OLD.execution_attempt_id
            AND NEW.execution_started_at_ms = OLD.execution_started_at_ms) OR
          (OLD.execution_state = 'blocked' AND NEW.execution_state = 'ready'
            AND NEW.execution_revision = OLD.execution_revision + 1
            AND NEW.execution_run = OLD.execution_run + 1 AND NEW.execution_attempt = 0)
        ))
    ) THEN RAISE(ABORT, 'wallet relocation transition rejected') END;
END;
