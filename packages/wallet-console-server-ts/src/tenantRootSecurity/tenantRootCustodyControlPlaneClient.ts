import { base64UrlDecode, base64UrlEncode } from '@seams/wallet-server/cloud-host';
import { isPlainObject } from '@seams-internal/shared-ts/utils/validation';
import type { TenantRootCustodyControlPlaneV1 } from './custodyService';

type RecipientProofControlPlane = Pick<
  TenantRootCustodyControlPlaneV1,
  'sealRecipientChallenge' | 'verifyRecipientConfirmation'
>;

type ControlPlaneOptions = {
  readonly controlPlaneFetch: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  readonly internalServiceAuthSecret: string;
};

/** Native custody operations over the private control-plane service binding. */
export class TenantRootCustodyControlPlaneClientV1 implements RecipientProofControlPlane {
  constructor(private readonly options: ControlPlaneOptions) {}

  async sealRecipientChallenge(
    input: Parameters<RecipientProofControlPlane['sealRecipientChallenge']>[0],
  ): ReturnType<RecipientProofControlPlane['sealRecipientChallenge']> {
    const result = await recipientProofRequest(this.options, {
      kind: 'seal',
      identity_digest_b64u: input.identityDigestB64u,
      custody_lineage_b64u: input.custodyLineageB64u,
      role: input.role,
      recipient_public_key_b64u: input.recipientPublicKeyB64u,
      actor_user_id: input.actorUserId,
      lifecycle_revision: input.lifecycleRevision,
      issued_at_ms: input.issuedAtMs,
    });
    return {
      challengeIdB64u: proofBytes(result.challenge_id_b64u, 16),
      envelopeB64u: proofBytes(result.envelope_b64u, null),
      recipientFingerprintB64u: proofBytes(result.recipient_fingerprint_b64u, 32),
      expectedConfirmationB64u: proofBytes(result.expected_confirmation_b64u, 32),
    };
  }

  async verifyRecipientConfirmation(
    input: Parameters<RecipientProofControlPlane['verifyRecipientConfirmation']>[0],
  ): Promise<boolean> {
    const result = await recipientProofRequest(this.options, {
      kind: 'verify',
      expected_confirmation_b64u: input.expectedConfirmationB64u,
      confirmation_b64u: input.confirmationB64u,
    });
    if (typeof result.verified !== 'boolean') throw new Error('Invalid recipient proof response');
    return result.verified;
  }
}

async function recipientProofRequest(
  options: ControlPlaneOptions,
  body: Record<string, string | number>,
): Promise<Record<string, unknown>> {
  const response = await options.controlPlaneFetch.fetch(
    'https://tenant-root-control-plane.internal/router-ab/tenant-root-control-plane/recovery/recipient-proof',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-router-ab-internal-service-auth': options.internalServiceAuthSecret,
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error('Recipient proof control plane refused the request');
  const text = await response.text();
  if (text.length > 8192) throw new Error('Recipient proof response exceeds its limit');
  const result: unknown = JSON.parse(text);
  if (!isPlainObject(result)) throw new Error('Invalid recipient proof response');
  return result;
}

function proofBytes(value: unknown, exactLength: number | null): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Invalid recipient proof encoding');
  }
  const bytes = base64UrlDecode(value);
  if (
    bytes.length === 0 ||
    bytes.length > 4096 ||
    (exactLength !== null && bytes.length !== exactLength) ||
    base64UrlEncode(bytes) !== value
  )
    throw new Error('Invalid recipient proof length or encoding');
  return value;
}
