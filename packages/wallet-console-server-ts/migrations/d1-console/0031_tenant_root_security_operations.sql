-- Tenant derivation-root console operations (Refactor 121).
--
-- The constraints below are the enforcement, not documentation: self-approval,
-- a reused approval, a reused idempotency key, and an accepted operation
-- without a recorded result are all unrepresentable rows.

CREATE TABLE tenant_root_security_approvals (
  namespace TEXT NOT NULL,
  operation_digest_b64u TEXT NOT NULL,
  org_id TEXT NOT NULL,
  identity_digest_b64u TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  approver_user_id TEXT NOT NULL,
  approver_session_id TEXT NOT NULL,
  approver_step_up_method TEXT NOT NULL,
  approver_step_up_verified_at_ms INTEGER NOT NULL,
  approved_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  consumed_by_operation_id TEXT,
  PRIMARY KEY (namespace, operation_digest_b64u),
  -- A requester can never approve their own operation.
  CHECK (approver_user_id <> requester_user_id),
  CHECK (approved_at_ms > 0),
  CHECK (approver_step_up_verified_at_ms > 0),
  -- An approval is consumed exactly once, by exactly one operation.
  CHECK (
    (consumed_at_ms IS NULL AND consumed_by_operation_id IS NULL)
    OR (consumed_at_ms >= approved_at_ms AND consumed_by_operation_id IS NOT NULL)
  )
);

CREATE TABLE tenant_root_security_operations (
  namespace TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  identity_digest_b64u TEXT NOT NULL,
  custody_lineage_b64u TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  operation_digest_b64u TEXT NOT NULL,
  canonical_record_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  approver_user_id TEXT,
  nonce_b64u TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  authorization_expires_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  accepted_result_json TEXT,
  failure_code TEXT,
  PRIMARY KEY (namespace, operation_id),
  -- One authorization per idempotency key within one tenant root, and one
  -- per operation digest. The key is the caller's choice, so it is scoped
  -- to the tenant-root identity: two tenants may pick the same key.
  UNIQUE (namespace, identity_digest_b64u, idempotency_key),
  UNIQUE (namespace, operation_digest_b64u),
  CHECK (status IN ('pending', 'accepted', 'authorization_expired', 'failed')),
  CHECK (approver_user_id IS NULL OR approver_user_id <> requester_user_id),
  CHECK (created_at_ms > 0),
  CHECK (authorization_expires_at_ms > created_at_ms),
  CHECK (updated_at_ms >= created_at_ms),
  -- An accepted operation records the control plane's result; nothing else does.
  CHECK (
    (status = 'accepted' AND accepted_result_json IS NOT NULL AND failure_code IS NULL)
    OR (status = 'failed' AND failure_code IS NOT NULL AND accepted_result_json IS NULL)
    OR (
      status IN ('pending', 'authorization_expired')
      AND accepted_result_json IS NULL
      AND failure_code IS NULL
    )
  )
);

CREATE INDEX tenant_root_security_operations_dispatch_idx
  ON tenant_root_security_operations (namespace, status, authorization_expires_at_ms);

CREATE INDEX tenant_root_security_operations_identity_idx
  ON tenant_root_security_operations (namespace, identity_digest_b64u, created_at_ms);
