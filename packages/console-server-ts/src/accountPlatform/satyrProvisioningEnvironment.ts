import { object, textValue } from '@seams-internal/console-shared/accountPlatform/boundary';
import type { D1AccountServiceAccess } from './serviceAccess';
import { SatyrServiceProvisioningAdapterV1 } from './satyrProvisioning';

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

export async function createSatyrProvisioningAdapterFromEnvironment(
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
