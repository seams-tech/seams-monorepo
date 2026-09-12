import type {
  TenantRootDeriverRoleV1,
  TenantRootOperationKindV1,
  TenantRootOperationSubjectV1,
  TenantRootRecoveryGovernanceV1,
  TenantRootTrustLevelV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import {
  buildTenantRootOperationRecordV1,
  tenantRootDownloadableRecoverySetV1,
  tenantRootOperationMaxLifetimeMsV1,
  tenantRootRecipientPairDigestB64uV1,
  tenantRootRecoveryGovernanceDigestB64uV1,
} from '@seams-internal/wallet-console-shared/tenant-root';
import { RecoveryBackupCooldownError } from './d1';
import {
  checkTenantRootAuditEventRedactionV1,
  type TenantRootAuditEventV1,
  type TenantRootAuditWriterV1,
} from './audit';
import {
  commitRecipientPairV1,
  confirmRecipientV1,
  createRecoveryBackupV1,
  recordDurableVerificationV1,
  retireSourceLineageOperationV1,
  serveRecoveryArtifactV1,
  setRecoveryGovernanceV1,
  startRecipientChallengeV1,
  tenantRootCustodyFailureCodeV1,
  type TenantRootCustodyErrorV1,
  type TenantRootCustodyControlPlaneV1,
  type TenantRootCustodyOutcomeV1,
  type TenantRootCustodyStateV1,
  type TenantRootCustodyStoreV1,
} from './custodyService';
import {
  buildTenantRootRecoveryGovernanceV1,
  commitTenantRootRecipientPairV1,
  type TenantRootGovernanceChoiceV1,
} from './recipients';
import type { TenantRootDownloadArtifactV1 } from './recoverySets';
import {
  guardTenantRootSecurityRequestV1,
  tenantRootSecurityJson,
  tenantRootStepUpRecordFromProofV1,
  type TenantRootSecurityGuardDependenciesV1,
  type TenantRootSecurityRequestV1,
} from './routeGuard';
import {
  approveTenantRootOperationV1,
  resolveTenantRootOperationRecordV1,
  startTenantRootOperationV1,
  type TenantRootOperationStoreV1,
} from './service';
import type { TenantRootStepUpProofV1 } from './stepUp';

function custodyFailureResponse(error: TenantRootCustodyErrorV1): Response {
  if (error.kind === 'download' && error.error.kind === 'recovery_holder_required') {
    return tenantRootSecurityJson(
      {
        ok: false,
        code: 'recovery_holder_required',
        message: 'Only the enrolled recovery key holder can access this package.',
        error,
      },
      403,
    );
  }
  return tenantRootSecurityJson({ ok: false, error }, 409);
}

type TenantRootCustodyOperationKindV1 = Exclude<
  TenantRootOperationKindV1,
  | 'tenant_root_restore_session_start_v1'
  | 'tenant_root_restore_manifest_register_v1'
  | 'tenant_root_restore_role_import_key_issue_v1'
  | 'tenant_root_restore_role_import_v1'
  | 'tenant_root_restore_activate_v1'
>;

/**
 * The recovery-custody console handlers.
 *
 * Every mutation here is one exact authorized operation: a server-generated
 * record, its digest, fresh step-up bound to the requesting session, and —
 * for the four governance-following operations under two-person governance —
 * a different owner's one-use approval of that digest, consumed in the same
 * transaction that creates the operation. Nothing in a request body can
 * stand in for any of that.
 *
 * Every handler writes its audit event before returning, refusal included, and
 * refuses to return at all if the event fails redaction — an operation whose
 * record cannot be written safely is not an operation that should appear to
 * have succeeded.
 */

export const TENANT_ROOT_GOVERNANCE_PATH_V1 = '/console/tenant-root/security/governance';
export const TENANT_ROOT_RECIPIENT_CHALLENGE_PATH_V1 =
  '/console/tenant-root/security/recipients/challenge';
export const TENANT_ROOT_RECIPIENT_CONFIRM_PATH_V1 =
  '/console/tenant-root/security/recipients/confirm';
export const TENANT_ROOT_RECIPIENT_COMMIT_PATH_V1 =
  '/console/tenant-root/security/recipients/commit';
export const TENANT_ROOT_BACKUP_PATH_V1 = '/console/tenant-root/security/backup';
export const TENANT_ROOT_ROLE_PACKAGE_PATH_V1 = '/console/tenant-root/security/backup/package';
export const TENANT_ROOT_DURABLE_VERIFICATION_PATH_V1 =
  '/console/tenant-root/security/backup/durable-verification';
export const TENANT_ROOT_MANIFEST_PATH_V1 = '/console/tenant-root/security/manifest';
export const TENANT_ROOT_OPERATION_APPROVE_PATH_V1 =
  '/console/tenant-root/security/operations/approve';
export const TENANT_ROOT_OPERATIONS_PENDING_PATH_V1 =
  '/console/tenant-root/security/operations/pending';
export const TENANT_ROOT_SOURCE_RETIRE_PATH_V1 = '/console/tenant-root/security/source/retire';

const CUSTODY_PATHS: ReadonlySet<string> = new Set([
  TENANT_ROOT_GOVERNANCE_PATH_V1,
  TENANT_ROOT_RECIPIENT_CHALLENGE_PATH_V1,
  TENANT_ROOT_RECIPIENT_CONFIRM_PATH_V1,
  TENANT_ROOT_RECIPIENT_COMMIT_PATH_V1,
  TENANT_ROOT_BACKUP_PATH_V1,
  TENANT_ROOT_ROLE_PACKAGE_PATH_V1,
  TENANT_ROOT_DURABLE_VERIFICATION_PATH_V1,
  TENANT_ROOT_MANIFEST_PATH_V1,
  TENANT_ROOT_OPERATION_APPROVE_PATH_V1,
  TENANT_ROOT_OPERATIONS_PENDING_PATH_V1,
  TENANT_ROOT_SOURCE_RETIRE_PATH_V1,
]);

export type { TenantRootAuditWriterV1 } from './audit';

/** Answers whether a user currently holds the organization's owner role. */
export interface TenantRootOwnerMembershipReaderV1 {
  isOrganizationOwner(input: { readonly orgId: string; readonly userId: string }): Promise<boolean>;
}

/** Everything the custody handlers need. */
export interface TenantRootCustodyRouteDependenciesV1 extends TenantRootSecurityGuardDependenciesV1 {
  readonly custody: TenantRootCustodyStoreV1;
  readonly controlPlane: TenantRootCustodyControlPlaneV1;
  readonly operations: TenantRootOperationStoreV1;
  readonly membership: TenantRootOwnerMembershipReaderV1;
  readonly audit: TenantRootAuditWriterV1;
  readonly newOperationId?: () => string;
  readonly newNonceB64u?: () => string;
  readonly newRecoverySetId?: () => string;
}

function parseRole(value: unknown): TenantRootDeriverRoleV1 {
  if (value === 'deriver_a' || value === 'deriver_b') return value;
  throw new Error('role must be deriver_a or deriver_b');
}

function parseArtifact(value: unknown): TenantRootDownloadArtifactV1 {
  if (value === 'deriver_a_package' || value === 'deriver_b_package' || value === 'manifest') {
    return value;
  }
  throw new Error('artifact must be deriver_a_package, deriver_b_package, or manifest');
}

function requiredText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text !== value) throw new Error(`${label} is invalid`);
  return text;
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be an object');
  }
  return body as Record<string, unknown>;
}

