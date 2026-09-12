import { expect, test } from '@playwright/test';
import { parseD1WalletRegistrationCommittedInstallationProjection } from '../../packages/wallet-server/src/router/cloudflare/d1/registration/d1RegistrationCeremonyRecords';
import {
  buildRegistrationCommittedInstallationProjectionFixture,
  REGISTRATION_COMMITTED_INSTALLATION_PROJECTION_FIXTURE_IDS,
} from './helpers/registrationCommittedInstallationProjection.fixtures';

const { registrationCeremonyId: REGISTRATION_CEREMONY_ID } =
  REGISTRATION_COMMITTED_INSTALLATION_PROJECTION_FIXTURE_IDS;

test('strictly parses a credential-free mixed installation projection', () => {
  const parsed = parseD1WalletRegistrationCommittedInstallationProjection(
    buildRegistrationCommittedInstallationProjectionFixture(),
  );

  expect(parsed).not.toBeNull();
  expect(parsed?.registrationCeremonyId).toBe(REGISTRATION_CEREMONY_ID);
  expect(parsed?.preparedContext.ecdsa.kind).toBe('evm_family_ecdsa_requested');
});

test('rejects projection records with unknown nested fields or mismatched NEAR scope', () => {
  const withAuthorityExtra = buildRegistrationCommittedInstallationProjectionFixture();
  const authority = withAuthorityExtra.registrationAuthority;
  if (authority === null || typeof authority !== 'object' || Array.isArray(authority)) {
    throw new Error('projection fixture authority is not an object');
  }
  withAuthorityExtra.registrationAuthority = { ...authority, walletSessionToken: 'forbidden' };
  expect(parseD1WalletRegistrationCommittedInstallationProjection(withAuthorityExtra)).toBeNull();

  const withNearScopeMismatch = buildRegistrationCommittedInstallationProjectionFixture();
  const near = withNearScopeMismatch.nearEd25519;
  if (near === null || typeof near !== 'object' || Array.isArray(near)) {
    throw new Error('projection fixture NEAR branch is not an object');
  }
  const admissionRequest = Reflect.get(near, 'admissionRequest');
  if (
    admissionRequest === null ||
    typeof admissionRequest !== 'object' ||
    Array.isArray(admissionRequest)
  ) {
    throw new Error('projection fixture admission request is not an object');
  }
  const scope = Reflect.get(admissionRequest, 'scope');
  if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('projection fixture admission scope is not an object');
  }
  Reflect.set(admissionRequest, 'scope', { ...scope, signer_set_id: 'near_ed25519:slot:9' });
  expect(
    parseD1WalletRegistrationCommittedInstallationProjection(withNearScopeMismatch),
  ).toBeNull();
});
