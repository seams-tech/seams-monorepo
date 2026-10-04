import { ScopedWalletAuthorityDatabase } from './scopedAuthorityDatabase';
import {
  CloudflareD1GoogleEmailOtpRegistrationAttemptStore,
  parseGoogleEmailOtpRegistrationAttemptRecord,
  parseGoogleEmailOtpRegistrationOfferCandidates,
  requireRuntimePolicyScope,
  type D1DatabaseLike,
  type GoogleEmailOtpRegistrationAttemptStore,
} from '@seams/wallet-server/cloud-host';
import { WalletPlacementError, WalletOwnershipKey } from './home';
import type { D1WalletHomeDirectory } from './d1';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';

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
> & { readonly environmentKey: string };

export async function handleRegistrationOfferCommand(
  raw: unknown,
  database: D1DatabaseLike,
  scope: Scope,
  directory: D1WalletHomeDirectory,
  writer: TenantRuntimeWriterV1,
): Promise<Response> {
  if (!raw || typeof raw !== 'object' || !('operation' in raw) || !('input' in raw))
    throw invalidOffer();
  const scoped = new ScopedWalletAuthorityDatabase(database, scope);
  const store = new CloudflareD1GoogleEmailOtpRegistrationAttemptStore({
    prepare: scoped.prepare.bind(scoped),
    orgId: scope.organizationId,
    batch: database.batch.bind(database),
  });
  switch (raw.operation) {
    case 'read':
      return Response.json({ value: await store.read(requiredString(raw.input)) });
    case 'cleanupExpired':
      return Response.json({ value: await store.cleanupExpired(requiredTime(raw.input)) });
    case 'put': {
      const record = parseGoogleEmailOtpRegistrationAttemptRecord(raw.input);
      if (!record) throw invalidOffer();
      scopedPolicy(record.runtimePolicyScope, scope);
      await store.put(record);
      break;
    }
    case 'completeCommitted': {
      const input = object(raw.input);
      const walletId = requiredString(input.walletId);
      const assignment = await directory.find(
        WalletOwnershipKey.parse({
          namespace: scope.namespace,
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          environmentId: scope.environmentId,
          walletId,
        }),
      );
      if (
        !assignment ||
        assignment.state === 'cancelled' ||
        assignment.home.accountId !== writer.resource.accountId ||
        assignment.home.databaseId !== writer.resource.databaseId
      ) {
        throw new WalletPlacementError(
          'scope_conflict',
          'Committed registration must complete at its wallet home',
        );
      }
      return Response.json({
        value: await store.completeCommitted({
          attemptId: requiredString(input.attemptId),
          walletId,
          intentDigest: requiredString(input.intentDigest),
        }),
      });
    }
    case 'complete': {
      const input = object(raw.input);
      return Response.json({
        value: await store.complete({
          attemptId: requiredString(input.attemptId),
          walletId: requiredString(input.walletId),
        }),
      });
    }
    case 'claimCandidate': {
      const input = object(raw.input);
      return Response.json({
        value: await store.claimCandidate({
          attemptId: requiredString(input.attemptId),
          candidateId: requiredString(input.candidateId),
          walletId: requiredString(input.walletId),
          intentDigest: requiredString(input.intentDigest),
        }),
      });
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
    policy.envId !== scope.environmentKey
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
