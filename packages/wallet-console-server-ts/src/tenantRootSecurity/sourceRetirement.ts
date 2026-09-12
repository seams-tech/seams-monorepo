import type { TenantRootSourceCustodyDispositionV1 } from '@seams-internal/wallet-console-shared/tenant-root';
import { buildTenantRootAuditEventV1, type TenantRootAuditEventV1 } from './audit';

/**
 * Retiring a source lineage after a destination has activated.
 *
 * This is deliberately a separate, explicit action rather than part of
 * activation. A destination cannot retire a source it does not control, and a
 * source that still holds usable shares remains a valid custodian of the same
 * root — so the strong claim is only available once the source itself has
 * produced every piece of evidence for it.
 *
 * Missing evidence does not weaken the claim silently: it selects the
 * unverified branch, which the product then displays as unverified.
 *
 * Who may retire a source is the operation layer's decision: retirement is a
 * governance-following operation, so under two-person governance the second
 * owner's approval is consumed before this module is reached.
 */

/** The evidence a source deployment must produce to be called retired. */
export type TenantRootSourceRetirementEvidenceV1 = {
  /** Destruction receipt from each source Deriver. */
  readonly destructionReceipts: {
    readonly deriverA: string | null;
    readonly deriverB: string | null;
  };
  /** Permanent decrypt-probe failure from each source Deriver's provider. */
  readonly decryptProbeReceipts: {
    readonly deriverA: string | null;
    readonly deriverB: string | null;
  };
  /** Receipt for revoking source lineage-scoped service credentials. */
  readonly credentialRevocationReceipt: string | null;
  /** Canary proving the old derivation endpoints reject the lineage. */
  readonly endpointCanaryReceipt: string | null;
};

/** Which piece of evidence is missing. */
export type TenantRootRetirementGapV1 =
  | 'deriver_a_destruction'
  | 'deriver_b_destruction'
  | 'deriver_a_decrypt_probe'
  | 'deriver_b_decrypt_probe'
  | 'credential_revocation'
  | 'endpoint_canary';

/** Why the strong claim was not available. */
export type TenantRootRetirementErrorV1 =
  | { readonly kind: 'destination_not_activated' }
  | { readonly kind: 'activation_receipt_mismatch' };

/** One retirement outcome and the event that records it. */
export type TenantRootRetirementOutcomeV1 =
  | {
      readonly ok: true;
      readonly disposition: TenantRootSourceCustodyDispositionV1;
      readonly gaps: readonly TenantRootRetirementGapV1[];
      readonly audit: TenantRootAuditEventV1;
    }
  | {
      readonly ok: false;
      readonly error: TenantRootRetirementErrorV1;
      readonly audit: TenantRootAuditEventV1;
    };

/** Returns every piece of evidence the source did not produce. */
export function tenantRootRetirementGapsV1(
  evidence: TenantRootSourceRetirementEvidenceV1,
): readonly TenantRootRetirementGapV1[] {
  const gaps: TenantRootRetirementGapV1[] = [];
  if (evidence.destructionReceipts.deriverA === null) gaps.push('deriver_a_destruction');
  if (evidence.destructionReceipts.deriverB === null) gaps.push('deriver_b_destruction');
  if (evidence.decryptProbeReceipts.deriverA === null) gaps.push('deriver_a_decrypt_probe');
  if (evidence.decryptProbeReceipts.deriverB === null) gaps.push('deriver_b_decrypt_probe');
  if (evidence.credentialRevocationReceipt === null) gaps.push('credential_revocation');
  if (evidence.endpointCanaryReceipt === null) gaps.push('endpoint_canary');
  return gaps;
}

/**
 * Records the source lineage's disposition after a destination activated.
 *
 * The destination's activation receipt is the binding: retirement is only
 * meaningful once another deployment holds the root, and it is the receipt
 * the source's control plane was asked to retire against.
 */
