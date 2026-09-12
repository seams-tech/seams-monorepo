import { expect, test } from '@playwright/test';
import {
  buildTenantRootIdentityFromAuthenticatedDeploymentV1,
  decodeTenantRootIdentityWireV1,
  encodeTenantRootIdentityV1,
} from '../../packages/shared-ts/src/tenant-root/tenantRootIdentity';
import { resolveTenantRootIdentityV1 } from '../../packages/wallet-server/src/router/domains/tenantRoot/tenantRootIdentityResolution';
import {
  buildActiveEcdsaMaterialFixture,
  buildActiveEd25519MaterialFixture,
  TENANT_ROOT_RUNTIME_POLICY_SCOPE_FIXTURE,
} from './helpers/tenantRootB5Material.fixtures';

const EXPECTED_IDENTITY = {
  orgId: TENANT_ROOT_RUNTIME_POLICY_SCOPE_FIXTURE.orgId,
  projectId: TENANT_ROOT_RUNTIME_POLICY_SCOPE_FIXTURE.projectId,
  envId: TENANT_ROOT_RUNTIME_POLICY_SCOPE_FIXTURE.envId,
  signingRootId: `${TENANT_ROOT_RUNTIME_POLICY_SCOPE_FIXTURE.projectId}:${TENANT_ROOT_RUNTIME_POLICY_SCOPE_FIXTURE.envId}`,
  signingRootVersion: TENANT_ROOT_RUNTIME_POLICY_SCOPE_FIXTURE.signingRootVersion,
};

const CANONICAL_IDENTITY_WIRE = {
  orgId: 'org-1',
  projectId: 'project-2',
  envId: 'production',
  signingRootId: 'root-main',
  signingRootVersion: 'v3',
} as const;

function buildCanonicalIdentity() {
  const result = buildTenantRootIdentityFromAuthenticatedDeploymentV1(
    CANONICAL_IDENTITY_WIRE,
  );
  if (!result.ok) throw new Error('canonical tenant-root fixture is invalid');
  return result.value;
}

test('encodes the canonical identity with the Rust-compatible wire bytes', () => {
  const identity = buildCanonicalIdentity();
  expect(Buffer.from(encodeTenantRootIdentityV1(identity)).toString('hex')).toBe(
    '7365616d732f74656e616e742d726f6f742d6964656e746974792f7631000000056f72672d310000000970726f6a6563742d320000000a70726f64756374696f6e00000009726f6f742d6d61696e000000027633',
  );
  expect(decodeTenantRootIdentityWireV1(CANONICAL_IDENTITY_WIRE)).toEqual({
    ok: true,
    value: identity,
  });
});

test('rejects identity wire records that are incomplete, extended, or non-canonical', () => {
  expect(
    decodeTenantRootIdentityWireV1({
      orgId: CANONICAL_IDENTITY_WIRE.orgId,
      projectId: CANONICAL_IDENTITY_WIRE.projectId,
      envId: CANONICAL_IDENTITY_WIRE.envId,
      signingRootId: CANONICAL_IDENTITY_WIRE.signingRootId,
    }),
  ).toEqual({ ok: false, error: { kind: 'missing_field', field: 'signingRootVersion' } });
  expect(
    decodeTenantRootIdentityWireV1({ ...CANONICAL_IDENTITY_WIRE, lineage: 'legacy' }),
  ).toEqual({ ok: false, error: { kind: 'unexpected_field', field: 'lineage' } });
  expect(
    decodeTenantRootIdentityWireV1({ ...CANONICAL_IDENTITY_WIRE, envId: ' production' }),
  ).toEqual({ ok: false, error: { kind: 'invalid_field', field: 'envId' } });
});

test('resolves the exact Ed25519 tenant-root identity from B5 active material', async () => {
  const result = resolveTenantRootIdentityV1({
    kind: 'ed25519_b5_active_material',
    activeMaterial: await buildActiveEd25519MaterialFixture(),
  });

  expect(result).toEqual({ ok: true, identity: EXPECTED_IDENTITY });
  expect(JSON.stringify(result)).not.toContain('tenantRootShareEpoch');
});

test('resolves the exact ECDSA tenant-root identity from B5 active material', () => {
  const result = resolveTenantRootIdentityV1({
    kind: 'ecdsa_b5_active_material',
    activeMaterial: buildActiveEcdsaMaterialFixture(),
  });

  expect(result).toEqual({ ok: true, identity: EXPECTED_IDENTITY });
});

