CREATE TABLE wallet_deriver_snapshots (
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('deriverA', 'deriverB')),
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json) AND json_type(receipt_json) = 'object'),
  PRIMARY KEY (namespace, organization_id, project_id, environment_id, wallet_id, move_id, role),
  FOREIGN KEY (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
    REFERENCES wallet_relocations (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
);
CREATE TRIGGER wallet_deriver_snapshots_immutable
BEFORE UPDATE ON wallet_deriver_snapshots
BEGIN SELECT RAISE(ABORT, 'deriver_snapshot_immutable'); END;
CREATE TRIGGER wallet_deriver_snapshots_retained
BEFORE DELETE ON wallet_deriver_snapshots
BEGIN SELECT RAISE(ABORT, 'deriver_snapshot_retained'); END;
