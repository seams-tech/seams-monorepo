import type {
  TenantDeploymentBindingBodyV1,
  TenantDeploymentBindingV1,
  TenantDeploymentCutoverV1,
  TenantDeploymentModeV1,
} from '../../packages/wallet-console-shared-ts/src/tenant-deployment';

type DevelopmentBindingBody = Extract<
  TenantDeploymentBindingBodyV1,
  { readonly mode: { readonly kind: 'development_testnet_v1' } }
>;

const development: TenantDeploymentModeV1 = {
  kind: 'development_testnet_v1',
  environment: 'development',
  network: 'testnet',
};

// @ts-expect-error Development is always Testnet.
const invalidDevelopment: TenantDeploymentModeV1 = {
  kind: 'development_testnet_v1',
  environment: 'development',
  network: 'mainnet',
};

declare const bodyWithoutRevision: Omit<TenantDeploymentBindingV1, 'revision'>;
// @ts-expect-error A persisted binding requires its content revision.
const invalidBinding: TenantDeploymentBindingV1 = bodyWithoutRevision;

declare const developmentBody: DevelopmentBindingBody;
const invalidDevelopmentCredential: TenantDeploymentBindingBodyV1 = {
  ...developmentBody,
  // @ts-expect-error Development bindings require development credential prefixes.
  browserCredential: {
    ...developmentBody.browserCredential,
    credentialId: 'ak_prod_fixture',
  },
};

// @ts-expect-error Ready cutovers require a readiness receipt.
const incompleteReady: TenantDeploymentCutoverV1 = {
  kind: 'ready',
  operationId: 'tco_fixture',
  deploymentLane: 'live-demo',
  binding: invalidBinding,
  expectedActiveRevision: null,
};

const environmentOnlyPlanning: TenantDeploymentCutoverV1 = {
  kind: 'planning',
  operationId: 'tco_fixture',
  deploymentLane: 'live-demo',
  // @ts-expect-error Planning is bound to the complete authenticated tenant-root identity.
  targetEnvironmentId: 'proj_fixture:dev',
  expectedActiveRevision: null,
};

void development;
void invalidDevelopment;
void invalidBinding;
void invalidDevelopmentCredential;
void incompleteReady;
void environmentOnlyPlanning;
