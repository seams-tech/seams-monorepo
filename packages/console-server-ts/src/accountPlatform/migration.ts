import {
  ServiceTenantBindingV1,
  nativeTenantScopeKey,
  readNativeTenantScope,
  type NativeTenantScopeV1,
  type PlatformResult,
} from '@seams-internal/console-shared/accountPlatform';
import {
  contractResult,
  digestValue,
  exactKeys,
  integer,
  invalidContract,
  object,
  textValue,
  versionOne,
  type PlatformContractError,
} from '@seams-internal/console-shared/accountPlatform/boundary';

export type SourceAccountOwnershipV1 =
  | {
      readonly kind: 'preserve_source_owners';
      readonly activeOwnerCount: number;
      readonly reason?: never;
    }
  | {
      readonly kind: 'unresolved';
      readonly reason: 'owner_missing' | 'identity_unverified';
      readonly activeOwnerCount?: never;
    };

export interface WalletMigrationCheckpointV1 {
  readonly serviceId: 'wallet';
  readonly authorityRevision: number;
  readonly ownership: SourceAccountOwnershipV1;
  readonly identityDigest: string;
  readonly membershipDigest: string;
  readonly operationalDigest: string;
  readonly ledgerDigest: string;
  readonly paymentDigest: string;
  readonly postedBalanceMinor: number;
  readonly openReservationsMinor: number;
  readonly historicalUnattributedChargeCount: number;
  readonly environmentIds: readonly string[];
}

export interface SatyrMigrationCheckpointV1 {
  readonly serviceId: 'satyr';
  readonly authorityRevision: number;
  readonly ownership: SourceAccountOwnershipV1;
  readonly identityDigest: string;
  readonly membershipDigest: string;
  readonly operationalDigest: string;
  readonly placementDigest: string;
  readonly placementCellId: string;
  readonly placementEpoch: number;
  readonly environment: 'development' | 'production';
  readonly money: 'no_customer_ledger';
  readonly ledgerDigest?: never;
  readonly paymentDigest?: never;
  readonly postedBalanceMinor?: never;
  readonly openReservationsMinor?: never;
  readonly historicalUnattributedChargeCount?: never;
  readonly environmentIds?: never;
}

export type AccountMigrationEntryV1 =
  | { readonly binding: ServiceTenantBindingV1; readonly checkpoint: WalletMigrationCheckpointV1 }
  | { readonly binding: ServiceTenantBindingV1; readonly checkpoint: SatyrMigrationCheckpointV1 };

/** Explicit mappings only. This boundary never derives an identity from an email or a name. */
export class AccountMigrationCohortV1 {
  private constructor(
    readonly cohortId: string,
    readonly inventory: readonly NativeTenantScopeV1[],
    readonly entries: readonly AccountMigrationEntryV1[],
  ) {
    this.seal();
  }

  private seal(): void {
    Object.freeze(this);
  }

  static parse(input: unknown): PlatformResult<AccountMigrationCohortV1, PlatformContractError> {
    return contractResult(AccountMigrationCohortV1.read, input);
  }

  private static read(input: unknown): AccountMigrationCohortV1 {
    const record = object(input, 'cohort');
    exactKeys(record, ['version', 'cohortId', 'inventory', 'entries']);
    versionOne(record.version);
    if (!Array.isArray(record.entries) || record.entries.length === 0) {
      return invalidContract('entries');
    }
    const entries: AccountMigrationEntryV1[] = [];
    for (const raw of record.entries) entries.push(readMigrationEntry(raw));
    if (!Array.isArray(record.inventory) || record.inventory.length === 0) {
      return invalidContract('inventory');
    }
    const inventory: NativeTenantScopeV1[] = [];
    const seen = new Set<string>();
    for (const raw of record.inventory) {
      const scope = readNativeTenantScope(raw);
      const key = nativeTenantScopeKey(scope);
      if (seen.has(key)) return invalidContract('inventory');
      seen.add(key);
      inventory.push(scope);
    }
    return new AccountMigrationCohortV1(
      textValue(record.cohortId, 'cohortId'),
      Object.freeze(inventory),
      Object.freeze(entries),
    );
  }
}

