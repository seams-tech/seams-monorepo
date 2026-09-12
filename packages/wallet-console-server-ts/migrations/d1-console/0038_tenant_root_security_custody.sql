-- Tenant-root recovery custody persistence for Refactor 121.
--
-- State is scoped to one tenant root and custody lineage. JSON columns carry
-- the already-validated discriminated unions; the adapter validates them
-- again at the D1 boundary before returning them to domain code.

CREATE TABLE tenant_root_security_custody_state (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  identity_digest_b64u TEXT NOT NULL,
  custody_lineage_b64u TEXT NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  root_commitment_b64u TEXT NOT NULL,
  governance_json TEXT,
  backup_json TEXT NOT NULL,
  recipient_pair_json TEXT,
  source_disposition_json TEXT,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, identity_digest_b64u, custody_lineage_b64u),
  CHECK (length(trim(namespace)) > 0),
  CHECK (length(trim(org_id)) > 0),
  CHECK (length(trim(identity_digest_b64u)) > 0),
  CHECK (length(trim(custody_lineage_b64u)) > 0),
  CHECK (lifecycle_revision > 0),
  CHECK (length(trim(root_commitment_b64u)) > 0),
  CHECK (length(trim(backup_json)) > 0),
  CHECK (governance_json IS NULL OR length(trim(governance_json)) > 0),
  CHECK (recipient_pair_json IS NULL OR length(trim(recipient_pair_json)) > 0),
  CHECK (source_disposition_json IS NULL OR length(trim(source_disposition_json)) > 0)
);

CREATE TABLE tenant_root_security_custody_challenges (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  identity_digest_b64u TEXT NOT NULL,
  custody_lineage_b64u TEXT NOT NULL,
  challenge_id_b64u TEXT NOT NULL,
  role TEXT NOT NULL,
  recipient_public_key_b64u TEXT NOT NULL,
  recipient_fingerprint_b64u TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  PRIMARY KEY (
    namespace,
    org_id,
    identity_digest_b64u,
    custody_lineage_b64u,
    challenge_id_b64u
  ),
  CHECK (role IN ('deriver_a', 'deriver_b')),
  CHECK (length(trim(challenge_id_b64u)) > 0),
  CHECK (length(trim(recipient_public_key_b64u)) > 0),
  CHECK (length(trim(recipient_fingerprint_b64u)) > 0),
  CHECK (length(trim(actor_user_id)) > 0),
  CHECK (lifecycle_revision > 0),
  CHECK (expires_at_ms > issued_at_ms),
  CHECK (consumed_at_ms IS NULL OR consumed_at_ms >= issued_at_ms)
);

CREATE TABLE tenant_root_security_custody_staged_recipients (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  identity_digest_b64u TEXT NOT NULL,
  custody_lineage_b64u TEXT NOT NULL,
  role TEXT NOT NULL,
  recipient_public_key_b64u TEXT NOT NULL,
  recipient_fingerprint_b64u TEXT NOT NULL,
  verified_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, identity_digest_b64u, custody_lineage_b64u, role),
  CHECK (role IN ('deriver_a', 'deriver_b')),
  CHECK (length(trim(recipient_public_key_b64u)) > 0),
  CHECK (length(trim(recipient_fingerprint_b64u)) > 0),
  CHECK (verified_at_ms > 0)
);

CREATE INDEX tenant_root_security_custody_challenge_expiry_idx
  ON tenant_root_security_custody_challenges (
    namespace,
    org_id,
    identity_digest_b64u,
    custody_lineage_b64u,
    expires_at_ms
  );
