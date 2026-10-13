-- The final owner remains required while the organization exists.
-- Deleting an empty organization removes its membership through the existing cascade.
DROP TRIGGER organization_memberships_last_owner_delete;
CREATE TRIGGER organization_memberships_last_owner_delete
BEFORE DELETE ON organization_memberships
WHEN OLD.kind = 'ACTIVE'
 AND OLD.role = 'OWNER'
 AND EXISTS (
   SELECT 1 FROM organizations
   WHERE namespace = OLD.namespace AND id = OLD.org_id
 )
 AND (
   SELECT COUNT(*) FROM organization_memberships
   WHERE namespace = OLD.namespace AND org_id = OLD.org_id
     AND kind = 'ACTIVE' AND role = 'OWNER'
 ) <= 1
BEGIN
  SELECT RAISE(ABORT, 'last_owner_required');
END;

CREATE TRIGGER organizations_delete_retained_members
BEFORE DELETE ON organizations
WHEN (
  SELECT COUNT(*) FROM organization_memberships
  WHERE namespace = OLD.namespace AND org_id = OLD.id AND kind <> 'REMOVED'
) > 1
BEGIN
  SELECT RAISE(ABORT, 'organization_delete_has_other_members');
END;

CREATE TRIGGER organizations_delete_retained_billing
BEFORE DELETE ON organizations
WHEN EXISTS (SELECT 1 FROM billing_ledger_entries WHERE namespace = OLD.namespace AND org_id = OLD.id)
 OR EXISTS (SELECT 1 FROM billing_credit_purchases WHERE namespace = OLD.namespace AND org_id = OLD.id)
 OR EXISTS (SELECT 1 FROM billing_refunds WHERE namespace = OLD.namespace AND org_id = OLD.id)
 OR EXISTS (SELECT 1 FROM billing_disputes WHERE namespace = OLD.namespace AND org_id = OLD.id)
 OR EXISTS (SELECT 1 FROM invoices WHERE namespace = OLD.namespace AND org_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'organization_delete_has_billing_history');
END;
