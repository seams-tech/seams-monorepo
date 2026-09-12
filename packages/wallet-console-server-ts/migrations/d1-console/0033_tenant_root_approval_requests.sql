-- Tenant derivation-root approval requests (Refactor 121).
--
-- An operation that needs a second owner is recorded here with its exact
-- canonical record before anyone approves it. The approver approves this
-- digest, and the requester's retry reuses this record, so the bytes a second
-- owner signed off on are the bytes the operation consumes. A request expires
-- with the record it carries; an expired request needs a fresh approval.

CREATE TABLE tenant_root_security_approval_requests (
  namespace TEXT NOT NULL,
  operation_digest_b64u TEXT NOT NULL,
  org_id TEXT NOT NULL,
  identity_digest_b64u TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  canonical_record_json TEXT NOT NULL,
  -- What the operation will do beyond what the frozen record encodes, such as
  -- the target governance branch, so an approver sees it and a retry cannot
  -- swap it under an approved digest.
  payload_json TEXT,
  idempotency_key TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, operation_digest_b64u),
  -- One record per idempotency key within one tenant root: a retry presents
  -- the same digest, and another tenant's choice of key is not this tenant's.
  UNIQUE (namespace, identity_digest_b64u, idempotency_key),
  CHECK (created_at_ms > 0),
  CHECK (expires_at_ms > created_at_ms)
);

CREATE INDEX tenant_root_security_approval_requests_expiry_idx
  ON tenant_root_security_approval_requests (namespace, expires_at_ms);
