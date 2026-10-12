-- Earlier moves must finish before admission requires participant preparation.
CREATE TABLE wallet_relocation_preparation_upgrade_guard (
  pending_count INTEGER NOT NULL CHECK (pending_count = 0)
);
INSERT INTO wallet_relocation_preparation_upgrade_guard
  SELECT COUNT(*) FROM wallet_relocations WHERE state != 'completed';
DROP TABLE wallet_relocation_preparation_upgrade_guard;

ALTER TABLE wallet_relocations ADD COLUMN preparation_json TEXT
  CHECK (preparation_json IS NULL OR
    (json_valid(preparation_json) AND json_type(preparation_json) = 'object'));

CREATE TRIGGER wallet_relocations_require_preparation
BEFORE INSERT ON wallet_relocations
WHEN NEW.preparation_json IS NULL
  OR json_extract(NEW.preparation_json, '$.requestDigest') IS NOT NEW.request_digest
  OR json_extract(NEW.preparation_json, '$.destinationGeneration') IS NOT NEW.destination_generation
  OR json_type(NEW.preparation_json, '$.receipts') IS NOT 'array'
  OR json_array_length(NEW.preparation_json, '$.receipts') IS NOT 7
  OR EXISTS (
    SELECT 1 FROM json_each('["gateway","walletRuntime","router","deriverA","deriverB","signingWorker","presignSessions"]') role
    WHERE (SELECT COUNT(*) FROM json_each(NEW.preparation_json, '$.receipts') receipt
      WHERE json_extract(receipt.value, '$.participant') = role.value) != 1
  )
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.preparation_json, '$.receipts') receipt
    WHERE json_type(receipt.value, '$.physicalResource') IS NOT 'text'
      OR length(json_extract(receipt.value, '$.physicalResource')) = 0
      OR json_type(receipt.value, '$.evidenceDigest') IS NOT 'text'
      OR length(json_extract(receipt.value, '$.evidenceDigest')) != 64
      OR json_extract(receipt.value, '$.evidenceDigest') GLOB '*[^a-f0-9]*'
      OR json_type(receipt.value, '$.preparedAtMs') IS NOT 'integer'
      OR json_type(receipt.value, '$.expiresAtMs') IS NOT 'integer'
      OR json_extract(receipt.value, '$.preparedAtMs') <= 0
      OR json_extract(receipt.value, '$.preparedAtMs') > NEW.admitted_at_ms
      OR json_extract(receipt.value, '$.expiresAtMs') <= NEW.admitted_at_ms
      OR json_extract(receipt.value, '$.expiresAtMs') - json_extract(receipt.value, '$.preparedAtMs') > 300000
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet relocation participants are unprepared');
END;

CREATE TRIGGER wallet_relocations_preparation_immutable
BEFORE UPDATE OF preparation_json ON wallet_relocations
WHEN NEW.preparation_json IS NOT OLD.preparation_json
BEGIN
  SELECT RAISE(ABORT, 'wallet relocation preparation is immutable');
END;
