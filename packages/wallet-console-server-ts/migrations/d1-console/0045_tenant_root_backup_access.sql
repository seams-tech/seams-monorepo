CREATE TABLE IF NOT EXISTS tenant_root_backup_access (
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  last_poll_ms INTEGER NOT NULL DEFAULT 0,
  request_json TEXT NOT NULL,
  PRIMARY KEY (namespace, id)
);
