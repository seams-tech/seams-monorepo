ALTER TABLE wallet_routes RENAME TO wallet_routes_previous;
DROP TRIGGER wallet_routes_no_update;
DROP TRIGGER wallet_routes_no_replace;

CREATE TABLE wallet_routes (
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('code', 'operation', 'yao_recovery', 'yao_export', 'passkey_challenge', 'linked_device')),
  value TEXT NOT NULL CHECK (length(value) > 0),
  wallet_id TEXT NOT NULL,
  PRIMARY KEY (namespace, organization_id, project_id, environment_id, kind, value),
  FOREIGN KEY (namespace, organization_id, project_id, environment_id, wallet_id)
    REFERENCES wallet_homes (namespace, organization_id, project_id, environment_id, wallet_id)
);

CREATE TRIGGER wallet_routes_no_update
BEFORE UPDATE ON wallet_routes
BEGIN
  SELECT RAISE(ABORT, 'wallet routing identity is immutable');
END;

CREATE TRIGGER wallet_routes_no_replace
BEFORE INSERT ON wallet_routes
WHEN EXISTS (
  SELECT 1 FROM wallet_routes
  WHERE namespace = NEW.namespace AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND environment_id = NEW.environment_id
    AND kind = NEW.kind AND value = NEW.value AND wallet_id != NEW.wallet_id
)
BEGIN
  SELECT RAISE(ABORT, 'wallet routing identity conflict');
END;

INSERT INTO wallet_routes SELECT * FROM wallet_routes_previous;
DROP TABLE wallet_routes_previous;
