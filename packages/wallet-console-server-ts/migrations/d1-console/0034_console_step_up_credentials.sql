-- Console WebAuthn credentials and ceremony challenges for step-up (Refactor 121).
--
-- The console authenticates users with OAuth, which proves who holds an
-- account, not who is at the keyboard now. Every tenant-root mutation needs the
-- second fact, so these tables hold the credentials a console user registers
-- and the one-use challenges their ceremonies consume.
--
-- A challenge is bound to the console session that requested it. Step-up proves
-- presence at a keyboard; an assertion replayed from a different session is not
-- that keyboard, so the binding is stored rather than inferred.

CREATE TABLE console_step_up_credentials (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  credential_id_b64u TEXT NOT NULL,
  public_key_b64u TEXT NOT NULL,
  -- Signature counter as last seen. A non-increasing counter on a later
  -- assertion is the cloned-authenticator signal, so it is stored, not derived.
  counter INTEGER NOT NULL,
  method TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  last_used_at_ms INTEGER,
  PRIMARY KEY (namespace, org_id, user_id, credential_id_b64u),
  -- Only methods that actually demonstrate presence count as step-up. This
  -- matches the CHECK on tenant_root_step_up_records in 0032.
  CHECK (method IN ('webauthn_platform_v1', 'webauthn_cross_platform_v1')),
  CHECK (counter >= 0),
  CHECK (created_at_ms > 0),
  CHECK (last_used_at_ms IS NULL OR last_used_at_ms >= created_at_ms)
);

CREATE INDEX console_step_up_credentials_user_idx
  ON console_step_up_credentials (namespace, org_id, user_id);

CREATE TABLE console_step_up_challenges (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  challenge_b64u TEXT NOT NULL,
  session_id TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  -- One live challenge per user and purpose. Issuing a new one replaces its
  -- predecessor rather than leaving a set an attacker could choose from.
  PRIMARY KEY (namespace, org_id, user_id, purpose),
  CHECK (purpose IN ('registration', 'assertion')),
  CHECK (issued_at_ms > 0),
  CHECK (expires_at_ms > issued_at_ms)
);
