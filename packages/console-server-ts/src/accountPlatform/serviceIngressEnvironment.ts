import { object, textValue } from '@seams-internal/console-shared/accountPlatform/boundary';
import { AccountServiceIngressAuthenticatorV1 } from './serviceIngressAuth';
import {
  createAccountPlatformServiceIngress,
  type AccountPlatformServiceIngressHandler,
} from './http';
import type { D1AccountServiceAccess } from './serviceAccess';
import type { D1AccountMembershipFacade } from './membershipFacade';
import type { ConsoleBillingPrepaidReservationService } from '../billingPrepaidReservations/service';
import type { D1BillingUsageService } from '../billing/usage';

export interface AccountServiceIngressEnvironment {
  readonly SATYR_DEPLOYMENT_ID?: string;
  readonly SATYR_ACCOUNT_SERVICE_TOKEN?: string;
  readonly SATYR_ACCOUNT_ASSERTION_ISSUER?: string;
  readonly SATYR_ACCOUNT_ASSERTION_AUDIENCE?: string;
  readonly SATYR_ACCOUNT_USER_ASSERTION_KEY_ID?: string;
  readonly SATYR_ACCOUNT_USER_ASSERTION_PUBLIC_JWK_JSON?: string;
  readonly SATYR_GOOGLE_OIDC_CLIENT_ID?: string;
}

interface AccountServiceIngressServices {
  readonly serviceAccess: D1AccountServiceAccess;
  readonly serviceMemberships: D1AccountMembershipFacade;
  readonly funds: ConsoleBillingPrepaidReservationService;
  readonly billingUsage: D1BillingUsageService;
}

function publicAssertionJwk(input: string): JsonWebKey {
  const record = object(JSON.parse(input), 'Satyr user assertion public JWK');
  if (record.kty !== 'OKP' || record.crv !== 'Ed25519' || record.d !== undefined) {
    throw new Error('Satyr user assertions require an Ed25519 public JWK');
  }
  return { kty: 'OKP', crv: 'Ed25519', x: textValue(record.x, 'public JWK x') };
}

export async function createAccountPlatformServiceIngressFromEnvironment(
  environment: AccountServiceIngressEnvironment,
  services: AccountServiceIngressServices,
): Promise<AccountPlatformServiceIngressHandler | null> {
  const values = [
    environment.SATYR_DEPLOYMENT_ID,
    environment.SATYR_ACCOUNT_SERVICE_TOKEN,
    environment.SATYR_ACCOUNT_ASSERTION_ISSUER,
    environment.SATYR_ACCOUNT_ASSERTION_AUDIENCE,
    environment.SATYR_ACCOUNT_USER_ASSERTION_KEY_ID,
    environment.SATYR_ACCOUNT_USER_ASSERTION_PUBLIC_JWK_JSON,
    environment.SATYR_GOOGLE_OIDC_CLIENT_ID,
  ];
  let configured = false;
  for (const value of values) if (value !== undefined) configured = true;
  if (!configured) return null;
  const authenticator = await AccountServiceIngressAuthenticatorV1.create([
    {
      authority: {
        serviceId: 'satyr',
        deploymentId: textValue(environment.SATYR_DEPLOYMENT_ID, 'SATYR_DEPLOYMENT_ID'),
      },
      bearerToken: textValue(
        environment.SATYR_ACCOUNT_SERVICE_TOKEN,
        'SATYR_ACCOUNT_SERVICE_TOKEN',
      ),
      userAssertion: {
        issuer: textValue(
          environment.SATYR_ACCOUNT_ASSERTION_ISSUER,
          'SATYR_ACCOUNT_ASSERTION_ISSUER',
        ),
        audience: textValue(
          environment.SATYR_ACCOUNT_ASSERTION_AUDIENCE,
          'SATYR_ACCOUNT_ASSERTION_AUDIENCE',
        ),
        keyId: textValue(
          environment.SATYR_ACCOUNT_USER_ASSERTION_KEY_ID,
          'SATYR_ACCOUNT_USER_ASSERTION_KEY_ID',
        ),
        publicJwk: publicAssertionJwk(
          textValue(
            environment.SATYR_ACCOUNT_USER_ASSERTION_PUBLIC_JWK_JSON,
            'SATYR_ACCOUNT_USER_ASSERTION_PUBLIC_JWK_JSON',
          ),
        ),
      },
      googleClientId: textValue(
        environment.SATYR_GOOGLE_OIDC_CLIENT_ID,
        'SATYR_GOOGLE_OIDC_CLIENT_ID',
      ),
    },
  ]);
  return createAccountPlatformServiceIngress({
    authenticator,
    access: services.serviceAccess,
    memberships: services.serviceMemberships,
    funds: services.funds,
    billingUsage: services.billingUsage,
  });
}
