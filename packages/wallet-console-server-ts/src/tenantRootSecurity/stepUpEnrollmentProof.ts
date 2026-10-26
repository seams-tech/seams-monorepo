import type { SessionAdapter } from '@seams-internal/console-server/boundary/session';

const PROVIDER_PROOF_KIND = 'console_step_up_provider_enrollment_v1';
const PASSKEY_PROOF_KIND = 'console_step_up_passkey_enrollment_v1';
const MAX_AGE_SECONDS = 300;
const MAX_FUTURE_SKEW_SECONDS = 60;

class VerifiedConsoleStepUpProviderEnrollmentProof {
  private retainProof(): true {
    return true;
  }

  private constructor(readonly userId: string) {
    void this.retainProof();
    Object.freeze(this);
  }

  static create(userId: string): VerifiedConsoleStepUpProviderEnrollmentProof {
    return new VerifiedConsoleStepUpProviderEnrollmentProof(userId);
  }
}

class VerifiedConsoleStepUpPasskeyEnrollmentProof {
  private retainProof(): true {
    return true;
  }

  private constructor(
    readonly userId: string,
    readonly orgId: string,
  ) {
    void this.retainProof();
    Object.freeze(this);
  }

  static create(userId: string, orgId: string): VerifiedConsoleStepUpPasskeyEnrollmentProof {
    return new VerifiedConsoleStepUpPasskeyEnrollmentProof(userId, orgId);
  }
}

export type VerifiedConsoleStepUpProviderEnrollmentProofV1 =
  VerifiedConsoleStepUpProviderEnrollmentProof;
export type VerifiedConsoleStepUpPasskeyEnrollmentProofV1 =
  VerifiedConsoleStepUpPasskeyEnrollmentProof;

export type ConsoleStepUpEnrollmentProofResultV1<TProof> =
  | { readonly ok: true; readonly proof: TProof }
  | { readonly ok: false };

export async function issueConsoleStepUpProviderEnrollmentProofV1(
  session: Pick<SessionAdapter, 'signJwt'>,
  userId: string,
): Promise<string> {
  return session.signJwt(userId, { kind: PROVIDER_PROOF_KIND });
}

export async function issueConsoleStepUpPasskeyEnrollmentProofV1(
  session: Pick<SessionAdapter, 'signJwt'>,
  userId: string,
  orgId: string,
): Promise<string> {
  return session.signJwt(userId, { kind: PASSKEY_PROOF_KIND, orgId });
}

interface EnrollmentProofInput {
  readonly session: Pick<SessionAdapter, 'verifyJwt'>;
  readonly proof: unknown;
  readonly userId: string;
  readonly nowMs: number;
}

async function verifySignedProof(
  input: EnrollmentProofInput,
  expectedKind: typeof PROVIDER_PROOF_KIND | typeof PASSKEY_PROOF_KIND,
): Promise<Record<string, unknown> | null> {
  if (typeof input.proof !== 'string' || !input.proof) return null;
  const verified = await input.session.verifyJwt(input.proof);
  if (!verified.valid) return null;
  const payload = verified.payload;
  if (payload.kind !== expectedKind || payload.sub !== input.userId) return null;
  if (typeof payload.iat !== 'number' || !Number.isSafeInteger(payload.iat)) {
    return null;
  }
  const issuedAtSeconds = payload.iat;
  const ageSeconds = Math.floor(input.nowMs / 1000) - issuedAtSeconds;
  if (ageSeconds < -MAX_FUTURE_SKEW_SECONDS || ageSeconds > MAX_AGE_SECONDS) return null;
  return payload;
}

export async function verifyConsoleStepUpProviderEnrollmentProofV1(
  input: EnrollmentProofInput,
): Promise<ConsoleStepUpEnrollmentProofResultV1<VerifiedConsoleStepUpProviderEnrollmentProofV1>> {
  const payload = await verifySignedProof(input, PROVIDER_PROOF_KIND);
  return payload
    ? { ok: true, proof: VerifiedConsoleStepUpProviderEnrollmentProof.create(input.userId) }
    : { ok: false };
}

export async function verifyConsoleStepUpPasskeyEnrollmentProofV1(
  input: EnrollmentProofInput & { readonly orgId: string },
): Promise<ConsoleStepUpEnrollmentProofResultV1<VerifiedConsoleStepUpPasskeyEnrollmentProofV1>> {
  const payload = await verifySignedProof(input, PASSKEY_PROOF_KIND);
  return payload?.orgId === input.orgId
    ? {
        ok: true,
        proof: VerifiedConsoleStepUpPasskeyEnrollmentProof.create(input.userId, input.orgId),
      }
    : { ok: false };
}
