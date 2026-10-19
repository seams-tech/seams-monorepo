import { formatD1ExecStatement, type D1DatabaseLike } from '../boundary/d1';

/** Existing billing_accounts are ledger accounts. These rows identify the customer payer. */
export const ACCOUNT_PLATFORM_D1_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS organization_billing_accounts (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    id TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency = 'USD'),
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, org_id),
    UNIQUE (namespace, id),
    UNIQUE (namespace, org_id, id),
    FOREIGN KEY (namespace, org_id) REFERENCES organizations(namespace, id)
  )`,
  `CREATE TABLE IF NOT EXISTS project_billing_bindings (
    namespace TEXT NOT NULL,
    org_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    PRIMARY KEY (namespace, project_id),
    UNIQUE (namespace, org_id, project_id, billing_account_id),
    FOREIGN KEY (namespace, project_id, org_id) REFERENCES projects(namespace, id, org_id),
    FOREIGN KEY (namespace, org_id, billing_account_id)
      REFERENCES organization_billing_accounts(namespace, org_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS platform_service_instances (
    namespace TEXT NOT NULL,
    id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    service_id TEXT NOT NULL CHECK (service_id IN ('wallet', 'satyr')),
    deployment_id TEXT NOT NULL,
    desired_revision INTEGER NOT NULL CHECK (desired_revision > 0),
    desired_state TEXT NOT NULL CHECK (desired_state IN ('enabled', 'disabled', 'archived')),
    observed_revision INTEGER NOT NULL CHECK (observed_revision >= 0 AND observed_revision <= desired_revision),
    observed_state TEXT NOT NULL CHECK (observed_state IN ('unknown', 'active', 'disabled', 'archived')),
    phase TEXT NOT NULL CHECK (phase IN ('provisioning', 'active', 'disabled', 'failed', 'archived')),
    operation_id TEXT NOT NULL,
    target_json TEXT NOT NULL CHECK (json_valid(target_json)),
    failure_code TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, id),
    UNIQUE (namespace, project_id, service_id),
    UNIQUE (namespace, id, service_id),
    FOREIGN KEY (namespace, org_id, project_id, billing_account_id)
      REFERENCES project_billing_bindings(namespace, org_id, project_id, billing_account_id),
    CHECK ((observed_state = 'unknown' AND observed_revision = 0)
      OR (observed_state <> 'unknown' AND observed_revision > 0)),
    CHECK ((phase = 'failed' AND failure_code IS NOT NULL)
      OR (phase <> 'failed' AND failure_code IS NULL)),
    CHECK (phase <> 'active' OR (desired_state = 'enabled' AND observed_state = 'active'
      AND observed_revision = desired_revision)),
    CHECK (phase <> 'archived' OR (desired_state = 'archived' AND observed_state = 'archived'
      AND observed_revision = desired_revision))
  )`,
  `CREATE TABLE IF NOT EXISTS wallet_service_bindings (
    namespace TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    service_id TEXT NOT NULL DEFAULT 'wallet' CHECK (service_id = 'wallet'),
    deployment_id TEXT NOT NULL,
    native_namespace TEXT NOT NULL,
    native_org_id TEXT NOT NULL,
    native_project_id TEXT NOT NULL,
    binding_json TEXT NOT NULL CHECK (json_valid(binding_json)),
    PRIMARY KEY (namespace, instance_id),
    UNIQUE (deployment_id, native_namespace, native_org_id, native_project_id),
    FOREIGN KEY (namespace, instance_id, service_id)
      REFERENCES platform_service_instances(namespace, id, service_id)
  )`,
  `CREATE TABLE IF NOT EXISTS satyr_service_bindings (
    namespace TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    service_id TEXT NOT NULL DEFAULT 'satyr' CHECK (service_id = 'satyr'),
    deployment_id TEXT NOT NULL,
    native_org_id TEXT NOT NULL,
    binding_json TEXT NOT NULL CHECK (json_valid(binding_json)),
    PRIMARY KEY (namespace, instance_id),
    UNIQUE (deployment_id, native_org_id),
    FOREIGN KEY (namespace, instance_id, service_id)
      REFERENCES platform_service_instances(namespace, id, service_id)
  )`,
  `CREATE TABLE IF NOT EXISTS platform_provision_operations (
    namespace TEXT NOT NULL,
    id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    billing_account_id TEXT NOT NULL,
    service_id TEXT NOT NULL CHECK (service_id IN ('wallet', 'satyr')),
    deployment_id TEXT NOT NULL,
    desired_revision INTEGER NOT NULL CHECK (desired_revision > 0),
    command TEXT NOT NULL CHECK (command IN ('enable', 'disable', 'archive')),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    payload_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'failed')),
    actor_user_id TEXT NOT NULL,
    authority_revision INTEGER NOT NULL CHECK (authority_revision >= 0),
    next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
    failure_code TEXT,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, id),
    UNIQUE (namespace, instance_id, desired_revision),
    FOREIGN KEY (namespace, instance_id) REFERENCES platform_service_instances(namespace, id)
      DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (namespace, org_id, project_id, billing_account_id)
      REFERENCES project_billing_bindings(namespace, org_id, project_id, billing_account_id),
    CHECK ((status = 'failed' AND failure_code IS NOT NULL)
      OR (status <> 'failed' AND failure_code IS NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS platform_provision_pending ON platform_provision_operations
    (namespace, service_id, deployment_id, next_attempt_at_ms, created_at_ms, id) WHERE status = 'pending'`,
  `CREATE TABLE IF NOT EXISTS platform_provision_receipts (
    namespace TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    result TEXT NOT NULL CHECK (result IN ('active', 'disabled', 'archived')),
    disposition TEXT NOT NULL CHECK (disposition IN ('applied', 'stale')),
    received_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace, operation_id),
    FOREIGN KEY (namespace, operation_id) REFERENCES platform_provision_operations(namespace, id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS platform_provision_scope_guard
  BEFORE INSERT ON platform_provision_operations
  BEGIN
    SELECT RAISE(ABORT, 'platform_scope_forbidden') WHERE NOT EXISTS (
      SELECT 1 FROM organizations o
      JOIN organization_memberships m ON m.namespace = o.namespace AND m.org_id = o.id
      JOIN projects p ON p.namespace = o.namespace AND p.org_id = o.id
      WHERE o.namespace = NEW.namespace AND o.id = NEW.org_id AND o.status = 'ACTIVE'
        AND o.authorization_version = NEW.authority_revision AND p.id = NEW.project_id
        AND p.status = 'ACTIVE' AND m.user_id = NEW.actor_user_id AND m.kind = 'ACTIVE'
        AND (m.role = 'OWNER' OR (m.role = 'ADMIN' AND EXISTS (
          SELECT 1 FROM organization_admin_permissions a
          WHERE a.namespace = m.namespace AND a.org_id = m.org_id
            AND a.membership_id = m.id AND a.permission = 'projects.manage'
        )))
    );
    SELECT RAISE(ABORT, 'platform_scope_forbidden') WHERE EXISTS (
      SELECT 1 FROM platform_service_instances i WHERE i.namespace = NEW.namespace AND i.id = NEW.instance_id
      AND (i.org_id <> NEW.org_id OR i.project_id <> NEW.project_id
        OR i.billing_account_id <> NEW.billing_account_id OR i.service_id <> NEW.service_id
        OR i.deployment_id <> NEW.deployment_id)
    );
    SELECT RAISE(ABORT, 'platform_instance_archived') WHERE EXISTS (
      SELECT 1 FROM platform_service_instances i
      WHERE i.namespace = NEW.namespace AND i.id = NEW.instance_id AND i.phase = 'archived'
    );
    SELECT RAISE(ABORT, 'platform_binding_conflict') WHERE EXISTS (
      SELECT 1 FROM platform_service_instances i
      WHERE i.namespace = NEW.namespace AND i.id = NEW.instance_id
      AND json_extract(NEW.payload_json, '$.binding') <> i.target_json
      AND NOT EXISTS (SELECT 1 FROM wallet_service_bindings b
        WHERE b.namespace = i.namespace AND b.instance_id = i.id
        AND b.binding_json = json_extract(NEW.payload_json, '$.binding'))
      AND NOT EXISTS (SELECT 1 FROM satyr_service_bindings b
        WHERE b.namespace = i.namespace AND b.instance_id = i.id
        AND b.binding_json = json_extract(NEW.payload_json, '$.binding'))
    );
    SELECT RAISE(ABORT, 'platform_transition_conflict') WHERE NOT (
      COALESCE((NEW.command = 'enable' AND NEW.desired_revision = 1
        AND json_extract(NEW.payload_json, '$.binding.kind') IN ('create_native_scope', 'attach_existing_scope')
        AND NOT EXISTS (SELECT 1 FROM platform_service_instances
          WHERE namespace = NEW.namespace AND id = NEW.instance_id)), 0)
      OR EXISTS (
        SELECT 1 FROM platform_service_instances i
        JOIN platform_provision_operations previous
          ON previous.namespace = i.namespace AND previous.id = i.operation_id
        WHERE i.namespace = NEW.namespace AND i.id = NEW.instance_id
        AND NEW.desired_revision = i.desired_revision + 1
        AND (
          (i.phase = 'failed' AND NEW.command = previous.command)
          OR (NEW.command = 'enable' AND i.phase = 'disabled' AND i.desired_state = 'disabled')
          OR (NEW.command = 'enable' AND NEW.service_id = 'wallet' AND i.phase = 'active')
          OR (NEW.command = 'disable' AND i.phase IN ('provisioning', 'active'))
          OR (NEW.command = 'archive' AND i.phase = 'disabled' AND i.desired_state = 'disabled'
            AND i.observed_state = 'disabled' AND i.observed_revision = i.desired_revision)
        )
      )
    );
  END`,
  `CREATE TRIGGER IF NOT EXISTS platform_provision_requested
  AFTER INSERT ON platform_provision_operations
  BEGIN
    INSERT INTO platform_service_instances
      (namespace, id, org_id, project_id, billing_account_id, service_id, deployment_id,
       desired_revision, desired_state, observed_revision, observed_state, phase,
       operation_id, target_json, failure_code, created_at_ms, updated_at_ms)
    VALUES (NEW.namespace, NEW.instance_id, NEW.org_id, NEW.project_id, NEW.billing_account_id,
      NEW.service_id, NEW.deployment_id, NEW.desired_revision,
      CASE NEW.command WHEN 'enable' THEN 'enabled' WHEN 'disable' THEN 'disabled' ELSE 'archived' END,
      0, 'unknown', CASE NEW.command WHEN 'enable' THEN 'provisioning' ELSE 'disabled' END,
      NEW.id, json_extract(NEW.payload_json, '$.binding'), NULL, NEW.created_at_ms, NEW.created_at_ms)
    ON CONFLICT(namespace, id) DO UPDATE SET
      desired_revision = NEW.desired_revision,
      desired_state = excluded.desired_state,
      phase = excluded.phase,
      operation_id = NEW.id,
      failure_code = NULL,
      updated_at_ms = NEW.created_at_ms;
  END`,
  `CREATE TRIGGER IF NOT EXISTS platform_provision_receipt_guard
  BEFORE INSERT ON platform_provision_receipts
  BEGIN
    SELECT RAISE(ABORT, 'platform_receipt_conflict') WHERE NOT EXISTS (
      SELECT 1 FROM platform_provision_operations o
      WHERE o.namespace = NEW.namespace AND o.id = NEW.operation_id
      AND o.instance_id = json_extract(NEW.payload_json, '$.instanceId')
      AND o.desired_revision = json_extract(NEW.payload_json, '$.desiredRevision')
      AND NEW.disposition = CASE WHEN o.desired_revision = (
        SELECT desired_revision FROM platform_service_instances
        WHERE namespace = o.namespace AND id = o.instance_id
      ) THEN 'applied' ELSE 'stale' END
      AND NEW.result = CASE o.command WHEN 'enable' THEN 'active' WHEN 'disable' THEN 'disabled' ELSE 'archived' END
      AND (
        EXISTS (SELECT 1 FROM wallet_service_bindings b
          WHERE b.namespace = o.namespace AND b.instance_id = o.instance_id
          AND b.binding_json = json_extract(NEW.payload_json, '$.binding'))
        OR EXISTS (SELECT 1 FROM satyr_service_bindings b
          WHERE b.namespace = o.namespace AND b.instance_id = o.instance_id
          AND b.binding_json = json_extract(NEW.payload_json, '$.binding'))
      )
    );
  END`,
  `CREATE TRIGGER IF NOT EXISTS platform_provision_acknowledged
  AFTER INSERT ON platform_provision_receipts
  BEGIN
    UPDATE platform_provision_operations SET status = 'applied', failure_code = NULL
      WHERE namespace = NEW.namespace AND id = NEW.operation_id;
    UPDATE platform_service_instances SET
      observed_revision = json_extract(NEW.payload_json, '$.desiredRevision'),
      observed_state = NEW.result,
      phase = CASE WHEN desired_revision = json_extract(NEW.payload_json, '$.desiredRevision')
        THEN NEW.result ELSE phase END,
      failure_code = CASE WHEN desired_revision = json_extract(NEW.payload_json, '$.desiredRevision')
        THEN NULL ELSE failure_code END,
      updated_at_ms = NEW.received_at_ms
    WHERE namespace = NEW.namespace AND id = json_extract(NEW.payload_json, '$.instanceId')
      AND observed_revision < json_extract(NEW.payload_json, '$.desiredRevision');
  END`,
  `CREATE TRIGGER IF NOT EXISTS platform_provision_failed
  AFTER UPDATE OF status ON platform_provision_operations
  WHEN NEW.status = 'failed'
  BEGIN
    UPDATE platform_service_instances SET phase = 'failed', failure_code = NEW.failure_code
    WHERE namespace = NEW.namespace AND id = NEW.instance_id AND operation_id = NEW.id;
  END`,
] as const);

export async function ensureAccountPlatformD1Schema(database: D1DatabaseLike): Promise<void> {
  for (const statement of ACCOUNT_PLATFORM_D1_SCHEMA_SQL) {
    await database.exec(formatD1ExecStatement(statement));
  }
}
