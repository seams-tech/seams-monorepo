-- Initial owner access is removable only after an unused Wallet service is unbound.
-- Revocation history, invitation grants, native principals, usage, and money remain retained.
DROP TRIGGER platform_instance_access_retained;
CREATE TRIGGER platform_instance_access_retained
BEFORE DELETE ON platform_instance_access
WHEN OLD.access <> 'allowed' OR OLD.access_revision <> 1 OR OLD.source_invitation_id IS NOT NULL
 OR NOT EXISTS (
   SELECT 1 FROM platform_service_instances i
   WHERE i.namespace = OLD.namespace AND i.id = OLD.instance_id AND i.service_id = 'wallet'
     AND NOT EXISTS (SELECT 1 FROM wallet_service_bindings b
       WHERE b.namespace = i.namespace AND b.instance_id = i.id)
     AND NOT EXISTS (SELECT 1 FROM platform_provision_operations o
       WHERE o.namespace = i.namespace AND o.instance_id = i.id)
     AND NOT EXISTS (SELECT 1 FROM platform_service_principals p
       WHERE p.namespace = i.namespace AND p.instance_id = i.id)
     AND NOT EXISTS (SELECT 1 FROM billing_funds_reservations r
       WHERE r.namespace = i.namespace AND r.instance_id = i.id)
     AND NOT EXISTS (SELECT 1 FROM billing_usage_receipts u
       WHERE u.namespace = i.namespace AND u.instance_id = i.id)
 )
BEGIN
  SELECT RAISE(ABORT, 'platform_access_retained');
END;
