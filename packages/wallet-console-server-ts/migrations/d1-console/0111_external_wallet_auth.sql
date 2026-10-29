ALTER TABLE environments ADD COLUMN external_auth_kind TEXT NOT NULL DEFAULT 'disabled'
  CHECK (external_auth_kind IN ('disabled', 'google'));
ALTER TABLE environments ADD COLUMN external_auth_client_id TEXT NOT NULL DEFAULT '';
ALTER TABLE environments ADD COLUMN external_auth_revision INTEGER NOT NULL DEFAULT 0
  CHECK (external_auth_revision >= 0);
