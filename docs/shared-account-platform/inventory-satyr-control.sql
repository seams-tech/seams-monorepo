-- Read only. The deployed DB binding owns identity and placement authority.
SELECT organisation_id, status FROM organisation ORDER BY organisation_id;

SELECT organisation_id, placement_epoch, placement_kind, placement_cell_id,
  location_hint, residency_jurisdiction, status, environment
FROM organisation_placement ORDER BY organisation_id, placement_epoch;

SELECT issuer, COUNT(*) AS principal_count, SUM(email_verified) AS verified_email_count
FROM app_user GROUP BY issuer;

SELECT user_id, issuer, subject, email_verified FROM app_user ORDER BY user_id;
