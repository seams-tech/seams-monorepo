CREATE TABLE console_session_revocations (
  namespace TEXT NOT NULL,
  token_digest TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, token_digest)
);

CREATE INDEX console_session_revocations_expiry_idx
  ON console_session_revocations (namespace, expires_at_ms);
