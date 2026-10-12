CREATE TRIGGER wallet_home_cancel_requires_uncommitted_offer
BEFORE UPDATE OF state ON wallet_homes
WHEN NEW.state = 'cancelled' AND EXISTS (
  SELECT 1 FROM email_otp_registration_attempts offer
  WHERE offer.namespace = NEW.namespace AND offer.org_id = NEW.organization_id
    AND offer.project_id = NEW.project_id AND offer.env_id = NEW.environment_id
    AND offer.wallet_id = NEW.wallet_id AND offer.state = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'completed registration cannot cancel its wallet home');
END;

CREATE TRIGGER wallet_home_cancel_releases_pending_offers
AFTER UPDATE OF state ON wallet_homes
WHEN NEW.state = 'cancelled'
BEGIN
  DELETE FROM email_otp_registration_attempts
  WHERE namespace = NEW.namespace AND org_id = NEW.organization_id
    AND project_id = NEW.project_id AND env_id = NEW.environment_id
    AND wallet_id = NEW.wallet_id AND state IN ('started', 'key_finalized');
END;
