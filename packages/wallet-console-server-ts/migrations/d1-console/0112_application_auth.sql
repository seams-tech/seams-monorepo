ALTER TABLE environments ADD COLUMN external_auth_json TEXT NOT NULL
  DEFAULT '{"kind":"disabled","revision":0}' CHECK (json_valid(external_auth_json));
UPDATE environments SET external_auth_json = CASE external_auth_kind
  WHEN 'google' THEN json_object('kind', 'google', 'clientId', external_auth_client_id, 'revision', external_auth_revision)
  ELSE json_object('kind', 'disabled', 'revision', external_auth_revision)
END;
ALTER TABLE environments DROP COLUMN external_auth_kind;
ALTER TABLE environments DROP COLUMN external_auth_client_id;
ALTER TABLE environments DROP COLUMN external_auth_revision;
