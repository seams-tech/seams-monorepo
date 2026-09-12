import { parseTenantRootOperationRecordV1 } from '../../packages/shared-ts/src/tenant-root';
import { expect, test } from '@playwright/test';
import type {
  TenantRootOutstandingCleanupV1,
  TenantRootRestoreCleanupEvidenceV1,
  TenantRootRestoreRoleCleanupV1,
  TenantRootRestoreSessionV1,
  TenantRootTrustLevelV1,
} from '../../packages/shared-ts/src/tenant-root';
import {
  buildTenantRootIdentityFromAuthenticatedDeploymentV1,
  tenantRootOperationDigestB64uV1,
} from '../../packages/shared-ts/src/tenant-root';
import { checkTenantRootAuditEventRedactionV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/audit';
import {
  activateRestoredRootV1,
  admitRestoreTrustV1,
  authenticateRestoreSessionV1,
  defaultSourceCustodyDispositionV1,
  importRestoreRoleShareV1,
  issueRestoreRoleImportKeyV1,
  mintRestoreBootstrapSessionV1,
  registerRestoreManifestV1,
  startRestoreSessionV1,
  TENANT_ROOT_RESTORE_SESSION_MS_V1,
  type TenantRootRestoreBootstrapSessionV1,
  type TenantRootRestoreContextV1,
  type TenantRootRestoreControlPlaneV1,
  type TenantRootRestoreExpiredSessionFinalizationInputV1,
  type TenantRootRestoreExpiredSessionFinalizationV1,
  type TenantRootRestoreInstalledImportV1,
  type TenantRootRestoreRegisteredManifestBundleV1,
  type TenantRootRestoreRegisteredManifestV1,
  type TenantRootRestoreRoleImportKeyV1,
  type TenantRootRestoreRoleImportKeyIssueAdmissionInputV1,
  type TenantRootRestoreRoleImportKeyIssueAdmissionV1,
  type TenantRootRestoreRoleImportKeyIssueResponseV1,
  type TenantRootRestoreRefreshGrantAdmissionV1,
  type TenantRootRestoreRefreshGrantScopeV1,
  type TenantRootRestoreSessionStartAdmissionInputV1,
  type TenantRootRestoreSessionStartAdmissionV1,
  type TenantRootRestoreStoreV1,
  type TenantRootRestoreRoleImportOperationStoreV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreService';
import type { SignedTenantRootRestoreRefreshGrantV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreRefreshGrantSigner';
import { TENANT_ROOT_RESTORE_ROLE_IMPORT_MAX_LIFETIME_MS_V1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreGrantSigner';
import type { TenantRootOperationEntryV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/service';

const NOW_MS = Date.parse('2026-09-05T12:00:00.000Z');
const AT_ISO = '2026-09-05T12:00:00.000Z';
const ACTOR = 'destination-operator';
const IDENTITY_DIGEST = '3FXFLfRtMWXk2dQjKkrEnNV9AnRg2zQwul3Z6TegCtU';
const DESTINATION_FINGERPRINT = 'ISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A';
const DESTINATION_LINEAGE = 'ERITFBUWFxgZGhscHR4fIA';
const SOURCE_CUSTODY_LINEAGE = 'AQIDBAUGBwgJCgsMDQ4PEA';
const RECOVERY_SET_ID = 'ERITFBUWFxgZGhscHR4fIA';
const RESTORE_SESSION_ID = 'AQIDBAUGBwgJCgsMDQ4PEA';
const STABLE_ROOT_COMMITMENT = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
const DERIVER_A_PUBLIC_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
const DERIVER_A_FINGERPRINT = 'riFsLvUkejeCwTXvonmj5M3GEJQnD10r5YxiBLemEsk';
const DERIVER_B_PUBLIC_KEY = 'ISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A';
const DERIVER_B_FINGERPRINT = 'fu5YAN3NOzzJ_QR4Mc2FNuPD9X9E10b1FdqT8EjunpE';
const RECOVERY_SHARE_COMMITMENT_A = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIg';
const RECOVERY_SHARE_COMMITMENT_B = 'IyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9AQUJDRA';
const PACKAGE_DIGEST_A = 'AgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICE';
const PACKAGE_DIGEST_B = 'AwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISI';
const MANIFEST_DIGEST = 'riFsLvUkejeCwTXvonmj5M3GEJQnD10r5YxiBLemEsk';
const ARTIFACT_CREATED = '2026-08-29T10:20:30.123Z';

const OFFLINE: TenantRootTrustLevelV1 = { kind: 'cryptographically_valid_offline' };
const CURRENT: TenantRootTrustLevelV1 = {
  kind: 'current_trust_confirmed',
  snapshotVersion: 1,
  snapshotIssuedAt: '2026-09-05T11:55:00.000Z',
  checkedAt: '2026-09-05T11:59:00.000Z',
};

function incompleteRoleCleanup(): TenantRootRestoreRoleCleanupV1 {
  const outstanding: TenantRootOutstandingCleanupV1 = {
    roles: ['deriver_a', 'deriver_b'],
    description: 'imported shares and role import keys',
  };
  return { kind: 'both_roles_incomplete', outstanding };
}

function incompleteCleanupEvidence(): TenantRootRestoreCleanupEvidenceV1 {
  return {
    bootstrap: {
      kind: 'outstanding',
      outstanding: {
        roles: ['deriver_a', 'deriver_b'],
        description: 'imported shares and role import keys',
      },
    },
    roles: incompleteRoleCleanup(),
  };
}

class MemoryRestoreStore
  implements TenantRootRestoreStoreV1, TenantRootRestoreRoleImportOperationStoreV1
{
  session: TenantRootRestoreSessionV1 | null = null;
  destinationEmpty = true;
  manifest: TenantRootRestoreRegisteredManifestV1 | null = null;
  manifestB64u: string | null = null;
  keys: {
    deriver_a: TenantRootRestoreRoleImportKeyV1 | null;
    deriver_b: TenantRootRestoreRoleImportKeyV1 | null;
  } = { deriver_a: null, deriver_b: null };
  installed: TenantRootRestoreInstalledImportV1[] = [];
  refreshGrant: SignedTenantRootRestoreRefreshGrantV1 | null = null;
  readonly bootstrapSessions = new Map<string, TenantRootRestoreBootstrapSessionV1>();
  readonly operations = new Map<string, TenantRootOperationEntryV1>();
  clears = 0;

  async readContext(): Promise<TenantRootRestoreContextV1> {
    return {
      orgId: 'org-1',
      identityDigestB64u: IDENTITY_DIGEST,
      destination: this.destinationEmpty
        ? { kind: 'empty', deploymentFingerprintB64u: DESTINATION_FINGERPRINT }
        : { kind: 'active_root_present' },
      destinationLineageB64u: DESTINATION_LINEAGE,
      session: this.session,
      registeredManifest:
        this.manifest === null || this.manifestB64u === null
          ? null
          : { descriptor: this.manifest, manifestB64u: this.manifestB64u },
      importKeys: { ...this.keys },
      installedImports: [...this.installed],
    };
  }
  async admitSessionStart(
    input: TenantRootRestoreSessionStartAdmissionInputV1,
  ): Promise<TenantRootRestoreSessionStartAdmissionV1> {
    const authenticated = this.bootstrapSessions.get(input.authenticatedSession.tokenDigestB64u);
    if (
      authenticated === undefined ||
      authenticated.actorUserId !== input.authenticatedSession.actorUserId ||
      authenticated.authenticatedAtMs !== input.authenticatedSession.authenticatedAtMs ||
      authenticated.expiresAtMs !== input.authenticatedSession.expiresAtMs ||
      authenticated.authenticatedAtMs > input.nowMs ||
      authenticated.expiresAtMs <= input.nowMs
    ) {
      return { kind: 'bootstrap_authentication_failed' };
    }
    if (this.session === null) {
      if (input.expectedSessionId !== null) return { kind: 'session_start_conflict' };
      await this.clearSessionMaterial();
      this.session = input.session;
      return { kind: 'started' };
    }
    if (this.session.status === 'cleanup_incomplete') {
      return { kind: 'cleanup_incomplete' };
    }
    if (this.session.status === 'expired' || this.session.status === 'failed_before_activation') {
      if (this.session.sessionId !== input.expectedSessionId) {
        return { kind: 'session_start_conflict' };
      }
      await this.clearSessionMaterial();
      this.session = input.session;
      return { kind: 'started' };
    }
    return JSON.stringify(this.session) === JSON.stringify(input.session)
      ? { kind: 'replayed' }
      : { kind: 'session_in_progress' };
  }
  async finalizeExpiredSession(
    input: TenantRootRestoreExpiredSessionFinalizationInputV1,
  ): Promise<TenantRootRestoreExpiredSessionFinalizationV1> {
    if (
      this.session === null ||
      this.session.sessionId !== input.expectedSessionId ||
      !(
        this.session.status === 'awaiting_manifest' ||
        this.session.status === 'awaiting_role_imports' ||
        this.session.status === 'verifying' ||
        this.session.status === 'ready_to_activate' ||
        this.session.status === 'refreshing' ||
        (this.session.status === 'cleanup_incomplete' && this.session.phase === 'pre_activation')
      ) ||
      Date.parse(this.session.expiresAt) > input.nowMs
    ) {
      return { kind: 'stale' };
    }
    this.session = input.endedSession;
    await this.clearSessionMaterial();
    return { kind: 'finalized' };
  }
  async putSession(session: TenantRootRestoreSessionV1): Promise<void> {
    this.session = session;
  }
  async admitRestoreRefreshGrant(input: {
    readonly expectedSessionId: string;
    readonly grant: SignedTenantRootRestoreRefreshGrantV1;
    readonly nowMs: number;
  }): Promise<TenantRootRestoreRefreshGrantAdmissionV1> {
    if (this.refreshGrant !== null) return { kind: 'replayed', grant: this.refreshGrant };
    if (
      this.session === null ||
      this.session.sessionId !== input.expectedSessionId ||
      (this.session.status !== 'verifying' && this.session.status !== 'ready_to_activate')
    ) {
      return { kind: 'session_not_ready' };
    }
    if (input.nowMs < input.grant.issuedAtMs || input.nowMs >= input.grant.expiresAtMs) {
      return { kind: 'expired' };
    }
    this.refreshGrant = input.grant;
    this.session = { ...this.session, status: 'refreshing' };
    return { kind: 'admitted', grant: input.grant };
  }
  async readRestoreRefreshGrant(
    sessionId: string,
  ): Promise<SignedTenantRootRestoreRefreshGrantV1 | null> {
    return this.refreshGrant?.restoreSessionIdB64u === sessionId ? this.refreshGrant : null;
  }
  async putRegisteredManifest(
    manifest: TenantRootRestoreRegisteredManifestV1,
    manifestB64u: string,
  ): Promise<void> {
    this.manifest = manifest;
    this.manifestB64u = manifestB64u;
  }
  async putRoleImportKey(key: TenantRootRestoreRoleImportKeyV1): Promise<void> {
    this.keys[key.role] = key;
  }
  async putInstalledImport(installed: TenantRootRestoreInstalledImportV1): Promise<void> {
    this.installed = [
      ...this.installed.filter((entry) => entry.role !== installed.role),
      installed,
    ];
  }
  async clearSessionMaterial(): Promise<void> {
    this.clears += 1;
    this.manifest = null;
    this.manifestB64u = null;
    this.refreshGrant = null;
    this.keys = { deriver_a: null, deriver_b: null };
    this.installed = [];
  }
  async putBootstrapSession(session: TenantRootRestoreBootstrapSessionV1): Promise<void> {
    this.bootstrapSessions.set(session.tokenDigestB64u, session);
  }
  async findBootstrapSession(digest: string): Promise<TenantRootRestoreBootstrapSessionV1 | null> {
    return this.bootstrapSessions.get(digest) ?? null;
  }

  async findRestoreRoleImportOperationForKey(
    role: 'deriver_a' | 'deriver_b',
    importKeyId: string,
  ): Promise<TenantRootOperationEntryV1 | null> {
    for (const entry of this.operations.values()) {
      const record = parseTenantRootOperationRecordV1(entry.canonicalRecordJson);
      if (
        entry.status === 'accepted' &&
        record?.operationKind === 'tenant_root_restore_role_import_key_issue_v1' &&
        record.role === role &&
        record.importKeyId === importKeyId
      )
        return entry;
    }
    return null;
  }
  async finalizeRoleImport(
    input: Parameters<TenantRootRestoreStoreV1['finalizeRoleImport']>[0],
  ): ReturnType<TenantRootRestoreStoreV1['finalizeRoleImport']> {
    const session = this.session;
    if (
      session === null ||
      session.sessionId !== input.sessionId ||
      session.status !== 'awaiting_role_imports' ||
      this.keys[input.installed.role]?.importKeyId !== input.key.importKeyId
    )
      return { kind: 'stale' };
    for (const installed of this.installed) {
      if (
        installed.role === input.installed.role &&
        installed.envelopeDigestB64u !== input.installed.envelopeDigestB64u
      )
        return { kind: 'stale' };
    }
    await this.putInstalledImport(input.installed);
    let receiptA: string | null = null;
    let receiptB: string | null = null;
    for (const installed of this.installed) {
      if (installed.role === 'deriver_a') receiptA = installed.receiptDigestB64u;
      else receiptB = installed.receiptDigestB64u;
    }
    if (receiptA !== null && receiptB !== null) {
      this.session = {
        status: 'verifying',
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        destinationFingerprintB64u: session.destinationFingerprintB64u,
        recoverySetId: session.recoverySetId,
        installationReceipts: { deriverA: receiptA, deriverB: receiptB },
      };
    } else {
      this.session = {
        status: 'awaiting_role_imports',
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        destinationFingerprintB64u: session.destinationFingerprintB64u,
        recoverySetId: session.recoverySetId,
        installed:
          input.installed.role === 'deriver_a'
            ? {
                kind: 'deriver_a_installed',
                deriverAReceiptDigestB64u: input.installed.receiptDigestB64u,
              }
            : {
                kind: 'deriver_b_installed',
                deriverBReceiptDigestB64u: input.installed.receiptDigestB64u,
              },
      };
    }
    return { kind: 'finalized', session: this.session };
  }
  async findRestoreRoleImportOperation(
    operationId: string,
  ): Promise<TenantRootOperationEntryV1 | null> {
    for (const entry of this.operations.values()) {
      if (entry.idempotencyKey === operationId) return entry;
    }
    return null;
  }

  async admitRestoreRoleImportOperation(
    input: TenantRootRestoreRoleImportKeyIssueAdmissionInputV1,
  ): Promise<TenantRootRestoreRoleImportKeyIssueAdmissionV1> {
    const existing = await this.findRestoreRoleImportOperation(
      input.operationRecord.idempotencyKey,
    );
    if (existing !== null) {
      return existing.operationDigestB64u === input.operationDigestB64u
        ? { kind: 'replayed', entry: existing }
        : { kind: 'idempotency_conflict' };
    }
    if (!this.destinationEmpty) return { kind: 'destination_not_empty' };
    if (!(await this.findBootstrapSession(input.authenticatedSession.tokenDigestB64u))) {
      return { kind: 'bootstrap_authentication_failed' };
    }
    if (this.session?.status !== 'awaiting_role_imports') return { kind: 'session_not_started' };
    if (
      this.manifest === null ||
      this.manifest.manifestDigestB64u !== input.operationRecord.manifestDigestB64u
    ) {
      return { kind: 'manifest_not_registered' };
    }
    if (this.installed.some((entry) => entry.role === input.operationRecord.role)) {
      return { kind: 'role_share_already_installed' };
    }
    for (const pending of this.operations.values()) {
      if (
        pending.status === 'pending' &&
        pending.idempotencyKey !== input.operationRecord.idempotencyKey &&
        pending.canonicalRecordJson.includes(`"role":"${input.operationRecord.role}"`)
      ) {
        return { kind: 'role_operation_pending' };
      }
    }
    const entry: TenantRootOperationEntryV1 = {
      operationId: input.operationDigestB64u,
      operationKind: input.operationRecord.operationKind,
      triggerKind: 'manual',
      operationDigestB64u: input.operationDigestB64u,
      canonicalRecordJson: input.canonicalRecordJson,
      idempotencyKey: input.operationRecord.idempotencyKey,
      requesterUserId: input.operationRecord.requesterActorId,
      approverUserId: null,
      nonceB64u: input.operationRecord.nonceB64u,
      status: 'pending',
      createdAtMs: Date.parse(input.operationRecord.issuedAt),
      authorizationExpiresAtMs: Date.parse(input.operationRecord.expiresAt),
      acceptedResultJson: null,
      failureCode: null,
      dispatchUncertainAtMs: null,
    };
    this.operations.set(entry.operationId, entry);
    return { kind: 'admitted', entry };
  }

  async markRestoreRoleImportDispatchUncertain(
    operationId: string,
    atMs: number,
  ): Promise<TenantRootOperationEntryV1> {
    const entry = this.operations.get(operationId);
    if (entry === undefined) throw new Error('operation missing');
    const updated = { ...entry, dispatchUncertainAtMs: atMs };
    this.operations.set(operationId, updated);
    return updated;
  }

  async finalizeRestoreRoleImportOperation(input: {
    readonly entry: TenantRootOperationEntryV1;
    readonly response: TenantRootRestoreRoleImportKeyIssueResponseV1;
    readonly key: TenantRootRestoreRoleImportKeyV1;
  }): Promise<TenantRootOperationEntryV1> {
    const entry = this.operations.get(input.entry.operationId);
    if (entry === undefined) throw new Error('operation missing');
    const updated: TenantRootOperationEntryV1 = {
      ...entry,
      status: 'accepted',
      acceptedResultJson: JSON.stringify(input.response),
      dispatchUncertainAtMs: entry.dispatchUncertainAtMs,
    };
    this.operations.set(entry.operationId, updated);
    await this.putRoleImportKey(input.key);
    return updated;
  }

  async failRestoreRoleImportOperation(
    operationId: string,
    failureCode: string,
  ): Promise<TenantRootOperationEntryV1> {
    const entry = this.operations.get(operationId);
    if (entry === undefined) throw new Error('operation missing');
    const updated: TenantRootOperationEntryV1 = {
      ...entry,
      status: 'failed',
      failureCode,
      acceptedResultJson: null,
    };
    this.operations.set(operationId, updated);
    return updated;
  }
}

function controlPlane(
  options: {
    identityDigestB64u?: string;
    trustLevel?: TenantRootTrustLevelV1;
    rootCommitmentMatches?: boolean;
    cleanup?: TenantRootRestoreCleanupEvidenceV1;
    cleanupRetry?: TenantRootRestoreCleanupEvidenceV1;
    cleanupSessionResult?: TenantRootRestoreRoleCleanupV1 | null;
    lineageId?: string;
    forwardRefreshReceipt?: string;
    canaryReceipt?: string;
    issueRoleImportKeyFailures?: number;
    issueRestoreRefreshGrantFailures?: number;
    activateFailures?: number;
  } = {},
): TenantRootRestoreControlPlaneV1 & {
  readonly calls: string[];
  readonly refreshGrants: SignedTenantRootRestoreRefreshGrantV1[];
} {
  const calls: string[] = [];
  let issueRoleImportKeyFailures = options.issueRoleImportKeyFailures ?? 0;
  let issueRestoreRefreshGrantFailures = options.issueRestoreRefreshGrantFailures ?? 0;
  let activateFailures = options.activateFailures ?? 0;
  const refreshGrants: SignedTenantRootRestoreRefreshGrantV1[] = [];
  const completeCleanup: TenantRootRestoreCleanupEvidenceV1 = {
    bootstrap: { kind: 'destroyed', receiptDigestB64u: 'bootstrap-destruction-receipt' },
    roles: {
      kind: 'complete',
      receipts: { deriverA: 'clean-a', deriverB: 'clean-b' },
    },
  };
  const configuredCleanup = options.cleanup ?? completeCleanup;
  const cleanupSessionResult =
    options.cleanupSessionResult === undefined
      ? completeCleanup.roles
      : options.cleanupSessionResult;
  return {
    calls,
    refreshGrants,
    registerManifest: async () => ({
      identityDigestB64u: options.identityDigestB64u ?? IDENTITY_DIGEST,
      sourceCustodyLineageB64u: SOURCE_CUSTODY_LINEAGE,
      recoverySetId: RECOVERY_SET_ID,
      stableRootCommitmentB64u: STABLE_ROOT_COMMITMENT,
      deriverA: {
        shareId: 1,
        recipientPublicKeyB64u: DERIVER_A_PUBLIC_KEY,
        recipientFingerprintB64u: DERIVER_A_FINGERPRINT,
        recoveryShareCommitmentB64u: RECOVERY_SHARE_COMMITMENT_A,
        deriverSigningKeyId: 'deriver-a-signing-key',
      },
      deriverB: {
        shareId: 2,
        recipientPublicKeyB64u: DERIVER_B_PUBLIC_KEY,
        recipientFingerprintB64u: DERIVER_B_FINGERPRINT,
        recoveryShareCommitmentB64u: RECOVERY_SHARE_COMMITMENT_B,
        deriverSigningKeyId: 'deriver-b-signing-key',
      },
      deriverAPackageLength: 128,
      deriverAPackageDigestB64u: PACKAGE_DIGEST_A,
      deriverBPackageLength: 128,
      deriverBPackageDigestB64u: PACKAGE_DIGEST_B,
      manifestDigestB64u: MANIFEST_DIGEST,
      artifactCreatedAtIso: ARTIFACT_CREATED,
      trustLevel: options.trustLevel ?? OFFLINE,
    }),
    issueRoleImportKey: async (input) => {
      calls.push(`key:${input.operationRecord.role}:${input.operationRecord.generation}`);
      if (issueRoleImportKeyFailures > 0) {
        issueRoleImportKeyFailures -= 1;
        throw new Error('simulated lost response');
      }
      const operationDigestB64u = await tenantRootOperationDigestB64uV1(input.operationRecord);
      return {
        role: input.operationRecord.role,
        importKeyId: input.operationRecord.importKeyId,
        importPublicKeyB64u: PACKAGE_DIGEST_A,
        generation: input.operationRecord.generation,
        issuedAtMs: Date.parse(input.operationRecord.issuedAt),
        expiresAtMs: Date.parse(input.operationRecord.issuedAt) + 900_000,
        operationDigestB64u,
        commandDigestB64u: PACKAGE_DIGEST_B,
      };
    },
    acceptRoleImport: async (input) => {
      calls.push(`import:${input.operationRecord.role}:${input.operationRecord.importKeyId}`);
      return { receiptDigestB64u: `receipt-${input.operationRecord.role}` };
    },
    issueRestoreRefreshGrant: async (
      input: TenantRootRestoreRefreshGrantScopeV1,
    ): Promise<SignedTenantRootRestoreRefreshGrantV1> => {
      calls.push('refresh-grant');
      if (issueRestoreRefreshGrantFailures > 0) {
        issueRestoreRefreshGrantFailures -= 1;
        throw new Error('simulated refresh grant signing failure');
      }
      const grant = {
        ...input,
        grantKeyId: 'restore-refresh-test',
        grantB64u: 'AQ',
        grantDigestB64u: 'Ag',
      };
      refreshGrants.push(grant);
      return grant;
    },
    activate: async () => {
      calls.push('activate');
      if (activateFailures > 0) {
        activateFailures -= 1;
        throw new Error('simulated lost activation response');
      }
      return {
        destinationLineageId: options.lineageId ?? 'destination-lineage-1',
        activatedEpoch: 1,
        activationReceiptB64u: 'canonical-activation-receipt',
        activationReceiptDigestB64u: 'activation-receipt',
        forwardRefreshReceiptDigestB64u: options.forwardRefreshReceipt ?? 'forward-refresh-receipt',
        continuityCanaryReceiptDigestB64u: options.canaryReceipt ?? 'continuity-canary-receipt',
        rootCommitmentMatches: options.rootCommitmentMatches !== false,
        cleanup: configuredCleanup,
      };
    },
    cleanupSession: async ({ restoreSessionId }) => {
      calls.push(`cleanup:${restoreSessionId}`);
      if (cleanupSessionResult === null) throw new Error('cleanup response unavailable');
      return cleanupSessionResult;
    },
    cleanupActivatedRoot: async ({ restoreSessionId }) => {
      calls.push(`cleanup-activated:${restoreSessionId}`);
      return options.cleanupRetry ?? configuredCleanup;
    },
  };
}

const step = { actorUserId: ACTOR, atIso: AT_ISO, nowMs: NOW_MS };

function restoreIdentity() {
  const result = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: 'org-1',
    projectId: 'project-1',
    envId: 'env-1',
    signingRootId: 'signing-root-1',
    signingRootVersion: '1',
  });
  if (!result.ok) throw new Error('expected a valid test identity');
  return result.value;
}

async function authenticatedSession(
  store: MemoryRestoreStore,
  nowMs = NOW_MS,
  token = 'session-token',
): Promise<TenantRootRestoreBootstrapSessionV1> {
  await mintRestoreBootstrapSessionV1(store, {
    actorUserId: ACTOR,
    nowMs,
    newSessionToken: () => token,
  });
  const authenticated = await authenticateRestoreSessionV1(store, {
    sessionToken: token,
    nowMs,
  });
  if (authenticated === null) throw new Error('expected a live restore administration session');
  return authenticated;
}

async function start(
  store: MemoryRestoreStore,
  plane: TenantRootRestoreControlPlaneV1,
  nowMs = NOW_MS,
  sessionId = RESTORE_SESSION_ID,
  token = 'session-token',
) {
  const authenticated = await authenticatedSession(store, nowMs, token);
  return await startRestoreSessionV1(store, plane, {
    sessionId,
    authenticatedSession: authenticated,
    atIso: AT_ISO,
    nowMs,
  });
}

async function importRole(
  store: MemoryRestoreStore,
  plane: TenantRootRestoreControlPlaneV1,
  role: 'deriver_a' | 'deriver_b',
  envelope = `envelope-${role}`,
  nowMs = NOW_MS,
) {
  return await importRestoreRoleShareV1(store, plane, {
    role,
    importEnvelopeB64u: envelope,
    authenticatedSession: await authenticatedSession(store, nowMs),
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs,
  });
}

async function issueKey(
  store: MemoryRestoreStore,
  plane: TenantRootRestoreControlPlaneV1,
  role: 'deriver_a' | 'deriver_b',
  operationId: string,
  nowMs = NOW_MS,
) {
  const authenticated = await authenticatedSession(store, nowMs);
  return await issueRestoreRoleImportKeyV1(store, plane, {
    role,
    operationId,
    identity: restoreIdentity(),
    authenticatedSession: authenticated,
    actorUserId: ACTOR,
    atIso: new Date(nowMs).toISOString(),
    nowMs,
  });
}

async function toBothInstalled(
  store: MemoryRestoreStore,
  plane: TenantRootRestoreControlPlaneV1,
): Promise<void> {
  const started = await start(store, plane);
  if (!started.ok) throw new Error('expected the session to start');
  const registered = await registerRestoreManifestV1(store, plane, {
    manifestB64u: 'manifest',
    ...step,
  });
  if (!registered.ok) throw new Error('expected the manifest to register');
  for (const role of ['deriver_a', 'deriver_b'] as const) {
    const key = await issueKey(store, plane, role, `operation-${role}`);
    if (!key.ok) throw new Error(`expected a ${role} import key`);
    const imported = await importRole(store, plane, role);
    if (!imported.ok) throw new Error(`expected ${role} to import`);
  }
}

test('an active destination refuses restore outright', async () => {
  const store = new MemoryRestoreStore();
  store.destinationEmpty = false;
  const started = await start(store, controlPlane());
  expect(started).toMatchObject({ ok: false, error: { kind: 'destination_not_empty' } });
  expect(store.session).toBeNull();
  expect(checkTenantRootAuditEventRedactionV1(started.audit)).toEqual({ ok: true });
});

test('a bootstrap session is minted from the credential and stored only as a digest', async () => {
  const store = new MemoryRestoreStore();
  const minted = await mintRestoreBootstrapSessionV1(store, {
    actorUserId: ACTOR,
    nowMs: NOW_MS,
    newSessionToken: () => 'session-token-1',
  });
  expect(minted.expiresAtMs).toBe(NOW_MS + 1_800_000);
  expect([...store.bootstrapSessions.keys()]).not.toContain('session-token-1');

  const live = await authenticateRestoreSessionV1(store, {
    sessionToken: 'session-token-1',
    nowMs: NOW_MS + 60_000,
  });
  expect(live?.actorUserId).toBe(ACTOR);
  expect(live?.authenticatedAtMs).toBe(NOW_MS);
  expect(
    await authenticateRestoreSessionV1(store, { sessionToken: 'not-a-session', nowMs: NOW_MS }),
  ).toBeNull();
  expect(
    await authenticateRestoreSessionV1(store, {
      sessionToken: 'session-token-1',
      nowMs: NOW_MS + 1_800_000,
    }),
  ).toBeNull();
});

test('a manifest for another tenant cannot be rebound to this destination', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane({ identityDigestB64u: 'a-different-tenant' });
  expect((await start(store, plane)).ok).toBe(true);
  const registered = await registerRestoreManifestV1(store, plane, {
    manifestB64u: 'manifest',
    ...step,
  });
  expect(registered).toMatchObject({
    ok: false,
    error: { kind: 'manifest_is_for_another_tenant' },
  });
  expect(store.session?.status).toBe('awaiting_manifest');
  expect(store.manifest).toBeNull();
});

test('manifest registration resumes only the exact registered backup', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane();
  expect((await start(store, plane)).ok).toBe(true);
  const first = await registerRestoreManifestV1(store, plane, { manifestB64u: 'manifest', ...step });
  expect(first.ok).toBe(true);
  const resumed = await registerRestoreManifestV1(store, plane, { manifestB64u: 'manifest', ...step });
  expect(resumed.ok).toBe(true);
  expect(store.session?.sessionId).toBe(RESTORE_SESSION_ID);
  const different = await registerRestoreManifestV1(store, plane, { manifestB64u: 'different', ...step });
  expect(different).toMatchObject({ ok: false, error: { kind: 'manifest_already_registered' } });
});

test('a second start does not abandon a session in progress', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane();
  expect((await start(store, plane)).ok).toBe(true);
  const again = await startRestoreSessionV1(store, plane, {
    sessionId: 'session-2',
    authenticatedSession: await authenticatedSession(store),
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  expect(again).toMatchObject({ ok: false, error: { kind: 'session_in_progress' } });
  expect(store.session?.sessionId).toBe(RESTORE_SESSION_ID);
});

test('role shares need the current import key, install one at a time, and replay exactly', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane();
  expect((await start(store, plane)).ok).toBe(true);

  // Importing before the manifest is registered is refused.
  expect(await importRole(store, plane, 'deriver_a')).toMatchObject({
    ok: false,
    error: { kind: 'manifest_not_registered' },
  });
  await registerRestoreManifestV1(store, plane, { manifestB64u: 'manifest', ...step });

  // No import key yet.
  expect(await importRole(store, plane, 'deriver_a')).toMatchObject({
    ok: false,
    error: { kind: 'import_key_not_issued', role: 'deriver_a' },
  });

  // Reissuing invalidates the predecessor: the second key is what imports use.
  const first = await issueKey(store, plane, 'deriver_a', 'operation-a-1');
  const second = await issueKey(store, plane, 'deriver_a', 'operation-a-2');
  expect(first.ok && second.ok).toBe(true);
  if (first.ok && second.ok) {
    expect(first.value.generation).toBe(1);
    expect(second.value.generation).toBe(2);
    expect(second.value.expiresAtMs - second.value.issuedAtMs).toBe(900_000);
    expect(second.value.destinationLineageB64u).toBe(DESTINATION_LINEAGE);
    expect(second.value.restoreSessionId).toBe(RESTORE_SESSION_ID);
  }

  const installed = await importRole(store, plane, 'deriver_a');
  expect(installed.ok).toBe(true);
  expect(plane.calls.some((call) => call.startsWith('import:deriver_a:'))).toBe(true);
  expect(store.session?.status).toBe('awaiting_role_imports');

  // The exact same envelope returns the existing receipt without a second install.
  const replayed = await importRole(store, plane, 'deriver_a');
  expect(replayed.ok).toBe(true);
  if (replayed.ok) {
    expect(replayed.value.replayed).toBe(true);
    expect(replayed.value.receiptDigestB64u).toBe('receipt-deriver_a');
  }
  expect(plane.calls.filter((call) => call.startsWith('import:deriver_a')).length).toBe(1);

  // Different bytes for an installed role are a conflict.
  expect(await importRole(store, plane, 'deriver_a', 'a-different-envelope')).toMatchObject({
    ok: false,
    error: { kind: 'role_share_already_installed', role: 'deriver_a' },
  });
  // And no new key is issued for a role that already installed.
  expect(await issueKey(store, plane, 'deriver_a', 'operation-a-3')).toMatchObject({
    ok: false,
    error: { kind: 'role_share_already_installed' },
  });

  await issueKey(store, plane, 'deriver_b', 'operation-b');
  const secondRole = await importRole(store, plane, 'deriver_b');
  expect(secondRole.ok).toBe(true);
  expect(store.session?.status).toBe('verifying');
});

test('a pending issue retries the exact operation after its authorization window', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane({ issueRoleImportKeyFailures: 1 });
  expect((await start(store, plane)).ok).toBe(true);
  await registerRestoreManifestV1(store, plane, { manifestB64u: 'manifest', ...step });

  const first = await issueKey(store, plane, 'deriver_a', 'operation-lost-response');
  expect(first).toMatchObject({
    ok: false,
    error: { kind: 'restore_role_import_unavailable' },
  });
  const pending = [...store.operations.values()][0];
  if (pending === undefined) throw new Error('expected a durable pending operation');

  const second = await issueKey(
    store,
    plane,
    'deriver_a',
    'operation-lost-response',
    NOW_MS + TENANT_ROOT_RESTORE_ROLE_IMPORT_MAX_LIFETIME_MS_V1 + 1,
  );
  expect(second).toMatchObject({ ok: true, value: { replayed: true, generation: 1 } });
  expect([...store.operations.values()][0]?.canonicalRecordJson).toBe(pending.canonicalRecordJson);
  expect(plane.calls).toEqual(['key:deriver_a:1', 'key:deriver_a:1']);
});

