-- Shared hosted identity authority; regional enrollment and proof state stay at home.
CREATE TABLE IF NOT EXISTS identity_links (
      namespace TEXT NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      user_id TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (namespace, org_id, project_id, env_id, subject),
      CHECK (length(namespace) > 0),
      CHECK (length(org_id) > 0),
      CHECK (length(project_id) > 0),
      CHECK (length(env_id) > 0),
      CHECK (length(subject) > 0),
      CHECK (length(user_id) > 0),
      CHECK (json_valid(record_json)),
      CHECK (created_at_ms > 0),
      CHECK (updated_at_ms >= created_at_ms),
      CHECK (COALESCE(json_extract(record_json, '$.version') = 'identity_subject_v1', 0)),
      CHECK (COALESCE(json_extract(record_json, '$.subject') = subject, 0)),
      CHECK (COALESCE(json_extract(record_json, '$.userId') = user_id, 0)),
      CHECK (COALESCE(json_extract(record_json, '$.createdAtMs') = created_at_ms, 0)),
      CHECK (COALESCE(json_extract(record_json, '$.updatedAtMs') = updated_at_ms, 0))
    );

CREATE INDEX IF NOT EXISTS identity_links_user_idx
      ON identity_links (
        namespace,
        org_id,
        project_id,
        env_id,
        user_id,
        created_at_ms
      );
