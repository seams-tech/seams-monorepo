CREATE TABLE linked_device_bootstrap (
 namespace TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, environment_id TEXT NOT NULL,
 link_session_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('displaying_qr', 'claimed', 'cancelled', 'expired')),
 qr_json TEXT NOT NULL CHECK(json_valid(qr_json)),
 record_json TEXT NOT NULL CHECK(json_valid(record_json)),
 expires_at_ms INTEGER NOT NULL,
 PRIMARY KEY(namespace, organization_id, project_id, environment_id, link_session_id),
 CHECK(json_extract(record_json, '$.state.state') = state)
);
CREATE TRIGGER linked_device_bootstrap_transition
BEFORE UPDATE ON linked_device_bootstrap
WHEN OLD.state != 'displaying_qr' OR NEW.state = 'displaying_qr'
 OR NEW.namespace != OLD.namespace OR NEW.organization_id != OLD.organization_id
 OR NEW.project_id != OLD.project_id OR NEW.environment_id != OLD.environment_id
 OR NEW.link_session_id != OLD.link_session_id OR NEW.qr_json != OLD.qr_json
 OR NEW.expires_at_ms != OLD.expires_at_ms
BEGIN SELECT RAISE(ABORT, 'Invalid linked-device bootstrap transition'); END;
