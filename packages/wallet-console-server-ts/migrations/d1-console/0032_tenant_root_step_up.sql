-- Console step-up records for tenant derivation-root operations (Refactor 121).
--
-- Step-up is proof of presence at a moment in time. The row records when it
-- happened; freshness is decided when an operation reads it, not by deleting
-- rows on a timer.

CREATE TABLE tenant_root_step_up_records (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  method TEXT NOT NULL,
  verified_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (namespace, org_id, actor_user_id),
  -- Only methods that actually demonstrate presence count as step-up.
  CHECK (method IN ('webauthn_platform_v1', 'webauthn_cross_platform_v1')),
  CHECK (verified_at_ms > 0),
  CHECK (created_at_ms >= verified_at_ms)
);

CREATE INDEX tenant_root_step_up_records_freshness_idx
  ON tenant_root_step_up_records (namespace, org_id, verified_at_ms);