/**
 * Parses what the tenant chose. Who chose it and when are never read from the
 * body; the authenticated actor and the server clock fill those in.
 */
function parseGovernanceChoice(record: Record<string, unknown>): TenantRootGovernanceChoiceV1 {
  const governance = record.governance;
  if (!governance || typeof governance !== 'object' || Array.isArray(governance)) {
    throw new Error('governance is required');
  }
  const value = governance as Record<string, unknown>;
  if (value.kind === 'single_owner_v1') {
    return { kind: 'single_owner_v1', acknowledgeWarning: value.acknowledgeWarning === true };
  }
  if (value.kind === 'two_person_v1') {
    return { kind: 'two_person_v1' };
  }
  throw new Error('governance kind must be single_owner_v1 or two_person_v1');
}

function parseTrustLevel(value: unknown): TenantRootTrustLevelV1 | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('trustLevel must be an object');
  }
  const record = value as Record<string, unknown>;
  switch (record.kind) {
    case 'cryptographically_valid_offline':
      return { kind: 'cryptographically_valid_offline' };
    case 'valid_at_trust_snapshot':
      return {
        kind: 'valid_at_trust_snapshot',
        snapshotVersion: requiredInteger(record.snapshotVersion, 'snapshotVersion'),
        snapshotIssuedAt: requiredText(record.snapshotIssuedAt, 'snapshotIssuedAt'),
      };
    case 'current_trust_confirmed':
      return {
        kind: 'current_trust_confirmed',
        snapshotVersion: requiredInteger(record.snapshotVersion, 'snapshotVersion'),
        snapshotIssuedAt: requiredText(record.snapshotIssuedAt, 'snapshotIssuedAt'),
        checkedAt: requiredText(record.checkedAt, 'checkedAt'),
      };
    default:
      throw new Error('trustLevel kind is not a known trust result');
  }
}

function requiredInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function randomB64u(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = '';
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

/** The audit fields the operation layer adds to every event it writes. */
type OperationAuthorization = {
  readonly stepUp: TenantRootStepUpProofV1;
  readonly approverUserId: string | null;
  readonly operationKind: TenantRootOperationKindV1;
  readonly operationDigestB64u: string;
};

function withAuthorization(
  event: TenantRootAuditEventV1,
  authorization: OperationAuthorization,
): TenantRootAuditEventV1 {
  return {
    ...event,
    authorization: {
      stepUpMethod: authorization.stepUp.method,
      approverUserId: authorization.approverUserId,
      operationKind: authorization.operationKind,
      operationDigestB64u: authorization.operationDigestB64u,
    },
  };
}

export function isTenantRootCustodyPathV1(path: string): boolean {
  return CUSTODY_PATHS.has(path);
}

class ScopedCustodyRoute {
  private readonly handler;
  constructor(private readonly dependencies: TenantRootCustodyRouteDependenciesV1) {
    this.handler = createAuthorizedTenantRootCustodyHandlerV1(dependencies);
  }
  async fetch(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (!isTenantRootCustodyPathV1(url.pathname)) return null;
    const guarded = await guardTenantRootSecurityRequestV1(this.dependencies, request, url);
    if (!guarded.ok) return guarded.response;
    return this.handler(request, guarded.request);
  }
}

/** Creates a route when its custody scope is already known. */
export function createTenantRootCustodyConsoleRouteV1(
  dependencies: TenantRootCustodyRouteDependenciesV1,
): (request: Request) => Promise<Response | null> {
  const route = new ScopedCustodyRoute(dependencies);
  return route.fetch.bind(route);
}

/** Creates the recovery-custody console route. */
export function createAuthorizedTenantRootCustodyHandlerV1(
  dependencies: TenantRootCustodyRouteDependenciesV1,
): (request: Request, authorized: TenantRootSecurityRequestV1) => Promise<Response | null> {
  const newOperationId = dependencies.newOperationId ?? (() => crypto.randomUUID());
  const newNonceB64u = dependencies.newNonceB64u ?? (() => randomB64u(32));
  const newRecoverySetId = dependencies.newRecoverySetId ?? (() => randomB64u(16));

  async function record(event: TenantRootAuditEventV1): Promise<void> {
    const redaction = checkTenantRootAuditEventRedactionV1(event);
    if (!redaction.ok) {
      throw new Error(
        `refusing to write an unredacted audit event: ${JSON.stringify(redaction.errors)}`,
      );
    }
    await dependencies.audit.write(event);
  }

  function baseEvent(
    state: TenantRootCustodyStateV1,
    guarded: TenantRootSecurityRequestV1,
    action: TenantRootAuditEventV1['action'],
    outcome: TenantRootAuditEventV1['outcome'],
    failureCode: string | null,
  ): TenantRootAuditEventV1 {
    return {
      action,
      outcome,
      atIso: new Date(guarded.nowMs).toISOString(),
      orgId: state.orgId,
      actorUserId: guarded.actorUserId,
      identityDigestB64u: state.identityDigestB64u,
      custodyLineageB64u: state.custodyLineageB64u,
      lifecycleRevision: state.lifecycleRevision,
      role: null,
      recoverySetId: null,
      receiptDigestB64u: null,
      failureCode,
      authorization: {
        stepUpMethod: guarded.stepUp?.method ?? null,
        approverUserId: null,
        operationKind: null,
        operationDigestB64u: null,
      },
    };
  }

  /**
   * Runs one custody mutation as an exact authorized operation.
   *
   * The record is resolved before it is built: a retry with the same key
   * presents the bytes the first attempt produced, so the digest an approver
   * signed off on is the digest consumed here.
   */
  async function runOperation<T>(input: {
    readonly guarded: TenantRootSecurityRequestV1;
    readonly stepUp: TenantRootStepUpProofV1;
    readonly state: TenantRootCustodyStateV1;
    readonly operationKind: TenantRootCustodyOperationKindV1;
    readonly subject: TenantRootOperationSubjectV1;
    readonly role?: TenantRootDeriverRoleV1;
    readonly targetGovernance?: TenantRootRecoveryGovernanceV1;
    readonly payloadJson?: string;
    readonly idempotencyKey: string;
    readonly auditAction: TenantRootAuditEventV1['action'];
    readonly execute: () => Promise<TenantRootCustodyOutcomeV1<T>>;
  }): Promise<Response> {
    const { guarded, state } = input;
    const governanceDigestB64u = await tenantRootRecoveryGovernanceDigestB64uV1(state.governance);
    const issuedAtMs = guarded.nowMs;
    const resolved = await resolveTenantRootOperationRecordV1(dependencies.operations, {
      idempotencyKey: input.idempotencyKey,
      operationKind: input.operationKind,
      requesterUserId: guarded.actorUserId,
      ...(input.payloadJson === undefined ? {} : { payloadJson: input.payloadJson }),
      nowMs: guarded.nowMs,
      build: () =>
        buildTenantRootOperationRecordV1({
          operationKind: input.operationKind,
          identity: guarded.identity,
          tenantRootIdentityDigest: state.identityDigestB64u,
          custodyLineageId: state.custodyLineageB64u,
          expectedLifecycleRevision: state.lifecycleRevision,
          recoveryGovernanceDigest: governanceDigestB64u,
          subject: input.subject,
          ...(input.role === undefined ? {} : { role: input.role }),
          requesterActorId: guarded.actorUserId,
          idempotencyKey: input.idempotencyKey,
          issuedAt: new Date(issuedAtMs).toISOString(),
          expiresAt: new Date(
            issuedAtMs + tenantRootOperationMaxLifetimeMsV1(input.operationKind),
          ).toISOString(),
          expectedRootCommitment: state.rootCommitmentB64u,
        }),
    });
    if (!resolved.ok) {
      await record(baseEvent(state, guarded, input.auditAction, 'failure', resolved.error.kind));
      return tenantRootSecurityJson(
        { ok: false, code: resolved.error.kind, error: resolved.error },
        resolved.error.kind === 'invalid_operation_record' ? 400 : 409,
      );
    }

    const started = await startTenantRootOperationV1(dependencies.operations, {
      record: resolved.record,
      triggerKind: 'manual',
      operationDigestB64u: resolved.operationDigestB64u,
      governance: state.governance,
      governanceDigestB64u,
      ...(input.targetGovernance === undefined ? {} : { targetGovernance: input.targetGovernance }),
      requesterStepUp: tenantRootStepUpRecordFromProofV1(input.stepUp),
      requesterSessionId: guarded.sessionId,
      approverIsOwner: (userId) =>
        dependencies.membership.isOrganizationOwner({ orgId: guarded.orgId, userId }),
      ...(input.payloadJson === undefined ? {} : { payloadJson: input.payloadJson }),
      operationId: newOperationId(),
      nonceB64u: newNonceB64u(),
      nowMs: guarded.nowMs,
    });
    const authorization = (approverUserId: string | null): OperationAuthorization => ({
      stepUp: input.stepUp,
      approverUserId,
      operationKind: input.operationKind,
      operationDigestB64u: resolved.operationDigestB64u,
    });

    if (!started.ok) {
      if (started.error.kind === 'approval_pending') {
        await record(
          withAuthorization(
            baseEvent(state, guarded, input.auditAction, 'failure', 'approval_pending'),
            authorization(null),
          ),
        );
        return tenantRootSecurityJson(
          {
            ok: false,
            code: 'approval_required',
            operationDigestB64u: started.error.operationDigestB64u,
            expiresAt: new Date(started.error.expiresAtMs).toISOString(),
          },
          202,
        );
      }
      const failureCode =
        started.error.kind === 'authorization_failed'
          ? started.error.error.kind
          : started.error.kind;
      await record(
        withAuthorization(
          baseEvent(state, guarded, 'approval_capability_rejected', 'failure', failureCode),
          authorization(null),
        ),
      );
      return tenantRootSecurityJson(
        { ok: false, code: started.error.kind, error: started.error },
        started.error.kind === 'authorization_failed' ? 403 : 409,
      );
    }

    const entry = started.entry;
    if (started.replayed && entry.status !== 'pending') {
      await record(
        withAuthorization(
          baseEvent(state, guarded, 'approval_capability_replayed', 'success', null),
          authorization(entry.approverUserId),
        ),
      );
      if (entry.status === 'accepted') {
        return tenantRootSecurityJson({
          ok: true,
          replayed: true,
          operationId: entry.operationId,
          result: JSON.parse(entry.acceptedResultJson ?? 'null') as unknown,
        });
      }
      return tenantRootSecurityJson(
        {
          ok: false,
          code: entry.status,
          replayed: true,
          operationId: entry.operationId,
          failureCode: entry.failureCode,
        },
        409,
      );
    }
    if (entry.approverUserId !== null && !started.replayed) {
      await record(
        withAuthorization(
          baseEvent(state, guarded, 'approval_capability_consumed', 'success', null),
          authorization(entry.approverUserId),
        ),
      );
    }

    const outcome = await input.execute();
    await record(withAuthorization(outcome.audit, authorization(entry.approverUserId)));
    if (!outcome.ok) {
      const failureCode = tenantRootCustodyFailureCodeV1(outcome.error);
      await dependencies.operations.markFailed(entry.operationId, failureCode);
      return tenantRootSecurityJson(
        { ok: false, code: failureCode, operationId: entry.operationId, error: outcome.error },
        409,
      );
    }
    const accepted = await dependencies.operations.markAccepted(
      entry.operationId,
      JSON.stringify(outcome.value),
    );
    return tenantRootSecurityJson({
      ok: true,
      replayed: false,
      operationId: accepted.operationId,
      result: outcome.value,
    });
  }

  return async (request, authorized) => {
    const url = new URL(request.url);
    if (!isTenantRootCustodyPathV1(url.pathname)) return null;
    const { actorUserId, nowMs, stepUp } = authorized;
    const atIso = new Date(nowMs).toISOString();

    try {
      const state = await dependencies.custody.readState();

      // Reads and the CLI's durability report need no step-up.
      if (url.pathname === TENANT_ROOT_MANIFEST_PATH_V1 && request.method === 'GET') {
        const outcome = await serveRecoveryArtifactV1(
          dependencies.custody,
          dependencies.controlPlane,
          { artifact: 'manifest', actorUserId, atIso },
        );
        await record(outcome.audit);
        return outcome.ok
          ? tenantRootSecurityJson({
              ok: true,
              artifactB64u: outcome.value.artifactB64u,
              contentDigestB64u: outcome.value.contentDigestB64u,
              recoverySetId: outcome.value.recoverySetId,
            })
          : custodyFailureResponse(outcome.error);
      }
      if (url.pathname === TENANT_ROOT_OPERATIONS_PENDING_PATH_V1 && request.method === 'GET') {
        const pending = await dependencies.operations.listApprovalRequests();
        return tenantRootSecurityJson({
          ok: true,
          pending: pending
            .filter((entry) => entry.expiresAtMs > nowMs)
            .map((entry) => ({
              operationDigestB64u: entry.operationDigestB64u,
              operationKind: entry.operationKind,
              payloadJson: entry.payloadJson,
              requesterUserId: entry.requesterUserId,
              expiresAt: new Date(entry.expiresAtMs).toISOString(),
            })),
        });
      }
      if (url.pathname === TENANT_ROOT_DURABLE_VERIFICATION_PATH_V1) {
        const body = await readObject(request);
        const outcome = await recordDurableVerificationV1(dependencies.custody, {
          artifact: parseArtifact(body.artifact),
          contentDigestB64u: requiredText(body.contentDigestB64u, 'contentDigestB64u'),
          trustLevel: parseTrustLevel(body.trustLevel),
          actorUserId,
          atIso,
        });
        await record(outcome.audit);
        return outcome.ok
          ? tenantRootSecurityJson({ ok: true, evidence: outcome.value })
          : custodyFailureResponse(outcome.error);
      }

      if (stepUp === null) {
        // The route table marks every remaining path as a mutation; the guard
        // refuses those without step-up, so this is unreachable by policy.
        return tenantRootSecurityJson(
          { ok: false, code: 'step_up_required', message: 'Step-up is required' },
          403,
        );
      }

      switch (url.pathname) {
        case TENANT_ROOT_OPERATION_APPROVE_PATH_V1: {
          const body = await readObject(request);
          const operationDigestB64u = requiredText(body.operationDigestB64u, 'operationDigestB64u');
          const approved = await approveTenantRootOperationV1(dependencies.operations, {
            operationDigestB64u,
            approver: stepUp,
            nowMs,
          });
          await record({
            ...baseEvent(
              state,
              authorized,
              approved.ok ? 'approval_capability_issued' : 'approval_capability_rejected',
              approved.ok ? 'success' : 'failure',
              approved.ok ? null : approved.error.kind,
            ),
            authorization: {
              stepUpMethod: stepUp.method,
              approverUserId: approved.ok ? actorUserId : null,
              operationKind: approved.ok ? approved.request.operationKind : null,
              operationDigestB64u,
            },
          });
          return approved.ok
            ? tenantRootSecurityJson({
                ok: true,
                operationDigestB64u,
                operationKind: approved.request.operationKind,
                payloadJson: approved.request.payloadJson,
              })
            : tenantRootSecurityJson({ ok: false, error: approved.error }, 409);
        }
        case TENANT_ROOT_GOVERNANCE_PATH_V1: {
          const body = await readObject(request);
          const choice = parseGovernanceChoice(body);
          const target = buildTenantRootRecoveryGovernanceV1({ choice, actorUserId, atIso });
          if (!target.ok) {
            await record(
              baseEvent(
                state,
                authorized,
                state.governance === null
                  ? 'recovery_governance_selected'
                  : 'recovery_governance_changed',
                'failure',
                target.error.kind,
              ),
            );
            return tenantRootSecurityJson(
              { ok: false, error: { kind: 'governance', error: target.error } },
              409,
            );
          }
          return await runOperation({
            guarded: authorized,
            stepUp,
            state,
            operationKind: 'tenant_root_recovery_governance_change_v1',
            subject: { kind: 'tenant_root' },
            targetGovernance: target.governance,
            // The target branch is bound into the approval request so the
            // second owner approves this exact change, not "a change".
            payloadJson: JSON.stringify({ targetGovernanceKind: choice.kind }),
            idempotencyKey: requiredText(body.idempotencyKey, 'idempotencyKey'),
            auditAction:
              state.governance === null
                ? 'recovery_governance_selected'
                : 'recovery_governance_changed',
            execute: () =>
              setRecoveryGovernanceV1(dependencies.custody, {
                target: target.governance,
                actorUserId,
                atIso,
              }),
          });
        }
        case TENANT_ROOT_RECIPIENT_CHALLENGE_PATH_V1: {
          const body = await readObject(request);
          const outcome = await startRecipientChallengeV1(
            dependencies.custody,
            dependencies.controlPlane,
            {
              role: parseRole(body.role),
              recipientPublicKeyB64u: requiredText(
                body.recipientPublicKeyB64u,
                'recipientPublicKeyB64u',
              ),
              actorUserId,
              atIso,
              nowMs,
            },
          );
          await record(outcome.audit);
          return outcome.ok
            ? tenantRootSecurityJson({
                ok: true,
                challengeIdB64u: outcome.value.challengeIdB64u,
                envelopeB64u: outcome.value.envelopeB64u,
              })
            : custodyFailureResponse(outcome.error);
        }
        case TENANT_ROOT_RECIPIENT_CONFIRM_PATH_V1: {
          const body = await readObject(request);
          const outcome = await confirmRecipientV1(
            dependencies.custody,
            dependencies.controlPlane,
            {
              challengeIdB64u: requiredText(body.challengeIdB64u, 'challengeIdB64u'),
              confirmationB64u: requiredText(body.confirmationB64u, 'confirmationB64u'),
              role: parseRole(body.role),
              actorUserId,
              atIso,
              nowMs,
            },
          );
          await record(outcome.audit);
          return outcome.ok
            ? tenantRootSecurityJson({ ok: true, recipient: outcome.value })
            : custodyFailureResponse(outcome.error);
        }
        case TENANT_ROOT_RECIPIENT_COMMIT_PATH_V1: {
          const body = await readObject(request);
          // The pair digest is computed from the staged recipients before the
          // operation is authorized, so an approver approves this exact pair.
          const staged = commitTenantRootRecipientPairV1({
            staged: state.stagedRecipients,
            previousPair:
              tenantRootDownloadableRecoverySetV1(state.backup)?.recipientPair ??
              state.recipientPair,
          });
          if (!staged.ok) {
            // Nothing to authorize yet; the refusal is still audited.
            const outcome = await commitRecipientPairV1(dependencies.custody, {
              actorUserId,
              atIso,
            });
            await record(outcome.audit);
            return tenantRootSecurityJson(
              { ok: false, error: { kind: 'recipient', error: staged.error } },
              409,
            );
          }
          const recipientPairDigest = await tenantRootRecipientPairDigestB64uV1({
            deriverAFingerprintB64u: staged.value.deriverA.recipientFingerprintB64u,
            deriverBFingerprintB64u: staged.value.deriverB.recipientFingerprintB64u,
          });
          return await runOperation({
            guarded: authorized,
            stepUp,
            state,
            operationKind:
              state.recipientPair === null
                ? 'tenant_root_recovery_recipient_pair_enroll_v1'
                : 'tenant_root_recovery_recipient_pair_replace_v1',
            subject: { kind: 'recipient_pair', recipientPairDigest },
            idempotencyKey: requiredText(body.idempotencyKey, 'idempotencyKey'),
            auditAction: 'recovery_recipient_pair_committed',
            execute: () => commitRecipientPairV1(dependencies.custody, { actorUserId, atIso }),
          });
        }
        case TENANT_ROOT_BACKUP_PATH_V1: {
          const body = await readObject(request);
          const activeSetId =
            tenantRootDownloadableRecoverySetV1(state.backup)?.recoverySetId ?? null;
          const pendingRecoverySetId =
            state.backup.status === 'preparing_initial' || state.backup.status === 'replacing'
              ? state.backup.pendingRecoverySetId
              : newRecoverySetId();
          return await runOperation({
            guarded: authorized,
            stepUp,
            state,
            operationKind:
              activeSetId === null
                ? 'tenant_root_recovery_backup_create_v1'
                : 'tenant_root_recovery_backup_replace_v1',
            subject:
              activeSetId === null
                ? { kind: 'tenant_root' }
                : { kind: 'recovery_set', recoverySetId: activeSetId },
            idempotencyKey: requiredText(body.idempotencyKey, 'idempotencyKey'),
            auditAction:
              activeSetId === null ? 'recovery_backup_created' : 'recovery_backup_replaced',
            execute: () =>
              createRecoveryBackupV1(dependencies.custody, dependencies.controlPlane, {
                pendingRecoverySetId,
                actorUserId,
                atIso,
              }),
          });
        }
        case TENANT_ROOT_ROLE_PACKAGE_PATH_V1: {
          const body = await readObject(request);
          const role = parseRole(body.role);
          const outcome = await serveRecoveryArtifactV1(
            dependencies.custody,
            dependencies.controlPlane,
            {
              artifact: role === 'deriver_a' ? 'deriver_a_package' : 'deriver_b_package',
              actorUserId,
              atIso,
            },
          );
          await record({
            ...outcome.audit,
            authorization: { ...outcome.audit.authorization, stepUpMethod: stepUp.method },
          });
          return outcome.ok
            ? tenantRootSecurityJson({
                ok: true,
                artifactB64u: outcome.value.artifactB64u,
                contentDigestB64u: outcome.value.contentDigestB64u,
                recoverySetId: outcome.value.recoverySetId,
              })
            : custodyFailureResponse(outcome.error);
        }
        case TENANT_ROOT_SOURCE_RETIRE_PATH_V1: {
          const body = await readObject(request);
          const destinationActivationReceiptDigestB64u = requiredText(
            body.destinationActivationReceiptDigestB64u,
            'destinationActivationReceiptDigestB64u',
          );
          return await runOperation({
            guarded: authorized,
            stepUp,
            state,
            operationKind: 'tenant_root_source_lineage_retire_v1',
            subject: { kind: 'tenant_root' },
            payloadJson: JSON.stringify({ destinationActivationReceiptDigestB64u }),
            idempotencyKey: requiredText(body.idempotencyKey, 'idempotencyKey'),
            auditAction: 'source_custody_disposition_recorded',
            execute: () =>
              retireSourceLineageOperationV1(dependencies.custody, dependencies.controlPlane, {
                destinationActivationReceiptDigestB64u,
                actorUserId,
                atIso,
              }),
          });
        }
        default:
          return tenantRootSecurityJson(
            { ok: false, code: 'not_found', message: 'Unknown custody operation' },
            404,
          );
      }
    } catch (error: unknown) {
      if (error instanceof RecoveryBackupCooldownError) {
        return Response.json(
          { ok: false, code: 'recovery_backup_cooldown', message: error.message },
          { status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds) } },
        );
      }
      return tenantRootSecurityJson(
        {
          ok: false,
          code: 'tenant_root_custody_operation_failed',
          message: error instanceof Error ? error.message : 'Custody operation failed',
        },
        400,
      );
    }
  };
}
