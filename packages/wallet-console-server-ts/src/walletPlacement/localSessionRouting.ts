import type { WalletOwnershipKey } from './home';
import type { SessionLocator } from './sessionLocators';

export type LocalGatewaySession =
  | { readonly kind: 'absent' }
  | { readonly kind: 'local'; readonly wallet: WalletOwnershipKey }
  | { readonly kind: 'missing'; readonly locator: SessionLocator };

// The enclosing query selects and validates the active deployment. Presence
// selects a local handler; the handler still authenticates the session.
// Retired credentials stay visible here so revocation cannot cause rediscovery.
export function localSessionWalletProjection(locator: SessionLocator | null): string {
  if (locator === null) return 'NULL';
  const predicate = `namespace = admission.namespace
    AND org_id = json_extract(admission.binding_json, '$.tenant.organizationId')
    AND project_id = json_extract(admission.binding_json, '$.tenant.projectId')
    AND env_id = json_extract(admission.binding_json, '$.tenant.environmentId')
    AND tenant_id = json_extract(admission.binding_json, '$.tenant.organizationId')`;
  switch (locator.kind) {
    case 'credential':
      return `(SELECT wallet_id FROM wallet_session_authorizations_v2
        WHERE ${predicate} AND operation_credential_hash = ?5
        UNION ALL SELECT wallet_id FROM wallet_session_hosted_credentials_v2
        WHERE ${predicate} AND credential_digest_b64u = ?5 LIMIT 1)`;
    case 'exchange':
      return `(SELECT wallet_id FROM wallet_session_hosted_exchange_codes_v2
        WHERE ${predicate} AND code_hash = ?5 LIMIT 1)`;
  }
}
