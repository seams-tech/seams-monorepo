-- Read only. Run against the D1 ID from the deployed Console Worker version.
SELECT namespace, id, status, authorization_version, owner_set_version
FROM organizations ORDER BY namespace, id;

SELECT namespace, id, org_id, status
FROM projects ORDER BY namespace, org_id, id;

SELECT namespace, org_id, project_id, id, env_key, runtime_version, status
FROM environments ORDER BY namespace, org_id, project_id, id;

SELECT namespace, org_id, role, kind, COUNT(*) AS membership_count
FROM organization_memberships GROUP BY namespace, org_id, role, kind;

SELECT namespace, org_id, id, user_id, role, kind
FROM organization_memberships ORDER BY namespace, org_id, id;

SELECT namespace, user_id FROM user_profiles ORDER BY namespace, user_id;

SELECT namespace, COUNT(*) AS profile_count
FROM user_profiles GROUP BY namespace;

SELECT namespace, org_id, entry_type, COUNT(*) AS entry_count, SUM(amount_minor) AS amount_minor
FROM billing_ledger_entries GROUP BY namespace, org_id, entry_type;

SELECT namespace, org_id, account_code, SUM(amount_minor) AS amount_minor
FROM billing_ledger_postings GROUP BY namespace, org_id, account_code;

SELECT namespace, org_id, status, COUNT(*) AS reservation_count,
  SUM(requested_minor) AS requested_minor, SUM(settled_minor) AS settled_minor,
  SUM(released_minor) AS released_minor
FROM billing_prepaid_reservations GROUP BY namespace, org_id, status;

SELECT namespace, org_id, COUNT(*) AS purchase_count
FROM billing_credit_purchases GROUP BY namespace, org_id;

SELECT namespace, org_id, id, provider, status, amount_minor, currency,
  provider_checkout_session_ref, provider_customer_ref, provider_payment_ref, related_invoice_id
FROM billing_credit_purchases ORDER BY namespace, org_id, id;

SELECT namespace, org_id, COUNT(*) AS refund_count
FROM billing_refunds GROUP BY namespace, org_id;

SELECT namespace, org_id, COUNT(*) AS dispute_count
FROM billing_disputes GROUP BY namespace, org_id;

SELECT namespace, org_id, document_type, COUNT(*) AS document_count
FROM invoices GROUP BY namespace, org_id, document_type;
