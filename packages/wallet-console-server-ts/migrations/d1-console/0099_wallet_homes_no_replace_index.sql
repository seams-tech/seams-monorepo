-- Answer the replacement guard from the three unique keys of wallet_homes.
-- One EXISTS with a nested OR read every home of the namespace on each insert.
DROP TRIGGER wallet_homes_no_replace;

CREATE TRIGGER wallet_homes_no_replace
BEFORE INSERT ON wallet_homes
WHEN EXISTS (
  SELECT 1 FROM wallet_homes
  WHERE namespace = NEW.namespace AND ceremony_id = NEW.ceremony_id
) OR EXISTS (
  SELECT 1 FROM wallet_homes
  WHERE namespace = NEW.namespace AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND environment_id = NEW.environment_id
    AND wallet_id = NEW.wallet_id
) OR EXISTS (
  SELECT 1 FROM wallet_homes
  WHERE namespace = NEW.namespace AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND environment_id = NEW.environment_id
    AND registration_id = NEW.registration_id
)
BEGIN
  SELECT RAISE(ABORT, 'wallet home identity is immutable');
END;
