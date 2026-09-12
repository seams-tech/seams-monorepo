CREATE TABLE tenant_root_cli_enrollment (
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  next_poll_ms INTEGER NOT NULL DEFAULT 0,
  environment_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('deriver_a', 'deriver_b')),
  public_key TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'denied', 'completed')),
  approval_json TEXT,
  result_json TEXT,
  PRIMARY KEY (namespace, id),
  CHECK ((state = 'pending' OR state = 'denied') AND approval_json IS NULL AND result_json IS NULL
      OR state = 'approved' AND approval_json IS NOT NULL AND result_json IS NULL
      OR state = 'completed' AND approval_json IS NOT NULL AND result_json IS NOT NULL)
);
CREATE INDEX tenant_root_cli_enrollment_expiry ON tenant_root_cli_enrollment(namespace, expires_at_ms);

-- Consumption and recipient staging must survive a process exit as one write.
CREATE TRIGGER tenant_root_recipient_stage_on_confirmation
AFTER UPDATE OF consumed_at_ms ON tenant_root_security_custody_challenges
WHEN OLD.consumed_at_ms IS NULL AND NEW.consumed_at_ms IS NOT NULL
BEGIN
  INSERT INTO tenant_root_security_custody_staged_recipients
    (namespace, org_id, identity_digest_b64u, custody_lineage_b64u, role,
     recipient_public_key_b64u, recipient_fingerprint_b64u, verified_at_ms)
  VALUES (NEW.namespace, NEW.org_id, NEW.identity_digest_b64u, NEW.custody_lineage_b64u,
    NEW.role, NEW.recipient_public_key_b64u, NEW.recipient_fingerprint_b64u, NEW.consumed_at_ms)
  ON CONFLICT (namespace, org_id, identity_digest_b64u, custody_lineage_b64u, role)
  DO UPDATE SET recipient_public_key_b64u=excluded.recipient_public_key_b64u,
    recipient_fingerprint_b64u=excluded.recipient_fingerprint_b64u,
    verified_at_ms=excluded.verified_at_ms;
END;
