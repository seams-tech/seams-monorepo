import {
  ServiceTenantBindingV1,
  type AcceptedServiceReceiptV1,
  type PlatformScopeV1,
  type ServiceBindingRequestV1,
  type ServiceProvisionCommandV1,
} from '@seams-internal/console-shared/accountPlatform';
import { textValue } from '@seams-internal/console-shared/accountPlatform/boundary';
import { secureRandomBase36 } from '../boundary';
import {
  queryD1All,
  queryD1One,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1Row,
} from '../boundary/d1';
import type {
  ConsoleOrganizationAccessService,
  OrganizationAccessContext,
} from '../teamRbac/service';
import type { ActiveOrganizationAuthorization } from '../teamRbac/types';
import { ensureAccountPlatformD1Schema } from './schema';
import {
  AccountServiceInstanceV1,
  readPlatformScopeColumns,
  readProvisionCommandColumn,
  platformScopesEqual,
  type AccountPlatformError,
  type AccountPlatformResult,
  type ServiceProducerAuthorityV1,
  type ServiceProvisionAcknowledgementV1,
  type ServiceProvisionDeliveryV1,
} from './types';

export interface D1AccountPlatformServiceOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  readonly organizationAccess: ConsoleOrganizationAccessService;
  readonly now?: () => Date;
}

export interface RequestServiceProvisionV1 {
  readonly scope: PlatformScopeV1;
  readonly command: ServiceProvisionCommandV1;
}

export interface WalletNativeAdmissionScopeV1 {
  readonly namespace: string;
  readonly nativeOrganizationId: string;
  readonly nativeProjectId: string;
}

const INSTANCE_QUERY = `SELECT i.*, o.payload_json, r.payload_json AS receipt_json
  FROM platform_service_instances i
  JOIN platform_provision_operations o ON o.namespace = i.namespace AND o.id = i.operation_id
  LEFT JOIN platform_provision_receipts r ON r.namespace = o.namespace AND r.operation_id = o.id`;

function defaultNow(): Date {
  return new Date();
}

function accepted<T>(value: T): AccountPlatformResult<T> {
  return { kind: 'accepted', value };
}

function rejected<T>(code: AccountPlatformError['code']): AccountPlatformResult<T> {
  return { kind: 'rejected', error: { code } };
}

function persistedInstance(row: D1Row): AccountServiceInstanceV1 {
  return AccountServiceInstanceV1.fromStorage(row);
}

function hasProjectVisibility(
  authorization: ActiveOrganizationAuthorization,
  projectId: string,
): boolean {
  switch (authorization.projectAccess.kind) {
    case 'all':
      return true;
    case 'assigned':
      for (const assignment of authorization.projectAccess.assignments) {
        if (assignment.projectId === projectId) return true;
      }
      return false;
  }
}

function bindingAuthority(
  binding: ServiceBindingRequestV1 | ServiceTenantBindingV1,
): ServiceProducerAuthorityV1 {
  if (binding instanceof ServiceTenantBindingV1) {
    return {
      serviceId: binding.nativeScope.serviceId,
      deploymentId: binding.nativeScope.deploymentId,
    };
  }
  if (binding.kind === 'attach_existing_scope') {
    return {
      serviceId: binding.nativeScope.serviceId,
      deploymentId: binding.nativeScope.deploymentId,
    };
  }
  return { serviceId: binding.serviceId, deploymentId: binding.configuration.deploymentId };
}

function authorityMatches(row: D1Row, authority: ServiceProducerAuthorityV1): boolean {
  return row.service_id === authority.serviceId && row.deployment_id === authority.deploymentId;
}

function commandScopeMatches(command: ServiceProvisionCommandV1, scope: PlatformScopeV1): boolean {
  const binding = command.binding;
  if (binding instanceof ServiceTenantBindingV1) return platformScopesEqual(binding.scope, scope);
  return binding.kind === 'attach_existing_scope' || platformScopesEqual(binding.parent, scope);
}

