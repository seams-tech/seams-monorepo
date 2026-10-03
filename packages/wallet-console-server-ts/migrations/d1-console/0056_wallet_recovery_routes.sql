CREATE TABLE wallet_recovery_routes (
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('code', 'operation')),
  value TEXT NOT NULL CHECK (length(value) > 0),
  wallet_id TEXT NOT NULL,
  PRIMARY KEY (namespace, organization_id, project_id, environment_id, kind, value),
  FOREIGN KEY (namespace, organization_id, project_id, environment_id, wallet_id)
    REFERENCES wallet_homes (namespace, organization_id, project_id, environment_id, wallet_id)
);

CREATE TRIGGER wallet_recovery_routes_no_update
BEFORE UPDATE ON wallet_recovery_routes
BEGIN
  SELECT RAISE(ABORT, 'recovery routing identity is immutable');
END;

CREATE TRIGGER wallet_recovery_routes_no_replace
BEFORE INSERT ON wallet_recovery_routes
WHEN EXISTS (
  SELECT 1 FROM wallet_recovery_routes
  WHERE namespace = NEW.namespace AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND environment_id = NEW.environment_id
    AND kind = NEW.kind AND value = NEW.value AND wallet_id != NEW.wallet_id
)
BEGIN
  SELECT RAISE(ABORT, 'recovery routing identity conflict');
END;
