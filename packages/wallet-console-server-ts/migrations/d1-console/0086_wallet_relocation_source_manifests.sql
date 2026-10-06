CREATE TABLE wallet_relocation_source_manifests (
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json) AND json_type(receipt_json) = 'object'),
  PRIMARY KEY (namespace, organization_id, project_id, environment_id, wallet_id, move_id),
  FOREIGN KEY (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
    REFERENCES wallet_relocations (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
);
CREATE TRIGGER wallet_relocation_source_manifests_immutable
BEFORE UPDATE ON wallet_relocation_source_manifests
BEGIN SELECT RAISE(ABORT, 'source_manifest_immutable'); END;
CREATE TRIGGER wallet_relocation_source_manifests_retained
BEFORE DELETE ON wallet_relocation_source_manifests
BEGIN SELECT RAISE(ABORT, 'source_manifest_retained'); END;
