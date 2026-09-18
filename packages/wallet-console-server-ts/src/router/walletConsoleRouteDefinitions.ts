import {
  createConsoleRouteDefinitions,
  defineConsoleRoutes,
  type ConsoleRouteDefinition,
  type ConsoleRouteTuple,
} from '@seams-internal/console-server/router/consoleRouteDefinitions';
import type { ConsoleRouteSurface } from '@seams-internal/console-server/router/consoleRouteSurface';

const AUTHENTICATED_ROUTES: readonly ConsoleRouteTuple[] = [
  [
    'console_step_up_registration_options',
    'POST',
    '/console/step-up/webauthn/registration/options',
  ],
  ['console_step_up_registration_verify', 'POST', '/console/step-up/webauthn/registration/verify'],
  ['console_step_up_assertion_options', 'POST', '/console/step-up/webauthn/assertion/options'],
  ['console_step_up_assertion_verify', 'POST', '/console/step-up/webauthn/assertion/verify'],
];

const PROJECTS_MANAGE_ROUTES: readonly ConsoleRouteTuple[] = [
  ['console_tenant_root_create', 'POST', '/console/tenant-root/creation'],
];

const PROJECTS_MANAGE_STEP_UP_ROUTES: readonly ConsoleRouteTuple[] = [
  ['console_tenant_root_refresh', 'POST', '/console/tenant-root/refresh'],
];

const PROJECT_VIEW_ROUTES: readonly ConsoleRouteTuple[] = [
  ['console_approvals_list', 'GET', '/console/approvals'],
  ['console_approvals_get', 'GET', '/console/approvals/:id'],
  ['console_wallets_list', 'GET', '/console/wallets'],
  ['console_wallets_search', 'GET', '/console/wallets/search'],
  ['console_wallets_get', 'GET', '/console/wallets/:id'],
  ['console_wallet_balances_refresh', 'POST', '/console/wallets/balances/refresh'],
  ['console_policies_list', 'GET', '/console/policies'],
  ['console_policy_versions_list', 'GET', '/console/policies/:id/versions'],
  ['console_policy_assignments_list', 'GET', '/console/policies/assignments'],
  ['console_policies_simulate', 'POST', '/console/policies/:id/simulate'],
  ['console_policy_coverage_get', 'GET', '/console/policy/coverage'],
  ['console_gas_readiness_get', 'GET', '/console/gas/readiness'],
  ['console_export_governance_get', 'GET', '/console/export/governance'],
  ['console_key_exports_list', 'GET', '/console/key-exports'],
  ['console_runtime_snapshots_list', 'GET', '/console/runtime-snapshots'],
  ['console_runtime_snapshots_latest_get', 'GET', '/console/runtime-snapshots/latest'],
];

const PROJECT_EDIT_ROUTES: readonly ConsoleRouteTuple[] = [
  ['console_approvals_create', 'POST', '/console/approvals'],
  ['console_approvals_approve', 'POST', '/console/approvals/:id/approve'],
  ['console_approvals_reject', 'POST', '/console/approvals/:id/reject'],
  ['console_policies_create', 'POST', '/console/policies'],
  ['console_policy_assignments_upsert', 'PUT', '/console/policies/assignments'],
  ['console_policy_assignments_delete', 'DELETE', '/console/policies/assignments/:id'],
  ['console_policies_update', 'PATCH', '/console/policies/:id'],
  ['console_policies_delete', 'DELETE', '/console/policies/:id'],
  ['console_policies_publish', 'POST', '/console/policies/:id/publish'],
  ['console_key_exports_create', 'POST', '/console/key-exports'],
  ['console_key_exports_approve', 'POST', '/console/key-exports/:id/approve'],
  ['console_runtime_snapshots_publish', 'POST', '/console/runtime-snapshots/publish'],
  [
    'console_runtime_snapshots_publish_current',
    'POST',
    '/console/runtime-snapshots/publish-current',
  ],
];