test('activation needs both shares, fresh reauthentication, and the trust registration established', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane();

  const activate = async (
    overrides: {
      offlineTrustAcknowledged?: boolean;
      nowMs?: number;
      bootstrapAuthenticatedAtMs?: number;
    } = {},
  ) =>
    activateRestoredRootV1(store, plane, {
      offlineTrustAcknowledged: overrides.offlineTrustAcknowledged ?? false,
      sourceDisposition: { kind: 'retained_as_backup' },
      authenticatedSession: await authenticatedSession(
        store,
        overrides.bootstrapAuthenticatedAtMs ?? NOW_MS - 10_000,
      ),
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: overrides.nowMs ?? NOW_MS,
    });

  // Nothing installed yet.
  await start(store, plane);
  await registerRestoreManifestV1(store, plane, { manifestB64u: 'manifest', ...step });
  expect(await activate()).toMatchObject({
    ok: false,
    error: { kind: 'role_shares_incomplete', missingRole: 'deriver_a' },
  });

  for (const role of ['deriver_a', 'deriver_b'] as const) {
    await issueKey(store, plane, role, `operation-${role}`);
    await importRole(store, plane, role);
  }

  // Stale bootstrap reauthentication.
  expect(await activate({ bootstrapAuthenticatedAtMs: NOW_MS - 300_001 })).toMatchObject({
    ok: false,
    error: { kind: 'bootstrap_reauthentication_stale' },
  });

  // The registered manifest verified offline, so activation needs the
  // acknowledgement; a caller cannot upgrade the trust result.
  expect(await activate()).toMatchObject({
    ok: false,
    error: { kind: 'offline_trust_acknowledgement_required' },
  });

  const activated = await activate({ offlineTrustAcknowledged: true });
  expect(activated.ok).toBe(true);
  expect(activated.audit.action).toBe('offline_trust_acknowledged');
  if (activated.ok && activated.value.status === 'active') {
    expect(activated.value.destinationLineageId).toBe('destination-lineage-1');
    expect(activated.value.sourceDisposition.kind).toBe('retained_as_backup');
    if (activated.value.sourceDisposition.kind === 'retained_as_backup') {
      // Actor and time are the server's, not a body's.
      expect(activated.value.sourceDisposition.acknowledgedByUserId).toBe(ACTOR);
      expect(activated.value.sourceDisposition.recordedAt).toBe(AT_ISO);
    }
    expect(activated.value.tenantHeldRecoverySet).toEqual({
      recoverySetId: RECOVERY_SET_ID,
      manifestDigestB64u: MANIFEST_DIGEST,
    });
  }
  // Imported material bookkeeping is cleared once the root is active.
  expect(store.installed).toEqual([]);
  expect(store.keys.deriver_a).toBeNull();
});

