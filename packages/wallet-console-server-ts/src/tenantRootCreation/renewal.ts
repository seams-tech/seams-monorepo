import {
  base64UrlDecode,
  ROUTER_AB_MPC_ROUTER_ORIGIN,
  signTenantRootCreationGrantV1,
} from '@seams/wallet-server/cloud-host';
import type { TenantRootCreationConsoleRouteDependenciesV1 } from './consoleRoute';
import type { TenantRootCreationGrantRecordV1 } from './types';

type IssuedGrant = Extract<TenantRootCreationGrantRecordV1, { readonly status: 'ISSUED' }>;
type RenewalOutcome =
  | { readonly kind: 'started' }
  | { readonly kind: 'renewal_permitted'; readonly expiredThroughMs: number };

function parseOutcome(value: unknown, grant: IssuedGrant, nowMs: number): RenewalOutcome {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    throw new Error('Router returned an invalid authorization renewal outcome');
  }
  switch (value.kind) {
    case 'started':
      return { kind: 'started' };
    case 'renewal_permitted': {
      if (
        !('grant_digest_b64u' in value) ||
        value.grant_digest_b64u !== grant.grantDigestB64u ||
        !('expired_through_ms' in value) ||
        typeof value.expired_through_ms !== 'number' ||
        !Number.isSafeInteger(value.expired_through_ms) ||
        value.expired_through_ms < grant.expiresAtMs ||
        value.expired_through_ms > nowMs
      ) {
        throw new Error('Router authorization fence does not match the expired grant');
      }
      return { kind: 'renewal_permitted', expiredThroughMs: value.expired_through_ms };
    }
    default:
      throw new Error('Router returned an unknown authorization renewal outcome');
  }
}

export async function renewUnusedCreationGrant(
  dependencies: TenantRootCreationConsoleRouteDependenciesV1,
  grant: IssuedGrant,
): Promise<TenantRootCreationGrantRecordV1> {
  const now = dependencies.now ?? currentTime;
  if (now().getTime() < grant.expiresAtMs) return grant;
  const response = await dependencies.router.fetch(
    `${ROUTER_AB_MPC_ROUTER_ORIGIN}/router-ab/internal/tenant-root/creation/v1/renewal-fence`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-router-ab-internal-service-auth': dependencies.internalServiceAuthSecret,
      },
      body: JSON.stringify({ creation_grant_b64u: grant.grantB64u }),
    },
  );
  if (!response.ok)
    throw new Error(
      `Router authorization fence failed (HTTP ${response.status}): ${(await response.text()).trim()}`,
    );
  const nowMs = now().getTime();
  const outcome = parseOutcome(await response.json(), grant, nowMs);
  switch (outcome.kind) {
    case 'started':
      return grant;
    case 'renewal_permitted': {
      const issuedAtMs = Math.max(nowMs - 1, outcome.expiredThroughMs);
      const renewed = await signTenantRootCreationGrantV1({
        identity: grant.identity,
        custodyLineage: base64UrlDecode(grant.custodyLineageB64u),
        grantNonce: base64UrlDecode(grant.grantNonceB64u),
        issuedAtMs,
        expiresAtMs: issuedAtMs + 300_000,
        grantKeyId: dependencies.grantAuthorityKeyId,
        signingSeedB64u: dependencies.grantAuthoritySigningSeedB64u,
      });
      return dependencies.grants.renewUnusedGrant({
        previous: grant,
        expiredThroughMs: outcome.expiredThroughMs,
        renewed: {
          operationId: grant.operationId,
          identity: grant.identity,
          identityDigestB64u: renewed.identityDigestB64u,
          custodyLineageB64u: renewed.custodyLineageB64u,
          grantNonceB64u: renewed.grantNonceB64u,
          grantKeyId: renewed.grantKeyId,
          grantB64u: renewed.grantB64u,
          grantDigestB64u: renewed.grantDigestB64u,
          issuedAtMs: renewed.issuedAtMs,
          expiresAtMs: renewed.expiresAtMs,
        },
      });
    }
    default:
      return assertNever(outcome);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected authorization renewal outcome: ${JSON.stringify(value)}`);
}

function currentTime(): Date {
  return new Date();
}