const BILLING_VIEW_ROUTES: readonly ConsoleRouteTuple[] = [
  ['console_billing_sponsored_executions_get', 'GET', '/console/billing/sponsored-executions'],
  [
    'console_billing_sponsored_executions_reconciliation_get',
    'GET',
    '/console/billing/sponsored-executions/reconciliation',
  ],
  [
    'console_billing_usage_monthly_active_wallets',
    'GET',
    '/console/billing/usage/monthly-active-wallets',
  ],
];

const TENANT_ROOT_SECURITY_VIEW_ROUTES: readonly ConsoleRouteTuple[] = [
  ['console_restore_access_config', 'GET', '/console/tenant-root/security/restore-access'],
  ['console_restore_access_request', 'GET', '/console/tenant-root/security/restore-access/request'],
  ['console_backup_access_request', 'GET', '/console/tenant-root/security/backup-access/request'],
  ['console_cli_enrollment_request', 'GET', '/console/tenant-root/security/cli-enrollment/request'],
  ['console_tenant_root_security_status_get', 'GET', '/console/tenant-root/security/status'],
  ['console_tenant_root_security_rotation_get', 'GET', '/console/tenant-root/security/rotation'],
  ['console_tenant_root_security_manifest_get', 'GET', '/console/tenant-root/security/manifest'],
  ['console_tenant_root_security_restore_get', 'GET', '/console/tenant-root/security/restore'],
  ['console_tenant_root_security_trust_get', 'GET', '/console/tenant-root/security/trust'],
];

const TENANT_ROOT_SECURITY_OWNER_ROUTES: readonly ConsoleRouteTuple[] = [
  [
    'console_tenant_root_security_durable_verification_record',
    'POST',
    '/console/tenant-root/security/backup/durable-verification',
  ],
  [
    'console_tenant_root_security_operations_pending_get',
    'GET',
    '/console/tenant-root/security/operations/pending',
  ],
];

const TENANT_ROOT_SECURITY_RECOVERY_ROUTES: readonly ConsoleRouteTuple[] = [
  [
    'console_restore_access_approve',
    'POST',
    '/console/tenant-root/security/restore-access/approve',
  ],
  ['console_restore_access_deny', 'POST', '/console/tenant-root/security/restore-access/deny'],
  ['console_backup_access_approve', 'POST', '/console/tenant-root/security/backup-access/approve'],
  ['console_backup_access_deny', 'POST', '/console/tenant-root/security/backup-access/deny'],
  [
    'console_cli_enrollment_approve',
    'POST',
    '/console/tenant-root/security/cli-enrollment/approve',
  ],
  ['console_cli_enrollment_deny', 'POST', '/console/tenant-root/security/cli-enrollment/deny'],
  [
    'console_tenant_root_security_governance_set',
    'POST',
    '/console/tenant-root/security/governance',
  ],
  [
    'console_tenant_root_security_recipient_challenge_start',
    'POST',
    '/console/tenant-root/security/recipients/challenge',
  ],
  [
    'console_tenant_root_security_recipient_confirm',
    'POST',
    '/console/tenant-root/security/recipients/confirm',
  ],
  [
    'console_tenant_root_security_recipient_pair_commit',
    'POST',
    '/console/tenant-root/security/recipients/commit',
  ],
  ['console_tenant_root_security_backup_create', 'POST', '/console/tenant-root/security/backup'],
  [
    'console_tenant_root_security_role_package_download',
    'POST',
    '/console/tenant-root/security/backup/package',
  ],
  [
    'console_tenant_root_security_operation_approve',
    'POST',
    '/console/tenant-root/security/operations/approve',
  ],
  [
    'console_tenant_root_security_source_lineage_retire',
    'POST',
    '/console/tenant-root/security/source/retire',
  ],
];