function receiptMatchesTarget(
  receipt: AcceptedServiceReceiptV1,
  command: ServiceProvisionCommandV1,
): boolean {
  const target = command.binding;
  if (target instanceof ServiceTenantBindingV1)
    return JSON.stringify(target) === JSON.stringify(receipt.binding);
  if (target.kind === 'attach_existing_scope') {
    return JSON.stringify(target.nativeScope) === JSON.stringify(receipt.binding.nativeScope);
  }
  const native = receipt.binding.nativeScope;
  if (
    target.serviceId !== native.serviceId ||
    target.configuration.deploymentId !== native.deploymentId
  )
    return false;
  return (
    target.serviceId !== 'wallet' ||
    (native.serviceId === 'wallet' && target.configuration.namespace === native.namespace)
  );
}

function receiptResult(command: ServiceProvisionCommandV1): AcceptedServiceReceiptV1['result'] {
  switch (command.command) {
    case 'enable':
      return 'active';
    case 'disable':
      return 'disabled';
    case 'archive':
      return 'archived';
  }
}

function transactionError(error: unknown): AccountPlatformError['code'] | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('platform_scope_forbidden')) return 'scope_forbidden';
  if (message.includes('platform_instance_archived')) return 'instance_archived';
  if (message.includes('platform_transition_conflict')) return 'transition_conflict';
  if (
    message.includes('platform_binding_conflict') ||
    message.includes('platform_receipt_conflict')
  )
    return 'binding_conflict';
  if (
    message.includes('UNIQUE constraint failed: wallet_service_bindings') ||
    message.includes('UNIQUE constraint failed: satyr_service_bindings')
  )
    return 'binding_conflict';
  if (
    message.includes('UNIQUE constraint failed: platform_service_instances') ||
    message.includes('UNIQUE constraint failed: platform_provision_operations')
  )
    return 'operation_conflict';
  return null;
}

function commandHex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

async function commandDigest(payload: string): Promise<string> {
  const result = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(result)).map(commandHex).join('');
}

function nativeBindingStatement(
  database: D1DatabaseLike,
  binding: ServiceTenantBindingV1,
): D1PreparedStatementLike {
  const native = binding.nativeScope;
  if (native.serviceId === 'wallet') {
    return database
      .prepare(
        `INSERT INTO wallet_service_bindings
      (namespace, instance_id, deployment_id, native_namespace, native_org_id, native_project_id, binding_json)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(namespace, instance_id) DO NOTHING`,
      )
      .bind(
        binding.scope.namespace,
        binding.instanceId,
        native.deploymentId,
        native.namespace,
        native.nativeOrganizationId,
        native.nativeProjectId,
        JSON.stringify(binding),
      );
  }
  return database
    .prepare(
      `INSERT INTO satyr_service_bindings
    (namespace, instance_id, deployment_id, native_org_id, binding_json)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(namespace, instance_id) DO NOTHING`,
    )
    .bind(
      binding.scope.namespace,
      binding.instanceId,
      native.deploymentId,
      native.nativeOrganizationId,
      JSON.stringify(binding),
    );
}

function attachedBinding(
  command: ServiceProvisionCommandV1,
  scope: PlatformScopeV1,
): ServiceTenantBindingV1 | null {
  if (command.binding instanceof ServiceTenantBindingV1) return command.binding;
  if (command.binding.kind !== 'attach_existing_scope') return null;
  const parsed = ServiceTenantBindingV1.parse({
    instanceId: command.instanceId,
    scope,
    nativeScope: command.binding.nativeScope,
  });
  if (parsed.kind === 'rejected') throw new Error('Invalid native attachment');
  return parsed.value;
}

/** Commands and observations share one D1 transaction boundary. Delivery can safely repeat. */
export class D1AccountPlatformService {
  private readonly database: D1DatabaseLike;
  private readonly namespace: string;
  private readonly access: ConsoleOrganizationAccessService;
  private readonly now: () => Date;

