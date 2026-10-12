ALTER TABLE wallet_homes ADD COLUMN ownership_generation INTEGER NOT NULL DEFAULT 1
  CHECK (ownership_generation BETWEEN 1 AND 9007199254740991);
ALTER TABLE wallet_homes ADD COLUMN placement_state TEXT NOT NULL DEFAULT 'active'
  CHECK (placement_state IN ('active', 'paused'));

CREATE TABLE wallet_relocations (
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL CHECK (move_id GLOB 'wmove_*'),
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64 AND request_digest NOT GLOB '*[^a-f0-9]*'),
  authority_id TEXT NOT NULL CHECK (authority_id GLOB 'wallet-authority:*'),
  source_region TEXT NOT NULL CHECK (source_region IN ('US', 'WEUR', 'APAC')),
  source_account_id TEXT NOT NULL CHECK (length(source_account_id) = 32),
  source_database_id TEXT NOT NULL CHECK (length(source_database_id) = 36),
  destination_region TEXT NOT NULL CHECK (destination_region IN ('US', 'WEUR', 'APAC')),
  destination_account_id TEXT NOT NULL CHECK (length(destination_account_id) = 32),
  destination_database_id TEXT NOT NULL CHECK (length(destination_database_id) = 36),
  source_generation INTEGER NOT NULL CHECK (source_generation BETWEEN 1 AND 9007199254740990),
  destination_generation INTEGER NOT NULL CHECK (destination_generation = source_generation + 1),
  state TEXT NOT NULL CHECK (state IN ('freezing', 'copying', 'verified', 'cutover', 'completed')),
  admitted_at_ms INTEGER NOT NULL CHECK (admitted_at_ms > 0),
  source_fence_json TEXT CHECK (source_fence_json IS NULL OR json_valid(source_fence_json)),
  destination_verification_json TEXT CHECK (destination_verification_json IS NULL OR json_valid(destination_verification_json)),
  cutover_at_ms INTEGER,
  completed_at_ms INTEGER,
  PRIMARY KEY (namespace, organization_id, project_id, environment_id, wallet_id, move_id),
  FOREIGN KEY (namespace, organization_id, project_id, environment_id, wallet_id)
    REFERENCES wallet_homes (namespace, organization_id, project_id, environment_id, wallet_id),
  CHECK (source_region != destination_region AND source_database_id != destination_database_id),
  CHECK (
    (state = 'freezing' AND source_fence_json IS NULL AND destination_verification_json IS NULL AND cutover_at_ms IS NULL AND completed_at_ms IS NULL) OR
    (state = 'copying' AND source_fence_json IS NOT NULL AND destination_verification_json IS NULL AND cutover_at_ms IS NULL AND completed_at_ms IS NULL) OR
    (state = 'verified' AND source_fence_json IS NOT NULL AND destination_verification_json IS NOT NULL AND cutover_at_ms IS NULL AND completed_at_ms IS NULL) OR
    (state = 'cutover' AND source_fence_json IS NOT NULL AND destination_verification_json IS NOT NULL AND cutover_at_ms IS NOT NULL AND cutover_at_ms >= admitted_at_ms AND completed_at_ms IS NULL) OR
    (state = 'completed' AND source_fence_json IS NOT NULL AND destination_verification_json IS NOT NULL AND cutover_at_ms IS NOT NULL AND cutover_at_ms >= admitted_at_ms AND completed_at_ms IS NOT NULL AND completed_at_ms >= cutover_at_ms)
  )
);

CREATE UNIQUE INDEX wallet_relocations_one_pending
  ON wallet_relocations (namespace, organization_id, project_id, environment_id, wallet_id)
  WHERE state != 'completed';

