import {
  NamespaceD1HomeV1,
  type NamespaceD1HomeAssignmentV1,
  type ReserveNamespaceD1HomeResultV1,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/namespaceHome';
import type { TenantDeploymentProvisionerOptionsV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/provisioning';
import type { ActivateTenantDeploymentBindingInputV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/types';
import type { TenantDeploymentHomeAdoptionRequestV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/homeAdoption';
import type {
  TenantD1HomeChallengeRequestV1,
  TenantD1HomeVerifierV1,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/homeChallenge';

declare const home: NamespaceD1HomeV1;
declare const assignment: NamespaceD1HomeAssignmentV1;

// @ts-expect-error Raw resource identities must pass the boundary parser.
const literal: NamespaceD1HomeV1 = {
  namespace: 'wallet',
  accountId: 'account',
  databaseId: 'database',
};
// @ts-expect-error Construction cannot bypass resource validation.
const constructed = new NamespaceD1HomeV1('wallet', 'account', 'database');
// @ts-expect-error Broad spreads cannot preserve the validated home identity.
const spread: NamespaceD1HomeV1 = { ...home, databaseId: 'weur' };
const mixed: ReserveNamespaceD1HomeResultV1 = {
  ok: false,
  code: 'namespace_home_conflict',
  // @ts-expect-error A failed reservation cannot carry a success disposition.
  disposition: 'reserved',
  assignment,
};
// @ts-expect-error Every outcome carries the authoritative assignment.
const incomplete: ReserveNamespaceD1HomeResultV1 = { ok: true, disposition: 'reused' };

void literal;
void constructed;
void spread;
void mixed;
void incomplete;

declare const optionsWithoutHome: Omit<TenantDeploymentProvisionerOptionsV1, 'home'>;
// @ts-expect-error Provisioning always requires a parsed home resource identity.
const unscopedProvisioner: TenantDeploymentProvisionerOptionsV1 = optionsWithoutHome;
void unscopedProvisioner;

declare const activationWithoutHome: Omit<ActivateTenantDeploymentBindingInputV1, 'home'>;
// @ts-expect-error Direct activation requires a parsed home even when provisioning is bypassed.
const unscopedActivation: ActivateTenantDeploymentBindingInputV1 = activationWithoutHome;
void unscopedActivation;

declare const adoptionWithoutOperation: Omit<TenantDeploymentHomeAdoptionRequestV1, 'operationId'>;
// @ts-expect-error Adoption retries require a stable operation identity.
const anonymousAdoption: TenantDeploymentHomeAdoptionRequestV1 = adoptionWithoutOperation;
const incompleteAdoption: TenantDeploymentHomeAdoptionRequestV1 = {
  deploymentLane: 'lane',
  operationId: 'tco_adoption',
  // @ts-expect-error A revision without its activation sequence cannot guard against a stale pointer.
  expectedActive: { revision: 'tdb_previous' },
};
void anonymousAdoption;
void incompleteAdoption;

declare const challengeWithoutProof: Omit<TenantD1HomeChallengeRequestV1, 'expectedProof'>;
// @ts-expect-error Knowing a challenge ID alone is insufficient for verification.
const unprovenChallenge: TenantD1HomeChallengeRequestV1 = challengeWithoutProof;
declare const checkpoint: Awaited<ReturnType<TenantD1HomeVerifierV1['verify']>>;
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
