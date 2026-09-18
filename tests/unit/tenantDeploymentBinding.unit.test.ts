import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ConsoleAuthAdapter } from '../../packages/console-server-ts/src/router/consoleAuth';
import {
  buildTenantDeploymentBindingV1,
  decodeTenantDeploymentBindingV1,
  decodeTenantDeploymentCutoverV1,
  type TenantDeploymentBindingBodyV1,
} from '../../packages/wallet-console-shared-ts/src/tenant-deployment';
import {
  createD1TenantDeploymentServiceV1,
  createD1TenantDeploymentSetupAdmissionReaderV1,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/d1';
import { createTenantDeploymentReadinessServiceV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/readiness';
import { createTenantDeploymentConsoleRouteV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/consoleRoute';
import {
  createTenantDeploymentRuntimeInspectionClientV1,
  createTenantDeploymentRuntimeInspectionHandlerV1,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/runtimeInspection';
import { createTenantDeploymentPublicProjectionHandlerV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/publicProjection';
import {
  bindTenantDeploymentToRuntimeEnvironmentV1,
  createTenantDeploymentInternalBindingHandlerV1,
  resolveActiveTenantDeploymentFromServiceV1,
  resolveTenantDeploymentSetupAdmissionFromServiceV1,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/runtimeBinding';
import { cleanupTemporaryD1Database, createTemporaryD1Database } from '../helpers/sqliteD1';

function developmentBindingBody(createdAtMs: number): TenantDeploymentBindingBodyV1 {
  return {
    kind: 'tenant_deployment_binding_v1',
    schemaVersion: 1,
    deploymentLane: 'live-demo',
    mode: { kind: 'development_testnet_v1', environment: 'development', network: 'testnet' },
    tenant: {
      namespace: 'wallet',
      organizationId: 'org_1',
      projectId: 'proj_mu3mtq24_6ni46i',
      environmentId: 'proj_mu3mtq24_6ni46i:dev',
    },
    tenantRoot: {
      identityDigestB64u: 'root-digest',
      custodyLineageId: 'lineage-1',
      signingRootId: 'signing-root-1',
      signingRootVersion: '1',
    },
    browserCredential: {
      credentialId: 'ak_dev_fixture',
      publishableKey: 'pk_dev_fixture',
      expiresAtMs: null,
      allowedOrigins: ['https://test.sign.seams.sh', 'https://wallet.seams.sh'],
      quotaPolicy: {
        rateLimitBucket: 'managed-registration',
        quotaBucket: 'included',
        riskPolicy: {},
        paymentPolicy: {},
      },
    },
    surfaces: {
      applicationOrigin: 'https://wallet.seams.sh',
      hostedWalletOrigin: 'https://test.sign.seams.sh',
      gatewayOrigin: 'https://test.api.wallet.seams.sh',
      relyingPartyId: 'test.sign.seams.sh',
    },
    runtimePolicyDigestB64u: 'policy-digest',
    createdAtMs,
  };
}

async function binding(createdAtMs: number) {
  const result = await buildTenantDeploymentBindingV1(developmentBindingBody(createdAtMs));
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

test.describe('tenant deployment binding', () => {
  test('reads durable wallet and live ceremony counts through the private runtime binding', async () => {
    const fixture = createTemporaryD1Database();
    try {
      await fixture.database.exec(`
        CREATE TABLE wallets (
          namespace TEXT NOT NULL,
          org_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          env_id TEXT NOT NULL,
          wallet_id TEXT NOT NULL
        );
        CREATE TABLE registration_ceremony_records (
          namespace TEXT NOT NULL,
          org_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          env_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          expires_at_ms INTEGER NOT NULL
        );
        INSERT INTO wallets VALUES
          ('wallet', 'org_1', 'project_source', 'project_source:dev', 'wallet_source'),
          ('wallet', 'org_1', 'proj_mu3mtq24_6ni46i', 'proj_mu3mtq24_6ni46i:dev', 'wallet_target');
        INSERT INTO registration_ceremony_records VALUES
          ('wallet', 'org_1', 'proj_mu3mtq24_6ni46i', 'proj_mu3mtq24_6ni46i:dev', 'live', 2000),
          ('wallet', 'org_1', 'proj_mu3mtq24_6ni46i', 'proj_mu3mtq24_6ni46i:dev', 'expired', 999);
      `);
      const handler = createTenantDeploymentRuntimeInspectionHandlerV1({
        database: fixture.database,
        now: () => 1000,
      });
      const client = createTenantDeploymentRuntimeInspectionClientV1({
        async fetch(request: Request | string, init?: RequestInit) {
          const result = await handler(new Request(request, init));
          return result ?? new Response('Not found', { status: 404 });
        },
      });
      await expect(
        client.inspect({
          bindingRevision: 'tdb_candidate',
          source: {
            namespace: 'wallet',
            organizationId: 'org_1',
            projectId: 'project_source',
            environmentId: 'project_source:dev',
          },
          target: {
            namespace: 'wallet',
            organizationId: 'org_1',
            projectId: 'proj_mu3mtq24_6ni46i',
            environmentId: 'proj_mu3mtq24_6ni46i:dev',
          },
        }),
      ).resolves.toEqual({
        acknowledgedBindingRevision: 'tdb_candidate',
        sourceDurableWalletCount: 1,
        targetDurableWalletCount: 1,
        inFlightCeremonyCount: 1,
      });
    } finally {
      cleanupTemporaryD1Database(fixture.tempDir);
    }
  });

  test('rejects a modified body under an existing content revision', async () => {
    const original = await binding(1_700_000_000_000);
    const decoded = await decodeTenantDeploymentBindingV1({
      ...original,
      runtimePolicyDigestB64u: 'different-policy',
    });
    expect(decoded).toEqual({
      ok: false,
      message: 'tenant deployment binding revision does not match its body',
    });
  });

  test('enforces credential environment prefixes and canonical origin order', async () => {
    const wrongCredential = developmentBindingBody(1_700_000_000_000);
    expect(
      (
        await buildTenantDeploymentBindingV1({
          ...wrongCredential,
          browserCredential: {
            ...wrongCredential.browserCredential,
            credentialId: 'ak_prod_fixture',
            publishableKey: 'pk_prod_fixture',
          },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await buildTenantDeploymentBindingV1({
          ...wrongCredential,
          browserCredential: {
            ...wrongCredential.browserCredential,
            allowedOrigins: ['https://wallet.seams.sh', 'https://test.sign.seams.sh'],
          },
        })
      ).ok,
    ).toBe(false);
  });

  test('activates with compare-and-swap and makes uncertain retries idempotent', async () => {
    const fixture = createTemporaryD1Database();
    try {
      const migration = path.resolve(
        '..',
        'packages/wallet-console-server-ts/migrations/d1-console/0046_tenant_deployment_bindings.sql',
      );
      await fixture.database.exec(readFileSync(migration, 'utf8'));
      const service = createD1TenantDeploymentServiceV1({
        database: fixture.database,
        now: () => new Date(1_800_000_000_000),
      });
      const first = await service.putBinding(await binding(1_700_000_000_000));
      const readinessReceipt = {
        kind: 'tenant_deployment_readiness_receipt_v1' as const,
        bindingRevision: first.revision,
        expectedActiveRevision: null,
        checkedAtMs: 1_799_999_000_000,
        expiresAtMs: 1_800_001_000_000,
        evidenceDigestB64u: 'evidence-digest',
        durableWalletCount: 0,
        inFlightCeremonyCount: 0,
      };
      const firstTargetIdentity = {
        organizationId: first.tenant.organizationId,
        projectId: first.tenant.projectId,
        environmentId: first.tenant.environmentId,
        signingRootId: first.tenantRoot.signingRootId,
        signingRootVersion: first.tenantRoot.signingRootVersion,
      };
      const planningFirst = await service.createCutover({
        kind: 'planning',
        operationId: 'tco_first',
        deploymentLane: first.deploymentLane,
        targetIdentity: firstTargetIdentity,
        expectedActiveRevision: null,
      });
      await expect(
        service.transitionCutover(planningFirst, {
          kind: 'awaiting_tenant_root',
          operationId: 'tco_first',
          deploymentLane: first.deploymentLane,
          targetIdentity: {
            ...firstTargetIdentity,
            environmentId: 'proj_other:dev',
          },
          expectedActiveRevision: null,
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
      const rootFirst = await service.transitionCutover(planningFirst, {
        kind: 'awaiting_tenant_root',
        operationId: 'tco_first',
        deploymentLane: first.deploymentLane,
        targetIdentity: firstTargetIdentity,
        expectedActiveRevision: null,
      });
      const credentialFirst = await service.transitionCutover(rootFirst, {
        kind: 'awaiting_browser_credential',
        operationId: 'tco_first',
        deploymentLane: first.deploymentLane,
        targetIdentity: firstTargetIdentity,
        activeTenantRoot: first.tenantRoot,
        expectedActiveRevision: null,
      });
      await expect(
        service.transitionCutover(rootFirst, {
          kind: 'awaiting_browser_credential',
          operationId: 'tco_first',
          deploymentLane: first.deploymentLane,
          targetIdentity: firstTargetIdentity,
          activeTenantRoot: { ...first.tenantRoot, signingRootVersion: 'other-version' },
          expectedActiveRevision: null,
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
      const readyFirst = await service.transitionCutover(credentialFirst, {
        kind: 'ready',
        operationId: 'tco_first',
        deploymentLane: first.deploymentLane,
        binding: first,
        readinessReceipt,
        expectedActiveRevision: null,
      });
      const setupAdmission = createD1TenantDeploymentSetupAdmissionReaderV1({
        database: fixture.database,
      });
      expect(await setupAdmission.isSetupQuiesced(first.deploymentLane)).toBe(true);
      await expect(
        service.transitionCutover(readyFirst, {
          // @ts-expect-error Only activateBinding may create the active state.
          kind: 'active',
          operationId: 'tco_first',
          deploymentLane: first.deploymentLane,
          binding: first,
          activationReceipt: {
            kind: 'tenant_deployment_activation_receipt_v1',
            bindingRevision: first.revision,
            previousRevision: null,
            activationSequence: 1,
            activatedAtMs: 1_800_000_000_000,
          },
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
      const input = {
        operationId: 'tco_first' as const,
        expectedCutoverRecordRevision: readyFirst.recordRevision,
        deploymentLane: first.deploymentLane,
        bindingRevision: first.revision,
        expectedActive: null,
        readinessReceipt,
      };
      await expect(
        service.activateBinding({
          ...input,
          readinessReceipt: { ...readinessReceipt, evidenceDigestB64u: 'different-evidence' },
        }),
      ).rejects.toMatchObject({ code: 'activation_conflict' });
      const activated = await service.activateBinding(input);
      expect(await setupAdmission.isSetupQuiesced(first.deploymentLane)).toBe(false);
      expect(await service.activateBinding(input)).toEqual(activated);
      expect(await service.resolveActiveBinding(first.deploymentLane)).toEqual(first);
      const internalBindingHandler = createTenantDeploymentInternalBindingHandlerV1({
        deploymentLane: first.deploymentLane,
        reader: service,
        setupAdmission: createD1TenantDeploymentSetupAdmissionReaderV1({
          database: fixture.database,
        }),
      });
      const serviceBinding = {
        async fetch(request: Request | string, init?: RequestInit) {
          const response = await internalBindingHandler(new Request(request, init));
          return response ?? new Response('Not found', { status: 404 });
        },
      };
      expect(
        await resolveActiveTenantDeploymentFromServiceV1({
          deploymentLane: first.deploymentLane,
          service: serviceBinding,
        }),
      ).toEqual(first);
      expect(
        await resolveTenantDeploymentSetupAdmissionFromServiceV1({
          deploymentLane: first.deploymentLane,
          service: serviceBinding,
        }),
      ).toBe(true);
      expect(
        bindTenantDeploymentToRuntimeEnvironmentV1(
          {
            WALLET_CONSOLE: serviceBinding,
            SEAMS_TENANT_DEPLOYMENT_LANE: first.deploymentLane,
          },
          first,
        ),
      ).toMatchObject({
        SEAMS_TENANT_STORAGE_NAMESPACE: first.tenant.namespace,
        SEAMS_STAGING_ORG_ID: first.tenant.organizationId,
        SEAMS_STAGING_PROJECT_ID: first.tenant.projectId,
        SEAMS_STAGING_ENV_ID: first.tenant.environmentId,
      });
      const publicProjection = createTenantDeploymentPublicProjectionHandlerV1({
        deploymentLane: first.deploymentLane,
        reader: service,
      });
      const projectionResponse = await publicProjection(
        new Request('https://gateway.example/.well-known/seams-tenant-deployment.json'),
      );
      expect(projectionResponse.status).toBe(200);
      expect(projectionResponse.headers.get('etag')).toBe(`"${first.revision}"`);
      const cachedResponse = await publicProjection(
        new Request('https://gateway.example/.well-known/seams-tenant-deployment.json', {
          headers: { 'If-None-Match': `"${first.revision}"` },
        }),
      );
      expect(cachedResponse.status).toBe(304);

      const second = await service.putBinding(await binding(1_700_000_000_001));
      const expectedActive = {
        revision: first.revision,
        activationSequence: activated.active.activationSequence,
      };
      const secondInput = {
        operationId: 'tco_second' as const,
        expectedCutoverRecordRevision: 4,
        deploymentLane: second.deploymentLane,
        bindingRevision: second.revision,
        expectedActive,
        readinessReceipt: {
          ...readinessReceipt,
          bindingRevision: second.revision,
          expectedActiveRevision: first.revision,
        },
      };
      const secondTargetIdentity = {
        organizationId: second.tenant.organizationId,
        projectId: second.tenant.projectId,
        environmentId: second.tenant.environmentId,
        signingRootId: second.tenantRoot.signingRootId,
        signingRootVersion: second.tenantRoot.signingRootVersion,
      };
      const planningSecond = await service.createCutover({
        kind: 'planning',
        operationId: 'tco_second',
        deploymentLane: second.deploymentLane,
        targetIdentity: secondTargetIdentity,
        expectedActiveRevision: first.revision,
      });
      const rootSecond = await service.transitionCutover(planningSecond, {
        kind: 'awaiting_tenant_root',
        operationId: 'tco_second',
        deploymentLane: second.deploymentLane,
        targetIdentity: secondTargetIdentity,
        expectedActiveRevision: first.revision,
      });
      const credentialSecond = await service.transitionCutover(rootSecond, {
        kind: 'awaiting_browser_credential',
        operationId: 'tco_second',
        deploymentLane: second.deploymentLane,
        targetIdentity: secondTargetIdentity,
        activeTenantRoot: second.tenantRoot,
        expectedActiveRevision: first.revision,
      });
      const readySecond = await service.transitionCutover(credentialSecond, {
        kind: 'ready',
        operationId: 'tco_second',
        deploymentLane: second.deploymentLane,
        binding: second,
        readinessReceipt: secondInput.readinessReceipt,
        expectedActiveRevision: first.revision,
      });
      secondInput.expectedCutoverRecordRevision = readySecond.recordRevision;
      const replaced = await service.activateBinding(secondInput);
      expect(await service.activateBinding(secondInput)).toEqual(replaced);
      expect(replaced.active).toMatchObject({
        previousRevision: first.revision,
        activationSequence: 2,
      });
      const expiredRetryService = createD1TenantDeploymentServiceV1({
        database: fixture.database,
        now: () => new Date(1_900_000_000_000),
      });
      expect(await expiredRetryService.activateBinding(secondInput)).toEqual(replaced);
      await expect(service.activateBinding(input)).rejects.toMatchObject({
        code: 'activation_conflict',
      });
      const planning = await service.createCutover({
        kind: 'planning',
        operationId: 'tco_transition',
        deploymentLane: first.deploymentLane,
        targetIdentity: firstTargetIdentity,
        expectedActiveRevision: second.revision,
      });
      await expect(
        service.transitionCutover(
          {
            ...planning,
            state: {
              kind: 'ready',
              operationId: 'tco_transition',
              deploymentLane: first.deploymentLane,
              binding: second,
              readinessReceipt: secondInput.readinessReceipt,
              expectedActiveRevision: first.revision,
            },
          },
          {
            kind: 'active',
            operationId: 'tco_transition',
            deploymentLane: first.deploymentLane,
            binding: second,
            activationReceipt: replaced.receipt,
          },
        ),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    } finally {
      cleanupTemporaryD1Database(fixture.tempDir);
    }
  });

  test('rejects a cutover whose nested binding or receipt names another lane or pointer', async () => {
    const candidate = await binding(1_700_000_000_000);
    const base = {
      kind: 'ready',
      operationId: 'tco_fixture',
      deploymentLane: 'another-lane',
      binding: candidate,
      expectedActiveRevision: null,
      readinessReceipt: {
        kind: 'tenant_deployment_readiness_receipt_v1',
        bindingRevision: candidate.revision,
        expectedActiveRevision: null,
        checkedAtMs: 1,
        expiresAtMs: 2,
        evidenceDigestB64u: 'evidence',
        durableWalletCount: 0,
        inFlightCeremonyCount: 0,
      },
    };
    expect((await decodeTenantDeploymentCutoverV1(base)).ok).toBe(false);
    expect(
      (
        await decodeTenantDeploymentCutoverV1({
          ...base,
          deploymentLane: candidate.deploymentLane,
          expectedActiveRevision: candidate.revision,
        })
      ).ok,
    ).toBe(false);
  });

  test('does not expose a cutover to another tenant that reuses an environment id', async () => {
    const decoded = await decodeTenantDeploymentCutoverV1({
      kind: 'planning',
      operationId: 'tco_shared123',
      deploymentLane: 'live-demo',
      targetIdentity: {
        organizationId: 'org_1',
        projectId: 'project_1',
        environmentId: 'shared:dev',
        signingRootId: 'project_1:dev',
        signingRootVersion: 'v1',
      },
      expectedActiveRevision: null,
    });
    if (!decoded.ok) throw new Error(decoded.message);
    const auth = {
      authenticate: () => ({
        ok: true as const,
        claims: {
          userId: 'user_2',
          orgId: 'org_2',
          platformSupport: false,
          membershipId: 'membership_2',
          role: 'OWNER' as const,
          authorizationVersion: 1,
          adminPermissions: [],
          projectAccess: { kind: 'all' as const },
          projectId: 'project_2',
          environmentId: 'shared:dev',
          sessionId: 'session_2',
        },
      }),
    } as ConsoleAuthAdapter;
    const unexpected = async (): Promise<never> => {
      throw new Error('unexpected cutover dependency call');
    };
    const route = createTenantDeploymentConsoleRouteV1({
      auth,
      orgProjectEnv: {
        listEnvironments: async () => [
          {
            id: 'shared:dev',
            orgId: 'org_2',
            projectId: 'project_2',
            key: 'dev',
            runtimeVersion: 'v1',
          },
        ],
      } as never,
      stepUp: { readStepUp: unexpected },
      tenantRootState: { readStatus: unexpected },
      candidates: { buildCandidate: unexpected },
      readiness: { issue: unexpected },
      store: {
        putBinding: unexpected,
        findBinding: unexpected,
        findActiveBinding: unexpected,
        resolveActiveBinding: unexpected,
        activateBinding: unexpected,
        createCutover: unexpected,
        findCutover: async () => ({
          state: decoded.value,
          recordRevision: 1,
          createdAtMs: 1,
          updatedAtMs: 1,
        }),
        transitionCutover: unexpected,
      },
      deploymentLane: 'live-demo',
    });
    const response = await route(
      new Request('https://console.example/console/tenant-deployment/cutovers/tco_shared123'),
    );
    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toMatchObject({
      ok: false,
      code: 'cutover_not_found',
    });
  });

  test('issues readiness only for evidence matching the complete binding', async () => {
    const candidate = await binding(1_700_000_000_000);
    let mismatchPolicy = false;
    const readiness = createTenantDeploymentReadinessServiceV1({
      now: () => new Date(1_800_000_000_000),
      inspector: {
        async inspect() {
          return {
            mode: candidate.mode,
            environmentId: candidate.tenant.environmentId,
            tenantRoot: candidate.tenantRoot,
            credential: {
              credentialId: candidate.browserCredential.credentialId,
              publishableKey: candidate.browserCredential.publishableKey,
              environmentId: candidate.tenant.environmentId,
              allowedOrigins: candidate.browserCredential.allowedOrigins,
              quotaPolicy: mismatchPolicy
                ? { ...candidate.browserCredential.quotaPolicy, quotaBucket: 'wrong' }
                : candidate.browserCredential.quotaPolicy,
              status: 'active' as const,
              expiresAtMs: candidate.browserCredential.expiresAtMs,
            },
            runtimePolicyDigestB64u: candidate.runtimePolicyDigestB64u,
            ...candidate.surfaces,
            acknowledgedBindingRevision: candidate.revision,
            sourceEnvironmentChanged: false,
            sourceDurableWalletCount: 0,
            targetDurableWalletCount: 0,
            inFlightCeremonyCount: 0,
            migrationAuthorized: false,
          };
        },
      },
    });
    const receipt = await readiness.issue({ binding: candidate, expectedActiveRevision: null });
    expect(receipt).toMatchObject({
      bindingRevision: candidate.revision,
      expectedActiveRevision: null,
      durableWalletCount: 0,
      inFlightCeremonyCount: 0,
    });
    mismatchPolicy = true;
    await expect(
      readiness.issue({ binding: candidate, expectedActiveRevision: null }),
    ).rejects.toMatchObject({ code: 'readiness_invalid' });
  });
});
