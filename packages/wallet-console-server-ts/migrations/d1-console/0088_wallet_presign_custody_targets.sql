-- Sessions created during preparation join the target set after source admission closes.
CREATE TABLE wallet_presign_custody_targets (
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  presign_session_id TEXT NOT NULL,
  targets_json TEXT NOT NULL CHECK (json_valid(targets_json) AND json_type(targets_json) = 'object'),
  PRIMARY KEY (namespace, organization_id, project_id, environment_id, wallet_id, move_id, presign_session_id),
  FOREIGN KEY (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
    REFERENCES wallet_relocations (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
);
CREATE TRIGGER wallet_presign_custody_targets_immutable
BEFORE UPDATE ON wallet_presign_custody_targets
BEGIN SELECT RAISE(ABORT, 'presign_custody_targets_immutable'); END;
CREATE TRIGGER wallet_presign_custody_targets_retained
BEFORE DELETE ON wallet_presign_custody_targets
BEGIN SELECT RAISE(ABORT, 'presign_custody_targets_retained'); END;
