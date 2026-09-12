-- Pending challenges from the unmounted custody path have no proof verifier.
DROP TABLE tenant_root_security_custody_challenges;
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
  expected_confirmation_b64u TEXT NOT NULL CHECK (length(expected_confirmation_b64u) = 43),
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


CREATE INDEX tenant_root_security_custody_challenge_expiry_idx
  ON tenant_root_security_custody_challenges (
    namespace,
    org_id,
    identity_digest_b64u,
    custody_lineage_b64u,
    expires_at_ms
  );
