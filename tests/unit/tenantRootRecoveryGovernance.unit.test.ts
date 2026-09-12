import { expect, test } from '@playwright/test';
import {
  canonicalTenantRootRecoveryGovernanceJsonV1,
  tenantRootGovernanceTransitionRequiresSecondOwnerV1,
  tenantRootRecipientPairDigestB64uV1,
  tenantRootRecoveryGovernanceDigestB64uV1,
  TENANT_ROOT_GOVERNANCE_NOT_CONFIGURED_CANONICAL_V1,
  type TenantRootRecoveryGovernanceV1,
} from '../../packages/shared-ts/src/tenant-root';

/**
 * The governance digest feeds the operation record, so it must match what the
 * Rust control plane computes for the same policy. The two-person vector below
 * is the one `crates/router-ab-core/tests/tenant_root_operation_fixtures.rs`
 * bakes into the committed operation records.
 */
const TWO_PERSON: TenantRootRecoveryGovernanceV1 = {
  kind: 'two_person_v1',
  selectedByOwnerId: 'owner-1',
  selectedAt: '2026-08-01T00:00:00.000Z',
};

const SINGLE_OWNER: TenantRootRecoveryGovernanceV1 = {
  kind: 'single_owner_v1',
  acknowledgedByOwnerId: 'owner-1',
  acknowledgedAt: '2026-08-01T00:00:00.000Z',
  warningVersion: 'tenant_root_single_owner_v1',
};

test('the governance digest matches the Rust operation fixture', async () => {
  expect(canonicalTenantRootRecoveryGovernanceJsonV1(TWO_PERSON)).toBe(
    '{"kind":"two_person_v1","selectedAt":"2026-08-01T00:00:00.000Z","selectedByOwnerId":"owner-1"}',
  );
  expect(await tenantRootRecoveryGovernanceDigestB64uV1(TWO_PERSON)).toBe(
    'hUXBekkP6CYYQtt4VJAzSMt0jTshXPte-Te5Q0uBKpc',
  );
  // Single-owner keys sort the same way the Rust encoder emits them.
  expect(canonicalTenantRootRecoveryGovernanceJsonV1(SINGLE_OWNER)).toBe(
    '{"acknowledgedAt":"2026-08-01T00:00:00.000Z","acknowledgedByOwnerId":"owner-1","kind":"single_owner_v1","warningVersion":"tenant_root_single_owner_v1"}',
  );
  // No policy yet is its own fixed value, distinct from every real policy.
  expect(canonicalTenantRootRecoveryGovernanceJsonV1(null)).toBe(
    TENANT_ROOT_GOVERNANCE_NOT_CONFIGURED_CANONICAL_V1,
  );
  expect(await tenantRootRecoveryGovernanceDigestB64uV1(null)).not.toBe(
    await tenantRootRecoveryGovernanceDigestB64uV1(SINGLE_OWNER),
  );
});

test('a recipient-pair digest binds both fingerprints in role order', async () => {
  const pair = {
    deriverAFingerprintB64u: 'GSYMSrbHNIS_I8s_-HNmSiE1IUPWtFBiAWyacCVe8uY',
    deriverBFingerprintB64u: 'nF1YOuRpN5POO1FZDHiGUboN9MIzmyW4RnZmX85Eqos',
  };
  const digest = await tenantRootRecipientPairDigestB64uV1(pair);
  expect(digest).toHaveLength(43);
  // Swapping the roles is a different pair.
  expect(
    await tenantRootRecipientPairDigestB64uV1({
      deriverAFingerprintB64u: pair.deriverBFingerprintB64u,
      deriverBFingerprintB64u: pair.deriverAFingerprintB64u,
    }),
  ).not.toBe(digest);
  // A fingerprint that is not a 32-byte digest is refused, not hashed.
  await expect(
    tenantRootRecipientPairDigestB64uV1({ ...pair, deriverBFingerprintB64u: 'short' }),
  ).rejects.toThrow();
});

test('a governance transition takes the stronger of its two quorums', () => {
  expect(tenantRootGovernanceTransitionRequiresSecondOwnerV1(null, SINGLE_OWNER)).toBe(false);
  expect(tenantRootGovernanceTransitionRequiresSecondOwnerV1(null, TWO_PERSON)).toBe(true);
  expect(tenantRootGovernanceTransitionRequiresSecondOwnerV1(SINGLE_OWNER, TWO_PERSON)).toBe(true);
  expect(tenantRootGovernanceTransitionRequiresSecondOwnerV1(TWO_PERSON, SINGLE_OWNER)).toBe(true);
  expect(tenantRootGovernanceTransitionRequiresSecondOwnerV1(TWO_PERSON, TWO_PERSON)).toBe(true);
});
