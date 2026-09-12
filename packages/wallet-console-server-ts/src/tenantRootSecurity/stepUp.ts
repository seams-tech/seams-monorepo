import type { TenantRootOperationKindV1 } from '@seams-internal/wallet-console-shared/tenant-root';

/**
 * Server-issued proof that one console actor completed high-assurance step-up.
 *
 * The proof has no public constructor and a private brand, so a request body
 * cannot produce one structurally. This is what replaces the caller-supplied
 * `mfaVerified` boolean the generic approval service accepts: a core service
 * takes this type or it takes nothing.
 *
 * A proof is bound to the console session it was recorded in. Step-up proves
 * presence at a keyboard; a different session presenting the same actor's
 * credential is not that keyboard.
 */

/** How long step-up evidence stays fresh enough to authorize an operation. */
export const TENANT_ROOT_STEP_UP_MAX_AGE_MS_V1 = 300_000;

/**
 * How far ahead of the verifier a recorded step-up may be dated.
 *
 * Issuers and consumers permit at most this much clock skew; a larger skew
 * fails closed rather than extending the freshness window.
 */
export const TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1 = 60_000;

/** How the actor proved presence. */
export type TenantRootStepUpMethodV1 = 'webauthn_platform_v1' | 'webauthn_cross_platform_v1';

/** The session record fields a step-up proof is parsed from. */
export type TenantRootStepUpSessionRecordV1 = {
  readonly actorUserId: string;
  readonly sessionId: string;
  readonly method: TenantRootStepUpMethodV1;
  readonly verifiedAtMs: number;
};

class TenantRootStepUpProof {
  readonly actorUserId: string;
  readonly sessionId: string;
  readonly method: TenantRootStepUpMethodV1;
  readonly verifiedAtMs: number;

  private retainProof(): true {
    return true;
  }

  private constructor(record: TenantRootStepUpSessionRecordV1) {
    void this.retainProof();
    this.actorUserId = record.actorUserId;
    this.sessionId = record.sessionId;
    this.method = record.method;
    this.verifiedAtMs = record.verifiedAtMs;
    Object.freeze(this);
  }

  static create(record: TenantRootStepUpSessionRecordV1): TenantRootStepUpProof {
    return new TenantRootStepUpProof(record);
  }
}

/** One parsed, server-issued step-up proof. */
export type TenantRootStepUpProofV1 = TenantRootStepUpProof;

/** Why a session could not produce a step-up proof. */
export type TenantRootStepUpParseErrorV1 =
  | { readonly kind: 'no_step_up_recorded' }
  | { readonly kind: 'actor_mismatch' }
  | { readonly kind: 'session_mismatch' }
  | { readonly kind: 'unsupported_method' }
  | { readonly kind: 'stale'; readonly ageMs: number }
  | { readonly kind: 'dated_in_the_future' };

/** Result of parsing one session's step-up state. */
export type TenantRootStepUpParseResultV1 =
  | { readonly ok: true; readonly proof: TenantRootStepUpProofV1 }
  | { readonly ok: false; readonly error: TenantRootStepUpParseErrorV1 };

const SUPPORTED_METHODS: ReadonlySet<string> = new Set([
  'webauthn_platform_v1',
  'webauthn_cross_platform_v1',
]);

/**
 * Parses one session's recorded step-up into a proof.
 *
 * This is the single place raw session state becomes an authorization input.
 * It runs at the adapter boundary, once per request. When the caller knows
 * which console session is presenting the request, the record must belong to
 * that session; a proof from another session of the same actor is refused.
 */
export function parseTenantRootStepUpV1(input: {
  readonly record: TenantRootStepUpSessionRecordV1 | null;
  readonly expectedActorUserId: string;
  readonly expectedSessionId?: string;
  readonly nowMs: number;
}): TenantRootStepUpParseResultV1 {
  const { record } = input;
  if (record === null) {
    return { ok: false, error: { kind: 'no_step_up_recorded' } };
  }
  if (record.actorUserId !== input.expectedActorUserId) {
    return { ok: false, error: { kind: 'actor_mismatch' } };
  }
  if (input.expectedSessionId !== undefined && record.sessionId !== input.expectedSessionId) {
    return { ok: false, error: { kind: 'session_mismatch' } };
  }
  if (!SUPPORTED_METHODS.has(record.method)) {
    return { ok: false, error: { kind: 'unsupported_method' } };
  }
  if (record.verifiedAtMs - input.nowMs > TENANT_ROOT_MAX_CLOCK_SKEW_MS_V1) {
    return { ok: false, error: { kind: 'dated_in_the_future' } };
  }
  const ageMs = Math.max(0, input.nowMs - record.verifiedAtMs);
  if (ageMs > TENANT_ROOT_STEP_UP_MAX_AGE_MS_V1) {
    return { ok: false, error: { kind: 'stale', ageMs } };
  }
  return { ok: true, proof: TenantRootStepUpProof.create(record) };
}

/**
 * Every tenant-root mutation requires step-up.
 *
 * Read-only status does not, and neither does any operation outside this
 * feature; the predicate exists so the route handler and the service agree.
 */
export function tenantRootOperationRequiresStepUpV1(kind: TenantRootOperationKindV1): boolean {
  void kind;
  return true;
}
