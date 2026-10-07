CREATE TABLE wallet_router_activations (
  namespace TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  move_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json) AND json_type(receipt_json) = 'object'),
  PRIMARY KEY (namespace, organization_id, project_id, environment_id, wallet_id, move_id),
  FOREIGN KEY (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
    REFERENCES wallet_relocations (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
);
CREATE TRIGGER wallet_router_activations_immutable
BEFORE UPDATE ON wallet_router_activations
BEGIN SELECT RAISE(ABORT, 'router_activation_immutable'); END;
CREATE TRIGGER wallet_router_activations_retained
BEFORE DELETE ON wallet_router_activations
BEGIN SELECT RAISE(ABORT, 'router_activation_retained'); END;
