import { formatD1ExecStatement, type D1DatabaseLike } from '../boundary/d1';

export const ACCOUNT_SERVICE_ACCESS_D1_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS platform_provider_identities (
    namespace TEXT NOT NULL,
    user_id TEXT NOT NULL,
    provider_issuer TEXT NOT NULL,
    provider_subject TEXT NOT NULL,
    verification_receipt_id TEXT NOT NULL,
    verified_email TEXT,
    display_name TEXT,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, user_id),
    UNIQUE (namespace, provider_issuer, provider_subject)
  )`,
  `CREATE TRIGGER IF NOT EXISTS platform_provider_identity_conflict BEFORE INSERT ON platform_provider_identities
    WHEN EXISTS (SELECT 1 FROM platform_provider_identities p WHERE p.namespace = NEW.namespace
      AND (p.user_id = NEW.user_id OR (p.provider_issuer = NEW.provider_issuer AND p.provider_subject = NEW.provider_subject))
      AND (p.user_id <> NEW.user_id OR p.provider_issuer <> NEW.provider_issuer OR p.provider_subject <> NEW.provider_subject))
    BEGIN SELECT RAISE(ABORT, 'platform_identity_conflict'); END`,
  `CREATE TRIGGER IF NOT EXISTS platform_provider_identity_immutable_update BEFORE UPDATE OF namespace, user_id, provider_issuer, provider_subject ON platform_provider_identities
    BEGIN SELECT RAISE(ABORT, 'platform_identity_immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS platform_provider_identity_immutable_delete BEFORE DELETE ON platform_provider_identities
    BEGIN SELECT RAISE(ABORT, 'platform_identity_immutable'); END`,
  `CREATE TABLE IF NOT EXISTS platform_service_principals (
    namespace TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    native_principal_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    provider_issuer TEXT NOT NULL,
    provider_subject TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, instance_id, native_principal_id),
    UNIQUE (namespace, instance_id, user_id),
    FOREIGN KEY (namespace, instance_id) REFERENCES platform_service_instances(namespace, id),
    FOREIGN KEY (namespace, user_id) REFERENCES platform_provider_identities(namespace, user_id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS platform_service_principal_conflict BEFORE INSERT ON platform_service_principals
    WHEN EXISTS (SELECT 1 FROM platform_service_principals p WHERE p.namespace = NEW.namespace AND p.instance_id = NEW.instance_id
      AND (p.native_principal_id = NEW.native_principal_id OR p.user_id = NEW.user_id)
      AND (p.native_principal_id <> NEW.native_principal_id OR p.user_id <> NEW.user_id
        OR p.provider_issuer <> NEW.provider_issuer OR p.provider_subject <> NEW.provider_subject))
    BEGIN SELECT RAISE(ABORT, 'platform_identity_conflict'); END`,
  `CREATE TRIGGER IF NOT EXISTS platform_service_principal_immutable_update BEFORE UPDATE ON platform_service_principals
    BEGIN SELECT RAISE(ABORT, 'platform_identity_immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS platform_service_principal_immutable_delete BEFORE DELETE ON platform_service_principals
    BEGIN SELECT RAISE(ABORT, 'platform_identity_immutable'); END`,
  `CREATE TABLE IF NOT EXISTS platform_instance_access (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    membership_id TEXT NOT NULL,
    access TEXT NOT NULL CHECK (access IN ('allowed', 'revoked')),
    access_revision INTEGER NOT NULL DEFAULT 1 CHECK (access_revision >= 1),
    revoked_authority_revision INTEGER,
    source_invitation_id TEXT,
    granted_by_user_id TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, instance_id, membership_id),
    FOREIGN KEY (namespace, instance_id) REFERENCES platform_service_instances(namespace, id),
    FOREIGN KEY (namespace, org_id, membership_id) REFERENCES organization_memberships(namespace, org_id, id),
    FOREIGN KEY (namespace, org_id, source_invitation_id) REFERENCES organization_invitations(namespace, org_id, id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS platform_instance_access_scope_guard BEFORE INSERT ON platform_instance_access
    WHEN NOT EXISTS (SELECT 1 FROM platform_service_instances i JOIN organization_memberships m
      ON m.namespace = i.namespace AND m.org_id = i.org_id
      WHERE i.namespace = NEW.namespace AND i.id = NEW.instance_id AND i.org_id = NEW.org_id AND m.id = NEW.membership_id)
    BEGIN SELECT RAISE(ABORT, 'platform_scope_forbidden'); END`,
  `CREATE TRIGGER IF NOT EXISTS platform_instance_access_revision_insert AFTER INSERT ON platform_instance_access
    BEGIN UPDATE organizations SET authorization_version = authorization_version + 1
      WHERE namespace = NEW.namespace AND id = (SELECT org_id FROM platform_service_instances WHERE namespace = NEW.namespace AND id = NEW.instance_id);
      UPDATE platform_instance_access SET revoked_authority_revision = (SELECT authorization_version FROM organizations WHERE namespace = NEW.namespace AND id = NEW.org_id)
        WHERE namespace = NEW.namespace AND instance_id = NEW.instance_id AND membership_id = NEW.membership_id AND NEW.access = 'revoked'; END`,
  `CREATE TRIGGER IF NOT EXISTS platform_instance_access_initial_user_revision AFTER INSERT ON platform_instance_access
    BEGIN UPDATE platform_instance_access SET access_revision = COALESCE((
      SELECT MAX(previous.access_revision) FROM platform_instance_access previous
      JOIN organization_memberships membership ON membership.namespace = previous.namespace AND membership.org_id = previous.org_id AND membership.id = previous.membership_id
      WHERE previous.namespace = NEW.namespace AND previous.instance_id = NEW.instance_id AND previous.membership_id <> NEW.membership_id
        AND membership.user_id = (SELECT user_id FROM organization_memberships WHERE namespace = NEW.namespace AND org_id = NEW.org_id AND id = NEW.membership_id)
    ), 0) + 1 WHERE namespace = NEW.namespace AND instance_id = NEW.instance_id AND membership_id = NEW.membership_id; END`,
  `CREATE TRIGGER IF NOT EXISTS platform_instance_access_identity_immutable BEFORE UPDATE OF namespace, org_id, instance_id, membership_id ON platform_instance_access
    BEGIN SELECT RAISE(ABORT, 'platform_access_identity_immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS platform_instance_access_retained BEFORE DELETE ON platform_instance_access
    BEGIN SELECT RAISE(ABORT, 'platform_access_retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS platform_instance_access_revision_update AFTER UPDATE OF access ON platform_instance_access
    WHEN OLD.access <> NEW.access
    BEGIN UPDATE organizations SET authorization_version = authorization_version + 1
      WHERE namespace = NEW.namespace AND id = (SELECT org_id FROM platform_service_instances WHERE namespace = NEW.namespace AND id = NEW.instance_id);
      UPDATE platform_instance_access SET revoked_authority_revision = (SELECT authorization_version FROM organizations WHERE namespace = NEW.namespace AND id = NEW.org_id)
        WHERE namespace = NEW.namespace AND instance_id = NEW.instance_id AND membership_id = NEW.membership_id AND NEW.access = 'revoked'; END`,
  `CREATE TRIGGER IF NOT EXISTS platform_instance_access_regrant_revision AFTER UPDATE OF access ON platform_instance_access
    WHEN OLD.access = 'revoked' AND NEW.access = 'allowed'
    BEGIN UPDATE platform_instance_access SET access_revision = COALESCE((
      SELECT MAX(previous.access_revision) FROM platform_instance_access previous
      JOIN organization_memberships membership ON membership.namespace = previous.namespace AND membership.org_id = previous.org_id AND membership.id = previous.membership_id
      WHERE previous.namespace = NEW.namespace AND previous.instance_id = NEW.instance_id
        AND membership.user_id = (SELECT user_id FROM organization_memberships WHERE namespace = NEW.namespace AND org_id = NEW.org_id AND id = NEW.membership_id)
    ), 0) + 1
      WHERE namespace = NEW.namespace AND instance_id = NEW.instance_id AND membership_id = NEW.membership_id; END`,
  `CREATE TRIGGER IF NOT EXISTS platform_membership_removal_revokes_instances AFTER UPDATE OF kind ON organization_memberships
    WHEN NEW.kind = 'REMOVED' AND OLD.kind <> 'REMOVED'
    BEGIN
      UPDATE organizations SET authorization_version = authorization_version + 1 WHERE namespace = NEW.namespace AND id = NEW.org_id;
      INSERT INTO platform_instance_access (namespace, org_id, instance_id, membership_id, access, granted_by_user_id, updated_at_ms)
        SELECT i.namespace, i.org_id, i.id, NEW.id, 'revoked', NEW.user_id, NEW.updated_at_ms
        FROM platform_service_instances i WHERE i.namespace = NEW.namespace AND i.org_id = NEW.org_id
        ON CONFLICT(namespace, instance_id, membership_id) DO UPDATE SET access = 'revoked', updated_at_ms = excluded.updated_at_ms;
      UPDATE platform_instance_access SET revoked_authority_revision = (SELECT authorization_version FROM organizations WHERE namespace = NEW.namespace AND id = NEW.org_id)
        WHERE namespace = NEW.namespace AND org_id = NEW.org_id AND membership_id = NEW.id;
    END`,
  `CREATE TABLE IF NOT EXISTS platform_service_invitation_grants (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    invitation_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    granted_by_user_id TEXT NOT NULL,
    issued_authority_revision INTEGER NOT NULL CHECK (issued_authority_revision >= 1),
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, invitation_id, instance_id),
    FOREIGN KEY (namespace, org_id, invitation_id) REFERENCES organization_invitations(namespace, org_id, id),
    FOREIGN KEY (namespace, instance_id) REFERENCES platform_service_instances(namespace, id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS platform_service_invitation_scope_guard BEFORE INSERT ON platform_service_invitation_grants
    WHEN NOT EXISTS (SELECT 1 FROM platform_service_instances i JOIN organization_invitations v
      ON v.namespace = i.namespace AND v.org_id = i.org_id
      WHERE i.namespace = NEW.namespace AND i.id = NEW.instance_id AND i.org_id = NEW.org_id AND v.id = NEW.invitation_id)
    BEGIN SELECT RAISE(ABORT, 'platform_scope_forbidden'); END`,
  `CREATE TRIGGER IF NOT EXISTS platform_service_invitation_immutable_update BEFORE UPDATE OF namespace, org_id, invitation_id, instance_id, granted_by_user_id, created_at_ms ON platform_service_invitation_grants
    BEGIN SELECT RAISE(ABORT, 'platform_invitation_grant_immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS platform_service_invitation_immutable_delete BEFORE DELETE ON platform_service_invitation_grants
    BEGIN SELECT RAISE(ABORT, 'platform_invitation_grant_immutable'); END`,
  `CREATE TABLE IF NOT EXISTS platform_automation_grants (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    automation_id TEXT NOT NULL,
    grant_id TEXT NOT NULL,
    native_principal_id TEXT NOT NULL,
    access TEXT NOT NULL CHECK (access IN ('allowed', 'revoked')),
    access_revision INTEGER NOT NULL DEFAULT 1 CHECK (access_revision >= 1),
    granted_by_user_id TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, instance_id, automation_id, grant_id),
    FOREIGN KEY (namespace, instance_id) REFERENCES platform_service_instances(namespace, id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS platform_automation_grant_scope_guard BEFORE INSERT ON platform_automation_grants
    WHEN NOT EXISTS (SELECT 1 FROM platform_service_instances i
      WHERE i.namespace = NEW.namespace AND i.id = NEW.instance_id AND i.org_id = NEW.org_id)
    BEGIN SELECT RAISE(ABORT, 'platform_scope_forbidden'); END`,
  `CREATE TRIGGER IF NOT EXISTS platform_automation_grant_identity_immutable BEFORE UPDATE OF namespace, org_id, instance_id, automation_id, grant_id, native_principal_id, granted_by_user_id ON platform_automation_grants
    BEGIN SELECT RAISE(ABORT, 'platform_automation_identity_immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS platform_automation_grant_retained BEFORE DELETE ON platform_automation_grants
    BEGIN SELECT RAISE(ABORT, 'platform_automation_grant_retained'); END`,
  `CREATE TRIGGER IF NOT EXISTS platform_automation_grant_revision_insert AFTER INSERT ON platform_automation_grants
    BEGIN UPDATE organizations SET authorization_version = authorization_version + 1
      WHERE namespace = NEW.namespace AND id = NEW.org_id; END`,
  `CREATE TRIGGER IF NOT EXISTS platform_automation_grant_revision_update AFTER UPDATE OF access ON platform_automation_grants
    WHEN OLD.access <> NEW.access
    BEGIN UPDATE organizations SET authorization_version = authorization_version + 1
      WHERE namespace = NEW.namespace AND id = NEW.org_id; END`,
  `CREATE TRIGGER IF NOT EXISTS platform_automation_grant_regrant_revision AFTER UPDATE OF access ON platform_automation_grants
    WHEN OLD.access = 'revoked' AND NEW.access = 'allowed'
    BEGIN UPDATE platform_automation_grants SET access_revision = OLD.access_revision + 1
      WHERE namespace = NEW.namespace AND instance_id = NEW.instance_id AND automation_id = NEW.automation_id AND grant_id = NEW.grant_id; END`,
  `CREATE TRIGGER IF NOT EXISTS platform_instance_initial_access AFTER INSERT ON platform_service_instances
    BEGIN INSERT INTO platform_instance_access (namespace, org_id, instance_id, membership_id, access, granted_by_user_id, updated_at_ms)
      SELECT NEW.namespace, NEW.org_id, NEW.id, m.id, 'allowed', o.actor_user_id, NEW.created_at_ms
      FROM platform_provision_operations o JOIN organization_memberships m
        ON m.namespace = o.namespace AND m.org_id = o.org_id AND m.user_id = o.actor_user_id
      WHERE o.namespace = NEW.namespace AND o.id = NEW.operation_id
      ON CONFLICT(namespace, instance_id, membership_id) DO NOTHING; END`,
  `INSERT INTO platform_instance_access (namespace, org_id, instance_id, membership_id, access, granted_by_user_id, updated_at_ms)
    SELECT o.namespace, o.org_id, o.instance_id, m.id, 'allowed', o.actor_user_id, o.created_at_ms
    FROM platform_provision_operations o JOIN organization_memberships m
      ON m.namespace = o.namespace AND m.org_id = o.org_id AND m.user_id = o.actor_user_id
    WHERE o.desired_revision = 1
    ON CONFLICT(namespace, instance_id, membership_id) DO NOTHING`,
  `INSERT INTO platform_instance_access (namespace, org_id, instance_id, membership_id, access, granted_by_user_id, updated_at_ms)
    SELECT i.namespace, i.org_id, i.id, m.id, 'revoked', m.user_id, m.updated_at_ms
    FROM platform_service_instances i JOIN organization_memberships m ON m.namespace = i.namespace AND m.org_id = i.org_id
    WHERE m.kind = 'REMOVED'
    ON CONFLICT(namespace, instance_id, membership_id) DO UPDATE SET access = 'revoked', updated_at_ms = excluded.updated_at_ms`,
]);

export async function ensureAccountServiceAccessD1Schema(database: D1DatabaseLike): Promise<void> {
  for (const statement of ACCOUNT_SERVICE_ACCESS_D1_SCHEMA_SQL) {
    await database.exec(formatD1ExecStatement(statement));
  }
}
