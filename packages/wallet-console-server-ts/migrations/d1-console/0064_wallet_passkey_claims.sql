CREATE TABLE wallet_passkey_claims (
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  PRIMARY KEY (namespace, organization_id, project_id, environment_id, rp_id, credential_id),
  FOREIGN KEY (namespace, organization_id, project_id, environment_id, wallet_id)
    REFERENCES wallet_homes (namespace, organization_id, project_id, environment_id, wallet_id)
);

CREATE TRIGGER wallet_passkey_claims_immutable
BEFORE UPDATE ON wallet_passkey_claims
BEGIN
  SELECT RAISE(ABORT, 'passkey ownership is immutable');
END;