test('activation refuses a revoked administration session before calling the control plane', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane({ trustLevel: CURRENT });
  await toBothInstalled(store, plane);
  const authentication = await authenticatedSession(store);
  store.bootstrapSessions.delete(authentication.tokenDigestB64u);
  const callsBefore = [...plane.calls];
  const outcome = await activateRestoredRootV1(store, plane, {
    offlineTrustAcknowledged: false,
    sourceDisposition: { kind: 'retained_as_backup' },
    authenticatedSession: authentication,
    ...step,
  });
  expect(outcome).toMatchObject({ ok: false, error: { kind: 'bootstrap_authentication_failed' } });
  expect(plane.calls).toEqual(callsBefore);
  expect(store.session?.status).toBe('verifying');
});

test('a current trust result admits activation without an acknowledgement', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane({ trustLevel: CURRENT });
  await toBothInstalled(store, plane);
  const activated = await activateRestoredRootV1(store, plane, {
    offlineTrustAcknowledged: false,
    sourceDisposition: {
      kind: 'unavailable_retirement_unverified',
      attemptedChecks: ['endpoint_canary'],
    },
    authenticatedSession: await authenticatedSession(store),
    ...step,
  });
  expect(activated.ok).toBe(true);
  expect(activated.audit.action).toBe('restore_root_activated');
  if (activated.ok && activated.value.status === 'active') {
    expect(activated.value.sourceDisposition.kind).toBe('unavailable_retirement_unverified');
  }
});