CREATE TRIGGER wallet_relocations_admission
BEFORE INSERT ON wallet_relocations
WHEN NEW.state != 'freezing' OR NOT EXISTS (
  SELECT 1 FROM wallet_homes home
  WHERE home.namespace = NEW.namespace AND home.organization_id = NEW.organization_id
    AND home.project_id = NEW.project_id AND home.environment_id = NEW.environment_id
    AND home.wallet_id = NEW.wallet_id AND home.state = 'established'
    AND home.placement_state = 'active' AND home.ownership_generation = NEW.source_generation
    AND home.region = NEW.source_region AND home.account_id = NEW.source_account_id
    AND home.database_id = NEW.source_database_id
) OR EXISTS (
  SELECT 1 FROM wallet_relocations prior
  WHERE prior.namespace = NEW.namespace AND prior.organization_id = NEW.organization_id
    AND prior.project_id = NEW.project_id AND prior.environment_id = NEW.environment_id
    AND prior.wallet_id = NEW.wallet_id
    AND (prior.move_id = NEW.move_id OR prior.state != 'completed'
      OR prior.admitted_at_ms + 300000 > NEW.admitted_at_ms)
)
BEGIN
  SELECT RAISE(ABORT, 'wallet relocation admission rejected');
END;

DROP TRIGGER wallet_homes_identity_immutable;
CREATE TRIGGER wallet_homes_identity_immutable
BEFORE UPDATE ON wallet_homes
WHEN NEW.namespace != OLD.namespace OR NEW.organization_id != OLD.organization_id OR
     NEW.project_id != OLD.project_id OR NEW.environment_id != OLD.environment_id OR
     NEW.wallet_id != OLD.wallet_id OR NEW.registration_id != OLD.registration_id OR
     NEW.request_digest != OLD.request_digest OR NEW.allocation != OLD.allocation OR
     NEW.ceremony_id != OLD.ceremony_id OR NEW.preparation_id != OLD.preparation_id OR
     NEW.wallet_authority_id != OLD.wallet_authority_id OR NEW.device_id != OLD.device_id OR
     NEW.wallet_auth_method_id != OLD.wallet_auth_method_id OR NEW.reserved_at_ms != OLD.reserved_at_ms
BEGIN
  SELECT RAISE(ABORT, 'wallet identity is immutable');
END;

DROP TRIGGER wallet_homes_terminal_state;
CREATE TRIGGER wallet_homes_terminal_state
BEFORE UPDATE OF state, completed_at_ms ON wallet_homes
WHEN NEW.state != OLD.state OR NEW.completed_at_ms IS NOT OLD.completed_at_ms
BEGIN
  SELECT CASE WHEN OLD.state != 'reserved' OR NEW.state = 'reserved'
    THEN RAISE(ABORT, 'wallet registration transition is invalid') END;
END;

CREATE TRIGGER wallet_homes_placement_transition
BEFORE UPDATE OF region, account_id, database_id, ownership_generation, placement_state ON wallet_homes
WHEN NEW.region != OLD.region OR NEW.account_id != OLD.account_id OR
     NEW.database_id != OLD.database_id OR NEW.ownership_generation != OLD.ownership_generation OR
     NEW.placement_state != OLD.placement_state
BEGIN
  SELECT CASE WHEN OLD.state != 'established' OR NOT EXISTS (
    SELECT 1 FROM wallet_relocations move
    WHERE move.namespace = OLD.namespace AND move.organization_id = OLD.organization_id
      AND move.project_id = OLD.project_id AND move.environment_id = OLD.environment_id
      AND move.wallet_id = OLD.wallet_id AND move.source_generation = OLD.ownership_generation
      AND move.source_region = OLD.region AND move.source_account_id = OLD.account_id
      AND move.source_database_id = OLD.database_id AND (
        (move.state = 'freezing' AND OLD.placement_state = 'active' AND NEW.placement_state = 'paused'
          AND NEW.region = OLD.region AND NEW.account_id = OLD.account_id
          AND NEW.database_id = OLD.database_id AND NEW.ownership_generation = OLD.ownership_generation) OR
        (move.state = 'cutover' AND OLD.placement_state = 'paused' AND NEW.placement_state = 'active'
          AND NEW.region = move.destination_region AND NEW.account_id = move.destination_account_id
          AND NEW.database_id = move.destination_database_id
          AND NEW.ownership_generation = move.destination_generation)
      )
  ) THEN RAISE(ABORT, 'wallet placement transition requires its relocation') END;
