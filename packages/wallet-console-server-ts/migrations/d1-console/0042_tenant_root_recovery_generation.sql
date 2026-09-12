CREATE TABLE tenant_root_security_recovery_generation (
  namespace TEXT NOT NULL,
  org_id TEXT NOT NULL,
  identity_digest_b64u TEXT NOT NULL,
  custody_lineage_b64u TEXT NOT NULL,
  recovery_set_id TEXT NOT NULL,
  step TEXT NOT NULL CHECK (step IN (
    'commands', 'prepare_a', 'prepare_b', 'contribute_a', 'contribute_b',
    'derive_a', 'derive_b', 'prove_a', 'prove_b', 'package_a', 'package_b',
    'manifest', 'closed'
  )),
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 43),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  PRIMARY KEY (namespace, org_id, identity_digest_b64u, custody_lineage_b64u, recovery_set_id, step)
);
