import {
  d1ChangedRows,
  queryD1One,
  type D1DatabaseLike,
  type D1Row,
} from '@seams/wallet-server/cloud-host';
import {
  decodeTenantDeploymentBindingV1,
  decodeTenantDeploymentCutoverV1,
  type ActiveTenantDeploymentBindingV1,
  type TenantDeploymentBindingRevision,
  type TenantDeploymentBindingV1,
  type TenantDeploymentCutoverId,
  type TenantDeploymentCutoverV1,
} from '@seams-internal/wallet-console-shared/tenant-deployment';
import { TenantDeploymentStoreError, type TenantDeploymentServiceV1 } from './service';
import type {
  ActivateTenantDeploymentBindingInputV1,
  ActivateTenantDeploymentBindingResultV1,
  TenantDeploymentBindingReaderV1,
  TenantDeploymentCutoverRecordV1,
} from './types';
import type { TenantDeploymentSetupAdmissionReaderV1 } from './runtimeBinding';

export type D1TenantDeploymentServiceOptionsV1 = {
  readonly database: D1DatabaseLike;
  readonly now?: () => Date;
};

export type D1TenantDeploymentBindingReaderOptionsV1 = {
  readonly database: D1DatabaseLike;
};

function requiredText(value: unknown, label: string): string {
  const parsed = typeof value === 'string' ? value : '';
  if (!parsed || parsed.trim() !== parsed) {
    throw new TenantDeploymentStoreError('invalid_input', `${label} is invalid`);
  }
  return parsed;
}

function positiveSafeInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TenantDeploymentStoreError('invalid_input', `${label} is invalid`);
  }
  return parsed;
}

function parseRevision(value: unknown, label: string): TenantDeploymentBindingRevision {
  const parsed = requiredText(value, label);
  if (!parsed.startsWith('tdb_') || parsed.length === 4) {
    throw new TenantDeploymentStoreError('invalid_input', `${label} is invalid`);
  }
  return `tdb_${parsed.slice(4)}`;
}

function parseNullableRevision(
  value: unknown,
  label: string,
): TenantDeploymentBindingRevision | null {
  return value === null || value === undefined ? null : parseRevision(value, label);
}

function parseCutoverId(value: unknown, label: string): TenantDeploymentCutoverId {
  const parsed = requiredText(value, label);
  if (!parsed.startsWith('tco_') || parsed.length === 4) {
    throw new TenantDeploymentStoreError('invalid_input', `${label} is invalid`);
  }
  return `tco_${parsed.slice(4)}`;
}

async function parseBindingJson(value: unknown): Promise<TenantDeploymentBindingV1> {
  const source = requiredText(value, 'binding_json');
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new TenantDeploymentStoreError(
      'invalid_record',
      'tenant deployment binding JSON is invalid',
    );
  }
  const decoded = await decodeTenantDeploymentBindingV1(raw);
  if (!decoded.ok) {
    throw new TenantDeploymentStoreError('invalid_record', decoded.message);
  }
  return decoded.value;
}

async function parseBindingRow(row: D1Row): Promise<TenantDeploymentBindingV1> {
  const binding = await parseBindingJson(row.binding_json);
  if (
    binding.deploymentLane !== row.deployment_lane ||
    binding.revision !== row.revision ||
    binding.tenant.namespace !== row.namespace ||
    binding.tenant.organizationId !== row.org_id ||
    binding.tenant.projectId !== row.project_id ||
    binding.tenant.environmentId !== row.environment_id ||
    binding.tenantRoot.identityDigestB64u !== row.tenant_root_identity_digest_b64u ||
    binding.tenantRoot.custodyLineageId !== row.custody_lineage_id ||
    binding.browserCredential.credentialId !== row.credential_id ||
    binding.runtimePolicyDigestB64u !== row.runtime_policy_digest_b64u
  ) {
    throw new TenantDeploymentStoreError(
      'invalid_record',
      'tenant deployment binding columns disagree with the canonical binding',
    );
  }
  return binding;
}