END;

CREATE TRIGGER wallet_relocations_pause_home
AFTER INSERT ON wallet_relocations
BEGIN
  UPDATE wallet_homes SET placement_state = 'paused'
  WHERE namespace = NEW.namespace AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND environment_id = NEW.environment_id AND wallet_id = NEW.wallet_id;
END;

CREATE TRIGGER wallet_relocations_transition
BEFORE UPDATE ON wallet_relocations
BEGIN
  SELECT CASE WHEN NEW.namespace != OLD.namespace OR NEW.organization_id != OLD.organization_id OR
    NEW.project_id != OLD.project_id OR NEW.environment_id != OLD.environment_id OR
    NEW.wallet_id != OLD.wallet_id OR NEW.move_id != OLD.move_id OR NEW.request_digest != OLD.request_digest OR
    NEW.authority_id != OLD.authority_id OR NEW.source_region != OLD.source_region OR
    NEW.source_account_id != OLD.source_account_id OR NEW.source_database_id != OLD.source_database_id OR
    NEW.destination_region != OLD.destination_region OR NEW.destination_account_id != OLD.destination_account_id OR
    NEW.destination_database_id != OLD.destination_database_id OR NEW.source_generation != OLD.source_generation OR
    NEW.destination_generation != OLD.destination_generation OR NEW.admitted_at_ms != OLD.admitted_at_ms OR
    (OLD.source_fence_json IS NOT NULL AND NEW.source_fence_json IS NOT OLD.source_fence_json) OR
    (OLD.destination_verification_json IS NOT NULL AND NEW.destination_verification_json IS NOT OLD.destination_verification_json) OR
    (OLD.cutover_at_ms IS NOT NULL AND NEW.cutover_at_ms IS NOT OLD.cutover_at_ms) OR
    (OLD.completed_at_ms IS NOT NULL AND NEW.completed_at_ms IS NOT OLD.completed_at_ms) OR NOT (
      (OLD.state = 'freezing' AND NEW.state = 'copying') OR
      (OLD.state = 'copying' AND NEW.state = 'verified') OR
      (OLD.state = 'verified' AND NEW.state = 'cutover') OR
      (OLD.state = 'cutover' AND NEW.state = 'completed')
    ) THEN RAISE(ABORT, 'wallet relocation transition rejected') END;
END;

CREATE TRIGGER wallet_relocations_switch_home
AFTER UPDATE OF state ON wallet_relocations
WHEN NEW.state = 'cutover'
BEGIN
  UPDATE wallet_homes SET region = NEW.destination_region, account_id = NEW.destination_account_id,
    database_id = NEW.destination_database_id, ownership_generation = NEW.destination_generation,
    placement_state = 'active'
  WHERE namespace = NEW.namespace AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND environment_id = NEW.environment_id AND wallet_id = NEW.wallet_id
    AND placement_state = 'paused' AND ownership_generation = NEW.source_generation;
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'wallet relocation ownership switch rejected') END;
END;

CREATE TRIGGER wallet_relocations_no_delete
BEFORE DELETE ON wallet_relocations
BEGIN
  SELECT RAISE(ABORT, 'wallet relocation history is immutable');
END;

CREATE TRIGGER wallet_relocations_no_replace
BEFORE INSERT ON wallet_relocations
WHEN EXISTS (
  SELECT 1 FROM wallet_relocations WHERE namespace = NEW.namespace AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND environment_id = NEW.environment_id AND wallet_id = NEW.wallet_id
    AND move_id = NEW.move_id
)
BEGIN
  SELECT RAISE(ABORT, 'wallet relocation history is immutable');
END;