test('activation durably enters refreshing before the control plane runs', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane();
  await toBothInstalled(store, plane);
  let observedStatus: string | null = null;
  let observedGrant: string | null = null;
  const observingPlane: TenantRootRestoreControlPlaneV1 = {
    ...plane,
    activate: async (input) => {
      observedStatus = store.session?.status ?? null;
      observedGrant = store.refreshGrant?.grantB64u ?? null;
      return plane.activate(input);
    },
  };

  const activated = await activateRestoredRootV1(store, observingPlane, {
    offlineTrustAcknowledged: true,
    sourceDisposition: { kind: 'retained_as_backup' },
    authenticatedSession: await authenticatedSession(store),
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });

  expect(activated.ok).toBe(true);
  expect(observedStatus).toBe('refreshing');
  expect(observedGrant).toBe('AQ');
});

test('activation reuses one admitted grant after an unknown control-plane response', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane({ activateFailures: 1 });
  await toBothInstalled(store, plane);

  await expect(
    activateRestoredRootV1(store, plane, {
      offlineTrustAcknowledged: true,
      sourceDisposition: { kind: 'retained_as_backup' },
      authenticatedSession: await authenticatedSession(store),
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    }),
  ).rejects.toThrow(/simulated lost activation response/u);
  expect(store.session?.status).toBe('refreshing');
  expect(plane.calls.filter((call) => call === 'refresh-grant')).toHaveLength(1);

  const firstGrant = store.refreshGrant;
  if (firstGrant === null) throw new Error('expected the admitted refresh grant');
  const retried = await activateRestoredRootV1(store, plane, {
    offlineTrustAcknowledged: true,
    sourceDisposition: { kind: 'retained_as_backup' },
    authenticatedSession: await authenticatedSession(store),
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  expect(retried.ok).toBe(true);
  expect(plane.calls.filter((call) => call === 'refresh-grant')).toHaveLength(1);
  expect(plane.calls.filter((call) => call === 'activate')).toHaveLength(2);
  expect(plane.refreshGrants).toEqual([firstGrant]);
  expect(store.refreshGrant).toBeNull();
});

test('refreshing resends an expired persisted grant for Router reconciliation', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane({ activateFailures: 1 });
  await toBothInstalled(store, plane);

  await expect(
    activateRestoredRootV1(store, plane, {
      offlineTrustAcknowledged: true,
      sourceDisposition: { kind: 'retained_as_backup' },
      authenticatedSession: await authenticatedSession(store),
      actorUserId: ACTOR,
      atIso: AT_ISO,
      nowMs: NOW_MS,
    }),
  ).rejects.toThrow(/simulated lost activation response/u);
  const admitted = store.refreshGrant;
  if (admitted === null) throw new Error('expected the admitted refresh grant');
  store.refreshGrant = { ...admitted, expiresAtMs: NOW_MS - 1 };

  const retried = await activateRestoredRootV1(store, plane, {
    offlineTrustAcknowledged: true,
    sourceDisposition: { kind: 'retained_as_backup' },
    authenticatedSession: await authenticatedSession(store),
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  expect(retried.ok).toBe(true);
  expect(plane.calls.filter((call) => call === 'refresh-grant')).toHaveLength(1);
  expect(plane.calls.filter((call) => call === 'activate')).toHaveLength(2);
});

test('refreshing without its persisted grant fails closed before dispatch', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane();
  await toBothInstalled(store, plane);
  const current = store.session;
  if (current === null || current.status !== 'verifying') {
    throw new Error('expected a verifying restore session');
  }
  await store.putSession({ ...current, status: 'refreshing' });

  const outcome = await activateRestoredRootV1(store, plane, {
    offlineTrustAcknowledged: true,
    sourceDisposition: { kind: 'retained_as_backup' },
    authenticatedSession: await authenticatedSession(store),
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  expect(outcome).toMatchObject({ ok: false, error: { kind: 'restore_refresh_grant_missing' } });
  expect(plane.calls).not.toContain('activate');
});

test('activation without a forward-refresh or canary receipt is refused and stays retryable', async () => {
  for (const [plane, kind] of [
    [
      controlPlane({ trustLevel: CURRENT, forwardRefreshReceipt: '' }),
      'forward_refresh_unverified',
    ],
    [controlPlane({ trustLevel: CURRENT, canaryReceipt: ' ' }), 'continuity_canary_failed'],
  ] as const) {
    const store = new MemoryRestoreStore();
    await toBothInstalled(store, plane);
    const activated = await activateRestoredRootV1(store, plane, {
      offlineTrustAcknowledged: false,
      sourceDisposition: { kind: 'retained_as_backup' },
      authenticatedSession: await authenticatedSession(store),
      ...step,
    });
    // A control plane that cannot show the refresh or the canaries passed
    // did not activate anything; the session keeps its imported shares so the
    // operator can retry once it can.
    expect(activated).toMatchObject({ ok: false, error: { kind } });
    expect(activated.audit.action).toBe('restore_root_activated');
    expect(activated.audit.outcome).toBe('failure');
    expect(store.session?.status).toBe('refreshing');
    expect(store.installed).toHaveLength(2);
  }

  const store = new MemoryRestoreStore();
  const plane = controlPlane({ trustLevel: CURRENT });
  await toBothInstalled(store, plane);
  const activated = await activateRestoredRootV1(store, plane, {
    offlineTrustAcknowledged: false,
    sourceDisposition: { kind: 'retained_as_backup' },
    authenticatedSession: await authenticatedSession(store),
    ...step,
  });
  expect(activated.ok).toBe(true);
  if (activated.ok && activated.value.status === 'active') {
    expect(activated.value.forwardRefreshReceiptDigestB64u).toBe('forward-refresh-receipt');
    expect(activated.value.continuityCanaryReceiptDigestB64u).toBe('continuity-canary-receipt');
  }
});

test('incomplete cleanup is its own state, not a successful activation', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane({ trustLevel: CURRENT, cleanup: incompleteCleanupEvidence() });
  await toBothInstalled(store, plane);
  const authenticated = await authenticatedSession(store);
  const activated = await activateRestoredRootV1(store, plane, {
    offlineTrustAcknowledged: false,
    sourceDisposition: { kind: 'retained_as_backup' },
    authenticatedSession: authenticated,
    ...step,
  });
  expect(activated).toMatchObject({ ok: false, error: { kind: 'cleanup_incomplete' } });
  expect(store.session).toMatchObject({
    status: 'cleanup_incomplete',
    phase: 'post_activation',
    activationEvidence: {
      destinationFingerprintB64u: DESTINATION_FINGERPRINT,
      destinationLineageId: 'destination-lineage-1',
      activatedEpoch: 1,
      activationReceiptB64u: 'canonical-activation-receipt',
      activationReceiptDigestB64u: 'activation-receipt',
      forwardRefreshReceiptDigestB64u: 'forward-refresh-receipt',
      continuityCanaryReceiptDigestB64u: 'continuity-canary-receipt',
    },
    bootstrapCleanup: { kind: 'outstanding' },
    roleCleanup: { kind: 'both_roles_incomplete' },
  });
  expect(store.refreshGrant).not.toBeNull();
  expect(plane.calls.filter((call) => call === 'activate')).toHaveLength(1);
});

test('post-activation cleanup retry reuses durable evidence and never activates again', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane({
    trustLevel: CURRENT,
    cleanup: incompleteCleanupEvidence(),
    cleanupRetry: {
      bootstrap: {
        kind: 'destroyed',
        receiptDigestB64u: 'bootstrap-destruction-receipt',
      },
      roles: {
        kind: 'complete',
        receipts: { deriverA: 'clean-a', deriverB: 'clean-b' },
      },
    },
  });
  await toBothInstalled(store, plane);
  const authenticated = await authenticatedSession(store);
  const first = await activateRestoredRootV1(store, plane, {
    offlineTrustAcknowledged: false,
    sourceDisposition: { kind: 'retained_as_backup' },
    authenticatedSession: authenticated,
    ...step,
  });
  expect(first.ok).toBe(false);
  const retry = await activateRestoredRootV1(store, plane, {
    offlineTrustAcknowledged: false,
    sourceDisposition: { kind: 'unavailable_retirement_unverified', attemptedChecks: ['changed'] },
    authenticatedSession: authenticated,
    ...step,
  });
  expect(retry.ok).toBe(true);
  expect(plane.calls.filter((call) => call === 'activate')).toHaveLength(1);
  expect(plane.calls).toContain(`cleanup-activated:${RESTORE_SESSION_ID}`);
  expect(store.session).toMatchObject({
    status: 'active',
    sourceDisposition: { kind: 'retained_as_backup' },
    activationReceiptDigestB64u: 'activation-receipt',
  });
  expect(store.refreshGrant).toBeNull();
});

test('a root commitment mismatch never activates', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane({ trustLevel: CURRENT, rootCommitmentMatches: false });
  await toBothInstalled(store, plane);
  const activated = await activateRestoredRootV1(store, plane, {
    offlineTrustAcknowledged: false,
    sourceDisposition: { kind: 'retained_as_backup' },
    authenticatedSession: await authenticatedSession(store),
    ...step,
  });
  expect(activated).toMatchObject({ ok: false, error: { kind: 'root_commitment_mismatch' } });
  expect(store.session?.status).toBe('refreshing');
});

