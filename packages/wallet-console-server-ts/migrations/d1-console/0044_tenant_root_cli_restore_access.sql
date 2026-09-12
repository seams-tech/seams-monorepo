CREATE TABLE tenant_root_cli_restore_access (
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  identity_digest TEXT NOT NULL,
  destination TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  next_poll_ms INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'denied')),
  actor_user_id TEXT,
  session_json TEXT,
  PRIMARY KEY (namespace, id),
  CHECK ((state IN ('pending', 'denied') AND actor_user_id IS NULL AND session_json IS NULL)
    OR (state = 'approved' AND actor_user_id IS NOT NULL AND session_json IS NOT NULL))
);
CREATE INDEX tenant_root_cli_restore_access_expiry ON tenant_root_cli_restore_access(namespace, expires_at_ms);
