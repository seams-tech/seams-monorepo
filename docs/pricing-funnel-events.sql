-- Bind ?1 to the Console namespace. This report uses durable facts and audit IDs.
-- It contains no email, IP address, wallet ID, or contact form text.
WITH attribution AS (
  SELECT org_id, json_extract(metadata_json, '$.plan') AS plan,
    json_extract(metadata_json, '$.intentId') AS intent_id,
    json_extract(metadata_json, '$.src') AS source, MIN(created_at_ms) AS ready_at_ms
  FROM audit_events WHERE namespace = ?1 AND action = 'plan_ready'
  GROUP BY org_id
), onboarding_events AS (
  SELECT id AS event_id, action AS event, NULLIF(org_id, 'console-funnel') AS org_id,
    NULLIF(actor_user_id, 'anonymous') AS account_id, created_at_ms AS occurred_at_ms,
    json_extract(metadata_json, '$.plan') AS plan,
    json_extract(metadata_json, '$.src') AS source,
    json_object('provider', json_extract(metadata_json, '$.provider'),
      'intentId', json_extract(metadata_json, '$.intentId')) AS properties
  FROM audit_events WHERE namespace = ?1 AND action IN (
    'console_login_view', 'console_identity_created', 'console_signin_existing',
    'growth_continue_free', 'card_setup_canceled')
  UNION ALL
  SELECT 'org:' || o.id, 'onboarding_org_created', o.id, o.created_by_user_id,
    o.created_at_ms, a.plan, a.source,
    json_object('automatic', COALESCE((SELECT json_extract(e.metadata_json, '$.automatic')
      FROM audit_events e WHERE e.namespace = ?1 AND e.org_id = o.id AND e.action = 'organization.create'
      ORDER BY e.created_at_ms LIMIT 1), 0))
  FROM organizations o JOIN attribution a ON a.org_id = o.id WHERE o.namespace = ?1
  UNION ALL
  SELECT 'project:' || p.id, 'onboarding_project_created', p.org_id, NULL,
    p.created_at_ms, a.plan, a.source, json_object('automatic', p.id = a.intent_id)
  FROM projects p JOIN attribution a ON a.org_id = p.org_id
  WHERE p.namespace = ?1 AND p.id = (SELECT first.id FROM projects first
    WHERE first.namespace = p.namespace AND first.org_id = p.org_id ORDER BY first.created_at_ms, first.id LIMIT 1)
), billing_events AS (
  SELECT 'setup:' || s.id AS event_id, 'card_setup_started' AS event, s.org_id, s.actor_user_id AS account_id,
    s.created_at_ms AS occurred_at_ms, a.plan, a.source, json_object('purpose', COALESCE(s.start_plan, 'free_card')) AS properties
  FROM billing_card_setup_sessions s LEFT JOIN attribution a ON a.org_id = s.org_id WHERE s.namespace = ?1
  UNION ALL
  SELECT 'verified:' || s.id, 'card_verified', s.org_id, s.actor_user_id,
    s.updated_at_ms, a.plan, a.source, json_object('purpose', COALESCE(s.start_plan, 'free_card'))
  FROM billing_card_setup_sessions s LEFT JOIN attribution a ON a.org_id = s.org_id
  WHERE s.namespace = ?1 AND s.status = 'verified'
  UNION ALL
  SELECT 'start:' || b.org_id || ':' || b.plan, b.plan || '_start', b.org_id, NULL,
    MIN(b.period_start_ms), b.plan, a.source, json_object('entry', CASE WHEN EXISTS (
      SELECT 1 FROM billing_card_setup_sessions s WHERE s.namespace = b.namespace AND s.org_id = b.org_id
        AND s.start_plan = b.plan AND s.status = 'verified') THEN 'card_setup' ELSE 'card_on_file_or_limit' END)
  FROM billing_plan_base_charges b LEFT JOIN attribution a ON a.org_id = b.org_id
  WHERE b.namespace = ?1 GROUP BY b.org_id, b.plan
), activation_events AS (
  SELECT 'activation:' || f.org_id AS event_id, 'first_production_registration' AS event, f.org_id, NULL AS account_id,
    MIN(f.recorded_at_ms) AS occurred_at_ms, a.plan, a.source, '{}' AS properties
  FROM billing_plan_usage_facts f LEFT JOIN attribution a ON a.org_id = f.org_id
  WHERE f.namespace = ?1 AND f.kind = 'active_user' GROUP BY f.org_id
  UNION ALL
  SELECT 'move:' || n.org_id || ':' || n.notice_key, 'growth_move', n.org_id, NULL,
    n.created_at_ms, 'growth', a.source, n.payload_json
  FROM billing_plan_notices n LEFT JOIN attribution a ON a.org_id = n.org_id
  WHERE n.namespace = ?1 AND n.notice_kind = 'growth_move'
  UNION ALL
  SELECT e.id, 'organization_renamed', e.org_id, e.actor_user_id, e.created_at_ms,
    a.plan, a.source, json_object('was_default', json_extract(e.metadata_json, '$.was_default'))
  FROM audit_events e LEFT JOIN attribution a ON a.org_id = e.org_id
  WHERE e.namespace = ?1 AND e.action = 'organization.update' AND json_extract(e.metadata_json, '$.name_changed') = 1
)
SELECT * FROM onboarding_events
UNION ALL SELECT * FROM billing_events
UNION ALL SELECT * FROM activation_events
ORDER BY occurred_at_ms, event_id;