  constructor(options: D1AccountPlatformServiceOptions) {
    this.database = options.database;
    this.namespace = options.namespace;
    this.access = options.organizationAccess;
    this.now = options.now ?? defaultNow;
  }

  async ensureSchema(): Promise<void> {
    await ensureAccountPlatformD1Schema(this.database);
  }

  private async authorize(
    ctx: OrganizationAccessContext,
    manage: boolean,
  ): Promise<ActiveOrganizationAuthorization | null> {
    const authorization = await this.access.lookupAuthorization({
      orgId: ctx.orgId,
      userId: ctx.actorUserId,
    });
    if (!authorization || authorization.kind !== 'authorized') return null;
    if (
      manage &&
      authorization.role !== 'OWNER' &&
      (authorization.role !== 'ADMIN' ||
        !authorization.adminPermissions.includes('projects.manage'))
    )
      return null;
    return authorization;
  }

  async bindProjectBilling(
    ctx: OrganizationAccessContext,
    projectId: string,
  ): Promise<AccountPlatformResult<PlatformScopeV1>> {
    const authorization = await this.authorize(ctx, true);
    if (!authorization) return rejected('scope_forbidden');
    const accountId = `payer_${secureRandomBase36(20, 'billing account identity')}`;
    // Both inserts use the same current authority revision. D1 batch rolls back both on failure.
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO organization_billing_accounts (namespace, org_id, id, currency, created_at_ms)
        SELECT o.namespace, o.id, ?, 'USD', ? FROM organizations o
        JOIN projects p ON p.namespace = o.namespace AND p.org_id = o.id
        WHERE o.namespace = ? AND o.id = ? AND o.authorization_version = ? AND o.status = 'ACTIVE'
          AND p.id = ? AND p.status = 'ACTIVE'
        ON CONFLICT(namespace, org_id) DO NOTHING`,
        )
        .bind(
          accountId,
          this.now().getTime(),
          this.namespace,
          ctx.orgId,
          authorization.authorizationVersion,
          projectId,
        ),
      this.database
        .prepare(
          `INSERT INTO project_billing_bindings (namespace, org_id, project_id, billing_account_id)
        SELECT o.namespace, o.id, p.id, a.id FROM organizations o
        JOIN projects p ON p.namespace = o.namespace AND p.org_id = o.id
        JOIN organization_billing_accounts a ON a.namespace = o.namespace AND a.org_id = o.id
        WHERE o.namespace = ? AND o.id = ? AND o.authorization_version = ? AND o.status = 'ACTIVE'
          AND p.id = ? AND p.status = 'ACTIVE'
        ON CONFLICT(namespace, project_id) DO NOTHING`,
        )
        .bind(this.namespace, ctx.orgId, authorization.authorizationVersion, projectId),
    ]);
    const row = await queryD1One(
      this.database,
      `SELECT namespace, org_id, project_id, billing_account_id
      FROM project_billing_bindings WHERE namespace = ? AND org_id = ? AND project_id = ?`,
      [this.namespace, ctx.orgId, projectId],
    );
    if (
      !row ||
      (await this.access.getAuthorizationVersion(ctx.orgId)) !== authorization.authorizationVersion
    )
      return rejected('scope_forbidden');
    return accepted(readPlatformScopeColumns(row));
  }

  async requestProvision(
    ctx: OrganizationAccessContext,
    request: RequestServiceProvisionV1,
  ): Promise<AccountPlatformResult<AccountServiceInstanceV1>> {
    const { scope, command } = request;
    if (
      scope.namespace !== this.namespace ||
      scope.organizationId !== ctx.orgId ||
      !commandScopeMatches(command, scope)
    )
      return rejected('scope_forbidden');
    const projectBinding = await queryD1One(
      this.database,
      `SELECT namespace, org_id, project_id, billing_account_id FROM project_billing_bindings
        WHERE namespace = ? AND org_id = ? AND project_id = ?`,
      [this.namespace, ctx.orgId, scope.projectId],
    );
    if (!projectBinding || !platformScopesEqual(readPlatformScopeColumns(projectBinding), scope)) {
      return rejected('scope_forbidden');
    }
    const authorization = await this.authorize(ctx, true);
    if (!authorization) return rejected('scope_forbidden');
    const authority = bindingAuthority(command.binding);
    const payload = JSON.stringify(command);
    const payloadDigest = await commandDigest(payload);
    const existing = await queryD1One(
      this.database,
      `SELECT * FROM platform_provision_operations WHERE namespace = ? AND id = ?`,
      [this.namespace, command.operationId],
    );
    if (existing) {
      if (
        existing.payload_digest !== payloadDigest ||
        !platformScopesEqual(readPlatformScopeColumns(existing), scope)
      )
        return rejected('operation_conflict');
      return await this.getInstance(ctx, command.instanceId);
    }
    const statements = [
      this.database
        .prepare(
          `INSERT INTO platform_provision_operations
      (namespace, id, instance_id, org_id, project_id, billing_account_id, service_id, deployment_id,
       desired_revision, command, payload_json, payload_digest, status, actor_user_id, authority_revision, failure_code, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, ?)`,
        )
        .bind(
          this.namespace,
          command.operationId,
          command.instanceId,
          scope.organizationId,
          scope.projectId,
          scope.billingAccountId,
          authority.serviceId,
          authority.deploymentId,
          command.desiredRevision,
          command.command,
          payload,
          payloadDigest,
          ctx.actorUserId,
          authorization.authorizationVersion,
          this.now().getTime(),
        ),
    ];
    const binding = attachedBinding(command, scope);
    if (binding) statements.push(nativeBindingStatement(this.database, binding));
    try {
      await this.database.batch(statements);
    } catch (error) {
      const code = transactionError(error);
      if (code === null) throw error;
      // A matching concurrent insert is a successful replay.
      if (code === 'operation_conflict') {
        const replay = await queryD1One(
          this.database,
          `SELECT * FROM platform_provision_operations WHERE namespace = ? AND id = ?`,
          [this.namespace, command.operationId],
        );
        if (
          replay &&
          replay.payload_digest === payloadDigest &&
          platformScopesEqual(readPlatformScopeColumns(replay), scope)
        )
          return await this.getInstance(ctx, command.instanceId);
      }
      return rejected(code);
    }
    return await this.getInstance(ctx, command.instanceId);
  }

  async getInstance(
    ctx: OrganizationAccessContext,
    instanceId: string,
  ): Promise<AccountPlatformResult<AccountServiceInstanceV1>> {
    const authorization = await this.authorize(ctx, false);
    if (!authorization) return rejected('scope_forbidden');
    const row = await queryD1One(
      this.database,
      `${INSTANCE_QUERY} WHERE i.namespace = ? AND i.org_id = ? AND i.id = ?`,
      [this.namespace, ctx.orgId, instanceId],
    );
    if (!row) return rejected('instance_not_found');
    const instance = persistedInstance(row);
    if (!hasProjectVisibility(authorization, instance.scope.projectId))
      return rejected('scope_forbidden');
    if (
      (await this.access.getAuthorizationVersion(ctx.orgId)) !== authorization.authorizationVersion
    )
      return rejected('scope_forbidden');
    return accepted(instance);
  }

  async listInstances(
    ctx: OrganizationAccessContext,
    projectId: string,
  ): Promise<AccountPlatformResult<readonly AccountServiceInstanceV1[]>> {
    const authorization = await this.authorize(ctx, false);
    if (!authorization) return rejected('scope_forbidden');
    if (!hasProjectVisibility(authorization, projectId)) return rejected('scope_forbidden');
    const rows = await queryD1All(
      this.database,
      `${INSTANCE_QUERY} WHERE i.namespace = ? AND i.org_id = ? AND i.project_id = ? ORDER BY i.service_id`,
      [this.namespace, ctx.orgId, projectId],
    );
    if (
      (await this.access.getAuthorizationVersion(ctx.orgId)) !== authorization.authorizationVersion
    )
      return rejected('scope_forbidden');
    return accepted(rows.map(persistedInstance));
  }

  async pendingProvision(
    authority: ServiceProducerAuthorityV1,
    limit: number,
  ): Promise<readonly ServiceProvisionDeliveryV1[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Provision delivery limit must be between 1 and 100');
    const rows = await queryD1All(
      this.database,
      `SELECT o.* FROM platform_provision_operations o
      JOIN platform_service_instances i ON i.namespace = o.namespace AND i.operation_id = o.id
      WHERE o.namespace = ? AND o.service_id = ? AND o.deployment_id = ? AND o.status = 'pending'
      ORDER BY o.created_at_ms, o.id LIMIT ?`,
      [this.namespace, authority.serviceId, authority.deploymentId, limit],
    );
    return rows.map(provisionDelivery);
  }

  async checkWalletAdmission(
    authority: ServiceProducerAuthorityV1,
    nativeScope: WalletNativeAdmissionScopeV1,
  ): Promise<AccountPlatformResult<PlatformScopeV1>> {
    if (authority.serviceId !== 'wallet') return rejected('scope_forbidden');
    const row = await queryD1One(
      this.database,
      `SELECT i.namespace, i.org_id, i.project_id, i.billing_account_id
        FROM wallet_service_bindings b
        JOIN platform_service_instances i ON i.namespace = b.namespace AND i.id = b.instance_id
        JOIN organizations o ON o.namespace = i.namespace AND o.id = i.org_id
        JOIN projects p ON p.namespace = i.namespace AND p.id = i.project_id AND p.org_id = i.org_id
        WHERE i.namespace = ? AND i.service_id = 'wallet' AND i.deployment_id = ?
          AND b.deployment_id = ? AND b.native_namespace = ? AND b.native_org_id = ? AND b.native_project_id = ?
          AND i.phase = 'active' AND i.desired_state = 'enabled' AND i.observed_state = 'active'
          AND i.desired_revision = i.observed_revision AND o.status = 'ACTIVE' AND p.status = 'ACTIVE'`,
      [
        this.namespace,
        authority.deploymentId,
        authority.deploymentId,
        nativeScope.namespace,
        nativeScope.nativeOrganizationId,
        nativeScope.nativeProjectId,
      ],
    );
    return row ? accepted(readPlatformScopeColumns(row)) : rejected('scope_forbidden');
  }

  async resolveWalletBinding(
    authority: ServiceProducerAuthorityV1,
    nativeScope: WalletNativeAdmissionScopeV1,
  ): Promise<AccountPlatformResult<ServiceTenantBindingV1>> {
    if (authority.serviceId !== 'wallet') return rejected('scope_forbidden');
    const row = await queryD1One(
      this.database,
      `SELECT i.namespace, i.id, i.org_id, i.project_id, i.billing_account_id, b.binding_json
       FROM wallet_service_bindings b
       JOIN platform_service_instances i ON i.namespace = b.namespace AND i.id = b.instance_id
       WHERE i.namespace = ? AND i.service_id = 'wallet' AND i.deployment_id = ?
         AND b.deployment_id = ? AND b.native_namespace = ? AND b.native_org_id = ? AND b.native_project_id = ?
         AND EXISTS (
           SELECT 1 FROM platform_provision_operations o
           JOIN platform_provision_receipts r ON r.namespace = o.namespace AND r.operation_id = o.id
           WHERE o.namespace = i.namespace AND o.instance_id = i.id AND o.service_id = 'wallet'
             AND o.deployment_id = ? AND r.result = 'active' AND r.disposition = 'applied'
         )`,
      [
        this.namespace,
        authority.deploymentId,
        authority.deploymentId,
        nativeScope.namespace,
        nativeScope.nativeOrganizationId,
        nativeScope.nativeProjectId,
        authority.deploymentId,
      ],
    );
    if (!row || typeof row.binding_json !== 'string') return rejected('scope_forbidden');
    const binding = ServiceTenantBindingV1.parse(JSON.parse(row.binding_json));
    if (binding.kind === 'rejected') throw new Error('Invalid persisted Wallet binding');
    const native = binding.value.nativeScope;
    if (
      binding.value.instanceId !== row.id ||
      !platformScopesEqual(binding.value.scope, readPlatformScopeColumns(row)) ||
      native.serviceId !== 'wallet' ||
      native.deploymentId !== authority.deploymentId ||
      native.namespace !== nativeScope.namespace ||
      native.nativeOrganizationId !== nativeScope.nativeOrganizationId ||
      native.nativeProjectId !== nativeScope.nativeProjectId
    ) {
      throw new Error('Persisted Wallet binding disagrees with its native scope');
    }
    return accepted(binding.value);
  }

  async resolveServiceProducerInstance(
    authority: ServiceProducerAuthorityV1,
    instanceId: string,
  ): Promise<AccountPlatformResult<AccountServiceInstanceV1>> {
    const row = await queryD1One(
      this.database,
      `${INSTANCE_QUERY} WHERE i.namespace = ? AND i.id = ? AND i.service_id = ? AND i.deployment_id = ?`,
      [this.namespace, instanceId, authority.serviceId, authority.deploymentId],
    );
    return row ? accepted(persistedInstance(row)) : rejected('scope_forbidden');
  }

  async resolveWalletServiceProducerInstance(
    authority: ServiceProducerAuthorityV1,
    nativeScope: WalletNativeAdmissionScopeV1,
  ): Promise<AccountPlatformResult<AccountServiceInstanceV1>> {
    const admitted = await this.checkWalletAdmission(authority, nativeScope);
    if (admitted.kind === 'rejected') return admitted;
    const binding = await this.resolveWalletBinding(authority, nativeScope);
    if (binding.kind === 'rejected') return binding;
    const instance = await this.resolveServiceProducerInstance(authority, binding.value.instanceId);
    if (instance.kind === 'rejected') return instance;
    return instance.value.state.kind === 'active' ? instance : rejected('scope_forbidden');
  }

  async acknowledgeProvision(
    authority: ServiceProducerAuthorityV1,
    receipt: AcceptedServiceReceiptV1,
  ): Promise<AccountPlatformResult<ServiceProvisionAcknowledgementV1>> {
    const operation = await queryD1One(
      this.database,
      `SELECT * FROM platform_provision_operations WHERE namespace = ? AND id = ?`,
      [this.namespace, receipt.operationId],
    );
    if (!operation || !authorityMatches(operation, authority)) return rejected('scope_forbidden');
    const command = readProvisionCommandColumn(operation.payload_json);
    const scope = readPlatformScopeColumns(operation);
    if (
      receipt.instanceId !== command.instanceId ||
      receipt.desiredRevision !== command.desiredRevision ||
      receipt.result !== receiptResult(command) ||
      !platformScopesEqual(receipt.binding.scope, scope) ||
      bindingAuthority(receipt.binding).serviceId !== authority.serviceId ||
      bindingAuthority(receipt.binding).deploymentId !== authority.deploymentId ||
      !receiptMatchesTarget(receipt, command)
    )
      return rejected('binding_conflict');
    const payload = JSON.stringify(receipt);
    const previous = await queryD1One(
      this.database,
      `SELECT * FROM platform_provision_receipts WHERE namespace = ? AND operation_id = ?`,
      [this.namespace, receipt.operationId],
    );
    if (previous && previous.payload_json !== payload) return rejected('operation_conflict');
    if (!previous) {
      try {
        await this.database.batch([
          nativeBindingStatement(this.database, receipt.binding),
          this.database
            .prepare(
              `INSERT INTO platform_provision_receipts
            (namespace, operation_id, payload_json, result, disposition, received_at_ms)
            SELECT ?, ?, ?, ?, CASE WHEN i.desired_revision = ? THEN 'applied' ELSE 'stale' END, ?
            FROM platform_service_instances i WHERE i.namespace = ? AND i.id = ?
            ON CONFLICT(namespace, operation_id) DO NOTHING`,
            )
            .bind(
              this.namespace,
              receipt.operationId,
              payload,
              receipt.result,
              receipt.desiredRevision,
              this.now().getTime(),
              this.namespace,
              receipt.instanceId,
            ),
        ]);
      } catch (error) {
        const code = transactionError(error);
        if (code === null) throw error;
        return rejected(code);
      }
    }
    const saved = await queryD1One(
      this.database,
      `SELECT * FROM platform_provision_receipts WHERE namespace = ? AND operation_id = ?`,
      [this.namespace, receipt.operationId],
    );
    if (!saved || saved.payload_json !== payload) return rejected('operation_conflict');
    const instance = await queryD1One(
      this.database,
      `${INSTANCE_QUERY} WHERE i.namespace = ? AND i.id = ?`,
      [this.namespace, receipt.instanceId],
    );
    if (!instance) throw new Error('Provision receipt has no instance');
    if (saved.disposition !== 'applied' && saved.disposition !== 'stale')
      throw new Error('Invalid receipt disposition');
    return accepted({ disposition: saved.disposition, instance: persistedInstance(instance) });
  }

  async failProvision(
    authority: ServiceProducerAuthorityV1,
    input: { readonly operationId: string; readonly failureCode: string },
  ): Promise<AccountPlatformResult<AccountServiceInstanceV1>> {
    const operation = await queryD1One(
      this.database,
      `SELECT * FROM platform_provision_operations WHERE namespace = ? AND id = ?`,
      [this.namespace, input.operationId],
    );
    if (!operation || !authorityMatches(operation, authority)) return rejected('scope_forbidden');
    if (
      operation.status === 'applied' ||
      (operation.status === 'failed' && operation.failure_code !== input.failureCode)
    )
      return rejected('operation_conflict');
    await this.database
      .prepare(
        `UPDATE platform_provision_operations SET status = 'failed', failure_code = ?
      WHERE namespace = ? AND id = ? AND status = 'pending'`,
      )
      .bind(input.failureCode, this.namespace, input.operationId)
      .run();
    const instance = await queryD1One(
      this.database,
      `${INSTANCE_QUERY} WHERE i.namespace = ? AND i.id = ?`,
      [this.namespace, operation.instance_id],
    );
    if (!instance) throw new Error('Failed provision operation has no instance');
    return accepted(persistedInstance(instance));
  }

  async assertOrganizationCanBeDeleted(ctx: OrganizationAccessContext): Promise<void> {
    const authorization = await this.authorize(ctx, true);
    if (!authorization) throw new Error('scope_forbidden');
    const instance = await queryD1One(
      this.database,
      `SELECT id FROM platform_service_instances WHERE namespace = ? AND org_id = ? LIMIT 1`,
      [this.namespace, ctx.orgId],
    );
    if (instance) throw new Error('service_instances_exist');
  }
}

function provisionDelivery(row: D1Row): ServiceProvisionDeliveryV1 {
  const command = readProvisionCommandColumn(row.payload_json);
  const authority = bindingAuthority(command.binding);
  if (!authorityMatches(row, authority) || typeof row.payload_digest !== 'string')
    throw new Error('Invalid persisted provision authority');
  return {
    scope: readPlatformScopeColumns(row),
    command,
    authority,
    payloadDigest: row.payload_digest,
    requestedByUserId: textValue(row.actor_user_id, 'actor_user_id'),
  };
}

export function createD1AccountPlatformService(
  options: D1AccountPlatformServiceOptions,
): D1AccountPlatformService {
  return new D1AccountPlatformService(options);
}