function parseActiveRow(row: D1Row): ActiveTenantDeploymentBindingV1 {
  return {
    kind: 'active_tenant_deployment_binding_v1',
    deploymentLane: requiredText(row.deployment_lane, 'deployment_lane'),
    revision: parseRevision(row.revision, 'revision'),
    previousRevision: parseNullableRevision(row.previous_revision, 'previous_revision'),
    activationSequence: positiveSafeInteger(row.activation_sequence, 'activation_sequence'),
    activatedAtMs: positiveSafeInteger(row.activated_at_ms, 'activated_at_ms'),
  };
}

function sameBinding(left: TenantDeploymentBindingV1, right: TenantDeploymentBindingV1): boolean {
  return left.revision === right.revision;
}

async function parseCutoverJson(row: D1Row): Promise<TenantDeploymentCutoverV1> {
  const source = requiredText(row.state_json, 'state_json');
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new TenantDeploymentStoreError(
      'invalid_record',
      'tenant deployment cutover JSON is invalid',
    );
  }
  const decoded = await decodeTenantDeploymentCutoverV1(value);
  if (!decoded.ok) throw new TenantDeploymentStoreError('invalid_record', decoded.message);
  const state = decoded.value;
  if (
    state.operationId !== row.operation_id ||
    state.deploymentLane !== row.deployment_lane ||
    state.kind !== row.state_kind
  ) {
    throw new TenantDeploymentStoreError(
      'invalid_record',
      'tenant deployment cutover columns disagree with its state',
    );
  }
  return state;
}

async function parseCutoverRow(row: D1Row): Promise<TenantDeploymentCutoverRecordV1> {
  return {
    state: await parseCutoverJson(row),
    recordRevision: positiveSafeInteger(row.record_revision, 'record_revision'),
    createdAtMs: positiveSafeInteger(row.created_at_ms, 'created_at_ms'),
    updatedAtMs: positiveSafeInteger(row.updated_at_ms, 'updated_at_ms'),
  };
}

async function readBinding(
  database: D1DatabaseLike,
  deploymentLane: string,
  revision: TenantDeploymentBindingRevision,
): Promise<TenantDeploymentBindingV1 | null> {
  const row = await queryD1One(
    database,
    `SELECT * FROM tenant_deployment_bindings
     WHERE deployment_lane = ?1 AND revision = ?2`,
    [deploymentLane, revision],
  );
  return row ? await parseBindingRow(row) : null;
}

async function readActive(
  database: D1DatabaseLike,
  deploymentLane: string,
): Promise<ActiveTenantDeploymentBindingV1 | null> {
  const row = await queryD1One(
    database,
    `SELECT * FROM active_tenant_deployment_bindings WHERE deployment_lane = ?1`,
    [deploymentLane],
  );
  return row ? parseActiveRow(row) : null;
}

async function readCutover(
  database: D1DatabaseLike,
  operationId: string,
): Promise<TenantDeploymentCutoverRecordV1 | null> {
  const row = await queryD1One(
    database,
    `SELECT * FROM tenant_deployment_cutovers WHERE operation_id = ?1`,
    [operationId],
  );
  return row ? await parseCutoverRow(row) : null;
}

function isAllowedCutoverTransition(
  current: TenantDeploymentCutoverV1['kind'],
  next: TenantDeploymentCutoverV1['kind'],
): boolean {
  if (next === 'failed') return current !== 'active' && current !== 'failed';
  switch (current) {
    case 'planning':
      return next === 'awaiting_tenant_root';
    case 'awaiting_tenant_root':
      return next === 'awaiting_browser_credential';
    case 'awaiting_browser_credential':
      return next === 'ready';
    case 'ready':
      return next === 'ready';
    case 'active':
    case 'failed':
      return false;
  }
}

function sameRootReference(
  left: Extract<
    TenantDeploymentCutoverV1,
    { readonly kind: 'awaiting_browser_credential' }
  >['activeTenantRoot'],
  right: TenantDeploymentBindingV1['tenantRoot'],
): boolean {
  return (
    left.identityDigestB64u === right.identityDigestB64u &&
    left.custodyLineageId === right.custodyLineageId &&
    left.signingRootId === right.signingRootId &&
    left.signingRootVersion === right.signingRootVersion
  );
}

