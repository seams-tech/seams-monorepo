ALTER TABLE tenant_deployment_activations ADD COLUMN home_verification_json TEXT;

CREATE INDEX tenant_deployment_activation_runtime_lookup
ON tenant_deployment_activations(deployment_lane, activation_sequence, binding_revision);

CREATE UNIQUE INDEX tenant_deployment_home_challenge_once
ON tenant_deployment_activations(json_extract(home_verification_json, '$.challengeId'))
WHERE home_verification_json IS NOT NULL;

CREATE TRIGGER tenant_deployment_home_verification_validate
BEFORE INSERT ON tenant_deployment_activations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_deployment_bindings AS binding
    WHERE binding.deployment_lane = NEW.deployment_lane
      AND binding.revision = NEW.binding_revision
      AND json_valid(NEW.home_verification_json)
      AND json_extract(NEW.home_verification_json, '$.deploymentLane') = NEW.deployment_lane
      AND json_extract(NEW.home_verification_json, '$.home.namespace') = binding.namespace
      AND json_extract(NEW.home_verification_json, '$.home.accountId') = NEW.home_account_id
      AND json_extract(NEW.home_verification_json, '$.home.databaseId') = NEW.home_database_id
      AND length(json_extract(NEW.home_verification_json, '$.challengeId')) = 64
      AND json_extract(NEW.home_verification_json, '$.checkedAtMs') <= NEW.activated_at_ms
      AND json_extract(NEW.home_verification_json, '$.expiresAtMs') > NEW.activated_at_ms
      AND json_extract(NEW.home_verification_json, '$.expiresAtMs') > (unixepoch() + 1) * 1000
      AND json_extract(NEW.home_verification_json, '$.expiresAtMs') <=
          json_extract(NEW.home_verification_json, '$.checkedAtMs') + 300000
      AND (
        (json_extract(NEW.home_verification_json, '$.authority.kind') = 'local_development'
          AND json_extract(binding.binding_json, '$.mode.kind') = 'development_testnet_v1')
        OR (json_extract(NEW.home_verification_json, '$.authority.kind') = 'cloudflare'
          AND length(json_extract(NEW.home_verification_json, '$.authority.gateway.versionId')) = 36
          AND length(json_extract(NEW.home_verification_json, '$.authority.walletRuntime.versionId')) = 36)
      )
  ) THEN RAISE(ABORT, 'tenant deployment home verification mismatch or expiry') END;
END;