test('a session past its deadline is cleaned up and recorded as expired', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane();
  const initialAuthentication = await authenticatedSession(store, NOW_MS, 'initial-session-token');
  const started = await startRestoreSessionV1(store, plane, {
    sessionId: RESTORE_SESSION_ID,
    authenticatedSession: initialAuthentication,
    atIso: AT_ISO,
    nowMs: NOW_MS,
  });
  expect(started.ok).toBe(true);
  await registerRestoreManifestV1(store, plane, { manifestB64u: 'manifest', ...step });
  await issueKey(store, plane, 'deriver_a', 'operation-a');
  await importRole(store, plane, 'deriver_a');

  const late = NOW_MS + TENANT_ROOT_RESTORE_SESSION_MS_V1;
  const refused = await importRestoreRoleShareV1(store, plane, {
    role: 'deriver_b',
    importEnvelopeB64u: 'envelope-deriver_b',
    authenticatedSession: await authenticatedSession(store, late, 'late-session-token'),
    actorUserId: ACTOR,
    atIso: AT_ISO,
    nowMs: late,
  });
  expect(refused).toMatchObject({ ok: false, error: { kind: 'session_expired' } });
  expect(store.session?.status).toBe('expired');
  expect(plane.calls).toContain(`cleanup:${RESTORE_SESSION_ID}`);
  expect(store.installed).toEqual([]);
  expect(store.bootstrapSessions.get(initialAuthentication.tokenDigestB64u)).toEqual(
    initialAuthentication,
  );

  // A new session may start once the old one is settled.
  const lateAuthentication = await authenticatedSession(store, late, 'late-session-token');
  const restarted = await startRestoreSessionV1(store, plane, {
    sessionId: 'session-2',
    authenticatedSession: lateAuthentication,
    atIso: AT_ISO,
    nowMs: late,
  });
  expect(restarted.ok).toBe(true);
  expect(store.session?.sessionId).toBe('session-2');
});