function sameTargetIdentity(
  left: Extract<
    TenantDeploymentCutoverV1,
    { readonly kind: 'awaiting_tenant_root' }
  >['targetIdentity'],
  right: Extract<
    TenantDeploymentCutoverV1,
    { readonly kind: 'awaiting_browser_credential' }
  >['targetIdentity'],
): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.environmentId === right.environmentId &&
    left.signingRootId === right.signingRootId &&
    left.signingRootVersion === right.signingRootVersion
  );
}

function isConsistentCutoverTransition(
  current: TenantDeploymentCutoverV1,
  next: TenantDeploymentCutoverV1,
): boolean {
  if (next.kind === 'failed') return true;
  switch (current.kind) {
    case 'planning':
      return (
        next.kind === 'awaiting_tenant_root' &&
        sameTargetIdentity(current.targetIdentity, next.targetIdentity) &&
        next.expectedActiveRevision === current.expectedActiveRevision
      );
    case 'awaiting_tenant_root':
      return (
        next.kind === 'awaiting_browser_credential' &&
        sameTargetIdentity(current.targetIdentity, next.targetIdentity) &&
        next.activeTenantRoot.signingRootId === current.targetIdentity.signingRootId &&
        next.activeTenantRoot.signingRootVersion === current.targetIdentity.signingRootVersion &&
        next.expectedActiveRevision === current.expectedActiveRevision
      );
    case 'awaiting_browser_credential':
      return (
        next.kind === 'ready' &&
        next.binding.tenant.organizationId === current.targetIdentity.organizationId &&
        next.binding.tenant.projectId === current.targetIdentity.projectId &&
        next.binding.tenant.environmentId === current.targetIdentity.environmentId &&
        sameRootReference(current.activeTenantRoot, next.binding.tenantRoot) &&
        next.expectedActiveRevision === current.expectedActiveRevision
      );
    case 'ready':
      return (
        next.kind === 'ready' &&
        next.binding.revision === current.binding.revision &&
        next.expectedActiveRevision === current.expectedActiveRevision
      );
    case 'active':
    case 'failed':
      return false;
  }
}

function assertReadiness(input: ActivateTenantDeploymentBindingInputV1, nowMs: number): void {
  const receipt = input.readinessReceipt;
  const expectedRevision = input.expectedActive?.revision ?? null;
  if (
    receipt.kind !== 'tenant_deployment_readiness_receipt_v1' ||
    receipt.bindingRevision !== input.bindingRevision ||
    receipt.expectedActiveRevision !== expectedRevision ||
    !Number.isSafeInteger(receipt.checkedAtMs) ||
    !Number.isSafeInteger(receipt.expiresAtMs) ||
    receipt.checkedAtMs <= 0 ||
    receipt.expiresAtMs <= nowMs ||
    receipt.expiresAtMs <= receipt.checkedAtMs ||
    !receipt.evidenceDigestB64u ||
    !Number.isSafeInteger(receipt.durableWalletCount) ||
    receipt.durableWalletCount < 0 ||
    receipt.inFlightCeremonyCount !== 0
  ) {
    throw new TenantDeploymentStoreError(
      'readiness_invalid',
      'tenant deployment readiness receipt is invalid or expired',
    );
  }
}

function activationResult(
  active: ActiveTenantDeploymentBindingV1,
): ActivateTenantDeploymentBindingResultV1 {
  return {
    active,
    receipt: {
      kind: 'tenant_deployment_activation_receipt_v1',
      bindingRevision: active.revision,
      previousRevision: active.previousRevision,
      activationSequence: active.activationSequence,
      activatedAtMs: active.activatedAtMs,
    },
  };
}

