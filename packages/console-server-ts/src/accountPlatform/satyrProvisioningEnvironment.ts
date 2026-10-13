import { object, textValue } from '@seams-internal/console-shared/accountPlatform/boundary';
import type { D1AccountServiceAccess } from './serviceAccess';
import type {
  PlatformScopeV1,
  ServiceBindingRequestV1,
} from '@seams-internal/console-shared/accountPlatform';
import type { AccountServiceProvisioningAdapterV1 } from './provisioning';
import type { ServiceProvisionDeliveryV1 } from './types';
import {
  createSatyrProvisioningBinding,
  SatyrServiceProvisioningAdapterV1,
} from './satyrProvisioning';

export interface SatyrProvisioningEnvironment {
  readonly SATYR_DEPLOYMENT_ID?: string;
  readonly SATYR_SERVICE_ORIGIN?: string;
  readonly SATYR_PROVISION_PLACEMENT_CELL_ID?: string;
  readonly SATYR_PROVISION_ENVIRONMENT?: string;
  readonly SATYR_PROVISION_TOKEN?: string;
  readonly ACCOUNT_PROVISION_ASSERTION_ISSUER?: string;
  readonly ACCOUNT_PROVISION_ASSERTION_AUDIENCE?: string;
  readonly ACCOUNT_PROVISION_ASSERTION_KEY_ID?: string;
  readonly ACCOUNT_PROVISION_ASSERTION_PRIVATE_JWK_JSON?: string;
}

function privateAssertionJwk(input: string): JsonWebKey {
  const record = object(JSON.parse(input), 'account provision private JWK');
  if (record.kty !== 'OKP' || record.crv !== 'Ed25519') {
    throw new Error('Account provisioning requires an Ed25519 private JWK');
  }
  return { kty: 'OKP', crv: 'Ed25519', x: textValue(record.x, 'x'), d: textValue(record.d, 'd') };
}

async function loadSatyrProvisioningAdapter(
  environment: SatyrProvisioningEnvironment,
  access: D1AccountServiceAccess,
  transport: typeof fetch,
): Promise<SatyrServiceProvisioningAdapterV1 | null> {
  if (environment.SATYR_SERVICE_ORIGIN === undefined) return null;
  const nativeEnvironment = environment.SATYR_PROVISION_ENVIRONMENT;
  if (nativeEnvironment !== 'development' && nativeEnvironment !== 'production') {
    throw new Error('SATYR_PROVISION_ENVIRONMENT must be development or production');
  }
  return SatyrServiceProvisioningAdapterV1.create({
    access,
    transport,
    configuration: {
      deploymentId: textValue(environment.SATYR_DEPLOYMENT_ID, 'SATYR_DEPLOYMENT_ID'),
      origin: textValue(environment.SATYR_SERVICE_ORIGIN, 'SATYR_SERVICE_ORIGIN'),
      placementCellId: textValue(
        environment.SATYR_PROVISION_PLACEMENT_CELL_ID,
        'SATYR_PROVISION_PLACEMENT_CELL_ID',
      ),
      environment: nativeEnvironment,
      bearerToken: textValue(environment.SATYR_PROVISION_TOKEN, 'SATYR_PROVISION_TOKEN'),
      ownerAssertion: {
        issuer: textValue(
          environment.ACCOUNT_PROVISION_ASSERTION_ISSUER,
          'ACCOUNT_PROVISION_ASSERTION_ISSUER',
        ),
        audience: textValue(
          environment.ACCOUNT_PROVISION_ASSERTION_AUDIENCE,
          'ACCOUNT_PROVISION_ASSERTION_AUDIENCE',
        ),
        keyId: textValue(
          environment.ACCOUNT_PROVISION_ASSERTION_KEY_ID,
          'ACCOUNT_PROVISION_ASSERTION_KEY_ID',
        ),
        privateJwk: privateAssertionJwk(
          textValue(
            environment.ACCOUNT_PROVISION_ASSERTION_PRIVATE_JWK_JSON,
            'ACCOUNT_PROVISION_ASSERTION_PRIVATE_JWK_JSON',
          ),
        ),
      },
    },
  });
}

/** Service discovery and command creation do not load signing credentials. */
class ConfiguredSatyrProvisioning implements AccountServiceProvisioningAdapterV1 {
  readonly authority;
  readonly consoleHref: string;
  constructor(
    private readonly environment: SatyrProvisioningEnvironment,
    private readonly access: D1AccountServiceAccess,
    private readonly transport: typeof fetch,
    private readonly nativeEnvironment: 'development' | 'production',
    private readonly placementCellId: string,
  ) {
    this.authority = {
      serviceId: 'satyr' as const,
      deploymentId: textValue(environment.SATYR_DEPLOYMENT_ID, 'SATYR_DEPLOYMENT_ID'),
    };
    this.consoleHref = new URL(
      '/portal',
      textValue(environment.SATYR_SERVICE_ORIGIN, 'SATYR_SERVICE_ORIGIN'),
    ).href;
  }
  createBinding(scope: PlatformScopeV1): ServiceBindingRequestV1 {
    return createSatyrProvisioningBinding(scope, {
      deploymentId: this.authority.deploymentId,
      placementCellId: this.placementCellId,
      environment: this.nativeEnvironment,
    });
  }

  async provision(delivery: ServiceProvisionDeliveryV1) {
    const adapter = await loadSatyrProvisioningAdapter(
      this.environment,
      this.access,
      this.transport,
    );
    if (!adapter) throw new Error('Satyr provisioning configuration disappeared');
    return adapter.provision(delivery);
  }
}

export function createSatyrProvisioningAdapterFromEnvironment(
  environment: SatyrProvisioningEnvironment,
  access: D1AccountServiceAccess,
  transport: typeof fetch,
): AccountServiceProvisioningAdapterV1 | null {
  if (environment.SATYR_SERVICE_ORIGIN === undefined) return null;
  const nativeEnvironment = environment.SATYR_PROVISION_ENVIRONMENT;
  if (nativeEnvironment !== 'development' && nativeEnvironment !== 'production')
    throw new Error('SATYR_PROVISION_ENVIRONMENT must be development or production');
  return new ConfiguredSatyrProvisioning(
    environment,
    access,
    transport,
    nativeEnvironment,
    textValue(environment.SATYR_PROVISION_PLACEMENT_CELL_ID, 'SATYR_PROVISION_PLACEMENT_CELL_ID'),
  );
}

/** Invalid Satyr metadata makes only Satyr unavailable in the shared service catalog. */
export function satyrProvisioningForConsoleRoute(
  pathname: string,
  environment: SatyrProvisioningEnvironment,
  access: D1AccountServiceAccess,
  transport: typeof fetch,
): AccountServiceProvisioningAdapterV1 | null {
  if (
    !/^\/console\/projects\/[^/]+\/services(?:\/satyr\/(?:enable|disable|archive))?$/.test(pathname)
  )
    return null;
  try {
    return createSatyrProvisioningAdapterFromEnvironment(environment, access, transport);
  } catch {
    console.error('Satyr provisioning metadata is invalid');
    return null;
  }
}
