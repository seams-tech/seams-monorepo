-- Records that one tenant-root operation was dispatched with an unknown
-- outcome (Refactor 121).
--
-- The distinction this column carries is the difference between two very
-- different situations that otherwise look identical in storage:
--
--   * the control plane definitively did not admit the operation (it answered
--     throttled, or another operation held the lock), so the operation can
--     still be refused on its own merits; and
--   * the console sent the operation and never learned what happened, so the
--     control plane may hold a completed rotation that only a retry of this
--     exact operation id can retrieve.
--
-- Without it, a retry after a lost response cannot be told apart from a first
-- attempt, and either every retry risks admitting an operation whose
-- authorization has since expired, or a rotation that already completed can
-- never be reconciled.
ALTER TABLE tenant_root_security_operations
  ADD COLUMN dispatch_uncertain_at_ms INTEGER;