export function retireSourceLineageV1(input: {
  readonly orgId: string;
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
  readonly lifecycleRevision: number;
  readonly destinationActivationReceiptDigestB64u: string | null;
  readonly expectedActivationReceiptDigestB64u: string | null;
  readonly evidence: TenantRootSourceRetirementEvidenceV1;
  readonly actorUserId: string;
  readonly atIso: string;
}): TenantRootRetirementOutcomeV1 {
  const audit = (
    outcome: TenantRootAuditEventV1['outcome'],
    failureCode?: string,
  ): TenantRootAuditEventV1 =>
    buildTenantRootAuditEventV1({
      action: 'source_custody_disposition_recorded',
      outcome,
      atIso: input.atIso,
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      identityDigestB64u: input.identityDigestB64u,
      custodyLineageB64u: input.custodyLineageB64u,
      lifecycleRevision: input.lifecycleRevision,
      ...(input.destinationActivationReceiptDigestB64u === null
        ? {}
        : { receiptDigestB64u: input.destinationActivationReceiptDigestB64u }),
      ...(failureCode === undefined ? {} : { failureCode }),
    });

  if (input.destinationActivationReceiptDigestB64u === null) {
    // Retirement is only meaningful once another deployment holds the root.
    return {
      ok: false,
      error: { kind: 'destination_not_activated' },
      audit: audit('failure', 'destination_not_activated'),
    };
  }
  if (
    input.expectedActivationReceiptDigestB64u !== null &&
    input.expectedActivationReceiptDigestB64u !== input.destinationActivationReceiptDigestB64u
  ) {
    return {
      ok: false,
      error: { kind: 'activation_receipt_mismatch' },
      audit: audit('failure', 'activation_receipt_mismatch'),
    };
  }

  const gaps = tenantRootRetirementGapsV1(input.evidence);
  if (gaps.length > 0) {
    // Every attempted check is named, so the weaker claim still says what was
    // tried rather than merely that it failed.
    return {
      ok: true,
      gaps,
      disposition: {
        kind: 'unavailable_retirement_unverified',
        attemptedChecks: gaps,
        recordedByUserId: input.actorUserId,
        recordedAt: input.atIso,
      },
      audit: audit('success'),
    };
  }

  return {
    ok: true,
    gaps: [],
    disposition: {
      kind: 'verified_retired',
      destructionReceipts: {
        deriverA: input.evidence.destructionReceipts.deriverA as string,
        deriverB: input.evidence.destructionReceipts.deriverB as string,
      },
      decryptProbeReceipts: {
        deriverA: input.evidence.decryptProbeReceipts.deriverA as string,
        deriverB: input.evidence.decryptProbeReceipts.deriverB as string,
      },
      credentialRevocationReceiptDigestB64u: input.evidence.credentialRevocationReceipt as string,
      endpointCanaryReceiptDigestB64u: input.evidence.endpointCanaryReceipt as string,
      recordedByUserId: input.actorUserId,
      recordedAt: input.atIso,
    },
    audit: audit('success'),
  };
}

/**
 * Returns the sentence a deployment may say about its source.
 *
 * The claims are deliberately different lengths of neck: only a fully verified
 * retirement says the source can no longer produce the root, and even then
 * only for the named lineage.
 */
export function sourceCustodyClaimV1(disposition: TenantRootSourceCustodyDispositionV1): string {
  switch (disposition.kind) {
    case 'verified_retired':
      return 'The source lineage produced every destruction, decrypt-probe, credential-revocation, and endpoint-canary receipt, so that named lineage can no longer derive this root. Other copies of your recovery files, if any exist, are unaffected.';
    case 'unavailable_retirement_unverified':
      return 'Retirement was attempted but could not be verified, so the source deployment stays in your security and incident-response model.';
    case 'retained_as_backup':
      return 'The source deployment is deliberately retained and may still hold usable shares. It remains a valid custodian of this root and stays in your security and incident-response model.';
  }
}
