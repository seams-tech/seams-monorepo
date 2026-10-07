CREATE TABLE namespace_d1_homes (
  namespace TEXT PRIMARY KEY NOT NULL CHECK (length(namespace) > 0 AND trim(namespace) = namespace),
  account_id TEXT NOT NULL CHECK (length(account_id) = 32),
  database_id TEXT NOT NULL CHECK (length(database_id) = 36),
  assigned_at_ms INTEGER NOT NULL CHECK (assigned_at_ms > 0)
);

-- Reservations survive interrupted provisioning. No update, delete, or REPLACE can move a home.
CREATE TRIGGER namespace_d1_homes_no_update
BEFORE UPDATE ON namespace_d1_homes
BEGIN
  SELECT RAISE(ABORT, 'namespace D1 home is immutable');
END;

CREATE TRIGGER namespace_d1_homes_no_delete
BEFORE DELETE ON namespace_d1_homes
BEGIN
  SELECT RAISE(ABORT, 'namespace D1 home is immutable');
END;

CREATE TRIGGER namespace_d1_homes_no_replace
BEFORE INSERT ON namespace_d1_homes
WHEN EXISTS (SELECT 1 FROM namespace_d1_homes WHERE namespace = NEW.namespace)
BEGIN
  SELECT RAISE(ABORT, 'namespace D1 home is immutable');
END;