const TENANT_ROOT_SECURITY_RESTORE_ROUTES: readonly ConsoleRouteTuple[] = [
  [
    'console_tenant_root_security_restore_bootstrap_session',
    'POST',
    '/console/tenant-root/security/restore/bootstrap-session',
  ],
  ['console_tenant_root_security_restore_start', 'POST', '/console/tenant-root/security/restore'],
  [
    'console_tenant_root_security_restore_manifest_register',
    'POST',
    '/console/tenant-root/security/restore/manifest',
  ],
  [
    'console_tenant_root_security_restore_import_key_issue',
    'POST',
    '/console/tenant-root/security/restore/import-key',
  ],
  [
    'console_tenant_root_security_restore_import',
    'POST',
    '/console/tenant-root/security/restore/import',
  ],
  [
    'console_tenant_root_security_restore_activate',
    'POST',
    '/console/tenant-root/security/restore/activate',
  ],
  [
    'console_tenant_root_security_restore_status',
    'GET',
    '/console/tenant-root/security/restore/status',
  ],
];

export function createWalletConsoleRouteDefinitions(): readonly ConsoleRouteDefinition[] {
  return Object.freeze([
    ...createWalletConsoleBaseRouteDefinitions(),
    ...defineConsoleRoutes('authenticated', AUTHENTICATED_ROUTES),
    ...defineConsoleRoutes('projects.manage', PROJECTS_MANAGE_ROUTES),
    ...defineConsoleRoutes('projects.manage.step_up', PROJECTS_MANAGE_STEP_UP_ROUTES),
    ...defineConsoleRoutes('project.view', TENANT_ROOT_SECURITY_VIEW_ROUTES),
    ...defineConsoleRoutes('owner', TENANT_ROOT_SECURITY_OWNER_ROUTES),
    ...defineConsoleRoutes('owner.step_up', TENANT_ROOT_SECURITY_RECOVERY_ROUTES),
    ...defineConsoleRoutes('owner.step_up', TENANT_ROOT_SECURITY_RESTORE_ROUTES),
  ]);
}

export function createWalletConsoleBaseRouteDefinitions(): readonly ConsoleRouteDefinition[] {
  return Object.freeze([
    ...defineConsoleRoutes('project.view', PROJECT_VIEW_ROUTES),
    ...defineConsoleRoutes('project.edit', PROJECT_EDIT_ROUTES),
    ...defineConsoleRoutes('billing.view', BILLING_VIEW_ROUTES),
  ]);
}

export function composeConsoleRouteDefinitions(
  core: readonly ConsoleRouteDefinition[],
  wallet: readonly ConsoleRouteDefinition[],
): readonly ConsoleRouteDefinition[] {
  const ids = new Set<string>();
  const endpoints = new Set<string>();
  const definitions: ConsoleRouteDefinition[] = [];

  for (const definition of [...core, ...wallet]) {
    const endpoint = `${definition.method} ${definition.path}`;
    if (ids.has(definition.id)) {
      throw new Error(`Duplicate Console route id: ${definition.id}`);
    }
    if (endpoints.has(endpoint)) {
      throw new Error(`Duplicate Console route endpoint: ${endpoint}`);
    }
    ids.add(definition.id);
    endpoints.add(endpoint);
    definitions.push(definition);
  }

  return Object.freeze(definitions);
}

export function createComposedConsoleRouteDefinitions(): readonly ConsoleRouteDefinition[] {
  return composeConsoleRouteDefinitions(
    createConsoleRouteDefinitions(),
    createWalletConsoleRouteDefinitions(),
  );
}

export function resolveWalletConsoleRouteSurface(): ConsoleRouteSurface {
  return {
    routeDefinitions: composeConsoleRouteDefinitions(
      createConsoleRouteDefinitions(),
      createWalletConsoleBaseRouteDefinitions(),
    ),
  };
}

export function resolveCompleteWalletConsoleRouteSurface(): ConsoleRouteSurface {
  return {
    routeDefinitions: createComposedConsoleRouteDefinitions(),
  };
}
