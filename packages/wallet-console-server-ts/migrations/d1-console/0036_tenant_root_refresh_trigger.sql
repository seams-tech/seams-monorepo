-- Persist the admission trigger with each tenant-root rotation operation.
-- Existing rows are manual browser-authorized operations at this boundary.
ALTER TABLE tenant_root_security_operations
  ADD COLUMN trigger_kind TEXT NOT NULL DEFAULT 'manual'
  CHECK (
    trigger_kind = 'manual'
    OR (
      trigger_kind = 'scheduled'
      AND operation_kind = 'tenant_root_operational_share_rotation_v1'
    )
  );
