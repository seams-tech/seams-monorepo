import { TenantHomeVerificationV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/homeVerification';
import { TenantDeploymentD1ResourceIdentityV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/deploymentResource';
import type { TenantDeploymentProvisionerOptionsV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/provisioning';
import type { ActivateTenantDeploymentBindingInputV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/types';
import type {
  TenantD1ResourceChallengeRequestV1,
  TenantD1ResourceVerifierV1,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceChallenge';

declare const home: TenantDeploymentD1ResourceIdentityV1;

// @ts-expect-error Raw resource identities must pass the boundary parser.
const literal: TenantDeploymentD1ResourceIdentityV1 = {
  namespace: 'wallet',
  accountId: 'account',
  databaseId: 'database',
};
// @ts-expect-error Construction cannot bypass resource validation.
const constructed = new TenantDeploymentD1ResourceIdentityV1('wallet', 'account', 'database');
// @ts-expect-error Broad spreads cannot preserve the validated home identity.
const spread: TenantDeploymentD1ResourceIdentityV1 = { ...home, databaseId: 'weur' };
void literal;
void constructed;
void spread;

declare const optionsWithoutHome: Omit<TenantDeploymentProvisionerOptionsV1, 'home'>;
// @ts-expect-error Provisioning always requires a parsed home resource identity.
const unscopedProvisioner: TenantDeploymentProvisionerOptionsV1 = optionsWithoutHome;
void unscopedProvisioner;

declare const activationWithoutHome: Omit<ActivateTenantDeploymentBindingInputV1, 'home'>;
// @ts-expect-error Direct activation requires a parsed home even when provisioning is bypassed.
const unscopedActivation: ActivateTenantDeploymentBindingInputV1 = activationWithoutHome;
void unscopedActivation;

declare const challengeWithoutProof: Omit<TenantD1ResourceChallengeRequestV1, 'expectedProof'>;
// @ts-expect-error Knowing a challenge ID alone is insufficient for verification.
const unprovenChallenge: TenantD1ResourceChallengeRequestV1 = challengeWithoutProof;
declare const checkpoint: Awaited<ReturnType<TenantD1ResourceVerifierV1['verify']>>;
// @ts-expect-error Runtime reachability evidence cannot authorize activation.
const activatedCheckpoint: typeof checkpoint = { ...checkpoint, activationAuthorized: true };
void unprovenChallenge;
void activatedCheckpoint;
declare const checkpointWithoutVersions: Omit<typeof checkpoint, 'writerVersions'>;
// @ts-expect-error Runtime proof must identify both answering versions.
const anonymousCheckpoint: typeof checkpoint = checkpointWithoutVersions;
const incompleteVersions: typeof checkpoint = {
  ...checkpoint,
  // @ts-expect-error A spread cannot erase a required writer version.
  writerVersions: { gateway: 'version' },
};
void anonymousCheckpoint;
void incompleteVersions;

declare const verification: TenantHomeVerificationV1;
// @ts-expect-error A spread loses the validated proof identity.
const forgedVerification: TenantHomeVerificationV1 = { ...verification };
declare const unverifiedActivation: Omit<
  ActivateTenantDeploymentBindingInputV1,
  'homeVerification'
>;
// @ts-expect-error Activation cannot omit physical-home verification.
const uncheckedActivation: ActivateTenantDeploymentBindingInputV1 = unverifiedActivation;
// @ts-expect-error Local authority cannot carry Cloudflare writer state.
const mixedAuthority: typeof verification.authority = {
  kind: 'local_development',
  gateway: { workerName: 'x', deploymentId: 'x', versionId: 'x' },
};
void forgedVerification;
void uncheckedActivation;
void mixedAuthority;