function sameReadinessReceipt(
  left: Extract<TenantDeploymentCutoverV1, { readonly kind: 'ready' }>,
  right: ActivateTenantDeploymentBindingInputV1['readinessReceipt'],
): boolean {
  const receipt = left.readinessReceipt;
  return (
    receipt.kind === right.kind &&
    receipt.bindingRevision === right.bindingRevision &&
    receipt.expectedActiveRevision === right.expectedActiveRevision &&
    receipt.checkedAtMs === right.checkedAtMs &&
    receipt.expiresAtMs === right.expiresAtMs &&
    receipt.evidenceDigestB64u === right.evidenceDigestB64u &&
    receipt.durableWalletCount === right.durableWalletCount &&
    receipt.inFlightCeremonyCount === right.inFlightCeremonyCount
  );
}

export function createD1TenantDeploymentBindingReaderV1(
  options: D1TenantDeploymentBindingReaderOptionsV1,
): TenantDeploymentBindingReaderV1 {
  const database = options.database;
  return {
    async findBinding(rawLane, revision) {
      return await readBinding(database, requiredText(rawLane, 'deploymentLane'), revision);
    },

    async findActiveBinding(rawLane) {
      return await readActive(database, requiredText(rawLane, 'deploymentLane'));
    },

    async resolveActiveBinding(rawLane) {
      const deploymentLane = requiredText(rawLane, 'deploymentLane');
      const active = await readActive(database, deploymentLane);
      if (!active) return null;
      const binding = await readBinding(database, deploymentLane, active.revision);
      if (!binding) {
        throw new TenantDeploymentStoreError(
          'invalid_record',
          'active tenant deployment binding does not exist',
        );
      }
      return binding;
    },
  };
}

export function createD1TenantDeploymentSetupAdmissionReaderV1(options: {
  readonly database: D1DatabaseLike;
}): TenantDeploymentSetupAdmissionReaderV1 {
  return {
    async isSetupQuiesced(rawLane) {
      const deploymentLane = requiredText(rawLane, 'deploymentLane');
      const row = await queryD1One(
        options.database,
        `SELECT operation_id
           FROM tenant_deployment_cutovers
          WHERE deployment_lane = ?1
            AND state_kind IN ('awaiting_browser_credential', 'ready')
          LIMIT 1`,
        [deploymentLane],
      );
      return row !== null;
    },
  };
}

