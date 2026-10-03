import { TenantResourceVerificationV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
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

declare const optionsWithoutHome: Omit<TenantDeploymentProvisionerOptionsV1, 'resources'>;
// @ts-expect-error Provisioning always requires a parsed home resource identity.
const unscopedProvisioner: TenantDeploymentProvisionerOptionsV1 = optionsWithoutHome;
void unscopedProvisioner;

declare const activationWithoutHome: Omit<
  ActivateTenantDeploymentBindingInputV1,
  'resourceVerifications'
>;
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

declare const verification: TenantResourceVerificationV1;
// @ts-expect-error A spread loses the validated proof identity.
const forgedVerification: TenantResourceVerificationV1 = { ...verification };
declare const unverifiedActivation: Omit<
  ActivateTenantDeploymentBindingInputV1,
  'resourceVerifications'
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

import type { TenantDeploymentD1ResourcesV1 } from '../../packages/wallet-console-shared-ts/src/tenant-deployment';
import type {
  TenantDeploymentResourceVerificationsV1,
  TenantRuntimeWriterV1,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
// @ts-expect-error Deployment admission requires at least one physical resource.
const emptyResources: TenantDeploymentD1ResourcesV1 = [];
// @ts-expect-error Activation cannot omit all resource proofs.
const emptyProofs: TenantDeploymentResourceVerificationsV1 = [];
declare const writerWithoutResource: Omit<TenantRuntimeWriterV1, 'resource'>;
// @ts-expect-error An admitted version must identify its verified physical database.
const unboundWriter: TenantRuntimeWriterV1 = writerWithoutResource;
void emptyResources;
void emptyProofs;
void unboundWriter;