test('an expiry whose cleanup cannot be proved blocks a new session', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane({ cleanupSessionResult: null });
  await start(store, plane);
  const late = NOW_MS + TENANT_ROOT_RESTORE_SESSION_MS_V1;
  const lateAuthentication = await authenticatedSession(store, late, 'late-session-token');
  const restarted = await startRestoreSessionV1(store, plane, {
    sessionId: 'session-2',
    authenticatedSession: lateAuthentication,
    atIso: AT_ISO,
    nowMs: late,
  });
  expect(store.session?.status).toBe('cleanup_incomplete');
  expect(restarted).toMatchObject({ ok: false, error: { kind: 'cleanup_incomplete' } });
  const recovered = await startRestoreSessionV1(store, controlPlane(), {
    sessionId: 'session-2',
    authenticatedSession: lateAuthentication,
    atIso: new Date(late + 1).toISOString(),
    nowMs: late + 1,
  });
  expect(recovered).toMatchObject({ ok: true, value: { sessionId: 'session-2' } });
});

test('an incomplete role cleanup records the role outstanding state', async () => {
  const store = new MemoryRestoreStore();
  const plane = controlPlane({ cleanupSessionResult: incompleteRoleCleanup() });
  await start(store, plane);
  const late = NOW_MS + TENANT_ROOT_RESTORE_SESSION_MS_V1;
  const restarted = await startRestoreSessionV1(store, plane, {
    sessionId: 'session-2',
    authenticatedSession: await authenticatedSession(store, late, 'late-session-token'),
    atIso: AT_ISO,
    nowMs: late,
  });
  expect(store.session).toEqual({
    status: 'cleanup_incomplete',
    phase: 'pre_activation',
    sessionId: RESTORE_SESSION_ID,
    expiresAt: new Date(late).toISOString(),
    destinationFingerprintB64u: DESTINATION_FINGERPRINT,
    outstanding: {
      roles: ['deriver_a', 'deriver_b'],
      description: 'imported shares and role import keys',
    },
  });
  expect(restarted).toMatchObject({ ok: false, error: { kind: 'cleanup_incomplete' } });
});