function readMigrationEntry(input: unknown): AccountMigrationEntryV1 {
  const record = object(input, 'entry');
  exactKeys(record, ['binding', 'checkpoint']);
  const binding = ServiceTenantBindingV1.parse(record.binding);
  if (binding.kind === 'rejected') return invalidContract(`binding.${binding.error.field}`);
  const checkpoint = object(record.checkpoint, 'checkpoint');
  if (checkpoint.serviceId !== binding.value.nativeScope.serviceId) {
    return invalidContract('checkpoint.serviceId');
  }
  switch (checkpoint.serviceId) {
    case 'wallet':
      return Object.freeze({
        binding: binding.value,
        checkpoint: readWalletCheckpoint(checkpoint),
      });
    case 'satyr':
      return Object.freeze({ binding: binding.value, checkpoint: readSatyrCheckpoint(checkpoint) });
    default:
      return invalidContract('checkpoint.serviceId');
  }
}

function readWalletCheckpoint(record: Record<string, unknown>): WalletMigrationCheckpointV1 {
  exactKeys(record, [
    'serviceId',
    'authorityRevision',
    'ownership',
    'identityDigest',
    'membershipDigest',
    'operationalDigest',
    'ledgerDigest',
    'paymentDigest',
    'postedBalanceMinor',
    'openReservationsMinor',
    'historicalUnattributedChargeCount',
    'environmentIds',
  ]);
  if (!Array.isArray(record.environmentIds)) return invalidContract('environmentIds');
  const environmentIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of record.environmentIds) {
    const id = textValue(raw, 'environmentIds');
    if (seen.has(id)) return invalidContract('environmentIds');
    seen.add(id);
    environmentIds.push(id);
  }
  environmentIds.sort();
  return Object.freeze({
    serviceId: 'wallet',
    authorityRevision: integer(record.authorityRevision, 'authorityRevision', 0),
    ownership: readSourceOwnership(record.ownership),
    identityDigest: digestValue(record.identityDigest, 'identityDigest'),
    membershipDigest: digestValue(record.membershipDigest, 'membershipDigest'),
    operationalDigest: digestValue(record.operationalDigest, 'operationalDigest'),
    ledgerDigest: digestValue(record.ledgerDigest, 'ledgerDigest'),
    paymentDigest: digestValue(record.paymentDigest, 'paymentDigest'),
    postedBalanceMinor: integer(
      record.postedBalanceMinor,
      'postedBalanceMinor',
      Number.MIN_SAFE_INTEGER,
    ),
    openReservationsMinor: integer(record.openReservationsMinor, 'openReservationsMinor', 0),
    historicalUnattributedChargeCount: integer(
      record.historicalUnattributedChargeCount,
      'historicalUnattributedChargeCount',
      0,
    ),
    environmentIds: Object.freeze(environmentIds),
  });
}

function readSatyrCheckpoint(record: Record<string, unknown>): SatyrMigrationCheckpointV1 {
  exactKeys(record, [
    'serviceId',
    'authorityRevision',
    'ownership',
    'identityDigest',
    'membershipDigest',
    'operationalDigest',
    'placementDigest',
    'placementCellId',
    'placementEpoch',
    'environment',
    'money',
  ]);
  if (record.environment !== 'development' && record.environment !== 'production') {
    return invalidContract('environment');
  }
  if (record.money !== 'no_customer_ledger') return invalidContract('money');
  return Object.freeze({
    serviceId: 'satyr',
    authorityRevision: integer(record.authorityRevision, 'authorityRevision', 1),
    ownership: readSourceOwnership(record.ownership),
    identityDigest: digestValue(record.identityDigest, 'identityDigest'),
    membershipDigest: digestValue(record.membershipDigest, 'membershipDigest'),
    operationalDigest: digestValue(record.operationalDigest, 'operationalDigest'),
    placementDigest: digestValue(record.placementDigest, 'placementDigest'),
    placementCellId: textValue(record.placementCellId, 'placementCellId'),
    placementEpoch: integer(record.placementEpoch, 'placementEpoch', 1),
    environment: record.environment,
    money: record.money,
  });
}

function readSourceOwnership(input: unknown): SourceAccountOwnershipV1 {
  const record = object(input, 'ownership');
  switch (record.kind) {
    case 'preserve_source_owners':
      exactKeys(record, ['kind', 'activeOwnerCount']);
      return Object.freeze({
        kind: record.kind,
        activeOwnerCount: integer(record.activeOwnerCount, 'activeOwnerCount', 1),
      });
    case 'unresolved':
      exactKeys(record, ['kind', 'reason']);
      if (record.reason !== 'owner_missing' && record.reason !== 'identity_unverified') {
        return invalidContract('ownership.reason');
      }
      return Object.freeze({ kind: record.kind, reason: record.reason });
    default:
      return invalidContract('ownership.kind');
  }
}

