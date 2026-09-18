import type {
  ActiveTenantRootReferenceV1,
  PublishableCredentialQuotaPolicyV1,
  TenantDeploymentBindingRevision,
  TenantDeploymentBindingV1,
  TenantDeploymentModeV1,
  TenantDeploymentReadinessReceiptV1,
} from '@seams-internal/wallet-console-shared/tenant-deployment';
import { encodeTenantDeploymentJsonValueV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';
import { TenantDeploymentStoreError } from './service';

export type TenantDeploymentReadinessEvidenceV1 = {
  readonly mode: TenantDeploymentModeV1;
  readonly environmentId: string;
  readonly tenantRoot: ActiveTenantRootReferenceV1;
  readonly credential: {
    readonly credentialId: string;
    readonly publishableKey: string;
    readonly environmentId: string;
    readonly allowedOrigins: readonly string[];
    readonly quotaPolicy: PublishableCredentialQuotaPolicyV1;
    readonly status: 'active';
    readonly expiresAtMs: number | null;
  };
  readonly runtimePolicyDigestB64u: string;
  readonly applicationOrigin: string;
  readonly hostedWalletOrigin: string;
  readonly gatewayOrigin: string;
  readonly relyingPartyId: string;
  readonly acknowledgedBindingRevision: TenantDeploymentBindingRevision;
  readonly sourceEnvironmentChanged: boolean;
  readonly sourceDurableWalletCount: number;
  readonly targetDurableWalletCount: number;
  readonly inFlightCeremonyCount: number;
  readonly migrationAuthorized: boolean;
};

export interface TenantDeploymentReadinessInspectorV1 {
  inspect(binding: TenantDeploymentBindingV1): Promise<TenantDeploymentReadinessEvidenceV1>;
}

export type TenantDeploymentReadinessServiceV1 = {
  issue(input: {
    readonly binding: TenantDeploymentBindingV1;
    readonly expectedActiveRevision: TenantDeploymentBindingRevision | null;
  }): Promise<TenantDeploymentReadinessReceiptV1>;
};

function assertEvidence(
  binding: TenantDeploymentBindingV1,
  evidence: TenantDeploymentReadinessEvidenceV1,
  nowMs: number,
): void {
  const credential = binding.browserCredential;
  const surfaces = binding.surfaces;
  const root = binding.tenantRoot;
  const valid =
    evidence.mode.kind === binding.mode.kind &&
    evidence.mode.environment === binding.mode.environment &&
    evidence.mode.network === binding.mode.network &&
    evidence.environmentId === binding.tenant.environmentId &&
    evidence.tenantRoot.identityDigestB64u === root.identityDigestB64u &&
    evidence.tenantRoot.custodyLineageId === root.custodyLineageId &&
    evidence.tenantRoot.signingRootId === root.signingRootId &&
    evidence.tenantRoot.signingRootVersion === root.signingRootVersion &&
    evidence.credential.credentialId === credential.credentialId &&
    evidence.credential.publishableKey === credential.publishableKey &&
    evidence.credential.environmentId === binding.tenant.environmentId &&
    evidence.credential.allowedOrigins.length === credential.allowedOrigins.length &&
    evidence.credential.allowedOrigins.every(
      (origin, index) => origin === credential.allowedOrigins[index],
    ) &&
    evidence.credential.quotaPolicy.rateLimitBucket === credential.quotaPolicy.rateLimitBucket &&
    evidence.credential.quotaPolicy.quotaBucket === credential.quotaPolicy.quotaBucket &&
    encodeTenantDeploymentJsonValueV1(evidence.credential.quotaPolicy.riskPolicy) ===
      encodeTenantDeploymentJsonValueV1(credential.quotaPolicy.riskPolicy) &&
    encodeTenantDeploymentJsonValueV1(evidence.credential.quotaPolicy.paymentPolicy) ===
      encodeTenantDeploymentJsonValueV1(credential.quotaPolicy.paymentPolicy) &&
    evidence.credential.status === 'active' &&
    evidence.credential.expiresAtMs === credential.expiresAtMs &&
    (credential.expiresAtMs === null || credential.expiresAtMs > nowMs) &&
    evidence.runtimePolicyDigestB64u === binding.runtimePolicyDigestB64u &&
    evidence.applicationOrigin === surfaces.applicationOrigin &&
    evidence.hostedWalletOrigin === surfaces.hostedWalletOrigin &&
    evidence.gatewayOrigin === surfaces.gatewayOrigin &&
    evidence.relyingPartyId === surfaces.relyingPartyId &&
    evidence.acknowledgedBindingRevision === binding.revision &&
    Number.isSafeInteger(evidence.sourceDurableWalletCount) &&
    evidence.sourceDurableWalletCount >= 0 &&
    Number.isSafeInteger(evidence.targetDurableWalletCount) &&
    evidence.targetDurableWalletCount >= 0 &&
    Number.isSafeInteger(evidence.inFlightCeremonyCount) &&
    evidence.inFlightCeremonyCount === 0 &&
    (!evidence.sourceEnvironmentChanged ||
      evidence.sourceDurableWalletCount === 0 ||
      evidence.migrationAuthorized);
  if (!valid)
    throw new TenantDeploymentStoreError(
      'readiness_invalid',
      'tenant deployment semantic readiness failed',
    );
}

async function sha256B64u(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function evidencePayload(evidence: TenantDeploymentReadinessEvidenceV1): string {
  return encodeTenantDeploymentJsonValueV1([
    evidence.mode.kind,
    evidence.mode.environment,
    evidence.mode.network,
    evidence.environmentId,
    evidence.tenantRoot.identityDigestB64u,
    evidence.tenantRoot.custodyLineageId,
    evidence.tenantRoot.signingRootId,
    evidence.tenantRoot.signingRootVersion,
    evidence.credential.credentialId,
    evidence.credential.publishableKey,
    evidence.credential.environmentId,
    evidence.credential.allowedOrigins,
    evidence.credential.quotaPolicy.rateLimitBucket,
    evidence.credential.quotaPolicy.quotaBucket,
    evidence.credential.quotaPolicy.riskPolicy,
    evidence.credential.quotaPolicy.paymentPolicy,
    evidence.credential.status,
    evidence.credential.expiresAtMs,
    evidence.runtimePolicyDigestB64u,
    evidence.applicationOrigin,
    evidence.hostedWalletOrigin,
    evidence.gatewayOrigin,
    evidence.relyingPartyId,
    evidence.acknowledgedBindingRevision,
    evidence.sourceEnvironmentChanged,
    evidence.sourceDurableWalletCount,
    evidence.targetDurableWalletCount,
    evidence.inFlightCeremonyCount,
    evidence.migrationAuthorized,
  ]);
}

export function createTenantDeploymentReadinessServiceV1(options: {
  readonly inspector: TenantDeploymentReadinessInspectorV1;
  readonly now?: () => Date;
  readonly receiptTtlMs?: number;
}): TenantDeploymentReadinessServiceV1 {
  const now = options.now ?? (() => new Date());
  const receiptTtlMs = options.receiptTtlMs ?? 60_000;
  if (!Number.isSafeInteger(receiptTtlMs) || receiptTtlMs <= 0)
    throw new Error('receiptTtlMs must be positive');
  return {
    async issue(input) {
      const checkedAtMs = now().getTime();
      const evidence = await options.inspector.inspect(input.binding);
      assertEvidence(input.binding, evidence, checkedAtMs);
      const evidenceDigestB64u = await sha256B64u(evidencePayload(evidence));
      return {
        kind: 'tenant_deployment_readiness_receipt_v1' as const,
        bindingRevision: input.binding.revision,
        expectedActiveRevision: input.expectedActiveRevision,
        checkedAtMs,
        expiresAtMs: checkedAtMs + receiptTtlMs,
        evidenceDigestB64u,
        durableWalletCount: evidence.targetDurableWalletCount,
        inFlightCeremonyCount: evidence.inFlightCeremonyCount,
      };
    },
  };
}
