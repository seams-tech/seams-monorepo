CREATE TRIGGER wallet_home_cancel_requires_no_passkey_claim
BEFORE UPDATE OF state ON wallet_homes
WHEN NEW.state = 'cancelled' AND EXISTS (
  SELECT 1 FROM wallet_passkey_claims claim
  WHERE claim.namespace = NEW.namespace AND claim.organization_id = NEW.organization_id
    AND claim.project_id = NEW.project_id AND claim.environment_id = NEW.environment_id
    AND claim.wallet_id = NEW.wallet_id
)
BEGIN
  SELECT RAISE(ABORT, 'passkey claim requires regional reconciliation before cancellation');
END;
