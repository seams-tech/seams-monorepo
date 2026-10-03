CREATE TABLE wallet_sync_challenges (
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  expected_wallet_id TEXT,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  expires_at_ms INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0, 1)),
  PRIMARY KEY(namespace, organization_id, project_id, environment_id, challenge_id)
);
