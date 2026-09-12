-- Destination restore persistence for Refactor 121.
--
-- The destination bootstrap credential and imported role material are scoped to
-- one deployment lineage. D1 stores only digests, public keys, receipts, and
-- branch state; it never stores a bootstrap token or an import private key.

CREATE TABLE tenant_root_security_restore_state (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  identity_digest_b64u TEXT NOT NULL,
  destination_lineage_b64u TEXT NOT NULL,
  session_json TEXT,
  registered_manifest_json TEXT,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, identity_digest_b64u, destination_lineage_b64u),
  CHECK (length(trim(namespace)) > 0),
  CHECK (length(trim(org_id)) > 0),
  CHECK (length(trim(identity_digest_b64u)) > 0),
  CHECK (length(trim(destination_lineage_b64u)) > 0),
  CHECK (session_json IS NULL OR length(trim(session_json)) > 0),
  CHECK (registered_manifest_json IS NULL OR length(trim(registered_manifest_json)) > 0)
);

CREATE TABLE tenant_root_security_restore_import_keys (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  identity_digest_b64u TEXT NOT NULL,
  destination_lineage_b64u TEXT NOT NULL,
  role TEXT NOT NULL,
  import_key_id TEXT NOT NULL,
  import_public_key_b64u TEXT NOT NULL,
  generation INTEGER NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (
    namespace,
    org_id,
    identity_digest_b64u,
    destination_lineage_b64u,
    role
  ),
  CHECK (role IN ('deriver_a', 'deriver_b')),
  CHECK (length(trim(import_key_id)) > 0),
  CHECK (length(trim(import_public_key_b64u)) > 0),
  CHECK (generation > 0),
  CHECK (expires_at_ms > issued_at_ms)
);

CREATE TABLE tenant_root_security_restore_installed_imports (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  identity_digest_b64u TEXT NOT NULL,
  destination_lineage_b64u TEXT NOT NULL,
  role TEXT NOT NULL,
  envelope_digest_b64u TEXT NOT NULL,
  receipt_digest_b64u TEXT NOT NULL,
  PRIMARY KEY (
    namespace,
    org_id,
    identity_digest_b64u,
    destination_lineage_b64u,
    role
  ),
  CHECK (role IN ('deriver_a', 'deriver_b')),
  CHECK (length(trim(envelope_digest_b64u)) > 0),
  CHECK (length(trim(receipt_digest_b64u)) > 0)
);

CREATE TABLE tenant_root_security_restore_bootstrap_sessions (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  identity_digest_b64u TEXT NOT NULL,
  destination_lineage_b64u TEXT NOT NULL,
  token_digest_b64u TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  authenticated_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (
    namespace,
    org_id,
    identity_digest_b64u,
    destination_lineage_b64u,
    token_digest_b64u
  ),
  CHECK (length(trim(token_digest_b64u)) > 0),
  CHECK (length(trim(actor_user_id)) > 0),
  CHECK (expires_at_ms > authenticated_at_ms)
);

CREATE INDEX tenant_root_security_restore_bootstrap_expiry_idx
  ON tenant_root_security_restore_bootstrap_sessions (
    namespace,
    identity_digest_b64u,
    expires_at_ms
  );
