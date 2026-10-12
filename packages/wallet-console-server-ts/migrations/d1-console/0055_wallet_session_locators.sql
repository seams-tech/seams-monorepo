CREATE TABLE wallet_session_locators (
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('credential', 'exchange')),
  digest TEXT NOT NULL CHECK (length(digest) = 43 AND digest NOT GLOB '*[^A-Za-z0-9_-]*'),
  wallet_id TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > 0),
  PRIMARY KEY (namespace, organization_id, project_id, environment_id, kind, digest),
  FOREIGN KEY (namespace, organization_id, project_id, environment_id, wallet_id)
    REFERENCES wallet_homes (namespace, organization_id, project_id, environment_id, wallet_id)
);

CREATE TRIGGER wallet_session_locators_no_update
BEFORE UPDATE ON wallet_session_locators
BEGIN
  SELECT RAISE(ABORT, 'session locator identity is immutable');
END;

CREATE TRIGGER wallet_session_locators_no_replace
BEFORE INSERT ON wallet_session_locators
WHEN EXISTS (
  SELECT 1 FROM wallet_session_locators
  WHERE namespace = NEW.namespace AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND environment_id = NEW.environment_id
    AND kind = NEW.kind AND digest = NEW.digest
    AND (wallet_id != NEW.wallet_id OR expires_at_ms != NEW.expires_at_ms)
)
BEGIN
  SELECT RAISE(ABORT, 'session locator identity conflict');
END;
