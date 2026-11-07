-- Satyr Jev customer price (Plan 88 D9, approved by the owner on 7 November 2026):
-- the terms of satyr-jev-input-tokens-v1 for customer accounts. Price versions are immutable.
-- $0.084 per million input tokens, after 23,809,523 tokens each UTC month.
INSERT INTO billing_price_definitions (meter_id, version, kind, currency, unit_minor, time_rule, availability, block_units, included_units)
    VALUES ('satyr.jev_input_tokens', 'satyr-jev-input-tokens-customer-v1', 'block_measured', 'USD', 84, 'hour_start_utc_month', 'customer_accounts', 10000000, 23809523);