export interface AccountMigrationPlanV1 {
  readonly version: 1;
  readonly cohortId: string;
  readonly entries: readonly AccountMigrationEntryV1[];
  readonly billingAccounts: readonly {
    readonly namespace: string;
    readonly organizationId: string;
    readonly billingAccountId: string;
    readonly currency: 'USD';
    readonly money:
      | {
          readonly kind: 'preserve_ledger';
          readonly postedBalanceMinor: number;
          readonly openReservationsMinor: number;
          readonly ledgerDigest: string;
        }
      | { readonly kind: 'new_empty_account' };
  }[];
}

export interface AccountMigrationConflictV1 {
  readonly code:
    | 'native_scope_already_bound'
    | 'project_service_already_bound'
    | 'instance_already_bound'
    | 'account_merge_requires_mapping'
    | 'source_organization_split'
    | 'billing_account_conflict'
    | 'project_ownership_conflict'
    | 'source_checkpoint_conflict'
    | 'owner_mapping_required'
    | 'environment_already_bound';
  readonly instanceId: string;
}

function sourceOrganizationKey(entry: AccountMigrationEntryV1): string {
  const native = entry.binding.nativeScope;
  switch (native.serviceId) {
    case 'wallet':
      return JSON.stringify([
        native.serviceId,
        native.deploymentId,
        native.namespace,
        native.nativeOrganizationId,
      ]);
    case 'satyr':
      return JSON.stringify([native.serviceId, native.deploymentId, native.nativeOrganizationId]);
  }
}

function organizationCheckpointKey(checkpoint: WalletMigrationCheckpointV1): string {
  return JSON.stringify([
    checkpoint.authorityRevision,
    checkpoint.ownership,
    checkpoint.identityDigest,
    checkpoint.membershipDigest,
    checkpoint.ledgerDigest,
    checkpoint.paymentDigest,
    checkpoint.postedBalanceMinor,
    checkpoint.openReservationsMinor,
    checkpoint.historicalUnattributedChargeCount,
  ]);
}

function conflict(
  code: AccountMigrationConflictV1['code'],
  entry: AccountMigrationEntryV1,
): { readonly kind: 'rejected'; readonly error: AccountMigrationConflictV1 } {
  return { kind: 'rejected', error: { code, instanceId: entry.binding.instanceId } };
}

function compareEntries(left: AccountMigrationEntryV1, right: AccountMigrationEntryV1): number {
  return nativeTenantScopeKey(left.binding.nativeScope).localeCompare(
    nativeTenantScopeKey(right.binding.nativeScope),
  );
}

/** Build a reviewable dry run. Apply no schema, membership, or money mutation here. */
export function planAccountMigration(
  cohort: AccountMigrationCohortV1,
): PlatformResult<
  AccountMigrationPlanV1,
  AccountMigrationConflictV1 | { readonly code: 'inventory_mapping_incomplete' }