export function createD1TenantDeploymentServiceV1(
  options: D1TenantDeploymentServiceOptionsV1,
): TenantDeploymentServiceV1 {
  const database = options.database;
  const now = options.now ?? (() => new Date());
  const reader = createD1TenantDeploymentBindingReaderV1({ database });
  return {
    ...reader,
    async putBinding(rawBinding) {
      const decoded = await decodeTenantDeploymentBindingV1(rawBinding);
      if (!decoded.ok) {
        throw new TenantDeploymentStoreError('invalid_input', decoded.message);
      }
      const binding = decoded.value;
      await database
        .prepare(
          `INSERT OR IGNORE INTO tenant_deployment_bindings (
             deployment_lane, revision, schema_version, binding_json,
             namespace, org_id, project_id, environment_id,
             tenant_root_identity_digest_b64u, custody_lineage_id,
             credential_id, runtime_policy_digest_b64u, created_at_ms
           ) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        )
        .bind(
          binding.deploymentLane,
          binding.revision,
          JSON.stringify(binding),
          binding.tenant.namespace,
          binding.tenant.organizationId,
          binding.tenant.projectId,
          binding.tenant.environmentId,
          binding.tenantRoot.identityDigestB64u,
          binding.tenantRoot.custodyLineageId,
          binding.browserCredential.credentialId,
          binding.runtimePolicyDigestB64u,
          binding.createdAtMs,
        )
        .run();
      const stored = await readBinding(database, binding.deploymentLane, binding.revision);
      if (!stored || !sameBinding(stored, binding)) {
        throw new TenantDeploymentStoreError(
          'binding_conflict',
          'tenant deployment binding revision already names different content',
        );
      }
      return stored;
    },

    async activateBinding(rawInput) {
      const input: ActivateTenantDeploymentBindingInputV1 = {
        operationId: parseCutoverId(rawInput.operationId, 'operationId'),
        expectedCutoverRecordRevision: positiveSafeInteger(
          rawInput.expectedCutoverRecordRevision,
          'expectedCutoverRecordRevision',
        ),
        deploymentLane: requiredText(rawInput.deploymentLane, 'deploymentLane'),
        bindingRevision: parseRevision(rawInput.bindingRevision, 'bindingRevision'),
        expectedActive: rawInput.expectedActive
          ? {
              revision: parseRevision(rawInput.expectedActive.revision, 'expectedActive.revision'),
              activationSequence: positiveSafeInteger(
                rawInput.expectedActive.activationSequence,
                'expectedActive.activationSequence',
              ),
            }
          : null,
        readinessReceipt: rawInput.readinessReceipt,
      };
      const timestamp = positiveSafeInteger(now().getTime(), 'current time');
      const cutover = await readCutover(database, input.operationId);
      const before = await readActive(database, input.deploymentLane);
      if (
        cutover?.state.kind === 'active' &&
        cutover.state.binding.revision === input.bindingRevision &&
        cutover.state.deploymentLane === input.deploymentLane &&
        cutover.recordRevision === input.expectedCutoverRecordRevision + 1 &&
        cutover.state.activationReceipt.previousRevision ===
          (input.expectedActive?.revision ?? null) &&
        cutover.state.activationReceipt.activationSequence ===
          (input.expectedActive?.activationSequence ?? 0) + 1 &&
        before?.revision === input.bindingRevision &&
        before.activationSequence === cutover.state.activationReceipt.activationSequence
      ) {
        return activationResult(before);
      }
      if (
        !cutover ||
        cutover.state.kind !== 'ready' ||
        cutover.recordRevision !== input.expectedCutoverRecordRevision ||
        cutover.state.binding.revision !== input.bindingRevision ||
        cutover.state.expectedActiveRevision !== (input.expectedActive?.revision ?? null) ||
        !sameReadinessReceipt(cutover.state, input.readinessReceipt)
      ) {
        throw new TenantDeploymentStoreError(
          'activation_conflict',
          'tenant deployment cutover is not ready for activation',
        );
      }
      assertReadiness(input, timestamp);
      const binding = await readBinding(database, input.deploymentLane, input.bindingRevision);
      if (!binding) {
        throw new TenantDeploymentStoreError(
          'binding_not_found',
          'tenant deployment binding was not found',
        );
      }
      const activationSequence = (input.expectedActive?.activationSequence ?? 0) + 1;
      const receipt = {
        kind: 'tenant_deployment_activation_receipt_v1' as const,
        bindingRevision: binding.revision,
        previousRevision: input.expectedActive?.revision ?? null,
        activationSequence,
        activatedAtMs: timestamp,
      };
      const activeState: TenantDeploymentCutoverV1 = {
        kind: 'active',
        operationId: input.operationId,
        deploymentLane: input.deploymentLane,
        binding,
        activationReceipt: receipt,
      };
      try {
        await database
          .prepare(
            `INSERT INTO tenant_deployment_activations (
             operation_id, deployment_lane, binding_revision,
             expected_previous_revision, expected_activation_sequence,
             activation_sequence, activated_at_ms, expected_cutover_record_revision,
             ready_state_json, active_state_json, receipt_json
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
          )
          .bind(
            input.operationId,
            input.deploymentLane,
            input.bindingRevision,
            input.expectedActive?.revision ?? null,
            input.expectedActive?.activationSequence ?? null,
            activationSequence,
            timestamp,
            input.expectedCutoverRecordRevision,
            JSON.stringify(cutover.state),
            JSON.stringify(activeState),
            JSON.stringify(receipt),
          )
          .run();
      } catch {
        throw new TenantDeploymentStoreError(
          'activation_conflict',
          'tenant deployment activation compare-and-swap failed',
        );
      }
      const active = await readActive(database, input.deploymentLane);
      if (!active || active.revision !== input.bindingRevision) {
        throw new TenantDeploymentStoreError(
          'invalid_record',
          'tenant deployment activation did not persist the requested binding',
        );
      }
      return activationResult(active);
    },

    async createCutover(state) {
      const decoded = await decodeTenantDeploymentCutoverV1(state);
      if (!decoded.ok || decoded.value.kind !== 'planning') {
        throw new TenantDeploymentStoreError('invalid_input', 'a cutover must begin in planning');
      }
      const initialState = decoded.value;
      const operationId = initialState.operationId;
      const deploymentLane = initialState.deploymentLane;
      const timestamp = positiveSafeInteger(now().getTime(), 'current time');
      await database
        .prepare(
          `INSERT OR IGNORE INTO tenant_deployment_cutovers (
             operation_id, deployment_lane, state_kind, state_json,
             record_revision, created_at_ms, updated_at_ms
           ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)`,
        )
        .bind(
          operationId,
          deploymentLane,
          initialState.kind,
          JSON.stringify(initialState),
          timestamp,
        )
        .run();
      const stored = await readCutover(database, operationId);
      if (!stored || JSON.stringify(stored.state) !== JSON.stringify(initialState)) {
        throw new TenantDeploymentStoreError(
          'cutover_conflict',
          'tenant deployment cutover operation already names different state',
        );
      }
      return stored;
    },

    async findCutover(rawOperationId) {
      return await readCutover(database, requiredText(rawOperationId, 'operationId'));
    },

    async transitionCutover(expected, next) {
      const decodedExpected = await decodeTenantDeploymentCutoverV1(expected.state);
      const decoded = await decodeTenantDeploymentCutoverV1(next);
      if (!decodedExpected.ok)
        throw new TenantDeploymentStoreError('invalid_input', decodedExpected.message);
      if (!decoded.ok) throw new TenantDeploymentStoreError('invalid_input', decoded.message);
      const expectedState = decodedExpected.value;
      const nextState = decoded.value;
      if (
        expectedState.operationId !== nextState.operationId ||
        expectedState.deploymentLane !== nextState.deploymentLane
      ) {
        throw new TenantDeploymentStoreError(
          'invalid_input',
          'tenant deployment cutover transition changes operation identity',
        );
      }
      if (
        !isAllowedCutoverTransition(expectedState.kind, nextState.kind) ||
        !isConsistentCutoverTransition(expectedState, nextState)
      ) {
        throw new TenantDeploymentStoreError(
          'invalid_input',
          'tenant deployment cutover transition is invalid',
        );
      }
      const expectedRecordRevision = positiveSafeInteger(
        expected.recordRevision,
        'expected.recordRevision',
      );
      const expectedCreatedAtMs = positiveSafeInteger(expected.createdAtMs, 'expected.createdAtMs');
      const expectedUpdatedAtMs = positiveSafeInteger(expected.updatedAtMs, 'expected.updatedAtMs');
      const current = await readCutover(database, expectedState.operationId);
      if (
        !current ||
        current.recordRevision !== expectedRecordRevision ||
        current.createdAtMs !== expectedCreatedAtMs ||
        current.updatedAtMs !== expectedUpdatedAtMs ||
        JSON.stringify(current.state) !== JSON.stringify(expectedState)
      ) {
        throw new TenantDeploymentStoreError(
          'cutover_conflict',
          'tenant deployment cutover changed before transition',
        );
      }
      const timestamp = positiveSafeInteger(now().getTime(), 'current time');
      const result = await database
        .prepare(
          `UPDATE tenant_deployment_cutovers
           SET state_kind = ?1, state_json = ?2,
               record_revision = record_revision + 1, updated_at_ms = ?3
           WHERE operation_id = ?4 AND deployment_lane = ?5
             AND record_revision = ?6 AND state_kind = ?7`,
        )
        .bind(
          nextState.kind,
          JSON.stringify(nextState),
          timestamp,
          nextState.operationId,
          nextState.deploymentLane,
          expectedRecordRevision,
          expectedState.kind,
        )
        .run();
      if (d1ChangedRows(result) !== 1) {
        throw new TenantDeploymentStoreError(
          'cutover_conflict',
          'tenant deployment cutover changed before transition',
        );
      }
      const stored = await readCutover(database, nextState.operationId);
      if (!stored) {
        throw new TenantDeploymentStoreError(
          'cutover_not_found',
          'tenant deployment cutover disappeared after transition',
        );
      }
      return stored;
    },
  };
}
