import {
  CloudflareD1GoogleEmailOtpRegistrationAttemptStore,
  parseGoogleEmailOtpRegistrationAttemptRecord,
  parseGoogleEmailOtpRegistrationOfferCandidates,
  prepareD1TenantStatement,
  requireRuntimePolicyScope,
  type D1DatabaseLike,
  type GoogleEmailOtpRegistrationAttemptStore,
} from '@seams/wallet-server/cloud-host';
import { WalletPlacementError, type WalletOwnershipKey } from './home';

type Input<Method extends keyof GoogleEmailOtpRegistrationAttemptStore> = Parameters<
  GoogleEmailOtpRegistrationAttemptStore[Method]
>[0];
export type RegistrationOfferCommand = {
  [Method in keyof GoogleEmailOtpRegistrationAttemptStore]: {
    readonly operation: Method;
    readonly input: Input<Method>;
  };
}[keyof GoogleEmailOtpRegistrationAttemptStore];

type Scope = Pick<
  WalletOwnershipKey,
  'namespace' | 'organizationId' | 'projectId' | 'environmentId'
>;

class ScopedOfferDatabase {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: Scope,
  ) {}
  prepare(sql: string, values: readonly unknown[]) {
    return prepareD1TenantStatement(
      this.database,
      {
        namespace: this.scope.namespace,
        orgId: this.scope.organizationId,
        projectId: this.scope.projectId,
        envId: this.scope.environmentId,
      },
      sql,
      values,
    );
  }
}

export async function handleRegistrationOfferCommand(
  raw: unknown,
  database: D1DatabaseLike,
  scope: Scope,
): Promise<Response> {
  if (!raw || typeof raw !== 'object' || !('operation' in raw) || !('input' in raw))
    throw invalidOffer();
  const scoped = new ScopedOfferDatabase(database, scope);
  const store = new CloudflareD1GoogleEmailOtpRegistrationAttemptStore({
    prepare: scoped.prepare.bind(scoped),
    orgId: scope.organizationId,
  });
  switch (raw.operation) {
    case 'read':
      return Response.json({ value: await store.read(requiredString(raw.input)) });
    case 'delete':
      await store.delete(requiredString(raw.input));
      break;
    case 'cleanupExpired':
      return Response.json({ value: await store.cleanupExpired(requiredTime(raw.input)) });
    case 'put': {
      const record = parseGoogleEmailOtpRegistrationAttemptRecord(raw.input);
      if (!record) throw invalidOffer();
      scopedPolicy(record.runtimePolicyScope, scope);
      await store.put(record);
      break;
    }
    case 'create':
      return Response.json({ value: await store.create(createInput(raw.input, scope)) });
    case 'findStarted':
      return Response.json({ value: await store.findStarted(findInput(raw.input, scope)) });
    case 'abandonStartedExceptBinding': {
      const input = object(raw.input);
      if (input.failureCode !== 'owner_proof_binding_replaced') throw invalidOffer();
      await store.abandonStartedExceptBinding({
        ...findInput(input, scope),
        nowMs: requiredTime(input.nowMs),
        failureCode: 'owner_proof_binding_replaced',
      });
      break;
    }
    case 'hasLiveStartedWalletAttempt': {
      const input = object(raw.input);
      return Response.json({
        value: await store.hasLiveStartedWalletAttempt({
          walletId: requiredString(input.walletId),
          nowMs: requiredTime(input.nowMs),
        }),
      });
    }
    default:
      throw invalidOffer();
  }
  return Response.json({ ok: true });
}

function findInput(raw: unknown, scope: Scope): Input<'findStarted'> {
  const input = object(raw);
  if (input.orgId !== scope.organizationId) throw invalidOffer();
  return {
    providerSubject: requiredString(input.providerSubject),
    email: requiredString(input.email),
    orgId: scope.organizationId,
    ownerProofBindingDigest: requiredString(input.ownerProofBindingDigest),
    runtimePolicyScope: scopedPolicy(input.runtimePolicyScope, scope),
  };
}
function createInput(raw: unknown, scope: Scope): Input<'create'> {
  const input = object(raw);
  const candidates = parseGoogleEmailOtpRegistrationOfferCandidates(input.offerCandidates);
  const selected = candidates?.find(matchesCandidate.bind(undefined, input.selectedCandidateId));
  if (
    !candidates ||
    !selected ||
    selected.walletId !== input.walletId ||
    selected.collisionCounter !== input.collisionCounter ||
    input.authProvider !== 'google'
  )
    throw invalidOffer();
  return {
    providerSubject: requiredString(input.providerSubject),
    email: requiredString(input.email),
    walletId: selected.walletId,
    offerId: requiredString(input.offerId),
    offerCandidates: candidates,
    selectedCandidateId: selected.candidateId,
    ownerProofBindingDigest: requiredString(input.ownerProofBindingDigest),
    authProvider: 'google',
    walletIdDerivationNonce: requiredString(input.walletIdDerivationNonce),
    collisionCounter: selected.collisionCounter,
    runtimePolicyScope: scopedPolicy(input.runtimePolicyScope, scope),
  };
}
function matchesCandidate(id: unknown, candidate: { readonly candidateId: string }): boolean {
  return candidate.candidateId === id;
}
function scopedPolicy(raw: unknown, scope: Scope) {
  const policy = requireRuntimePolicyScope(raw);
  if (
    policy.orgId !== scope.organizationId ||
    policy.projectId !== scope.projectId ||
    policy.envId !== scope.environmentId
  )
    throw invalidOffer();
  return policy;
}
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidOffer();
  return Object.fromEntries(Object.entries(raw));
}
function requiredString(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.trim() !== raw) throw invalidOffer();
  return raw;
}
function requiredTime(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) throw invalidOffer();
  return raw;
}
function invalidOffer(): WalletPlacementError {
  return new WalletPlacementError('invalid_input', 'Invalid registration offer command');
}
