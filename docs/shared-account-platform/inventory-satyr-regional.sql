-- Read only. Run in every cell selected by the deployed placement authority.
SELECT organisation_id, status FROM organisation ORDER BY organisation_id;

SELECT organisation_id, role, status, COUNT(*) AS membership_count,
  COUNT(DISTINCT person_id) AS person_count
FROM organisation_membership GROUP BY organisation_id, role, status;

SELECT organisation_id, user_id, person_id, role, status
FROM organisation_membership ORDER BY organisation_id, user_id;

SELECT organisation_id, lifecycle, configuration_version, projection_revision
FROM organisation_onboarding ORDER BY organisation_id;

SELECT organisation_id, placement_epoch, placement_kind, placement_cell_id,
  location_hint, residency_jurisdiction, status, environment
FROM organisation_placement ORDER BY organisation_id, placement_epoch;

SELECT organisation_id, selection_kind FROM organisation_inference_selection ORDER BY organisation_id;
