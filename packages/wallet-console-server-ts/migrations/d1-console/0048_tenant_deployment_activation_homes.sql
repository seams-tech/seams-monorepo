-- Historical activations retain NULL resource identity until a new activation is verified.
ALTER TABLE tenant_deployment_activations ADD COLUMN home_account_id TEXT;
ALTER TABLE tenant_deployment_activations ADD COLUMN home_database_id TEXT;

CREATE TRIGGER tenant_deployment_activation_home_validate
BEFORE INSERT ON tenant_deployment_activations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenant_deployment_bindings AS binding
    JOIN namespace_d1_homes AS home ON home.namespace = binding.namespace
    WHERE binding.deployment_lane = NEW.deployment_lane
      AND binding.revision = NEW.binding_revision
      AND home.account_id = NEW.home_account_id
      AND home.database_id = NEW.home_database_id
  ) THEN RAISE(ABORT, 'tenant deployment activation home mismatch') END;
END;

CREATE TRIGGER tenant_deployment_activation_no_replace
BEFORE INSERT ON tenant_deployment_activations
WHEN EXISTS (
  SELECT 1 FROM tenant_deployment_activations WHERE operation_id = NEW.operation_id
)
BEGIN
  SELECT RAISE(ABORT, 'tenant deployment activations are immutable');
END;
