-- A funded Wallet project can refresh live access through its existing service command.
DROP TRIGGER IF EXISTS platform_provision_scope_guard;

CREATE TRIGGER IF NOT EXISTS platform_provision_scope_guard
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
  END;