test('rejects a runtime caller-selected tenant-root field', () => {
  const input = {
    kind: 'ecdsa_b5_active_material' as const,
    activeMaterial: buildActiveEcdsaMaterialFixture(),
  };
  Reflect.set(input, 'tenantRootShareEpoch', 2);

  expect(resolveTenantRootIdentityV1(input)).toEqual({
    ok: false,
    code: 'caller_selected_tenant_root',
    message: 'Caller-supplied tenant-root selector field is forbidden: tenantRootShareEpoch',
  });
});

test('rejects an Ed25519 B5 signing-root ID mismatch', async () => {
  const activeMaterial = await buildActiveEd25519MaterialFixture();
  const result = resolveTenantRootIdentityV1({
    kind: 'ed25519_b5_active_material',
    activeMaterial: {
      ...activeMaterial,
      exportIdentity: {
        ...activeMaterial.exportIdentity,
        application_binding: {
          ...activeMaterial.exportIdentity.application_binding,
          signing_root_id: 'other-project:env-a',
        },
      },
    },
  });

  expect(result).toEqual({
    ok: false,
    code: 'signing_root_id_mismatch',
    message: 'B5 signing-root ID does not match authenticated deployment configuration',
  });
});

test('rejects an Ed25519 B5 stable signing-root version mismatch', async () => {
  const activeMaterial = await buildActiveEd25519MaterialFixture();
  const result = resolveTenantRootIdentityV1({
    kind: 'ed25519_b5_active_material',
    activeMaterial: {
      ...activeMaterial,
      exportIdentity: {
        ...activeMaterial.exportIdentity,
        scope: {
          ...activeMaterial.exportIdentity.scope,
          root_share_epoch: 'root-v2',
        },
      },
    },
  });

  expect(result).toEqual({
    ok: false,
    code: 'signing_root_version_mismatch',
    message: 'B5 signing-root version does not match authenticated deployment configuration',
  });
});

test('rejects an ECDSA B5 stable signing-root version mismatch', () => {
  const activeMaterial = buildActiveEcdsaMaterialFixture();
  const normalSigning = activeMaterial.routerAbEcdsaDerivationNormalSigning;
  const result = resolveTenantRootIdentityV1({
    kind: 'ecdsa_b5_active_material',
    activeMaterial: {
      ...activeMaterial,
      routerAbEcdsaDerivationNormalSigning: {
        ...normalSigning,
        scope: {
          ...normalSigning.scope,
          signing_root_version: 'root-v2',
        },
      },
    },
  });

  expect(result).toEqual({
    ok: false,
    code: 'signing_root_version_mismatch',
    message: 'B5 signing-root version does not match authenticated deployment configuration',
  });
});

test('returns a typed rejection for an empty B5 signing-root version', () => {
  const activeMaterial = buildActiveEcdsaMaterialFixture();
  const result = resolveTenantRootIdentityV1({
    kind: 'ecdsa_b5_active_material',
    activeMaterial: {
      ...activeMaterial,
      runtimePolicyScope: {
        ...activeMaterial.runtimePolicyScope,
        signingRootVersion: '',
      },
    },
  });

  expect(result).toEqual({
    ok: false,
    code: 'non_canonical_tenant_root_field',
    message: 'B5 runtime policy scope field is not canonical: signingRootVersion',
  });
});

test('rejects a padded B5 scope before deriving an inconsistent identity', () => {
  const activeMaterial = buildActiveEcdsaMaterialFixture();
  const result = resolveTenantRootIdentityV1({
    kind: 'ecdsa_b5_active_material',
    activeMaterial: {
      ...activeMaterial,
      runtimePolicyScope: {
        ...activeMaterial.runtimePolicyScope,
        projectId: ` ${activeMaterial.runtimePolicyScope.projectId}`,
      },
    },
  });

  expect(result).toEqual({
    ok: false,
    code: 'non_canonical_tenant_root_field',
    message: 'B5 runtime policy scope field is not canonical: projectId',
  });
});

test('rejects a B5 result whose nested material activation changed', () => {
  const activeMaterial = buildActiveEcdsaMaterialFixture();
  const normalSigning = activeMaterial.routerAbEcdsaDerivationNormalSigning;
  const result = resolveTenantRootIdentityV1({
    kind: 'ecdsa_b5_active_material',
    activeMaterial: {
      ...activeMaterial,
      routerAbEcdsaDerivationNormalSigning: {
        ...normalSigning,
        scope: {
          ...normalSigning.scope,
          material_activation: {
            ...normalSigning.scope.material_activation,
            activation_id: 'activation:substituted',
          },
        },
      },
    },
  });

  expect(result).toEqual({
    ok: false,
    code: 'material_activation_mismatch',
    message: 'B5 material activation does not match its established material identity',
  });
});
