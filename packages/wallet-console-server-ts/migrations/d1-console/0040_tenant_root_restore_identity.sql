-- Keep public signing scope after restore clears the recovery manifest.
ALTER TABLE tenant_root_security_restore_state ADD COLUMN identity_json TEXT
  CHECK (identity_json IS NULL OR json_valid(identity_json));
