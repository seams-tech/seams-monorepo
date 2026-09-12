import { expect, test } from '@playwright/test';
import type { TenantRootSourceCustodyDispositionV1 } from '../../packages/shared-ts/src/tenant-root';
import { checkTenantRootAuditEventRedactionV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/audit';
import { defaultSourceCustodyDispositionV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreService';
import {
  retireSourceLineageV1,
  sourceCustodyClaimV1,
  tenantRootRetirementGapsV1,
  type TenantRootSourceRetirementEvidenceV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/sourceRetirement';

/**
 * The retained-source and verified-retirement drills.
 *
 * These exist to keep two claims apart. A retained source is still a custodian
 * of the root; a verified retirement says one named lineage can no longer
 * derive it. Nothing in between may borrow the stronger wording.
 */

const AT_ISO = '2026-09-05T12:00:00.000Z';
const ACTOR = 'owner-1';
const ACTIVATION_RECEIPT = 'destination-activation-receipt';

const COMPLETE_EVIDENCE: TenantRootSourceRetirementEvidenceV1 = {
  destructionReceipts: { deriverA: 'destroy-a', deriverB: 'destroy-b' },
  decryptProbeReceipts: { deriverA: 'probe-a', deriverB: 'probe-b' },
  credentialRevocationReceipt: 'revoke-1',
  endpointCanaryReceipt: 'canary-1',
};

function retire(
  overrides: {
    evidence?: TenantRootSourceRetirementEvidenceV1;
    destinationActivationReceiptDigestB64u?: string | null;
    expectedActivationReceiptDigestB64u?: string | null;
  } = {},
) {
  return retireSourceLineageV1({
    orgId: 'org-1',
    identityDigestB64u: 'identity-digest',
    custodyLineageB64u: 'source-lineage',
    lifecycleRevision: 7,
    destinationActivationReceiptDigestB64u:
      overrides.destinationActivationReceiptDigestB64u === undefined
        ? ACTIVATION_RECEIPT
        : overrides.destinationActivationReceiptDigestB64u,
    expectedActivationReceiptDigestB64u:
      overrides.expectedActivationReceiptDigestB64u === undefined
        ? ACTIVATION_RECEIPT
        : overrides.expectedActivationReceiptDigestB64u,
    evidence: overrides.evidence ?? COMPLETE_EVIDENCE,
    actorUserId: ACTOR,
    atIso: AT_ISO,
  });
}

test('the retained-source drill leaves the source a custodian and says so', () => {
  // This is what a restore records by default: nothing was done to the source.
  const retained: TenantRootSourceCustodyDispositionV1 = defaultSourceCustodyDispositionV1({
    acknowledgedByUserId: ACTOR,
    recordedAtIso: AT_ISO,
  });
  expect(retained.kind).toBe('retained_as_backup');

  const claim = sourceCustodyClaimV1(retained);
  expect(claim).toContain('may still hold usable shares');
  expect(claim).toContain('remains a valid custodian');
  // The retained claim never borrows retirement wording.
  expect(claim).not.toContain('can no longer derive');
  expect(claim).not.toContain('destruction');
});

test('the verified-retirement drill needs every receipt the source can produce', () => {
  const gapCases: {
    readonly label: string;
    readonly evidence: TenantRootSourceRetirementEvidenceV1;
    readonly missing: string;
  }[] = [
    {
      label: 'no Deriver A destruction',
      evidence: {
        ...COMPLETE_EVIDENCE,
        destructionReceipts: { deriverA: null, deriverB: 'destroy-b' },
      },
      missing: 'deriver_a_destruction',
    },
    {
      label: 'no Deriver B decrypt probe',
      evidence: {
        ...COMPLETE_EVIDENCE,
        decryptProbeReceipts: { deriverA: 'probe-a', deriverB: null },
      },
      missing: 'deriver_b_decrypt_probe',
    },
    {
      label: 'no credential revocation',
      evidence: { ...COMPLETE_EVIDENCE, credentialRevocationReceipt: null },
      missing: 'credential_revocation',
    },
    {
      label: 'no endpoint canary',
      evidence: { ...COMPLETE_EVIDENCE, endpointCanaryReceipt: null },
      missing: 'endpoint_canary',
    },
  ];

  for (const gapCase of gapCases) {
    const outcome = retire({ evidence: gapCase.evidence });
    expect(outcome.ok, gapCase.label).toBe(true);
    if (!outcome.ok) continue;
    // Missing evidence downgrades the branch rather than the wording.
    expect(outcome.disposition.kind, gapCase.label).toBe('unavailable_retirement_unverified');
    expect(outcome.gaps, gapCase.label).toContain(gapCase.missing);
    if (outcome.disposition.kind === 'unavailable_retirement_unverified') {
      // The weaker branch still names what was tried.
      expect(outcome.disposition.attemptedChecks.length).toBeGreaterThan(0);
    }
    expect(sourceCustodyClaimV1(outcome.disposition)).toContain('could not be verified');
    expect(sourceCustodyClaimV1(outcome.disposition)).not.toContain('can no longer derive');
  }

  const verified = retire();
  expect(verified.ok).toBe(true);
  if (verified.ok) {
    expect(verified.gaps).toEqual([]);
    expect(verified.disposition.kind).toBe('verified_retired');
    const claim = sourceCustodyClaimV1(verified.disposition);
    expect(claim).toContain('can no longer derive this root');
    // Even the strong claim is scoped to the named lineage.
    expect(claim).toContain('that named lineage');
    expect(claim).toContain('Other copies of your recovery files');
  }
});

test('retirement is unavailable until a destination has activated', () => {
  const tooEarly = retire({
    destinationActivationReceiptDigestB64u: null,
    expectedActivationReceiptDigestB64u: null,
  });
  expect(tooEarly).toMatchObject({ ok: false, error: { kind: 'destination_not_activated' } });

  const mismatched = retire({
    expectedActivationReceiptDigestB64u: 'a-different-activation',
  });
  expect(mismatched).toMatchObject({
    ok: false,
    error: { kind: 'activation_receipt_mismatch' },
  });
});

test('every retirement outcome writes one redacted audit event', () => {
  for (const outcome of [
    retire(),
    retire({ evidence: { ...COMPLETE_EVIDENCE, endpointCanaryReceipt: null } }),
    retire({ destinationActivationReceiptDigestB64u: null }),
  ]) {
    expect(checkTenantRootAuditEventRedactionV1(outcome.audit)).toEqual({ ok: true });
    expect(outcome.audit.action).toBe('source_custody_disposition_recorded');
  }
});

test('the three dispositions make three different claims', () => {
  const claims = new Set(
    [
      defaultSourceCustodyDispositionV1({
        acknowledgedByUserId: ACTOR,
        recordedAtIso: AT_ISO,
      }),
      {
        kind: 'unavailable_retirement_unverified' as const,
        attemptedChecks: ['endpoint_canary'],
        recordedByUserId: ACTOR,
        recordedAt: AT_ISO,
      },
      {
        kind: 'verified_retired' as const,
        destructionReceipts: { deriverA: 'destroy-a', deriverB: 'destroy-b' },
        decryptProbeReceipts: { deriverA: 'probe-a', deriverB: 'probe-b' },
        credentialRevocationReceiptDigestB64u: 'revoke-1',
        endpointCanaryReceiptDigestB64u: 'canary-1',
        recordedByUserId: ACTOR,
        recordedAt: AT_ISO,
      },
    ].map((disposition) => sourceCustodyClaimV1(disposition)),
  );
  expect(claims.size).toBe(3);

  expect(tenantRootRetirementGapsV1(COMPLETE_EVIDENCE)).toEqual([]);
  expect(
    tenantRootRetirementGapsV1({
      destructionReceipts: { deriverA: null, deriverB: null },
      decryptProbeReceipts: { deriverA: null, deriverB: null },
      credentialRevocationReceipt: null,
      endpointCanaryReceipt: null,
    }),
  ).toHaveLength(6);
});
