-- An unfinished cutover from the earlier journal must be resolved before upgrade.
CREATE TABLE wallet_activation_upgrade_guard (pending_count INTEGER NOT NULL CHECK (pending_count = 0));
INSERT INTO wallet_activation_upgrade_guard
  SELECT COUNT(*) FROM wallet_relocations WHERE state = 'cutover';
DROP TABLE wallet_activation_upgrade_guard;

DROP TRIGGER wallet_homes_placement_transition;
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
      AND move.wallet_id = OLD.wallet_id AND (
        (move.source_generation = OLD.ownership_generation
          AND move.source_region = OLD.region AND move.source_account_id = OLD.account_id
          AND move.source_database_id = OLD.database_id AND (
            (move.state = 'freezing' AND OLD.placement_state = 'active' AND NEW.placement_state = 'paused'
              AND NEW.region = OLD.region AND NEW.account_id = OLD.account_id
              AND NEW.database_id = OLD.database_id AND NEW.ownership_generation = OLD.ownership_generation) OR
            (move.state = 'cutover' AND move.destination_activation_json IS NULL
              AND OLD.placement_state = 'paused' AND NEW.placement_state = 'paused'
              AND NEW.region = move.destination_region AND NEW.account_id = move.destination_account_id
              AND NEW.database_id = move.destination_database_id
              AND NEW.ownership_generation = move.destination_generation)
          )) OR
        (move.state = 'cutover' AND move.destination_activation_json IS NOT NULL
          AND move.destination_generation = OLD.ownership_generation
          AND move.destination_region = OLD.region AND move.destination_account_id = OLD.account_id
          AND move.destination_database_id = OLD.database_id
          AND OLD.placement_state = 'paused' AND NEW.placement_state = 'active'
          AND NEW.region = OLD.region AND NEW.account_id = OLD.account_id
          AND NEW.database_id = OLD.database_id AND NEW.ownership_generation = OLD.ownership_generation)
      )
  ) THEN RAISE(ABORT, 'wallet placement transition requires its relocation') END;
END;

DROP TRIGGER wallet_relocations_switch_home;
CREATE TRIGGER wallet_relocations_switch_home
AFTER UPDATE OF state ON wallet_relocations
WHEN OLD.state = 'verified' AND NEW.state = 'cutover'
BEGIN
  UPDATE wallet_homes SET region = NEW.destination_region, account_id = NEW.destination_account_id,
    database_id = NEW.destination_database_id, ownership_generation = NEW.destination_generation
  WHERE namespace = NEW.namespace AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND environment_id = NEW.environment_id AND wallet_id = NEW.wallet_id
    AND placement_state = 'paused' AND ownership_generation = NEW.source_generation
    AND region = NEW.source_region AND account_id = NEW.source_account_id AND database_id = NEW.source_database_id;
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'wallet relocation ownership switch rejected') END;
END;

CREATE TRIGGER wallet_relocations_activate_home
AFTER UPDATE OF destination_activation_json ON wallet_relocations
WHEN OLD.destination_activation_json IS NULL AND NEW.destination_activation_json IS NOT NULL
  AND NEW.state = 'cutover'
BEGIN
  UPDATE wallet_homes SET placement_state = 'active'
  WHERE namespace = NEW.namespace AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND environment_id = NEW.environment_id AND wallet_id = NEW.wallet_id
    AND placement_state = 'paused' AND ownership_generation = NEW.destination_generation
    AND region = NEW.destination_region AND account_id = NEW.destination_account_id
    AND database_id = NEW.destination_database_id;
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'wallet relocation activation rejected') END;
END;