> {
  const inventory = new Set<string>();
  for (const scope of cohort.inventory) inventory.add(nativeTenantScopeKey(scope));
  if (cohort.entries.length !== inventory.size) {
    return { kind: 'rejected', error: { code: 'inventory_mapping_incomplete' } };
  }
  const nativeScopes = new Set<string>();
  const projectServices = new Set<string>();
  const instanceIds = new Set<string>();
  const accountSources = new Map<string, string>();
  const sourceAccounts = new Map<string, string>();
  const accountBilling = new Map<string, string>();
  const billingOwners = new Map<string, string>();
  const projectOwners = new Map<string, string>();
  const checkpoints = new Map<string, string>();
  const environments = new Set<string>();
  const billingAccounts: AccountMigrationPlanV1['billingAccounts'][number][] = [];
  const entries = [...cohort.entries].sort(compareEntries);
  for (const entry of entries) {
    if (entry.checkpoint.ownership.kind === 'unresolved')
      return conflict('owner_mapping_required', entry);
    const { instanceId, scope, nativeScope } = entry.binding;
    const nativeKey = nativeTenantScopeKey(nativeScope);
    if (!inventory.has(nativeKey)) {
      return { kind: 'rejected', error: { code: 'inventory_mapping_incomplete' } };
    }
    const accountKey = JSON.stringify([scope.namespace, scope.organizationId]);
    const billingKey = JSON.stringify([scope.namespace, scope.billingAccountId]);
    const projectKey = JSON.stringify([scope.namespace, scope.projectId]);
    const projectServiceKey = JSON.stringify([
      scope.namespace,
      scope.projectId,
      nativeScope.serviceId,
    ]);
    const instanceKey = JSON.stringify([scope.namespace, instanceId]);
    const sourceKey = sourceOrganizationKey(entry);
    if (nativeScopes.has(nativeKey)) return conflict('native_scope_already_bound', entry);
    if (projectServices.has(projectServiceKey))
      return conflict('project_service_already_bound', entry);
    if (instanceIds.has(instanceKey)) return conflict('instance_already_bound', entry);
    if (accountSources.has(accountKey) && accountSources.get(accountKey) !== sourceKey) {
      return conflict('account_merge_requires_mapping', entry);
    }
    if (sourceAccounts.has(sourceKey) && sourceAccounts.get(sourceKey) !== accountKey) {
      return conflict('source_organization_split', entry);
    }
    if (accountBilling.has(accountKey) && accountBilling.get(accountKey) !== billingKey) {
      return conflict('billing_account_conflict', entry);
    }
    if (billingOwners.has(billingKey) && billingOwners.get(billingKey) !== accountKey) {
      return conflict('billing_account_conflict', entry);
    }
    if (projectOwners.has(projectKey) && projectOwners.get(projectKey) !== accountKey) {
      return conflict('project_ownership_conflict', entry);
    }
    if (entry.checkpoint.serviceId === 'wallet') {
      const checkpointKey = organizationCheckpointKey(entry.checkpoint);
      if (checkpoints.has(sourceKey) && checkpoints.get(sourceKey) !== checkpointKey) {
        return conflict('source_checkpoint_conflict', entry);
      }
      checkpoints.set(sourceKey, checkpointKey);
      for (const environmentId of entry.checkpoint.environmentIds) {
        if (nativeScope.serviceId !== 'wallet')
          return conflict('source_checkpoint_conflict', entry);
        const environmentKey = JSON.stringify([
          nativeScope.deploymentId,
          nativeScope.namespace,
          environmentId,
        ]);
        if (environments.has(environmentKey)) return conflict('environment_already_bound', entry);
        environments.add(environmentKey);
      }
    }
    if (!accountSources.has(accountKey)) {
      billingAccounts.push({
        namespace: scope.namespace,
        organizationId: scope.organizationId,
        billingAccountId: scope.billingAccountId,
        currency: 'USD',
        money:
          entry.checkpoint.serviceId === 'wallet'
            ? {
                kind: 'preserve_ledger',
                postedBalanceMinor: entry.checkpoint.postedBalanceMinor,
                openReservationsMinor: entry.checkpoint.openReservationsMinor,
                ledgerDigest: entry.checkpoint.ledgerDigest,
              }
            : { kind: 'new_empty_account' },
      });
    }
    nativeScopes.add(nativeKey);
    projectServices.add(projectServiceKey);
    instanceIds.add(instanceKey);
    accountSources.set(accountKey, sourceKey);
    sourceAccounts.set(sourceKey, accountKey);
    accountBilling.set(accountKey, billingKey);
    billingOwners.set(billingKey, accountKey);
    projectOwners.set(projectKey, accountKey);
  }
  return {
    kind: 'accepted',
    value: { version: 1, cohortId: cohort.cohortId, entries, billingAccounts },
  };
}

export function reconcileAccountMigration(
  before: AccountMigrationCohortV1,
  after: AccountMigrationCohortV1,
): PlatformResult<
  AccountMigrationPlanV1,
  | AccountMigrationConflictV1
  | { readonly code: 'snapshot_changed' | 'inventory_mapping_incomplete' }
> {
  const initial = planAccountMigration(before);
  if (initial.kind === 'rejected') return initial;
  const resulting = planAccountMigration(after);
  if (resulting.kind === 'rejected') return resulting;
  if (JSON.stringify(initial.value) !== JSON.stringify(resulting.value)) {
    return { kind: 'rejected', error: { code: 'snapshot_changed' } };
  }
  return resulting;
}