test('a trust snapshot must postdate the artifact it vouches for', () => {
  expect(
    admitRestoreTrustV1({
      level: {
        kind: 'valid_at_trust_snapshot',
        snapshotVersion: 1,
        snapshotIssuedAt: ARTIFACT_CREATED,
      },
      artifactCreatedAtIso: ARTIFACT_CREATED,
      offlineAcknowledged: false,
    }),
  ).toEqual({ ok: true });
  expect(
    admitRestoreTrustV1({
      level: {
        kind: 'valid_at_trust_snapshot',
        snapshotVersion: 1,
        snapshotIssuedAt: '2026-08-29T10:20:30.122Z',
      },
      artifactCreatedAtIso: ARTIFACT_CREATED,
      offlineAcknowledged: false,
    }),
  ).toEqual({
    ok: false,
    error: { kind: 'trust_not_admitted', level: 'valid_at_trust_snapshot' },
  });
  expect(
    admitRestoreTrustV1({
      level: OFFLINE,
      artifactCreatedAtIso: ARTIFACT_CREATED,
      offlineAcknowledged: true,
    }),
  ).toEqual({ ok: true });
});

test('the default disposition keeps the source in the security model', () => {
  const disposition = defaultSourceCustodyDispositionV1({
    acknowledgedByUserId: ACTOR,
    recordedAtIso: AT_ISO,
  });
  expect(disposition.kind).toBe('retained_as_backup');
  if (disposition.kind === 'retained_as_backup') {
    expect(disposition.incidentResponseNote).toContain('may still hold usable shares');
  }
});
