CREATE TRIGGER tenant_deployment_activation_binding_home_validate
BEFORE INSERT ON tenant_deployment_activations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_deployment_bindings
    WHERE deployment_lane = NEW.deployment_lane
      AND revision = NEW.binding_revision
      AND json_extract(binding_json, '$.home.accountId') = NEW.home_account_id
      AND json_extract(binding_json, '$.home.databaseId') = NEW.home_database_id
  ) THEN RAISE(ABORT, 'activation home disagrees with the canonical binding') END;
END;
