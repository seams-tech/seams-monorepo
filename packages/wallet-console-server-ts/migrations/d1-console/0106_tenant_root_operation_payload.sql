ALTER TABLE tenant_root_security_operations
  ADD COLUMN payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json));
