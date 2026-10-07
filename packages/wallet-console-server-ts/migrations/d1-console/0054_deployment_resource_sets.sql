-- A new resource-set binding and fresh operator verification are required after cutover.
DELETE FROM active_tenant_deployment_bindings;
UPDATE tenant_deployment_cutovers
SET state_json = json_object(
      'kind', 'failed', 'operationId', operation_id, 'deploymentLane', deployment_lane,
      'failedPhase', CASE state_kind
        WHEN 'planning' THEN 'planning' WHEN 'awaiting_tenant_root' THEN 'tenant_root'
        WHEN 'awaiting_browser_credential' THEN 'browser_credential' ELSE 'readiness' END,
      'failure', json_object('code', 'resource_set_cutover', 'message', 'Restart with a verified resource set')),
    state_kind = 'failed', record_revision = record_revision + 1
WHERE state_kind IN ('planning', 'awaiting_tenant_root', 'awaiting_browser_credential', 'ready');

DROP TRIGGER tenant_deployment_activation_binding_home_validate;
DROP TRIGGER tenant_deployment_home_verification_validate;
DROP INDEX tenant_deployment_home_challenge_once;
ALTER TABLE tenant_deployment_activations DROP COLUMN home_account_id;
ALTER TABLE tenant_deployment_activations DROP COLUMN home_database_id;
ALTER TABLE tenant_deployment_activations RENAME COLUMN home_verification_json TO resource_verifications_json;

-- Preserve consumed challenge IDs independently of the historical proof's wire shape.
CREATE TABLE tenant_deployment_resource_challenges (
  challenge_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES tenant_deployment_activations(operation_id)
);
INSERT INTO tenant_deployment_resource_challenges
SELECT json_extract(resource_verifications_json, '$.challengeId'), operation_id
FROM tenant_deployment_activations
WHERE json_extract(resource_verifications_json, '$.challengeId') IS NOT NULL;

CREATE TRIGGER tenant_deployment_resource_challenge_immutable_update
BEFORE UPDATE ON tenant_deployment_resource_challenges
BEGIN
  SELECT RAISE(ABORT, 'consumed deployment challenges are immutable');
END;
CREATE TRIGGER tenant_deployment_resource_challenge_immutable_delete
BEFORE DELETE ON tenant_deployment_resource_challenges
BEGIN
  SELECT RAISE(ABORT, 'consumed deployment challenges are immutable');
END;
CREATE TRIGGER tenant_deployment_resource_challenge_no_replace
BEFORE INSERT ON tenant_deployment_resource_challenges
WHEN EXISTS (SELECT 1 FROM tenant_deployment_resource_challenges WHERE challenge_id = NEW.challenge_id)
BEGIN
  SELECT RAISE(ABORT, 'deployment challenge already consumed');
END;

CREATE TRIGGER tenant_deployment_resource_verifications_validate
BEFORE INSERT ON tenant_deployment_activations
BEGIN
  SELECT CASE WHEN COALESCE(json_type(NEW.resource_verifications_json), '') != 'array'
    OR json_array_length(NEW.resource_verifications_json) = 0
    THEN RAISE(ABORT, 'deployment resource proofs are required') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_deployment_bindings AS binding
    WHERE binding.deployment_lane = NEW.deployment_lane AND binding.revision = NEW.binding_revision
      AND json_type(binding.binding_json, '$.resources') = 'array'
      AND json_array_length(binding.binding_json, '$.resources') = json_array_length(NEW.resource_verifications_json)
      AND NOT EXISTS (
        SELECT 1 FROM json_each(binding.binding_json, '$.resources') AS resource
        WHERE 1 != (
          SELECT count(*) FROM json_each(NEW.resource_verifications_json) AS proof
          WHERE json_extract(proof.value, '$.resource.accountId') = json_extract(resource.value, '$.accountId')
            AND json_extract(proof.value, '$.resource.databaseId') = json_extract(resource.value, '$.databaseId')
            AND json_extract(proof.value, '$.resource.namespace') = binding.namespace
            AND json_extract(proof.value, '$.deploymentLane') = NEW.deployment_lane
            AND length(json_extract(proof.value, '$.challengeId')) = 64
            AND json_extract(proof.value, '$.checkedAtMs') <= NEW.activated_at_ms
            AND json_extract(proof.value, '$.expiresAtMs') > NEW.activated_at_ms
            AND json_extract(proof.value, '$.expiresAtMs') > (unixepoch() + 1) * 1000
            AND json_extract(proof.value, '$.expiresAtMs') <= json_extract(proof.value, '$.checkedAtMs') + 300000
            AND (
              (json_extract(proof.value, '$.authority.kind') = 'local_development'
                AND json_extract(binding.binding_json, '$.mode.kind') = 'development_testnet_v1'
                AND json_array_length(NEW.resource_verifications_json) = 1)
              OR (json_extract(proof.value, '$.authority.kind') = 'cloudflare'
                AND length(json_extract(proof.value, '$.authority.gateway.versionId')) = 36
                AND length(json_extract(proof.value, '$.authority.walletRuntime.versionId')) = 36)
            )
        )
      )
  ) THEN RAISE(ABORT, 'deployment resource proof mismatch or expiry') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM (
      SELECT json_extract(value, '$.authority.gateway.versionId') AS identity FROM json_each(NEW.resource_verifications_json)
      UNION ALL
      SELECT json_extract(value, '$.authority.walletRuntime.versionId') FROM json_each(NEW.resource_verifications_json)
    ) WHERE identity IS NOT NULL GROUP BY identity HAVING count(*) > 1
  ) THEN RAISE(ABORT, 'deployment writer version is duplicated') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM (
      SELECT json_extract(value, '$.authority.gateway.workerName') AS identity FROM json_each(NEW.resource_verifications_json)
      UNION ALL
      SELECT json_extract(value, '$.authority.walletRuntime.workerName') FROM json_each(NEW.resource_verifications_json)
    ) WHERE identity IS NOT NULL GROUP BY identity HAVING count(*) > 1
  ) THEN RAISE(ABORT, 'deployment writer name is duplicated') END;
END;

CREATE TRIGGER tenant_deployment_resource_challenges_consume
AFTER INSERT ON tenant_deployment_activations
BEGIN
  INSERT INTO tenant_deployment_resource_challenges (challenge_id, operation_id)
    SELECT json_extract(value, '$.challengeId'), NEW.operation_id
    FROM json_each(NEW.resource_verifications_json);
END;
