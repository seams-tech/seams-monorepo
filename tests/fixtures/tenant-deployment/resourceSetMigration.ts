import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { encodeTenantDeploymentJsonValueV1 } from '../../../packages/wallet-console-shared-ts/src/tenant-deployment';
import { TenantResourceVerificationV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { developmentBindingBody, deploymentResource } from '../../helpers/tenantDeploymentFixtures';

// Historical wire records belong only at this migration-test boundary.
export async function seedSingleResourceDeployment(database: D1DatabaseLike) {
  const nowMs = Date.now();
  const { resources, ...body } = developmentBindingBody(nowMs, 'before-resource-set');
  const legacyBody = { ...body, home: resources[0] };
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(encodeTenantDeploymentJsonValueV1(legacyBody)),
  );
  const binding = { ...legacyBody, revision: `tdb_${Buffer.from(digest).toString('base64url')}` };
  const operationId = 'tco_before_resource_set';
  const pendingOperationId = 'tco_pending_resource_set';
  const resource = deploymentResource(body.tenant.namespace, resources[0].databaseId);
  const { resource: verifiedResource, ...verification } =
    TenantResourceVerificationV1.forLocalDevelopment(resource, body.deploymentLane, nowMs);
  const legacyVerification = { ...verification, home: verifiedResource };
  const ready = {
    kind: 'ready',
    operationId,
    deploymentLane: body.deploymentLane,
    binding,
    expectedActiveRevision: null,
    readinessReceipt: {
      kind: 'tenant_deployment_readiness_receipt_v1',
      bindingRevision: binding.revision,
      expectedActiveRevision: null,
      checkedAtMs: nowMs,
      expiresAtMs: nowMs + 60_000,
      evidenceDigestB64u: 'migration-fixture',
      durableWalletCount: 0,
      inFlightCeremonyCount: 0,
    },
  };
  const receipt = {
    kind: 'tenant_deployment_activation_receipt_v1',
    bindingRevision: binding.revision,
    previousRevision: null,
    activationSequence: 1,
    activatedAtMs: nowMs,
  };
  const active = {
    kind: 'active',
    operationId,
    deploymentLane: body.deploymentLane,
    binding,
    activationReceipt: receipt,
  };
  await database
    .prepare(
      `INSERT INTO tenant_deployment_bindings (
    deployment_lane, revision, schema_version, binding_json, namespace, org_id, project_id,
    environment_id, tenant_root_identity_digest_b64u, custody_lineage_id, credential_id,
    runtime_policy_digest_b64u, created_at_ms
  ) VALUES (?1,?2,1,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
    )
    .bind(
      binding.deploymentLane,
      binding.revision,
      JSON.stringify(binding),
      body.tenant.namespace,
      body.tenant.organizationId,
      body.tenant.projectId,
      body.tenant.environmentId,
      body.tenantRoot.identityDigestB64u,
      body.tenantRoot.custodyLineageId,
      body.browserCredential.credentialId,
      body.runtimePolicyDigestB64u,
      nowMs,
    )
    .run();
  await database
    .prepare('INSERT INTO tenant_deployment_cutovers VALUES (?1,?2,?3,?4,4,?5,?5)')
    .bind(operationId, body.deploymentLane, 'ready', JSON.stringify(ready), nowMs)
    .run();
  await database
    .prepare(
      `INSERT INTO tenant_deployment_activations (
    operation_id, deployment_lane, binding_revision, expected_previous_revision,
    expected_activation_sequence, activation_sequence, activated_at_ms, expected_cutover_record_revision,
    ready_state_json, active_state_json, receipt_json, home_account_id, home_database_id, home_verification_json
  ) VALUES (?1,?2,?3,NULL,NULL,1,?4,4,?5,?6,?7,?8,?9,?10)`,
    )
    .bind(
      operationId,
      body.deploymentLane,
      binding.revision,
      nowMs,
      JSON.stringify(ready),
      JSON.stringify(active),
      JSON.stringify(receipt),
      resource.accountId,
      resource.databaseId,
      JSON.stringify(legacyVerification),
    )
    .run();
  await database
    .prepare('INSERT INTO tenant_deployment_cutovers VALUES (?1,?2,?3,?4,4,?5,?5)')
    .bind(
      pendingOperationId,
      body.deploymentLane,
      'ready',
      JSON.stringify({ ...ready, operationId: pendingOperationId }),
      nowMs,
    )
    .run();
  return { operationId, pendingOperationId, challengeId: verification.challengeId };
}
