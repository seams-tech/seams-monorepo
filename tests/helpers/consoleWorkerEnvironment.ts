import { randomBytes } from 'node:crypto';

export function consoleWorkerEnvironment(input: {
  readonly namespace: string;
  readonly deploymentLane: string;
  readonly accountId: string;
  readonly databaseId: string;
}): Record<string, string> {
  return {
    SEAMS_TENANT_STORAGE_NAMESPACE: input.namespace,
    SEAMS_TENANT_DEPLOYMENT_LANE: input.deploymentLane,
    SEAMS_D1_HOME_ACCOUNT_ID: input.accountId,
    SEAMS_D1_HOME_DATABASE_ID: input.databaseId,
    CONSOLE_BASE_URL: 'https://console.example.test',
    CONSOLE_EMAIL_RUNTIME_PROFILE: 'DEVELOPMENT',
    CONSOLE_EMAIL_PROVIDER: 'CAPTURE',
    CONSOLE_EMAIL_INVITATION_SECRET_KEY_ID: 'local-invitation',
    CONSOLE_EMAIL_INVITATION_SECRET_KEY_B64U: randomBytes(32).toString('base64url'),
    CONSOLE_WEBHOOK_SECRET_KEY_ID: 'local-webhook',
    CONSOLE_WEBHOOK_SECRET_KEY_B64U: randomBytes(32).toString('base64url'),
    CONSOLE_SESSION_HMAC_SECRET: randomBytes(32).toString('base64url'),
    CONSOLE_STEP_UP_RP_ID: 'console.example.test',
    CONSOLE_STEP_UP_ORIGIN: 'https://console.example.test',
    TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID: 'local-grant',
    TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED: randomBytes(32).toString('base64url'),
    TENANT_DEPLOYMENT_SURFACES_JSON: JSON.stringify({
      applicationOrigin: 'https://wallet.example.test',
      hostedWalletOrigin: 'https://wallet.example.test',
      gatewayOrigin: 'https://gateway.example.test',
      relyingPartyId: 'wallet.example.test',
    }),
    STRIPE_API_SK: 'sk_test_local_unusable',
    STRIPE_WEBHOOK_SECRET: 'whsec_local_unusable',
  };
}
