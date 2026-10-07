CREATE TABLE wallet_relocation_stage_receipts (
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('source_fence', 'destination_verification', 'destination_activation', 'source_cleanup')),
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json) AND json_type(receipt_json) = 'object'),
  PRIMARY KEY (namespace, organization_id, project_id, environment_id, wallet_id, move_id, kind),
  FOREIGN KEY (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
    REFERENCES wallet_relocations (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
);
CREATE TRIGGER wallet_relocation_stage_receipts_immutable
BEFORE UPDATE ON wallet_relocation_stage_receipts
BEGIN SELECT RAISE(ABORT, 'stage_receipt_immutable'); END;
CREATE TRIGGER wallet_relocation_stage_receipts_retained
BEFORE DELETE ON wallet_relocation_stage_receipts
BEGIN SELECT RAISE(ABORT, 'stage_receipt_retained'); END;
