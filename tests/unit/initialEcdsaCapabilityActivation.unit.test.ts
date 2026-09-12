import { expect, test } from '@playwright/test';
import { deriveThresholdEcdsaKeyHandle } from '@shared/utils/thresholdEcdsaKeyHandle';
import {
  assertInitialEcdsaActivationPlanMatchesVerifiedCeremony,
  buildInitialEcdsaCapabilityActivationPlan,
  parsePersistInitialCanonicalEcdsaActivationRequestV1,
  type InitialEcdsaCapabilityActivationPlan,
} from '@/core/signingEngine/session/material/initialEcdsaCapabilityActivation';
import { initialEcdsaCapabilityActivationFixture } from './helpers/initialEcdsaCapabilityActivation.fixtures';

function plannedIdentityValues(plan: InitialEcdsaCapabilityActivationPlan): string[] {
  const binding = plan.activationBinding;
  return [
    binding.signer.capability,
    binding.signer.signerId,
    binding.targetManifest.manifestId,
    binding.durableMaterialRef,
  ];
}

test('initial ECDSA activation planner owns fresh independent identities', async () => {
  const fixture = await initialEcdsaCapabilityActivationFixture();
  const first = await buildInitialEcdsaCapabilityActivationPlan(fixture.input);
  const second = await buildInitialEcdsaCapabilityActivationPlan(fixture.input);
  const plannedIdentities = [...plannedIdentityValues(first), ...plannedIdentityValues(second)];

  expect(new Set(plannedIdentities).size).toBe(plannedIdentities.length);
  expect(first.activationBinding.signer.materialOwner).toBe(fixture.input.authority.walletId);
  expect(second.activationBinding.signer.materialOwner).toBe(fixture.input.authority.walletId);
  for (const forbiddenAlias of fixture.forbiddenAliases) {
    expect(plannedIdentities).not.toContain(forbiddenAlias);
  }
  expect(plannedIdentities).not.toContain(first.activationBinding.roleLocalBinding.keyHandle);
  expect(first.activationBinding.targetManifest.manifestRevision).toBe(1);
  expect(first.expectedManifest.kind).toBe('no_current_manifest');
  expect(first.expectedGeneration.kind).toBe('no_current_generation');
  expect(first.activationBinding.signer.authority).toEqual(fixture.input.authority);
  expect('pendingPayloadB64u' in first).toBe(false);
  expect('pendingStateBlobB64u' in first).toBe(false);
});

test('initial ECDSA activation planner derives the canonical key handle', async () => {
  const fixture = await initialEcdsaCapabilityActivationFixture();
  const plan = await buildInitialEcdsaCapabilityActivationPlan(fixture.input);
  const expectedKeyHandle = await deriveThresholdEcdsaKeyHandle({
    ecdsaThresholdKeyId: fixture.input.ecdsaThresholdKeyId,
    signingRootId: fixture.input.signingRootId,
    signingRootVersion: fixture.input.signingRootVersion,
  });

  expect(plan.activationBinding.roleLocalBinding.keyHandle).toBe(expectedKeyHandle);
  expect(plan.activationBinding.bindingDigest).toBe(fixture.input.bindingDigest);
});

test('initial ECDSA activation command matches the verified worker ceremony', async () => {
  const fixture = await initialEcdsaCapabilityActivationFixture();

  expect(() =>
    assertInitialEcdsaActivationPlanMatchesVerifiedCeremony({
      ceremonyId: fixture.input.journalId,
      planInput: fixture.input,
      clientActivation: fixture.clientActivation,
    }),
  ).not.toThrow();
});

test('initial ECDSA activation rejects a substituted canonical ceremony', async () => {
  const fixture = await initialEcdsaCapabilityActivationFixture({
    canonicalRequestCeremonyId: 'substituted-registration-ceremony',
  });

  expect(() =>
    assertInitialEcdsaActivationPlanMatchesVerifiedCeremony({
      ceremonyId: fixture.input.journalId,
      planInput: fixture.input,
      clientActivation: fixture.clientActivation,
    }),
  ).toThrow(/changed the ceremony identity/);
});

test('initial ECDSA persistence request parser returns exact branded nested domains', async () => {
  const fixture = await initialEcdsaCapabilityActivationFixture();
  const request = {
    kind: 'persist_initial_canonical_ecdsa_activation_v1',
    bootstrapOwner: 'wallet_custody',
    ceremonyId: fixture.input.journalId,
    clientActivation: fixture.clientActivation,
    planInput: fixture.input,
  };

  expect(parsePersistInitialCanonicalEcdsaActivationRequestV1(request)).toEqual(request);
});

test('initial ECDSA persistence request parser rejects stale fields and wrong discriminants', async () => {
  const fixture = await initialEcdsaCapabilityActivationFixture();
  const request = {
    kind: 'persist_initial_canonical_ecdsa_activation_v1',
    bootstrapOwner: 'wallet_custody',
    ceremonyId: fixture.input.journalId,
    clientActivation: fixture.clientActivation,
    planInput: fixture.input,
  };

  expect(() =>
    parsePersistInitialCanonicalEcdsaActivationRequestV1({
      ...request,
      bootstrapOwner: 'server',
    }),
  ).toThrow(/discriminant is invalid/);
  expect(() =>
    parsePersistInitialCanonicalEcdsaActivationRequestV1({
      ...request,
      planInput: {
        ...request.planInput,
        targetMemberships: [
          {
            ...request.planInput.targetMemberships[0],
            staleField: true,
          },
        ],
      },
    }),
  ).toThrow(/fields are invalid/);
});
