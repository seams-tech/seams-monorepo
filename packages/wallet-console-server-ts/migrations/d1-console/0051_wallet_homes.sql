CREATE TABLE wallet_homes (
  namespace TEXT NOT NULL CHECK (length(namespace) > 0 AND trim(namespace) = namespace),
  organization_id TEXT NOT NULL CHECK (length(organization_id) > 0 AND trim(organization_id) = organization_id),
  project_id TEXT NOT NULL CHECK (length(project_id) > 0 AND trim(project_id) = project_id),
  environment_id TEXT NOT NULL CHECK (length(environment_id) > 0 AND trim(environment_id) = environment_id),
  wallet_id TEXT NOT NULL CHECK (length(wallet_id) > 0 AND trim(wallet_id) = wallet_id),
  registration_id TEXT NOT NULL CHECK (length(registration_id) > 0 AND trim(registration_id) = registration_id),
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64 AND request_digest NOT GLOB '*[^a-f0-9]*'),
  allocation TEXT NOT NULL CHECK (allocation IN ('provided', 'server_allocated')),
  region TEXT NOT NULL CHECK (region IN ('US', 'WEUR', 'APAC')),
  account_id TEXT NOT NULL CHECK (length(account_id) = 32),
  database_id TEXT NOT NULL CHECK (length(database_id) = 36),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'established', 'cancelled')),
  reserved_at_ms INTEGER NOT NULL CHECK (reserved_at_ms > 0),
  completed_at_ms INTEGER,
  PRIMARY KEY (namespace, organization_id, project_id, environment_id, wallet_id),
  UNIQUE (namespace, organization_id, project_id, environment_id, registration_id),
  CHECK ((state = 'reserved' AND completed_at_ms IS NULL) OR
         (state IN ('established', 'cancelled') AND completed_at_ms >= reserved_at_ms AND completed_at_ms IS NOT NULL))
);

CREATE TRIGGER wallet_homes_identity_immutable
BEFORE UPDATE ON wallet_homes
WHEN NEW.namespace != OLD.namespace OR NEW.organization_id != OLD.organization_id OR
     NEW.project_id != OLD.project_id OR NEW.environment_id != OLD.environment_id OR
     NEW.wallet_id != OLD.wallet_id OR NEW.registration_id != OLD.registration_id OR
     NEW.request_digest != OLD.request_digest OR NEW.allocation != OLD.allocation OR
     NEW.region != OLD.region OR NEW.account_id != OLD.account_id OR
     NEW.database_id != OLD.database_id OR NEW.reserved_at_ms != OLD.reserved_at_ms
BEGIN
  SELECT RAISE(ABORT, 'wallet home identity is immutable');
END;

CREATE TRIGGER wallet_homes_terminal_state
BEFORE UPDATE ON wallet_homes
WHEN OLD.state != 'reserved' OR NEW.state = 'reserved'
BEGIN
  SELECT RAISE(ABORT, 'wallet home transition is invalid');
END;

CREATE TRIGGER wallet_homes_no_delete
BEFORE DELETE ON wallet_homes
BEGIN
  SELECT RAISE(ABORT, 'wallet home identity is immutable');
END;

CREATE TRIGGER wallet_homes_no_replace
BEFORE INSERT ON wallet_homes
WHEN EXISTS (
  SELECT 1 FROM wallet_homes
  WHERE namespace = NEW.namespace AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND environment_id = NEW.environment_id
    AND (wallet_id = NEW.wallet_id OR registration_id = NEW.registration_id)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet home identity is immutable');
END;
