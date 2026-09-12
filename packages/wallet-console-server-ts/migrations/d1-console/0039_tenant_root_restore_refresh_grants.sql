-- Server-private restore refresh authorization for Refactor 121.
--
-- One row is the exact signed grant admitted for one restore session. The
-- signed bytes stay in this private table and never enter public session JSON
-- or route responses.

CREATE TABLE tenant_root_security_restore_refresh_grants (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  identity_digest_b64u TEXT NOT NULL,
  destination_lineage_b64u TEXT NOT NULL,
  session_id_b64u TEXT NOT NULL,
  operation_digest_b64u TEXT NOT NULL,
  destination_identity_digest_b64u TEXT NOT NULL,
  destination_fingerprint_b64u TEXT NOT NULL,
  grant_destination_lineage_b64u TEXT NOT NULL,
  grant_session_id_b64u TEXT NOT NULL,
  manifest_digest_b64u TEXT NOT NULL,
  deriver_a_acceptance_receipt_digest_b64u TEXT NOT NULL,
  deriver_b_acceptance_receipt_digest_b64u TEXT NOT NULL,
  nonce_b64u TEXT NOT NULL,
  grant_key_id TEXT NOT NULL,
  grant_b64u TEXT NOT NULL,
  grant_digest_b64u TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (
    namespace,
    org_id,
    identity_digest_b64u,
    destination_lineage_b64u,
    session_id_b64u
  ),
  CHECK (length(trim(namespace)) > 0),
  CHECK (length(trim(org_id)) > 0),
  CHECK (length(trim(identity_digest_b64u)) > 0),
  CHECK (length(trim(destination_lineage_b64u)) > 0),
  CHECK (length(trim(session_id_b64u)) > 0),
  CHECK (length(trim(operation_digest_b64u)) > 0),
  CHECK (length(trim(destination_identity_digest_b64u)) > 0),
  CHECK (length(trim(destination_fingerprint_b64u)) > 0),
  CHECK (length(trim(grant_destination_lineage_b64u)) > 0),
  CHECK (length(trim(grant_session_id_b64u)) > 0),
  CHECK (length(trim(manifest_digest_b64u)) > 0),
  CHECK (length(trim(deriver_a_acceptance_receipt_digest_b64u)) > 0),
  CHECK (length(trim(deriver_b_acceptance_receipt_digest_b64u)) > 0),
  CHECK (length(trim(nonce_b64u)) > 0),
  CHECK (length(trim(grant_key_id)) > 0),
  CHECK (length(trim(grant_b64u)) > 0),
  CHECK (length(trim(grant_digest_b64u)) > 0),
  CHECK (issued_at_ms > 0),
  CHECK (expires_at_ms > issued_at_ms),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms > 0)
);

CREATE INDEX tenant_root_security_restore_refresh_grants_expiry_idx
  ON tenant_root_security_restore_refresh_grants (
    namespace,
    identity_digest_b64u,
    expires_at_ms
  );
