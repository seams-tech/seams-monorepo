-- Finish earlier moves before installing the required resource admission contract.
CREATE TABLE wallet_relocation_resource_upgrade_guard (pending_count INTEGER NOT NULL CHECK (pending_count = 0));
INSERT INTO wallet_relocation_resource_upgrade_guard
  SELECT COUNT(*) FROM wallet_relocations WHERE state != 'completed';
DROP TABLE wallet_relocation_resource_upgrade_guard;

ALTER TABLE wallet_relocations ADD COLUMN resource_verifications_json TEXT
  CHECK (resource_verifications_json IS NULL OR
    (json_valid(resource_verifications_json) AND json_type(resource_verifications_json) = 'array'
      AND json_array_length(resource_verifications_json) = 2));

CREATE TRIGGER wallet_relocations_require_resources
BEFORE INSERT ON wallet_relocations
WHEN NEW.resource_verifications_json IS NULL OR EXISTS (
  SELECT 1 FROM json_each(NEW.resource_verifications_json) proof
  WHERE json_extract(proof.value, '$.resource.namespace') IS NOT NEW.namespace
    OR json_extract(proof.value, '$.authority.kind') IS NOT 'cloudflare'
    OR json_type(proof.value, '$.checkedAtMs') IS NOT 'integer'
    OR json_type(proof.value, '$.expiresAtMs') IS NOT 'integer'
    OR json_type(proof.value, '$.authority.gateway.versionId') IS NOT 'text'
    OR json_type(proof.value, '$.authority.walletRuntime.versionId') IS NOT 'text'
    OR json_extract(proof.value, '$.checkedAtMs') <= 0
    OR json_extract(proof.value, '$.expiresAtMs') - json_extract(proof.value, '$.checkedAtMs') > 300000
    OR json_extract(proof.value, '$.checkedAtMs') > NEW.admitted_at_ms
    OR json_extract(proof.value, '$.expiresAtMs') <= NEW.admitted_at_ms
) OR NOT EXISTS (
  SELECT 1 FROM json_each(NEW.resource_verifications_json) proof
  WHERE json_extract(proof.value, '$.resource.accountId') = NEW.source_account_id
    AND json_extract(proof.value, '$.resource.databaseId') = NEW.source_database_id
) OR NOT EXISTS (
  SELECT 1 FROM json_each(NEW.resource_verifications_json) proof
  WHERE json_extract(proof.value, '$.resource.accountId') = NEW.destination_account_id
    AND json_extract(proof.value, '$.resource.databaseId') = NEW.destination_database_id
)
BEGIN
  SELECT RAISE(ABORT, 'wallet relocation resources are unverified');
END;

CREATE TRIGGER wallet_relocations_resources_immutable
BEFORE UPDATE OF resource_verifications_json ON wallet_relocations
WHEN NEW.resource_verifications_json IS NOT OLD.resource_verifications_json
BEGIN
  SELECT RAISE(ABORT, 'wallet relocation resources are immutable');
END;
