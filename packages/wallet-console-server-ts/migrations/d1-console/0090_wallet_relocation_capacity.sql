CREATE TABLE wallet_relocation_capacity (
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  state TEXT NOT NULL CHECK (state IN ('checking', 'admitted', 'releasing', 'released')),
  started_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > started_at_ms),
  PRIMARY KEY (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
);
CREATE UNIQUE INDEX wallet_relocation_capacity_active ON wallet_relocation_capacity
  (namespace, organization_id, project_id, environment_id, wallet_id) WHERE state = 'checking';

CREATE TRIGGER wallet_relocation_capacity_admitted AFTER INSERT ON wallet_relocations
BEGIN
  UPDATE wallet_relocation_capacity SET state = 'admitted'
  WHERE namespace = NEW.namespace AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND environment_id = NEW.environment_id
    AND wallet_id = NEW.wallet_id AND move_id = NEW.move_id AND state = 'checking';
END;
