import { createD1ConsoleOrgProjectEnvService } from '@seams-internal/console-server/orgProjectEnv';
import { createWalletProjectEnvironmentResolver } from '../projectEnvironmentAdapter';
import { resolveRuntimeTenantRootLineage } from '@seams/wallet-server/cloud-host';
import type { RuntimePolicyScope } from '@seams-internal/shared-ts/threshold/signingRootScope';
import { recoveryTrustResponse } from '../../tenantRootSecurity/recoveryTrustRoute';
import { createRestoreAccessRoute } from '../../tenantRootSecurity/restoreAccessRoute';
import { createConsoleProviderIdentity } from '@seams-internal/console-server/boundary/providerIdentity';
import { TenantRootCustodyWorkerRouteV1 } from '../../tenantRootSecurity/custodyWorkerRoute';
import { D1TenantRootActiveLineageResolverV1 } from '../../tenantRootSecurity/activeLineageD1';
import { createTenantRootRestoreWorkerRouteV1 } from '../../tenantRootSecurity/restoreWorkerRoute';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type {
  ConsoleAuthAdapter,
  ConsoleAuthClaims,
  HeaderRecord,
} from '@seams-internal/console-server/router/consoleAuth';
import type {
  CfEnv,
  CfExecutionContext,
  CfScheduledEvent,
  FetchHandler,
} from '@seams/wallet-server/cloud-host';
import { createSigningSessionSealOptions } from '@seams/wallet-server/cloud-host';
import { RouterAbEcdsaPresignRuntime } from '@seams/wallet-server/cloud-host';
import type { SigningSessionSealRoutesOptions } from '@seams/wallet-server/cloud-host';
import { createCloudflareRouter } from '@seams/wallet-server/cloud-host';
import {
  consoleCoreServicesFromBundle,
  createCloudflareD1ConsoleOnlyServiceBundle,
  createCloudflareD1ConsoleServiceBundle,
  createCloudflareD1RouterApiRouteExtensions,
  walletConsoleServicesFromBundle,
} from './d1ConsoleServices';
import { createHostedWalletConsoleRouter } from '../consoleComposition';
import { attachConsoleRouteSurface } from '@seams-internal/console-server/router/consoleRouteSurface';
import { resolveCompleteWalletConsoleRouteSurface } from '../walletConsoleRouteDefinitions';
import {
  createCloudflareD1RouterApiAuthService,
  createCloudflareLinkedDeviceEd25519SourcePreservingRouterEndpointV1,
  createCloudflareOrdinaryInactiveSignerMaterialActivationEndpointV1,
  createCloudflareOrdinaryInactiveSignerMaterialDeactivationEndpointV1,
  createCloudflareOrdinaryInactiveSignerMaterialReservationEndpointV1,
  createD1LinkedDeviceOwnerSourceChildReaderV1,
  createD1LinkedDeviceSourceContributionPreparationPlannerV1,
  D1LinkedDeviceTargetCredentialProviderV1,
  D1WalletAuthMethodStore,
  type CloudflareD1EmailOtpServerSealConfig,
  type CloudflareD1RouterApiAuthServiceOptions,
} from '@seams/wallet-server/cloud-host';
import { loadCloudflareSignerWasmModule } from '@seams/wallet-server/cloud-host';
import { createConsoleSessionAuthAdapter, createHmacSessionAdapter } from './d1StagingSession';
import { createEd25519SessionAdapter } from '@seams/wallet-server/cloud-host';
import { HostedConsoleAuthHandler } from '../hostedConsoleAuth';
import {
  resolveSponsoredEvmCallConfigFromWorkerEnv,
  resolveSponsoredEvmWorkerExecutionAdapter,
} from '@seams-internal/wallet-console-server/sponsorship/evmWorkerExecutionAdapter';
import { resolveSponsoredExecutionPricingFromEnv } from '@seams-internal/wallet-console-server/sponsorship/pricing';
import { createDefaultBillingProviderAdapters } from '@seams-internal/console-server/billing/providers';
import {
  createAesGcmConsoleWebhookSecretCipher,
  type ConsoleWebhookSecretCipher,
} from '@seams-internal/console-server/webhooks/d1';
import { createStripeBillingProviderAdaptersFromEnv } from '@seams-internal/console-server/billing/stripeProvider';
import { CONSOLE_ORGANIZATION_ID_PATTERN } from '@seams-internal/console-shared/organizationIdentity';
import {
  parseRouterAbPublicKeysetV2,
  ROUTER_AB_PUBLIC_KEYSET_VERSION_V2,
  type RouterAbPublicKeysetV2,
} from '@seams/wallet-server/cloud-host';
import { base64UrlDecode, base64UrlEncode } from '@seams/wallet-server/cloud-host';
import { parseWalletId } from '@seams/wallet-server/cloud-host';
import {
  createRouterAbEd25519YaoProductRegistrationRequestScopedRuntimeV1,
  createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1,
  type RouterAbEd25519YaoProductRegistrationRuntimeV1,
} from '@seams/wallet-server/cloud-host';
import type { SessionAdapter } from '@seams/wallet-server/cloud-host';
import { D1WalletStore } from '@seams/wallet-server/cloud-host';
import {
  createRouterAbEcdsaEd25519CeremonyTokenIssuer,
  createRouterAbEcdsaStrictPostRegistrationPort,
  createRouterAbEcdsaStrictRegistrationPort,
  parseRouterAbEcdsaEd25519PrivateJwk,
  parseRouterAbEcdsaStrictRegistrationTopology,
  type RouterAbEcdsaEd25519PrivateJwk,
  type RouterAbEcdsaStrictPostRegistrationPort,
  type RouterAbEcdsaStrictRegistrationPort,
} from '@seams/wallet-server/cloud-host';
import {
  createRouterAbServiceBindingFetch,
  ROUTER_AB_MPC_ROUTER_ORIGIN,
  ROUTER_AB_SIGNING_WORKER_ORIGIN,
  type RouterAbServiceBindingEnv,
  type CloudflareServiceBindingFetcher,
} from '@seams/wallet-server/cloud-host';
import { withCors } from '@seams/wallet-server/cloud-host';
import {
  createRouterAbEd25519YaoHttpRegistrationBackendFromEnv,
  type RouterAbEd25519YaoTenantRootResolverV1,
} from '@seams/wallet-server/cloud-host';
import { CloudflareD1RouterAbEd25519YaoCapabilityPersistence } from '@seams/wallet-server/cloud-host';
import { handleRouterAbEd25519YaoRegistrationRequestScopedCloudflareV1 } from '@seams/wallet-server/cloud-host';
import { handleRouterAbEd25519YaoRecoveryRequestScopedCloudflareV1 } from '@seams/wallet-server/cloud-host';
import type { WarmBootstrapLinkedEd25519AuthorityReaderV1 } from '@seams/wallet-server/cloud-host';
import { handleRouterAbEd25519YaoExportRequestScopedCloudflareV1 } from '@seams/wallet-server/cloud-host';
import { RouterAbEd25519YaoRecoveryWalletSessionAuthorizationAdapter } from '@seams/wallet-server/cloud-host';
import { RouterAbEd25519YaoExportOwnerProofAuthorizationAdapter } from '@seams/wallet-server/cloud-host';
import {
  ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_EXPORT_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_STATUS_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_WARM_RECOVERY_BOOTSTRAP_PATH_V1,
} from '@seams/wallet-server/cloud-host';
import { ROUTER_AB_TRACE_ID_HEADER_V1 } from '@seams/wallet-server/cloud-host';
import { createD1TenantRootCreationGrantServiceV1 } from '../../tenantRootCreation/d1';
import { tenantRootIdentityDigestB64uV1 } from '@seams/wallet-server/cloud-host';
import {
  createTenantRootCreationConsoleRouteV1,
  createTenantRootRefreshConsoleRouteV1,
  dispatchTenantRootRefreshOperationV1,
} from '../../tenantRootCreation/consoleRoute';
import { createD1TenantRootStepUpStoreV1 } from '../../tenantRootSecurity/stepUpStore';
import { createD1ConsoleStepUpCredentialStoreV1 } from '../../tenantRootSecurity/stepUpCredentialStore';
import { createConsoleStepUpRouteV1 } from '../../tenantRootSecurity/stepUpRoute';
import { createConsoleWebAuthnPortV1 } from '../../tenantRootSecurity/stepUpWebAuthnAdapter';
import {
  createD1TenantRootOperationResumptionStoreV1,
  createD1TenantRootOperationStoreV1,
} from '../../tenantRootSecurity/d1';
import { createTenantRootSecurityStateReaderV1 } from '../../tenantRootSecurity/stateReader';
import { createConsoleTenantRootAuditWriterV1 } from '../../tenantRootSecurity/auditWriter';
import {
  createD1TenantRootScheduledActiveGrantReaderV1,
  createTenantRootScheduledRotationIntentV1,
} from '../../tenantRootSecurity/scheduledIntent';
import { createTenantRootSecurityConsoleRouteV1 } from '../../tenantRootSecurity/consoleRoute';
import { createCloudflareCron, type TenantRootRefreshResumptionRunner } from './cron';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from '@seams/wallet-server/cloud-host';
import { decodeTenantRootIdentityWireV1 } from '@seams-internal/shared-ts/tenant-root';

interface LocalD1DevEnv extends RouterAbServiceBindingEnv {
  readonly CONSOLE_DB: D1DatabaseLike;
  readonly SIGNER_DB: D1DatabaseLike;
  readonly SEAMS_TENANT_STORAGE_NAMESPACE?: string;
  readonly CONSOLE_STEP_UP_RP_ID?: string;
  readonly CONSOLE_STEP_UP_RP_NAME?: string;
  readonly CONSOLE_STEP_UP_ORIGIN?: string;
  readonly SEAMS_LOCAL_CONSOLE_ORG_ID: string;
  readonly SEAMS_LOCAL_CONSOLE_PROJECT_ID?: string;
  readonly SEAMS_LOCAL_CONSOLE_ENVIRONMENT_ID?: string;
  readonly SEAMS_LOCAL_RELAYER_ACCOUNT?: string;
  readonly SEAMS_LOCAL_RELAYER_PUBLIC_KEY?: string;
  readonly SEAMS_LOCAL_RELAYER_PRIVATE_KEY?: string;
  readonly RELAYER_ACCOUNT_ID?: string;
  readonly RELAYER_PUBLIC_KEY?: string;
  readonly RELAYER_PRIVATE_KEY?: string;
  readonly NEAR_RPC_URL?: string;
  readonly ARC_RPC_URL?: string;
  readonly ACCOUNT_INITIAL_BALANCE?: string;
  readonly ENABLE_IMPLICIT_NEAR_ACCOUNT_TEST_FUNDING?: string;
  readonly SEAMS_LOCAL_GOOGLE_OIDC_CLIENT_ID?: string;
  readonly GOOGLE_OIDC_CLIENT_ID?: string;
  readonly GOOGLE_OIDC_CLIENT_IDS?: string;
  readonly GITHUB_OAUTH_CLIENT_ID?: string;
  readonly GITHUB_OAUTH_CLIENT_SECRET?: string;
  readonly GITHUB_OAUTH_CALLBACK_URL?: string;
  readonly ROUTER_AB_CEREMONY_JWT_ISSUER?: string;
  readonly ROUTER_AB_CEREMONY_JWT_AUDIENCE?: string;
  readonly ROUTER_AB_CEREMONY_JWT_KEY_ID?: string;
  readonly ROUTER_AB_CEREMONY_JWT_PRIVATE_JWK?: string;
  readonly ROUTER_AB_ECDSA_REGISTRATION_TOPOLOGY_JSON?: string;
  readonly ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET?: string;
  readonly TENANT_ROOT_RESTORE_DESTINATION_JSON?: string;
  readonly TENANT_ROOT_RESTORE_ACCESS_JSON?: string;
  readonly TENANT_ROOT_RECOVERY_CERTIFICATES_JSON?: string;
  readonly TENANT_ROOT_CONTROL_PLANE?: CloudflareServiceBindingFetcher;
  readonly DERIVER_A?: CloudflareServiceBindingFetcher;
  readonly DERIVER_B?: CloudflareServiceBindingFetcher;
  readonly TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID: string;
  readonly TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED: string;
  readonly LINKED_DEVICE_WEBAUTHN_RP_ID?: string;
  readonly RELAY_SESSION_HMAC_SECRET?: string;
  readonly SESSION_COOKIE_NAME?: string;
  readonly RELAY_SESSION_ISSUER?: string;
  readonly RELAY_SESSION_AUDIENCE?: string;
  readonly CONSOLE_SESSION_HMAC_SECRET?: string;
  readonly CONSOLE_WEBHOOK_SECRET_KEY_B64U?: string;
  readonly CONSOLE_WEBHOOK_SECRET_KEY_ID?: string;
  readonly CONSOLE_SESSION_COOKIE_NAME?: string;
  readonly CONSOLE_SESSION_ISSUER?: string;
  readonly CONSOLE_SESSION_AUDIENCE?: string;
  readonly ROUTER_AB_NORMAL_SIGNING_WORKER_ID?: string;
  readonly SIGNING_WORKER_ID?: string;
  readonly DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY?: string;
  readonly DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY?: string;
  readonly DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH?: string;
  readonly DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY?: string;
  readonly DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH?: string;
  readonly DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY?: string;
  readonly DERIVER_A_PEER_VERIFYING_KEY_HEX?: string;
  readonly DERIVER_B_PEER_VERIFYING_KEY_HEX?: string;
  readonly SIGNING_WORKER_SERVER_OUTPUT_HPKE_KEY_EPOCH?: string;
  readonly SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY?: string;
  readonly ACCOUNT_ID_DERIVATION_SECRET?: string;
  readonly SIGNING_SESSION_SEAL_ROOT_SECRET_B64U?: string;
  readonly SIGNING_SESSION_SEAL_CURRENT_KEY_VERSION?: string;
  readonly SIGNING_SESSION_SEAL_ACCEPTED_WARM_KEY_VERSIONS?: string;
  readonly EMAIL_OTP_DELIVERY_MODE?: string;
  readonly EMAIL_OTP_RUNTIME_PROFILE?: string;
  readonly EMAIL_OTP_DEMO_ALLOWED_ORIGINS?: string;
  readonly EMAIL_OTP_DEV_OUTBOX_ENABLED?: string;
  readonly EMAIL_OTP_CHALLENGE_RATE_LIMIT_MAX?: string;
  readonly EMAIL_OTP_CHALLENGE_RATE_LIMIT_WINDOW_MS?: string;
  readonly EMAIL_OTP_VERIFY_RATE_LIMIT_MAX?: string;
  readonly EMAIL_OTP_VERIFY_RATE_LIMIT_WINDOW_MS?: string;
  readonly EMAIL_OTP_GRANT_RATE_LIMIT_MAX?: string;
  readonly EMAIL_OTP_GRANT_RATE_LIMIT_WINDOW_MS?: string;
  readonly EMAIL_OTP_MAX_ATTEMPTS?: string;
  readonly EMAIL_OTP_LOCKOUT_TTL_MS?: string;
  readonly EMAIL_OTP_GOOGLE_REGISTRATION_ATTEMPT_RATE_LIMIT_MAX?: string;
  readonly EMAIL_OTP_GOOGLE_REGISTRATION_ATTEMPT_RATE_LIMIT_WINDOW_MS?: string;
  readonly SPONSORED_EVM_EXECUTORS_JSON?: string;
  readonly SPONSORED_EXECUTION_REAL_PRICING_JSON?: string;
  readonly SPONSORED_EXECUTION_STATIC_PRICING_JSON?: string;
  readonly STRIPE_API_SK?: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly STRIPE_API_BASE_URL?: string;
  readonly STRIPE_API_TIMEOUT_MS?: string;
  readonly CONSOLE_BASE_URL?: string;
}

type TableCountRow = {
  readonly table_count?: unknown;
};

type ReadyD1SchemaResult = {
  readonly consoleTables: number;
  readonly signerTables: number;
};

const DEFAULT_LOCAL_CONSOLE_SESSION_HMAC_SECRET =
  'seams-local-console-session-secret-change-before-shared-dev';
const DEFAULT_LOCAL_CONSOLE_SESSION_COOKIE_NAME = 'seams-console-jwt';
const DEFAULT_LOCAL_CONSOLE_SESSION_ISSUER = 'https://localhost:4101/console';
const DEFAULT_LOCAL_CONSOLE_SESSION_AUDIENCE = 'seams-console-session';
const DEFAULT_LOCAL_CONSOLE_WEBHOOK_SECRET_KEY_ID = 'local-console-webhook-k1';
// AES-256-GCM key material for sealing webhook signing secrets at rest.
// Exactly 32 ASCII bytes; local dev only, overridden by CONSOLE_WEBHOOK_SECRET_KEY_B64U.
const DEFAULT_LOCAL_CONSOLE_WEBHOOK_SECRET_KEY = 'seams-local-console-webhook-key!';
const DEFAULT_LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET = 'dev-router-ab-internal-service-auth';
const DEFAULT_LOCAL_ROUTER_AB_ROUTER_URL = 'http://127.0.0.1:4100';
// Local D1 handlers are rebuilt per request, so synthetic provider state must outlive one handler.
const LOCAL_SYNTHETIC_BILLING_PROVIDERS = createDefaultBillingProviderAdapters();
const LOCAL_ROUTER_AB_CEREMONY_JWKS_PATH = '/.well-known/router-ab-ceremony-jwks.json';
const LOCAL_INTENDED_YAO_FAULT_HEADER_V1 = 'x-seams-intended-yao-fault-v1';
const LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1 = 'x-seams-intended-yao-fault-token-v1';
const LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-yao-fault-proof-v1';
const ROUTER_AB_YAO_REPLAY_HEADER_V1 = 'x-seams-yao-replay';
const ROUTER_AB_YAO_EXECUTE_PATH_V1 = '/router-ab/router/ed25519-yao/execute';
const LOCAL_INTENDED_YAO_FAULT_TOKEN_PATTERN_V1 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function localBillingProviderAdapters(env: LocalD1DevEnv) {
  return createStripeBillingProviderAdaptersFromEnv(env) ?? LOCAL_SYNTHETIC_BILLING_PROVIDERS;
}

type LocalIntendedYaoFaultModeV1 = 'drop_router_response_once' | 'return_terminal_burned_once';

type LocalIntendedYaoFaultProofV1 = 'exact_request_replayed' | 'terminal_failure_not_retried';

type LocalIntendedYaoFaultViolationV1 =
  | 'fault_already_armed'
  | 'router_execute_not_observed'
  | 'router_first_response_failed'
  | 'router_retry_not_observed'
  | 'router_retry_body_changed'
  | 'router_retry_trace_changed'
  | 'router_retry_marker_missing'
  | 'router_retry_response_failed'
  | 'unexpected_additional_execute';

type LocalIntendedYaoFaultStateV1 =
  | {
      readonly kind: 'idle';
    }
  | {
      readonly kind: 'armed';
      readonly mode: LocalIntendedYaoFaultModeV1;
    }
  | {
      readonly kind: 'awaiting_exact_replay';
      readonly body: Uint8Array;
      readonly traceId: string;
    }
  | {
      readonly kind: 'proved';
      readonly proof: LocalIntendedYaoFaultProofV1;
    }
  | {
      readonly kind: 'violated';
      readonly violation: LocalIntendedYaoFaultViolationV1;
    };

type LocalIntendedYaoFaultOutcomeV1 =
  | {
      readonly kind: 'proved';
      readonly proof: LocalIntendedYaoFaultProofV1;
    }
  | {
      readonly kind: 'violated';
      readonly violation: LocalIntendedYaoFaultViolationV1;
    };

type LocalIntendedYaoFaultTokenV1 = {
  readonly value: string;
};

type LocalEd25519YaoRouterFetchV1 =
  | {
      readonly kind: 'direct';
    }
  | {
      readonly kind: 'fault_injected';
      readonly controller: LocalIntendedYaoFaultControllerV1;
    };

const LOCAL_INTENDED_BURNED_EXECUTION_ID_V1 = new Array<number>(32).fill(93);

function equalRequestBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function parseLocalIntendedYaoFaultModeV1(
  value: string | null,
): LocalIntendedYaoFaultModeV1 | null {
  switch (value) {
    case 'drop_router_response_once':
    case 'return_terminal_burned_once':
      return value;
    default:
      return null;
  }
}

function parseLocalIntendedYaoFaultTokenV1(
  value: string | null,
): LocalIntendedYaoFaultTokenV1 | null {
  if (!isLocalIntendedYaoFaultTokenV1(value)) return null;
  return { value };
}

export function isLocalIntendedYaoFaultTokenV1(value: string | null): value is string {
  return !!value && LOCAL_INTENDED_YAO_FAULT_TOKEN_PATTERN_V1.test(value);
}

function terminalBurnedRouterResponseV1(): Response {
  return new Response(
    JSON.stringify({
      status: 'burned',
      execution_id: LOCAL_INTENDED_BURNED_EXECUTION_ID_V1,
      reason: 'protocol_failure',
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

export class LocalIntendedYaoFaultControllerV1 {
  private state: LocalIntendedYaoFaultStateV1 = { kind: 'idle' };

  constructor(private readonly baseFetch: typeof globalThis.fetch) {}

  arm(mode: LocalIntendedYaoFaultModeV1): void {
    if (this.state.kind !== 'idle') {
      this.state = { kind: 'violated', violation: 'fault_already_armed' };
      return;
    }
    this.state = { kind: 'armed', mode };
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== ROUTER_AB_YAO_EXECUTE_PATH_V1) {
      return await this.baseFetch.call(globalThis, request);
    }

    switch (this.state.kind) {
      case 'idle':
        return await this.baseFetch.call(globalThis, request);
      case 'armed':
        return await this.handleArmedExecute(request, this.state.mode);
      case 'awaiting_exact_replay':
        return await this.handleExactReplay(request, this.state);
      case 'proved':
      case 'violated':
        this.state = { kind: 'violated', violation: 'unexpected_additional_execute' };
        throw new Error('Local intended Yao fault observed an additional Router execute');
    }
  }

  consumeOutcome(): LocalIntendedYaoFaultOutcomeV1 {
    const current = this.state;
    this.state = { kind: 'idle' };
    switch (current.kind) {
      case 'proved':
        return current;
      case 'violated':
        return current;
      case 'armed':
        return { kind: 'violated', violation: 'router_execute_not_observed' };
      case 'awaiting_exact_replay':
        return { kind: 'violated', violation: 'router_retry_not_observed' };
      case 'idle':
        return { kind: 'violated', violation: 'router_execute_not_observed' };
    }
  }

  reset(): void {
    this.state = { kind: 'idle' };
  }

  private async handleArmedExecute(
    request: Request,
    mode: LocalIntendedYaoFaultModeV1,
  ): Promise<Response> {
    if (mode === 'return_terminal_burned_once') {
      this.state = { kind: 'proved', proof: 'terminal_failure_not_retried' };
      return terminalBurnedRouterResponseV1();
    }

    const body = new Uint8Array(await request.clone().arrayBuffer());
    const traceId = request.headers.get(ROUTER_AB_TRACE_ID_HEADER_V1) ?? '';
    const response = await this.baseFetch.call(globalThis, request);
    await response.clone().arrayBuffer();
    if (!response.ok) {
      this.state = { kind: 'violated', violation: 'router_first_response_failed' };
      return response;
    }
    this.state = { kind: 'awaiting_exact_replay', body, traceId };
    throw new Error('Local intended Yao fault dropped the completed Router response');
  }

  private async handleExactReplay(
    request: Request,
    expected: Extract<LocalIntendedYaoFaultStateV1, { kind: 'awaiting_exact_replay' }>,
  ): Promise<Response> {
    const replayBody = new Uint8Array(await request.clone().arrayBuffer());
    if (!equalRequestBytes(expected.body, replayBody)) {
      this.state = { kind: 'violated', violation: 'router_retry_body_changed' };
      throw new Error('Local intended Yao retry changed the Router request body');
    }
    if (request.headers.get(ROUTER_AB_TRACE_ID_HEADER_V1) !== expected.traceId) {
      this.state = { kind: 'violated', violation: 'router_retry_trace_changed' };
      throw new Error('Local intended Yao retry changed the Router trace ID');
    }
    if (request.headers.get(ROUTER_AB_YAO_REPLAY_HEADER_V1) !== '1') {
      this.state = { kind: 'violated', violation: 'router_retry_marker_missing' };
      throw new Error('Local intended Yao retry omitted the replay marker');
    }
    const response = await this.baseFetch.call(globalThis, request);
    await response.clone().arrayBuffer();
    if (!response.ok) {
      this.state = { kind: 'violated', violation: 'router_retry_response_failed' };
      return response;
    }
    this.state = { kind: 'proved', proof: 'exact_request_replayed' };
    return response;
  }
}

function localEd25519YaoRouterFetchV1(
  env: LocalD1DevEnv,
  routerFetch: LocalEd25519YaoRouterFetchV1,
): typeof globalThis.fetch {
  switch (routerFetch.kind) {
    case 'direct':
      return createRouterAbServiceBindingFetch(env);
    case 'fault_injected':
      return routerFetch.controller.fetch.bind(routerFetch.controller);
  }
}

function requestWithoutLocalIntendedYaoFaultHeadersV1(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(LOCAL_INTENDED_YAO_FAULT_HEADER_V1);
  headers.delete(LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1);
  return new Request(request, { headers });
}

function responseWithLocalIntendedYaoFaultOutcomeV1(
  response: Response,
  outcome: LocalIntendedYaoFaultOutcomeV1,
  token: LocalIntendedYaoFaultTokenV1,
): Response {
  const headers = new Headers(response.headers);
  const proof = outcome.kind === 'proved' ? outcome.proof : `violation:${outcome.violation}`;
  const value = `${token.value}:${proof}`;
  headers.set(LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function buildLocalRouterRequest(
  routerUrl: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Request {
  const source =
    input instanceof Request
      ? new Request(input, init)
      : new Request(new URL(String(input), routerUrl), init);
  const sourceUrl = new URL(source.url);
  const targetUrl = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, routerUrl);
  return new Request(targetUrl, source);
}

type LocalEcdsaStrictPorts = {
  readonly registration: RouterAbEcdsaStrictRegistrationPort;
  readonly postRegistration: RouterAbEcdsaStrictPostRegistrationPort;
};

const localEcdsaStrictPortsByEnv = new WeakMap<LocalD1DevEnv, Map<string, LocalEcdsaStrictPorts>>();

function localEcdsaStrictPorts(env: LocalD1DevEnv, orgId: string): LocalEcdsaStrictPorts {
  const portsByOrg =
    localEcdsaStrictPortsByEnv.get(env) ?? new Map<string, LocalEcdsaStrictPorts>();
  const existing = portsByOrg.get(orgId);
  if (existing) return existing;
  const privateJwkSource = normalizeLocalString(env.ROUTER_AB_CEREMONY_JWT_PRIVATE_JWK);
  const topologySource = normalizeLocalString(env.ROUTER_AB_ECDSA_REGISTRATION_TOPOLOGY_JSON);
  const privateJwk = parseRouterAbEcdsaEd25519PrivateJwk(
    privateJwkSource ? JSON.parse(privateJwkSource) : null,
  );
  const topology = parseRouterAbEcdsaStrictRegistrationTopology(
    topologySource ? JSON.parse(topologySource) : null,
  );
  if (!privateJwk || !topology) {
    throw new Error(
      'Local strict ECDSA registration requires ceremony JWK and registration topology',
    );
  }
  const tokenIssuer = localEcdsaCeremonyTokenIssuer(env, privateJwk);
  const config = {
    router: env.MPC_ROUTER,
    tokenIssuer,
    tokenScope: {
      orgId,
      projectId: localConsoleProjectId(env),
      environment: localConsoleEnvironmentId(env),
    },
    topology,
  };
  const ports = {
    registration: createRouterAbEcdsaStrictRegistrationPort(config),
    postRegistration: createRouterAbEcdsaStrictPostRegistrationPort(config),
  };
  portsByOrg.set(orgId, ports);
  localEcdsaStrictPortsByEnv.set(env, portsByOrg);
  return ports;
}

function localEcdsaCeremonyTokenIssuer(
  env: LocalD1DevEnv,
  privateJwk: RouterAbEcdsaEd25519PrivateJwk,
) {
  return createRouterAbEcdsaEd25519CeremonyTokenIssuer({
    issuer:
      normalizeLocalString(env.ROUTER_AB_CEREMONY_JWT_ISSUER) || DEFAULT_LOCAL_ROUTER_AB_ROUTER_URL,
    audience: normalizeLocalString(env.ROUTER_AB_CEREMONY_JWT_AUDIENCE) || 'router-ab',
    keyId: normalizeLocalString(env.ROUTER_AB_CEREMONY_JWT_KEY_ID) || 'local-router-ab-r1',
    privateJwk,
  });
}

function requireLocalEcdsaCeremonyPrivateJwk(env: LocalD1DevEnv): RouterAbEcdsaEd25519PrivateJwk {
  const privateJwkSource = normalizeLocalString(env.ROUTER_AB_CEREMONY_JWT_PRIVATE_JWK);
  const privateJwk = parseRouterAbEcdsaEd25519PrivateJwk(
    privateJwkSource ? JSON.parse(privateJwkSource) : null,
  );
  if (!privateJwk) {
    throw new Error('Local ceremony JWT private JWK is required');
  }
  return privateJwk;
}

function localRouterAbCeremonyJwksResponse(env: LocalD1DevEnv): Response {
  const privateJwk = requireLocalEcdsaCeremonyPrivateJwk(env);
  const issuer = localEcdsaCeremonyTokenIssuer(env, privateJwk);
  return new Response(JSON.stringify(issuer.publicJwks()), {
    status: 200,
    headers: {
      'cache-control': 'public, max-age=300',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
const LOCAL_ROUTER_API_CORS_ORIGINS = Object.freeze([
  'http://localhost:4001',
  'https://localhost',
  'https://localhost:4002',
  'https://localhost:4101',
  'http://127.0.0.1:4100',
  'http://localhost:4100',
  'http://127.0.0.1:8787',
  'http://localhost:8787',
]);
const LOCAL_HOSTED_WALLET_ORIGINS = Object.freeze(['https://localhost:4002']);

export function localHostedWalletOrigins(): string[] {
  return [...LOCAL_HOSTED_WALLET_ORIGINS];
}
const CONSOLE_READY_TABLES = Object.freeze([
  'organizations',
  'projects',
  'environments',
  'organization_memberships',
  'organization_admin_permissions',
  'organization_invitations',
  'project_member_access',
  'organization_owner_events',
  'user_profiles',
  'user_backup_emails',
  'policies',
  'policy_versions',
  'policy_assignments',
  'wallet_index',
  'api_keys',
  'approvals',
  'key_exports',
  'webhook_endpoints',
  'webhook_endpoint_categories',
  'webhook_deliveries',
  'webhook_attempts',
  'webhook_dead_letters',
  'observability_events',
  'observability_event_dedup',
  'observability_ingest_windows',
  'observability_request_rollups_minute',
  'audit_events',
  'audit_evidence',
  'billing_accounts',
  'billing_ledger_entries',
  'billing_ledger_postings',
  'billing_monthly_active_resources',
  'billing_credit_purchases',
  'invoices',
  'invoice_line_items',
  'stripe_webhook_events',
  'billing_prepaid_reservation_summaries',
  'billing_prepaid_reservations',
  'sponsorship_spend_cap_windows',
  'sponsorship_spend_cap_reservations',
  'sponsorship_pricing_rules',
  'sponsored_call_records',
  'runtime_snapshots',
  'runtime_snapshot_outbox',
]);

const SIGNER_READY_TABLES = Object.freeze([
  'wallets',
  'wallet_signers',
  'wallet_auth_methods',
  'webauthn_authenticators',
  'webauthn_credential_bindings',
  'webauthn_challenges',
  'identity_links',
  'authorization_wallet_session_quotas',
  'wallet_session_authorizations_v2',
  'wallet_session_hosted_credentials_v2',
  'wallet_session_hosted_exchange_codes_v2',
  'linked_device_wallet_session_credential_deliveries_v1',
  'verified_wallet_operation_evidence_sets',
  'verified_owner_proof_consumptions',
  'near_public_keys',
  'email_otp_challenges',
  'email_otp_grants',
  'email_otp_wallet_enrollments',
  'email_otp_auth_states',
  'email_otp_unlock_challenges',
  'email_otp_registration_attempts',
  'email_otp_rate_limits',
  'router_ab_yao_capability_replacements',
  'router_ab_yao_versioned_json_records',
  'router_ab_yao_versioned_json_cas_guard',
  'router_ab_normal_signing_admission_records',
  'registration_ceremony_records',
  'registration_ceremony_cas_guard',
  'lane_enrollments',
  'lane_protocol_operations',
  'lane_product_epochs',
  'lane_receipts',
  'lane_effect_journal',
  'lane_locks',
  'lane_cas_guard',
  'linked_device_sessions',
  'linked_device_session_cas_guard',
  'linked_device_session_transcripts',
  'linked_device_request_proof_nonces',
  'linked_device_target_credentials',
  'linked_device_target_commit_reservations',
  'linked_device_email_otp_grants',
  'linked_device_ed25519_export_root_transfers',
]);

function jsonResponse(body: Record<string, unknown>, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers || {}),
    },
  });
}

function localRouterAbInternalServiceAuthSecret(env: LocalD1DevEnv): string {
  return (
    normalizeLocalString(env.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET) ||
    DEFAULT_LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET
  );
}

function parseReadyTableCount(row: TableCountRow | null): number {
  const count = Number(row?.table_count);
  if (!Number.isInteger(count) || count < 0) return 0;
  return count;
}

function localTenantStorageNamespace(env: LocalD1DevEnv): string {
  const namespace = String(env.SEAMS_TENANT_STORAGE_NAMESPACE || '').trim();
  return namespace || 'seams-local';
}

// Without a secret cipher the console webhook service is never constructed and
// every /console/webhooks route answers 501 webhooks_not_configured.
function localConsoleWebhookSecretCipher(env: LocalD1DevEnv): ConsoleWebhookSecretCipher {
  const configured = normalizeLocalString(env.CONSOLE_WEBHOOK_SECRET_KEY_B64U);
  const keyBytes = configured
    ? base64UrlDecode(configured)
    : new TextEncoder().encode(DEFAULT_LOCAL_CONSOLE_WEBHOOK_SECRET_KEY);
  return createAesGcmConsoleWebhookSecretCipher({
    keyId:
      normalizeLocalString(env.CONSOLE_WEBHOOK_SECRET_KEY_ID) ||
      DEFAULT_LOCAL_CONSOLE_WEBHOOK_SECRET_KEY_ID,
    keyBytes,
  });
}

class LocalD1DevReadyCheck {
  constructor(private readonly env: LocalD1DevEnv) {}

  async check(): Promise<void> {
    await assertLocalD1DoReady(this.env);
  }
}

function normalizeLocalString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function localStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const values: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const value = normalizeLocalString(item);
    if (!value || seen.has(value)) continue;
    values.push(value);
    seen.add(value);
  }
  return values;
}

function localCsvStringArray(input: unknown): string[] {
  const raw = normalizeLocalString(input);
  if (!raw) return [];
  return localStringArray(raw.split(','));
}

function localGoogleOidcClientId(env: LocalD1DevEnv): string | undefined {
  return (
    normalizeLocalString(env.GOOGLE_OIDC_CLIENT_ID) ||
    localCsvStringArray(env.GOOGLE_OIDC_CLIENT_IDS)[0] ||
    normalizeLocalString(env.SEAMS_LOCAL_GOOGLE_OIDC_CLIENT_ID) ||
    undefined
  );
}

function localGithubOAuthConfig(env: LocalD1DevEnv) {
  const clientId = normalizeLocalString(env.GITHUB_OAUTH_CLIENT_ID);
  const clientSecret = normalizeLocalString(env.GITHUB_OAUTH_CLIENT_SECRET);
  const callbackUrl = normalizeLocalString(env.GITHUB_OAUTH_CALLBACK_URL);
  if (!clientId && !clientSecret && !callbackUrl) return undefined;
  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error(
      'GitHub OAuth requires GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, and GITHUB_OAUTH_CALLBACK_URL',
    );
  }
  return { clientId, clientSecret, callbackUrl };
}

function localRouterApiSessionCookieName(env: LocalD1DevEnv): string | undefined {
  return normalizeLocalString(env.SESSION_COOKIE_NAME) || undefined;
}

function localConsoleSession(env: LocalD1DevEnv): SessionAdapter {
  return createHmacSessionAdapter({
    secret:
      normalizeLocalString(env.CONSOLE_SESSION_HMAC_SECRET) ||
      DEFAULT_LOCAL_CONSOLE_SESSION_HMAC_SECRET,
    cookieName:
      normalizeLocalString(env.CONSOLE_SESSION_COOKIE_NAME) ||
      DEFAULT_LOCAL_CONSOLE_SESSION_COOKIE_NAME,
    issuer:
      normalizeLocalString(env.CONSOLE_SESSION_ISSUER) || DEFAULT_LOCAL_CONSOLE_SESSION_ISSUER,
    audience:
      normalizeLocalString(env.CONSOLE_SESSION_AUDIENCE) || DEFAULT_LOCAL_CONSOLE_SESSION_AUDIENCE,
  });
}

function localEmailOtpServerSealConfig(
  env: LocalD1DevEnv,
): CloudflareD1EmailOtpServerSealConfig | undefined {
  const rootSecretB64u = normalizeLocalString(env.SIGNING_SESSION_SEAL_ROOT_SECRET_B64U);
  const currentKeyVersion = normalizeLocalString(env.SIGNING_SESSION_SEAL_CURRENT_KEY_VERSION);
  const acceptedWarmKeyVersions = normalizeLocalString(
    env.SIGNING_SESSION_SEAL_ACCEPTED_WARM_KEY_VERSIONS,
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!rootSecretB64u && !currentKeyVersion) {
    return undefined;
  }
  if (!rootSecretB64u || !currentKeyVersion || acceptedWarmKeyVersions.length === 0) {
    throw new Error(
      'Email OTP server seal requires the root secret, current key version, and accepted warm key versions',
    );
  }
  return {
    rootSecretB64u,
    currentKeyVersion,
    acceptedWarmKeyVersions,
  };
}

function localConsoleOrgId(env: LocalD1DevEnv): string {
  return parseLocalConsoleOrganizationId(env.SEAMS_LOCAL_CONSOLE_ORG_ID);
}

async function resolveLocalRouterOrganizationId(env: LocalD1DevEnv): Promise<string> {
  const environment = await env.CONSOLE_DB.prepare(
    `SELECT org_id
       FROM environments
      WHERE namespace = ? AND id = ? AND status = 'ACTIVE'
      LIMIT 1`,
  )
    .bind(localTenantStorageNamespace(env), localConsoleEnvironmentId(env))
    .first<{ readonly org_id: unknown }>();
  return environment
    ? parseLocalConsoleOrganizationId(String(environment.org_id || ''))
    : localConsoleOrgId(env);
}

function parseLocalConsoleOrganizationId(value: string): string {
  const organizationId = normalizeLocalString(value);
  if (!CONSOLE_ORGANIZATION_ID_PATTERN.test(organizationId)) {
    throw new Error('SEAMS_LOCAL_CONSOLE_ORG_ID must match org_[a-z0-9]{12}');
  }
  return organizationId;
}

function localConsoleProjectId(env: LocalD1DevEnv): string {
  const projectId = normalizeLocalString(env.SEAMS_LOCAL_CONSOLE_PROJECT_ID);
  if (!projectId) throw new Error('Configure SEAMS_LOCAL_CONSOLE_PROJECT_ID from the Console');
  return projectId;
}

function localConsoleEnvironmentId(env: LocalD1DevEnv): string {
  const environmentId = normalizeLocalString(env.SEAMS_LOCAL_CONSOLE_ENVIRONMENT_ID);
  if (!environmentId)
    throw new Error('Configure SEAMS_LOCAL_CONSOLE_ENVIRONMENT_ID from the Console');
  return environmentId;
}

function isConsolePath(pathname: string): boolean {
  return pathname === '/console' || pathname.startsWith('/console/');
}

function isRouterApiPath(pathname: string): boolean {
  return (
    pathname === '/relay' ||
    pathname.startsWith('/relay/') ||
    pathname.startsWith('/.well-known/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/near/') ||
    pathname.startsWith('/router-ab/') ||
    // The SDK relayer client POSTs signed delegates to `/signed-delegate`
    // (DEFAULT_SIGNED_DELEGATE_ROUTE). Without this, the request fell through
    // to the catch-all `{ ok: true }` responder and never reached the router
    // API handler that actually broadcasts the delegate to NEAR.
    pathname === '/signed-delegate' ||
    pathname.startsWith('/sponsorships/') ||
    pathname.startsWith('/sync-account/') ||
    pathname.startsWith('/internal/gateway/') ||
    pathname.startsWith('/v1/') ||
    pathname.startsWith('/wallet/') ||
    pathname.startsWith('/wallet-session/') ||
    pathname.startsWith('/wallets/') ||
    pathname.startsWith('/webauthn/')
  );
}

async function assertLocalD1DoReady(env: LocalD1DevEnv): Promise<void> {
  await assertLocalD1Schemas(env);
}

function createLocalReadyCheck(env: LocalD1DevEnv): () => Promise<void> {
  const readyCheck = new LocalD1DevReadyCheck(env);
  return readyCheck.check.bind(readyCheck);
}

async function createLocalConsoleHandler(env: LocalD1DevEnv): Promise<FetchHandler> {
  const sponsoredEvmCallConfig = await resolveSponsoredEvmCallConfigFromWorkerEnv(env);
  const billingProviders = localBillingProviderAdapters(env);
  const bundle = await createCloudflareD1ConsoleServiceBundle({
    bindings: {
      consoleDatabase: env.CONSOLE_DB,
      signerMetadataDatabase: env.SIGNER_DB,
    },
    route: {
      namespace: localTenantStorageNamespace(env),
    },
    adapters: {
      ensureSchema: false,
      sponsoredEvmCallConfig,
      sponsorshipPricing: resolveSponsoredExecutionPricingFromEnv(env),
      billingProviders,
      billingEmailConsoleBaseUrl:
        String(env.CONSOLE_BASE_URL || '').trim() || 'http://localhost:4001',
      webhookSecretCipher: localConsoleWebhookSecretCipher(env),
    },
  });
  const session = localConsoleSession(env);
  const sessionAuth = createConsoleSessionAuthAdapter({
    session,
    organizationAccess: bundle.organizationAccess,
  });
  const auth = sessionAuth;
  const handler = createHostedWalletConsoleRouter({
    core: consoleCoreServicesFromBundle(bundle),
    walletConsole: walletConsoleServicesFromBundle(bundle),
    tenantStorage: {
      resolver: bundle.tenantStorageRouteResolver,
      namespace: bundle.tenantStorageNamespace,
    },
    corsOrigins: [...LOCAL_ROUTER_API_CORS_ORIGINS],
    auth,
    session,
    readyCheck: createLocalReadyCheck(env),
    billingStripeWebhookSigningSecret: String(env.STRIPE_WEBHOOK_SECRET || '').trim() || undefined,
  });
  const tenantRootRestoreRoute = await createTenantRootRestoreWorkerRouteV1({
    destinationJson: env.TENANT_ROOT_RESTORE_DESTINATION_JSON,
    database: env.CONSOLE_DB,
    namespace: localTenantStorageNamespace(env),
    router: env.MPC_ROUTER,
    internalServiceAuthSecret: localRouterAbInternalServiceAuthSecret(env),
    grantKeyId: requireLocalEnvString(
      env.TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID,
      'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID',
    ),
    grantSigningSeedB64u: requireLocalEnvString(
      env.TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED,
      'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED',
    ),
    audit: createConsoleTenantRootAuditWriterV1({ audit: bundle.audit, actorType: 'USER' }),
  });
  const tenantRootCreationRoute = createTenantRootCreationConsoleRouteV1({
    auth,
    orgProjectEnv: bundle.orgProjectEnv,
    grants: createD1TenantRootCreationGrantServiceV1({
      database: env.CONSOLE_DB,
      namespace: localTenantStorageNamespace(env),
    }),
    router: env.MPC_ROUTER,
    internalServiceAuthSecret: localRouterAbInternalServiceAuthSecret(env),
    grantAuthorityKeyId: requireLocalEnvString(
      env.TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID,
      'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_KEY_ID',
    ),
    grantAuthoritySigningSeedB64u: requireLocalEnvString(
      env.TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED,
      'TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED',
    ),
  });
  const localTenantStepUpStore = createD1TenantRootStepUpStoreV1({
    database: env.CONSOLE_DB,
    namespace: localTenantStorageNamespace(env),
  });
  // Rotation and the ceremony that unlocks it are mounted together. The
  // refresh route refuses without fresh step-up, so mounting it alone would
  // make rotation undemonstrable locally.
  const tenantRootCustody = new TenantRootCustodyWorkerRouteV1({
    backupIntervalMs: 60_000,
    auth,
    orgProjectEnv: bundle.orgProjectEnv,
    stepUp: localTenantStepUpStore,
    database: env.CONSOLE_DB,
    namespace: localTenantStorageNamespace(env),
    state: createTenantRootSecurityStateReaderV1({
      router: env.MPC_ROUTER,
      internalServiceAuthSecret: localRouterAbInternalServiceAuthSecret(env),
      activeRoots: new D1TenantRootActiveLineageResolverV1(
        env.CONSOLE_DB,
        localTenantStorageNamespace(env),
      ),
    }),
    organizationAccess: bundle.organizationAccess,
    audit: createConsoleTenantRootAuditWriterV1({ audit: bundle.audit, actorType: 'USER' }),
    internalServiceAuthSecret: localRouterAbInternalServiceAuthSecret(env),
    certificatesJson: env.TENANT_ROOT_RECOVERY_CERTIFICATES_JSON,
    controlPlane: env.TENANT_ROOT_CONTROL_PLANE,
    deriverA: env.DERIVER_A,
    deriverB: env.DERIVER_B,
  });
  const tenantRootRefreshRoute = createTenantRootRefreshConsoleRouteV1({
    audit: createConsoleTenantRootAuditWriterV1({ audit: bundle.audit, actorType: 'USER' }),
    operations: (scope) =>
      createD1TenantRootOperationStoreV1({
        database: env.CONSOLE_DB,
        namespace: localTenantStorageNamespace(env),
        ...scope,
      }),
    auth,
    orgProjectEnv: bundle.orgProjectEnv,
    state: tenantRootCustody,
    router: env.MPC_ROUTER,
    internalServiceAuthSecret: localRouterAbInternalServiceAuthSecret(env),
    stepUp: localTenantStepUpStore,
  });
  const consoleStepUpRoute = createConsoleStepUpRouteV1({
    auth,
    credentials: createD1ConsoleStepUpCredentialStoreV1({
      database: env.CONSOLE_DB,
      namespace: localTenantStorageNamespace(env),
    }),
    stepUp: localTenantStepUpStore,
    webAuthn: createConsoleWebAuthnPortV1({
      rpId: String(env.CONSOLE_STEP_UP_RP_ID || 'localhost').trim(),
      rpName: String(env.CONSOLE_STEP_UP_RP_NAME || 'Seams Console (local)').trim(),
      expectedOrigin: new URL(
        String(
          env.CONSOLE_STEP_UP_ORIGIN || env.CONSOLE_BASE_URL || 'http://localhost:4001',
        ).trim(),
      ).origin,
    }),
  });
  // Reads only: rotation is the refresh route, and polling reads the durable
  // operation that route wrote.
  const restoreAccessRoute = await createRestoreAccessRoute(
    {
      audit: bundle.audit,
      database: env.CONSOLE_DB,
      namespace: localTenantStorageNamespace(env),
      isOwner: tenantRootCustody.isOrganizationOwner.bind(tenantRootCustody),
      auth,
      orgProjectEnv: bundle.orgProjectEnv,
      stepUp: localTenantStepUpStore,
    },
    env.TENANT_ROOT_RESTORE_ACCESS_JSON,
  );
  const tenantRootSecurityReadRoute = createTenantRootSecurityConsoleRouteV1({
    auth,
    orgProjectEnv: bundle.orgProjectEnv,
    stepUp: localTenantStepUpStore,
    state: tenantRootCustody,
    operations: (scope) =>
      createD1TenantRootOperationStoreV1({
        database: env.CONSOLE_DB,
        namespace: localTenantStorageNamespace(env),
        ...scope,
      }),
  });
  const handlerWithTenantRootCreation = createLocalConsoleTenantRootHandler({
    handler,
    tenantRootRoutes: [
      recoveryTrustResponse.bind(
        null,
        env.TENANT_ROOT_CONTROL_PLANE,
        localRouterAbInternalServiceAuthSecret(env),
        env.CONSOLE_STEP_UP_ORIGIN || env.CONSOLE_BASE_URL || 'http://localhost:4001',
      ),
      tenantRootCustody.fetch.bind(tenantRootCustody),
      tenantRootRestoreRoute,
      tenantRootCreationRoute,
      tenantRootRefreshRoute,
      consoleStepUpRoute,
      restoreAccessRoute,
      tenantRootSecurityReadRoute,
    ],
  });
  const consoleAuthHandler = new HostedConsoleAuthHandler({
    handler: handlerWithTenantRootCreation,
    identity: createConsoleProviderIdentity({
      googleOidcClientId: localGoogleOidcClientId(env),
      githubOAuth: localGithubOAuthConfig(env),
    }),
    session,
    account: bundle.account,
    orgProjectEnv: bundle.orgProjectEnv,
    corsOrigins: [...LOCAL_ROUTER_API_CORS_ORIGINS],
  });
  return attachConsoleRouteSurface(
    consoleAuthHandler.fetch.bind(consoleAuthHandler),
    resolveCompleteWalletConsoleRouteSurface(),
  );
}

type LocalConsoleTenantRootHandlerInput = {
  readonly handler: FetchHandler;
  /** Tried in order; the first that claims the request answers it. */
  readonly tenantRootRoutes: readonly ((request: Request) => Promise<Response | null>)[];
};

function createLocalConsoleTenantRootHandler(
  input: LocalConsoleTenantRootHandlerInput,
): FetchHandler {
  return handleLocalConsoleTenantRoot.bind(undefined, input);
}

async function handleLocalConsoleTenantRoot(
  input: LocalConsoleTenantRootHandlerInput,
  request: Request,
  workerEnv: CfEnv | undefined,
  ctx: CfExecutionContext | undefined,
): Promise<Response> {
  for (const route of input.tenantRootRoutes) {
    const response = await route(request);
    if (response) return response;
  }
  return await input.handler(request, workerEnv, ctx);
}

function localConsoleHandler(env: LocalD1DevEnv): Promise<FetchHandler> {
  return createLocalConsoleHandler(env);
}

async function createLocalRouterApiHandler(
  env: LocalD1DevEnv,
  routerFetch: LocalEd25519YaoRouterFetchV1,
): Promise<FetchHandler> {
  const orgId = await resolveLocalRouterOrganizationId(env);
  const sponsoredEvmCallConfig = await resolveSponsoredEvmCallConfigFromWorkerEnv(env);
  const routerAbPublicKeyset = localRouterAbPublicKeyset(env);
  const billingProviders = localBillingProviderAdapters(env);
  const bundle = await createCloudflareD1ConsoleServiceBundle({
    bindings: {
      consoleDatabase: env.CONSOLE_DB,
      signerMetadataDatabase: env.SIGNER_DB,
    },
    route: {
      namespace: localTenantStorageNamespace(env),
    },
    adapters: {
      ensureSchema: false,
      sponsoredEvmCallConfig,
      resolveSponsoredEvmExecutionAdapter: resolveSponsoredEvmWorkerExecutionAdapter,
      sponsorshipPricing: resolveSponsoredExecutionPricingFromEnv(env),
      billingProviders,
      webhookSecretCipher: localConsoleWebhookSecretCipher(env),
    },
  });
  const sessionCookieName = localRouterApiSessionCookieName(env);
  const session = createEd25519SessionAdapter({
    privateJwk: requireLocalEcdsaCeremonyPrivateJwk(env),
    keyId: normalizeLocalString(env.ROUTER_AB_CEREMONY_JWT_KEY_ID) || 'local-router-ab-r1',
    cookieName: sessionCookieName,
    issuer:
      normalizeLocalString(env.ROUTER_AB_CEREMONY_JWT_ISSUER) || DEFAULT_LOCAL_ROUTER_AB_ROUTER_URL,
    audience: normalizeLocalString(env.ROUTER_AB_CEREMONY_JWT_AUDIENCE) || 'router-ab',
  });
  const routerApiServiceState: LocalRouterApiServiceState = { service: null };
  const ed25519YaoComposition = await createLocalEd25519YaoProductComposition(
    env,
    routerFetch,
    orgId,
    resolveLocalRecoveryAuthorizationServices.bind(undefined, routerApiServiceState),
    resolveLocalActiveTenantRoot.bind(undefined, routerApiServiceState),
    readLocalLinkedAuthorities.bind(undefined, routerApiServiceState),
  );
  const ecdsaStrictPorts = localEcdsaStrictPorts(env, orgId);
  routerApiServiceState.service = createLocalD1RouterApiAuthService(
    env,
    orgId,
    ed25519YaoComposition,
  );
  const routerApiService = requireLocalRouterApiService(routerApiServiceState);
  const ed25519Yao =
    ed25519YaoComposition.kind === 'enabled'
      ? {
          ...ed25519YaoComposition,
          requestScoped: {
            ...ed25519YaoComposition.requestScoped,
            exportAuthorization: new RouterAbEd25519YaoExportOwnerProofAuthorizationAdapter(
              routerApiService.webAuthn,
              routerApiService.emailOtp,
              routerApiService.walletAuthMethods,
              routerApiService.authorizedOperations,
              routerApiService.walletRegistration.resolveEd25519MaterialActivation.bind(
                routerApiService.walletRegistration,
              ),
            ),
          },
        }
      : ed25519YaoComposition;
  const baseHandler = createCloudflareRouter(routerApiService, {
    ...bundle.routerApiRouterOptions,
    routeExtensions: createCloudflareD1RouterApiRouteExtensions(bundle, routerApiService),
    healthz: true,
    readyz: true,
    corsOrigins: [...LOCAL_ROUTER_API_CORS_ORIGINS],
    hostedWalletOrigins: localHostedWalletOrigins(),
    ...(routerAbPublicKeyset ? { routerAbPublicKeyset } : {}),
    session,
    ...(ed25519Yao.kind === 'enabled' ? { routerAbEd25519YaoProduct: ed25519Yao.runtime } : {}),
    ...(sessionCookieName ? { sessionCookieName } : {}),
    routerAbNormalSigningRouterProxy: {
      internalServiceAuthSecret: localRouterAbInternalServiceAuthSecret(env),
      fetch: (request) => env.MPC_ROUTER.fetch(request),
    },
    routerAbEcdsaStrictPostRegistration: ecdsaStrictPorts.postRegistration,
    signingSessionSeal: localSigningSessionSealOptions(env),
  });
  if (ed25519Yao.kind !== 'enabled') return baseHandler;
  return createLocalRouterApiRequestScopedHandler({
    baseHandler,
    dependencies: ed25519Yao.requestScoped,
  });
}

type LocalRouterApiRequestScopedHandlerInput = {
  readonly baseHandler: FetchHandler;
  readonly dependencies: LocalEd25519YaoRequestScopedDependencies;
};

function createLocalRouterApiRequestScopedHandler(
  input: LocalRouterApiRequestScopedHandlerInput,
): FetchHandler {
  return handleLocalRouterApiRequestScoped.bind(undefined, input);
}

async function handleLocalRouterApiRequestScoped(
  input: LocalRouterApiRequestScopedHandlerInput,
  request: Request,
  env: CfEnv | undefined,
  ctx: CfExecutionContext | undefined,
): Promise<Response> {
  const response = await handleLocalYaoRequestScoped(input.dependencies, request);
  if (response) {
    withCors(response.headers, { corsOrigins: [...LOCAL_ROUTER_API_CORS_ORIGINS] }, request);
    return response;
  }
  return await input.baseHandler(request, env, ctx);
}

async function handleLocalYaoRequestScoped(
  dependencies: LocalEd25519YaoRequestScopedDependencies,
  request: Request,
): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const pathname = new URL(request.url).pathname;
  switch (pathname) {
    case ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1:
    case ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1:
      return await handleRouterAbEd25519YaoRegistrationRequestScopedCloudflareV1({
        request,
        store: dependencies.store,
        backend: dependencies.backend,
      });
    case ROUTER_AB_ED25519_YAO_WARM_RECOVERY_BOOTSTRAP_PATH_V1:
    case ROUTER_AB_ED25519_YAO_RECOVERY_ADMISSION_PATH_V1:
    case ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1:
    case ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1:
    case ROUTER_AB_ED25519_YAO_RECOVERY_STATUS_PATH_V1:
      return await handleRouterAbEd25519YaoRecoveryRequestScopedCloudflareV1({
        request,
        store: dependencies.store,
        backend: dependencies.backend,
        authorization: dependencies.recoveryAuthorization,
        capabilityPersistence: dependencies.capabilityPersistence,
        capabilities: dependencies.capabilities,
        linkedAuthorities: dependencies.linkedAuthorities(),
      });
    case ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1:
    case ROUTER_AB_ED25519_YAO_EXPORT_EXECUTE_PATH_V1:
      return await handleRouterAbEd25519YaoExportRequestScopedCloudflareV1({
        request,
        store: dependencies.store,
        backend: dependencies.backend,
        authorization: dependencies.exportAuthorization,
        capabilities: dependencies.capabilities,
      });
    default:
      return null;
  }
}

function localSigningSessionSealOptions(
  env: LocalD1DevEnv,
): SigningSessionSealRoutesOptions | undefined {
  const seal = localEmailOtpServerSealConfig(env);
  if (!seal) return undefined;
  return createSigningSessionSealOptions({
    rootSecretB64u: seal.rootSecretB64u,
    currentKeyVersion: seal.currentKeyVersion,
    acceptedWarmKeyVersions: seal.acceptedWarmKeyVersions,
  });
}

function createLocalEcdsaPresignRuntime(env: LocalD1DevEnv): RouterAbEcdsaPresignRuntime {
  return new RouterAbEcdsaPresignRuntime({
    config: {
      nodeRole: 'coordinator',
      participantIds: {
        clientParticipantId: 1,
        relayerParticipantId: 2,
        participantIds2p: [1, 2],
      },
    },
    signingWorkerTransport: {
      kind: 'configured',
      signingWorkerBaseUrl: ROUTER_AB_SIGNING_WORKER_ORIGIN,
      auth: {
        kind: 'internal_service_auth_secret',
        secret: localRouterAbInternalServiceAuthSecret(env),
      },
      fetchImpl: createRouterAbServiceBindingFetch(env),
    },
    ensureReady: readyLocalEcdsaPresignRuntime,
  });
}

async function readyLocalEcdsaPresignRuntime(): Promise<void> {}

function localD1RouterApiAuthServiceOptions(
  env: LocalD1DevEnv,
  orgId: string,
  ed25519Yao: LocalEd25519YaoProductCompositionState = { kind: 'disabled' },
): CloudflareD1RouterApiAuthServiceOptions {
  const relayerPrivateKey = env.RELAYER_PRIVATE_KEY || env.SEAMS_LOCAL_RELAYER_PRIVATE_KEY;
  const relayerPublicKey =
    env.RELAYER_PUBLIC_KEY ||
    (env.RELAYER_PRIVATE_KEY ? undefined : env.SEAMS_LOCAL_RELAYER_PUBLIC_KEY);
  const tenantRootCustodyLineage = localTenantRootCustodyLineageResolver(env);
  return {
    database: env.SIGNER_DB,
    namespace: localTenantStorageNamespace(env),
    orgId,
    projectId: localConsoleProjectId(env),
    envId: localConsoleEnvironmentId(env),
    relayerAccount: env.RELAYER_ACCOUNT_ID || env.SEAMS_LOCAL_RELAYER_ACCOUNT,
    relayerPublicKey,
    relayerPrivateKey,
    nearRpcUrl: env.NEAR_RPC_URL,
    accountInitialBalance: env.ACCOUNT_INITIAL_BALANCE,
    implicitNearAccountTestFundingEnabled: env.ENABLE_IMPLICIT_NEAR_ACCOUNT_TEST_FUNDING,
    googleOidcClientId: localGoogleOidcClientId(env),
    githubOAuth: localGithubOAuthConfig(env),
    accountIdDerivationSecret: env.ACCOUNT_ID_DERIVATION_SECRET,
    emailOtpServerSeal: localEmailOtpServerSealConfig(env),
    emailOtpDeliveryMode: env.EMAIL_OTP_DELIVERY_MODE || 'dev_d1_outbox',
    emailOtpRuntimeProfile: env.EMAIL_OTP_RUNTIME_PROFILE,
    emailOtpDemoAllowedOrigins: env.EMAIL_OTP_DEMO_ALLOWED_ORIGINS,
    emailOtpDevOutboxEnabled: env.EMAIL_OTP_DEV_OUTBOX_ENABLED ?? true,
    emailOtpChallengeRateLimitMax: env.EMAIL_OTP_CHALLENGE_RATE_LIMIT_MAX,
    emailOtpChallengeRateLimitWindowMs: env.EMAIL_OTP_CHALLENGE_RATE_LIMIT_WINDOW_MS,
    emailOtpVerifyRateLimitMax: env.EMAIL_OTP_VERIFY_RATE_LIMIT_MAX,
    emailOtpVerifyRateLimitWindowMs: env.EMAIL_OTP_VERIFY_RATE_LIMIT_WINDOW_MS,
    emailOtpGrantRateLimitMax: env.EMAIL_OTP_GRANT_RATE_LIMIT_MAX,
    emailOtpGrantRateLimitWindowMs: env.EMAIL_OTP_GRANT_RATE_LIMIT_WINDOW_MS,
    emailOtpMaxAttempts: env.EMAIL_OTP_MAX_ATTEMPTS,
    emailOtpLockoutTtlMs: env.EMAIL_OTP_LOCKOUT_TTL_MS,
    emailOtpGoogleRegistrationAttemptRateLimitMax:
      env.EMAIL_OTP_GOOGLE_REGISTRATION_ATTEMPT_RATE_LIMIT_MAX,
    emailOtpGoogleRegistrationAttemptRateLimitWindowMs:
      env.EMAIL_OTP_GOOGLE_REGISTRATION_ATTEMPT_RATE_LIMIT_WINDOW_MS,
    routerAbEcdsaPresignRuntime: createLocalEcdsaPresignRuntime(env),
    ecdsaStrictRegistration: localEcdsaStrictPorts(env, orgId).registration,
    tenantRootCustodyLineage,
    linkedDevice: localLinkedDeviceSessionComposition(env, orgId, tenantRootCustodyLineage),
    ...(ed25519Yao.kind === 'enabled' ? { ed25519YaoProductRegistration: ed25519Yao.runtime } : {}),
  };
}

function localTenantRootCustodyLineageResolver(
  env: LocalD1DevEnv,
): CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'] {
  const resolver = new D1TenantRootActiveLineageResolverV1(
    env.CONSOLE_DB,
    localTenantStorageNamespace(env),
  );
  return {
    resolveActiveLineage: resolveLocalTenantRootActiveLineage.bind(null, resolver),
    resolveActiveLineageForRuntimeScope: resolveLocalRuntimeTenantRootLineage.bind(
      null,
      env,
      resolver,
    ),
  };
}

async function resolveLocalRuntimeTenantRootLineage(
  env: LocalD1DevEnv,
  roots: D1TenantRootActiveLineageResolverV1,
  scope: RuntimePolicyScope & { readonly signingRootId: string },
) {
  const environments = await createD1ConsoleOrgProjectEnvService({
    database: env.CONSOLE_DB,
    namespace: localTenantStorageNamespace(env),
    ensureSchema: false,
  });
  return resolveRuntimeTenantRootLineage(
    createWalletProjectEnvironmentResolver(environments),
    roots,
    scope,
  );
}

async function resolveLocalTenantRootActiveLineage(
  resolver: D1TenantRootActiveLineageResolverV1,
  identity: LocalTenantRootIdentity,
) {
  const decoded = decodeTenantRootIdentityWireV1({
    orgId: identity.orgId,
    projectId: identity.projectId,
    envId: identity.envId,
    signingRootId: identity.signingRootId,
    signingRootVersion: identity.signingRootVersion,
  });
  if (!decoded.ok) throw new Error('Local tenant-root identity is not canonical');
  return resolver.resolveActiveLineage(decoded.value);
}

type LocalTenantRootIdentity = Parameters<
  CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage']['resolveActiveLineage']
>[0];

type LocalTenantRootContext = {
  readonly env: LocalD1DevEnv;
  readonly orgId: string;
  readonly tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'];
};
type LocalTenantRootResolutionInput = Parameters<RouterAbEd25519YaoTenantRootResolverV1>[0];
type LocalLinkedDeviceTenantRootInput = Parameters<
  Parameters<
    typeof createCloudflareLinkedDeviceEd25519SourcePreservingRouterEndpointV1
  >[0]['resolveTenantRoot']
>[0];

type LocalActiveTenantRootResolver = (
  input: Parameters<
    ReturnType<
      typeof createLocalD1RouterApiAuthService
    >['walletRegistration']['resolveActiveEd25519TenantRoot']
  >[0],
) => Promise<Awaited<ReturnType<RouterAbEd25519YaoTenantRootResolverV1>>>;

type LocalRouterApiService = ReturnType<typeof createLocalD1RouterApiAuthService>;
type LocalRouterApiServiceState = { service: LocalRouterApiService | null };
type LocalActiveTenantRootInput = Parameters<LocalActiveTenantRootResolver>[0];
type LocalTenantRootResolutionResult = Awaited<ReturnType<RouterAbEd25519YaoTenantRootResolverV1>>;
type LocalRecoveryAuthorizationServices = Awaited<
  ReturnType<
    ConstructorParameters<typeof RouterAbEd25519YaoRecoveryWalletSessionAuthorizationAdapter>[0]
  >
>;

function requireLocalRouterApiService(state: LocalRouterApiServiceState): LocalRouterApiService {
  if (!state.service) throw new Error('Local Router API service is not initialized');
  return state.service;
}

async function resolveLocalActiveTenantRoot(
  state: LocalRouterApiServiceState,
  input: LocalActiveTenantRootInput,
): Promise<LocalTenantRootResolutionResult> {
  const service = requireLocalRouterApiService(state);
  const resolved = await service.walletRegistration.resolveActiveEd25519TenantRoot(input);
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved;
}

async function resolveLocalRecoveryAuthorizationServices(
  state: LocalRouterApiServiceState,
): Promise<LocalRecoveryAuthorizationServices> {
  const service = requireLocalRouterApiService(state);
  return {
    authorizationSessions: service.authorizationSessions,
    preparedRecoveryAdmission: service.passkeyCustody,
    resolveEd25519MaterialActivation:
      service.walletRegistration.resolveEd25519MaterialActivation.bind(service.walletRegistration),
  };
}

function readLocalLinkedAuthorities(
  state: LocalRouterApiServiceState,
): WarmBootstrapLinkedEd25519AuthorityReaderV1 | null {
  return state.service?.linkedDeviceEd25519AuthorityReader ?? null;
}

function localTenantRootIdentity(
  env: LocalD1DevEnv,
  orgId: string,
  applicationBinding: { readonly signing_root_id: string },
  signingRootVersion: string,
): LocalTenantRootIdentity {
  const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId,
    projectId: localConsoleProjectId(env),
    envId: localConsoleEnvironmentId(env),
    signingRootId: applicationBinding.signing_root_id,
    signingRootVersion,
  });
  if (!identity.ok) {
    throw new Error('Local tenant-root identity is not canonical');
  }
  return identity.value;
}

async function resolveLocalDeploymentTenantRoot(
  env: LocalD1DevEnv,
  orgId: string,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
  applicationBinding: { readonly signing_root_id: string },
  signingRootVersion: string,
): Promise<Awaited<ReturnType<RouterAbEd25519YaoTenantRootResolverV1>>> {
  const tenantRoot = await tenantRootCustodyLineage.resolveActiveLineage(
    localTenantRootIdentity(env, orgId, applicationBinding, signingRootVersion),
  );
  if (!tenantRoot) throw new Error('Ed25519 tenant root is not active');
  return tenantRoot;
}

async function resolveLocalRegistrationTenantRoot(
  context: LocalTenantRootContext,
  input: LocalTenantRootResolutionInput,
): Promise<LocalTenantRootResolutionResult> {
  switch (input.operation) {
    case 'registration':
      return await resolveLocalDeploymentTenantRoot(
        context.env,
        context.orgId,
        context.tenantRootCustodyLineage,
        input.admissionRequest.application_binding,
        input.admissionRequest.scope.root_share_epoch,
      );
    case 'recovery':
    case 'export':
      throw new Error('Ed25519 active-material tenant-root resolver is unavailable');
  }
}

async function resolveLocalTenantRoot(
  context: LocalTenantRootContext & {
    readonly resolveActiveTenantRoot: LocalActiveTenantRootResolver;
  },
  input: LocalTenantRootResolutionInput,
): Promise<LocalTenantRootResolutionResult> {
  switch (input.operation) {
    case 'registration':
      return await resolveLocalDeploymentTenantRoot(
        context.env,
        context.orgId,
        context.tenantRootCustodyLineage,
        input.admissionRequest.application_binding,
        input.admissionRequest.scope.root_share_epoch,
      );
    case 'recovery':
      return await context.resolveActiveTenantRoot({
        walletId: input.admissionRequest.application_binding.wallet_id,
        materialActivation: input.admissionRequest.active_material_activation,
      });
    case 'export':
      return await context.resolveActiveTenantRoot({
        walletId: input.admissionRequest.application_binding.wallet_id,
        materialActivation: input.admissionRequest.scope.material_activation,
      });
  }
}

async function resolveLocalLinkedDeviceTenantRoot(
  context: LocalTenantRootContext,
  input: LocalLinkedDeviceTenantRootInput,
): Promise<LocalTenantRootResolutionResult> {
  return await resolveLocalDeploymentTenantRoot(
    context.env,
    context.orgId,
    context.tenantRootCustodyLineage,
    input.applicationBinding,
    input.targetAdmission.binding.lifecycle.root_share_epoch,
  );
}

function createLocalRegistrationTenantRootResolver(
  env: LocalD1DevEnv,
  orgId: string,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
): RouterAbEd25519YaoTenantRootResolverV1 {
  return resolveLocalRegistrationTenantRoot.bind(undefined, {
    env,
    orgId,
    tenantRootCustodyLineage,
  });
}

function createLocalTenantRootResolver(
  env: LocalD1DevEnv,
  orgId: string,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
  resolveActiveTenantRoot: LocalActiveTenantRootResolver,
): RouterAbEd25519YaoTenantRootResolverV1 {
  return resolveLocalTenantRoot.bind(undefined, {
    env,
    orgId,
    tenantRootCustodyLineage,
    resolveActiveTenantRoot,
  });
}

function createLocalLinkedDeviceTenantRootResolver(
  env: LocalD1DevEnv,
  orgId: string,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
): Parameters<
  typeof createCloudflareLinkedDeviceEd25519SourcePreservingRouterEndpointV1
>[0]['resolveTenantRoot'] {
  return resolveLocalLinkedDeviceTenantRoot.bind(undefined, {
    env,
    orgId,
    tenantRootCustodyLineage,
  });
}

function localLinkedDeviceSessionComposition(
  env: LocalD1DevEnv,
  orgId: string,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
): NonNullable<CloudflareD1RouterApiAuthServiceOptions['linkedDevice']> {
  const scope = {
    namespace: localTenantStorageNamespace(env),
    orgId,
    projectId: localConsoleProjectId(env),
    envId: localConsoleEnvironmentId(env),
  };
  const walletStore = new D1WalletStore({
    database: env.SIGNER_DB,
    ...scope,
    ensureSchema: false,
  });
  const walletAuthMethodStore = new D1WalletAuthMethodStore({
    database: env.SIGNER_DB,
    ...scope,
    ensureSchema: false,
  });
  const sourceChildReader = createD1LinkedDeviceOwnerSourceChildReaderV1({
    walletAuthMethodStore,
    walletStore,
  });
  const serviceFetch = createRouterAbServiceBindingFetch(env);
  const internalServiceAuthSecret = localRouterAbInternalServiceAuthSecret(env);
  const deriverAInputPublicKeyB64u = localDeriverInputPublicKeyB64u(env, 'a');
  const deriverBInputPublicKeyB64u = localDeriverInputPublicKeyB64u(env, 'b');
  const signingWorkerRecipientPublicKeyB64u = localSigningWorkerRecipientPublicKeyB64u(env);
  return {
    session: {
      readOwnerSourceChildV1: sourceChildReader.readOwnerSourceChildV1,
      targetPasskeyRpId: requireLocalEnvString(
        env.LINKED_DEVICE_WEBAUTHN_RP_ID,
        'LINKED_DEVICE_WEBAUTHN_RP_ID',
      ),
      targetCredential: ({
        verifiedLinkBuilder,
        targetCredentialVerification,
        targetPlanner,
        resolveOwnerSourceChildV1,
        emailOtpGrants,
      }) =>
        new D1LinkedDeviceTargetCredentialProviderV1({
          database: env.SIGNER_DB,
          scope,
          verifier: targetCredentialVerification,
          ...(emailOtpGrants === undefined ? {} : { emailOtpGrants }),
          planner: targetPlanner,
          sourceContributionPreparationPlanner:
            createD1LinkedDeviceSourceContributionPreparationPlannerV1({
              resolveOwnerSourceChildV1,
              deriverAInputPublicKeyB64u,
              deriverBInputPublicKeyB64u,
              signingWorkerRecipientPublicKeyB64u,
            }),
          verifiedLinkBuilder,
        }),
      authorityInstallation: {
        reservationEndpoint: createCloudflareOrdinaryInactiveSignerMaterialReservationEndpointV1({
          fetch: serviceFetch,
          internalServiceAuthSecret,
        }),
        activationEndpoint: createCloudflareOrdinaryInactiveSignerMaterialActivationEndpointV1({
          fetch: serviceFetch,
          internalServiceAuthSecret,
        }),
        deactivationEndpoint: createCloudflareOrdinaryInactiveSignerMaterialDeactivationEndpointV1({
          fetch: serviceFetch,
          internalServiceAuthSecret,
        }),
      },
      sourceContributionRouter: createCloudflareLinkedDeviceEd25519SourcePreservingRouterEndpointV1(
        {
          fetch: serviceFetch,
          internalServiceAuthSecret,
          resolveTenantRoot: createLocalLinkedDeviceTenantRootResolver(
            env,
            orgId,
            tenantRootCustodyLineage,
          ),
        },
      ),
    },
  };
}

type LocalEd25519YaoProductCompositionState =
  | { readonly kind: 'disabled'; readonly runtime?: never }
  | {
      readonly kind: 'enabled';
      readonly runtime: RouterAbEd25519YaoProductRegistrationRuntimeV1;
      readonly requestScoped: LocalEd25519YaoRequestScopedBaseDependencies;
    };

type LocalEd25519YaoRequestScopedBaseDependencies = {
  readonly store: ReturnType<
    typeof createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1
  >;
  readonly backend: ReturnType<typeof createRouterAbEd25519YaoHttpRegistrationBackendFromEnv>;
  readonly recoveryAuthorization: RouterAbEd25519YaoRecoveryWalletSessionAuthorizationAdapter;
  readonly capabilityPersistence: CloudflareD1RouterAbEd25519YaoCapabilityPersistence;
  readonly capabilities: RouterAbEd25519YaoProductRegistrationRuntimeV1;
  readonly linkedAuthorities: () => WarmBootstrapLinkedEd25519AuthorityReaderV1 | null;
};

type LocalEd25519YaoRequestScopedDependencies = LocalEd25519YaoRequestScopedBaseDependencies & {
  readonly exportAuthorization: RouterAbEd25519YaoExportOwnerProofAuthorizationAdapter;
};

async function createLocalEd25519YaoProductComposition(
  env: LocalD1DevEnv,
  routerFetch: LocalEd25519YaoRouterFetchV1,
  orgId: string,
  resolveAuthorizationServices: ConstructorParameters<
    typeof RouterAbEd25519YaoRecoveryWalletSessionAuthorizationAdapter
  >[0],
  resolveActiveTenantRoot: LocalActiveTenantRootResolver,
  resolveLinkedAuthorities: () => WarmBootstrapLinkedEd25519AuthorityReaderV1 | null,
): Promise<LocalEd25519YaoProductCompositionState> {
  const signingWorkerId =
    normalizeLocalString(env.SIGNING_WORKER_ID) ||
    normalizeLocalString(env.ROUTER_AB_NORMAL_SIGNING_WORKER_ID);
  const capabilityScope = {
    namespace: localTenantStorageNamespace(env),
    orgId,
    projectId: localConsoleProjectId(env),
    envId: localConsoleEnvironmentId(env),
  };
  const walletStore = new D1WalletStore({
    database: env.SIGNER_DB,
    ...capabilityScope,
    ensureSchema: false,
  });
  const store = createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1({
    database: env.SIGNER_DB,
    scope: capabilityScope,
  });
  const tenantRootCustodyLineage = localTenantRootCustodyLineageResolver(env);
  const backend = createRouterAbEd25519YaoHttpRegistrationBackendFromEnv({
    env: {
      MPC_ROUTER_URL: ROUTER_AB_MPC_ROUTER_ORIGIN,
      SIGNING_WORKER_ID: signingWorkerId,
      ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET: localRouterAbInternalServiceAuthSecret(env),
      DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY: normalizeLocalString(
        env.DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY,
      ),
      DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY: normalizeLocalString(
        env.DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY,
      ),
      SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY: normalizeLocalString(
        env.SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY,
      ),
    },
    resolveTenantRoot: createLocalTenantRootResolver(
      env,
      orgId,
      tenantRootCustodyLineage,
      resolveActiveTenantRoot,
    ),
    fetch: localEd25519YaoRouterFetchV1(env, routerFetch),
  });
  const runtime = createRouterAbEd25519YaoProductRegistrationRequestScopedRuntimeV1({
    signingWorkerId,
    store,
    registrationBackend: backend,
    loadPersistedActiveCapability: async (lookup) => {
      const walletId = parseWalletId(lookup.walletId);
      if (!walletId.ok) return null;
      const signer = await walletStore.getEd25519SignerBySlot({
        walletId: walletId.value,
        signerSlot: lookup.signerSlot,
      });
      return signer?.activeYaoCapability || null;
    },
  });
  return {
    kind: 'enabled',
    runtime,
    requestScoped: {
      store,
      backend,
      recoveryAuthorization: new RouterAbEd25519YaoRecoveryWalletSessionAuthorizationAdapter(
        resolveAuthorizationServices,
      ),
      capabilityPersistence: new CloudflareD1RouterAbEd25519YaoCapabilityPersistence({
        database: env.SIGNER_DB,
        scope: capabilityScope,
        walletStore,
        ensureSchema: false,
      }),
      capabilities: runtime,
      linkedAuthorities: resolveLinkedAuthorities,
    },
  };
}

function createLocalD1RouterApiAuthService(
  env: LocalD1DevEnv,
  orgId: string,
  ed25519Yao: LocalEd25519YaoProductCompositionState = { kind: 'disabled' },
) {
  return createCloudflareD1RouterApiAuthService({
    ...localD1RouterApiAuthServiceOptions(env, orgId, ed25519Yao),
    signerWasmModuleOrPath: loadCloudflareSignerWasmModule,
  });
}

function localRouterApiHandler(
  env: LocalD1DevEnv,
  routerFetch: LocalEd25519YaoRouterFetchV1,
): Promise<FetchHandler> {
  return createLocalRouterApiHandler(env, routerFetch);
}

function routerApiRequest(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  const stripped = pathname.startsWith('/relay')
    ? pathname === '/relay'
      ? '/'
      : pathname.slice('/relay'.length)
    : pathname;
  url.pathname = stripped || '/';
  return new Request(url.toString(), request);
}

function requireLocalEnvString(value: unknown, field: string): string {
  const normalized = normalizeLocalString(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function allLocalStringsEmpty(values: readonly unknown[]): boolean {
  for (const value of values) {
    if (normalizeLocalString(value)) return false;
  }
  return true;
}

function localRouterAbPublicKeyset(env: LocalD1DevEnv): RouterAbPublicKeysetV2 | undefined {
  const fields = [
    env.DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH,
    env.DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY,
    env.DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH,
    env.DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY,
    env.DERIVER_A_PEER_VERIFYING_KEY_HEX,
    env.DERIVER_B_PEER_VERIFYING_KEY_HEX,
    env.SIGNING_WORKER_SERVER_OUTPUT_HPKE_KEY_EPOCH,
    env.SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY,
  ];
  if (allLocalStringsEmpty(fields)) {
    return undefined;
  }
  return parseRouterAbPublicKeysetV2({
    keyset_version: ROUTER_AB_PUBLIC_KEYSET_VERSION_V2,
    signer_envelope_hpke: {
      current: {
        deriver_a: {
          role: 'signer_a',
          key_epoch: requireLocalEnvString(
            env.DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH,
            'DERIVER_A_ENVELOPE_HPKE_KEY_EPOCH',
          ),
          public_key: requireLocalEnvString(
            env.DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY,
            'DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY',
          ),
        },
        deriver_b: {
          role: 'signer_b',
          key_epoch: requireLocalEnvString(
            env.DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH,
            'DERIVER_B_ENVELOPE_HPKE_KEY_EPOCH',
          ),
          public_key: requireLocalEnvString(
            env.DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY,
            'DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY',
          ),
        },
      },
    },
    signer_peer_verifying_keys: {
      deriver_a: {
        role: 'signer_a',
        verifying_key_hex: requireLocalEnvString(
          env.DERIVER_A_PEER_VERIFYING_KEY_HEX,
          'DERIVER_A_PEER_VERIFYING_KEY_HEX',
        ),
      },
      deriver_b: {
        role: 'signer_b',
        verifying_key_hex: requireLocalEnvString(
          env.DERIVER_B_PEER_VERIFYING_KEY_HEX,
          'DERIVER_B_PEER_VERIFYING_KEY_HEX',
        ),
      },
    },
    signing_worker_server_output_hpke: {
      key_epoch: requireLocalEnvString(
        env.SIGNING_WORKER_SERVER_OUTPUT_HPKE_KEY_EPOCH,
        'SIGNING_WORKER_SERVER_OUTPUT_HPKE_KEY_EPOCH',
      ),
      public_key: requireLocalEnvString(
        env.SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY,
        'SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY',
      ),
    },
  });
}

function localSigningWorkerRecipientPublicKeyB64u(env: LocalD1DevEnv): string {
  const publicKey =
    normalizeLocalString(env.SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY) ||
    localRouterAbPublicKeyset(env)?.signing_worker_server_output_hpke.public_key;
  if (!publicKey) {
    throw new Error(
      'SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY is required for linked-device sessions',
    );
  }
  return localX25519PublicKeyB64u(publicKey, 'SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY');
}

function localDeriverInputPublicKeyB64u(env: LocalD1DevEnv, role: 'a' | 'b'): string {
  const configuredPublicKey = normalizeLocalString(
    role === 'a'
      ? env.DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY
      : env.DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY,
  );
  const keyset = configuredPublicKey ? undefined : localRouterAbPublicKeyset(env);
  const publicKey =
    configuredPublicKey ||
    keyset?.signer_envelope_hpke.current[role === 'a' ? 'deriver_a' : 'deriver_b'].public_key;
  if (!publicKey) {
    throw new Error(
      `${role === 'a' ? 'DERIVER_A' : 'DERIVER_B'}_ED25519_YAO_INPUT_PUBLIC_KEY is required for linked-device sessions`,
    );
  }
  return localX25519PublicKeyB64u(
    publicKey,
    `${role === 'a' ? 'DERIVER_A' : 'DERIVER_B'}_ED25519_YAO_INPUT_PUBLIC_KEY`,
  );
}

function localX25519PublicKeyB64u(value: string, label: string): string {
  if (!/^x25519:[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must use x25519:<64 lowercase hex chars> encoding`);
  }
  const hex = value.slice('x25519:'.length);
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return base64UrlEncode(bytes);
}

async function assertD1Tables(input: {
  readonly database: D1DatabaseLike;
  readonly label: 'CONSOLE_DB' | 'SIGNER_DB';
  readonly tables: readonly string[];
}): Promise<number> {
  const row = await input.database
    .prepare(
      `SELECT COUNT(*) AS table_count
         FROM sqlite_master
        WHERE type = 'table'
          AND name IN (${d1StringList(input.tables)})`,
    )
    .first<TableCountRow>();
  const count = parseReadyTableCount(row);
  if (count !== input.tables.length) {
    throw new Error(
      `local ${input.label} migration has created ${count} of ${input.tables.length} required tables`,
    );
  }
  return count;
}

function d1StringList(values: readonly string[]): string {
  return values.map(d1StringLiteral).join(', ');
}

function d1StringLiteral(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) {
    throw new Error(`invalid D1 table name ${value}`);
  }
  return `'${value}'`;
}

async function assertLocalD1Schemas(env: LocalD1DevEnv): Promise<ReadyD1SchemaResult> {
  const consoleTables = await assertD1Tables({
    database: env.CONSOLE_DB,
    label: 'CONSOLE_DB',
    tables: CONSOLE_READY_TABLES,
  });
  const signerTables = await assertD1Tables({
    database: env.SIGNER_DB,
    label: 'SIGNER_DB',
    tables: SIGNER_READY_TABLES,
  });
  return { consoleTables, signerTables };
}

async function handleReady(env: LocalD1DevEnv): Promise<Response> {
  const schemas = await assertLocalD1Schemas(env);
  return jsonResponse({
    ok: true,
    backend: 'cloudflare_d1_do',
    namespace: localTenantStorageNamespace(env),
    schemas,
    bindings: {
      console: 'CONSOLE_DB',
      signer: 'SIGNER_DB',
    },
  });
}

async function fetch(
  request: Request,
  env: LocalD1DevEnv,
  ctx: CfExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/healthz') return jsonResponse({ ok: true });
  if (url.pathname === '/readyz') return await handleReady(env);
  if (request.method === 'GET' && url.pathname === LOCAL_ROUTER_AB_CEREMONY_JWKS_PATH) {
    return localRouterAbCeremonyJwksResponse(env);
  }
  if (isConsolePath(url.pathname)) {
    const handler = await localConsoleHandler(env);
    return await handler(request, env, ctx);
  }
  if (isRouterApiPath(url.pathname)) {
    return await handleLocalRouterApiRequestV1(request, env, ctx, url.pathname);
  }
  return jsonResponse(
    {
      ok: true,
      service: 'seams-sdk-d1-local',
      endpoints: [
        '/healthz',
        '/readyz',
        '/console/healthz',
        '/console/readyz',
        '/console/*',
        '/relay/healthz',
        '/relay/readyz',
        '/auth/google/options',
        '/sponsorships/evm/call',
        '/wallet-session/seal/apply-server-seal',
        '/wallet-session/seal/remove-server-seal',
      ],
    },
    { status: 200 },
  );
}

async function handleLocalRouterApiRequestV1(
  request: Request,
  env: LocalD1DevEnv,
  ctx: CfExecutionContext,
  pathname: string,
): Promise<Response> {
  const rawFaultMode = request.headers.get(LOCAL_INTENDED_YAO_FAULT_HEADER_V1);
  const rawFaultToken = request.headers.get(LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1);
  const sanitizedRequest = requestWithoutLocalIntendedYaoFaultHeadersV1(request);
  if (rawFaultMode === null && rawFaultToken === null) {
    const handler = await localRouterApiHandler(env, { kind: 'direct' });
    return await handler(routerApiRequest(sanitizedRequest, pathname), env, ctx);
  }

  const faultMode = parseLocalIntendedYaoFaultModeV1(rawFaultMode);
  const faultToken = parseLocalIntendedYaoFaultTokenV1(rawFaultToken);
  if (
    pathname !== ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 ||
    !faultMode ||
    !faultToken
  ) {
    return jsonResponse(
      {
        ok: false,
        code: 'invalid_intended_yao_fault',
        message: 'Local intended Yao fault control is invalid',
      },
      { status: 400 },
    );
  }

  const controller = new LocalIntendedYaoFaultControllerV1(createRouterAbServiceBindingFetch(env));
  controller.arm(faultMode);
  try {
    const handler = await localRouterApiHandler(env, {
      kind: 'fault_injected',
      controller,
    });
    const response = await handler(routerApiRequest(sanitizedRequest, pathname), env, ctx);
    return responseWithLocalIntendedYaoFaultOutcomeV1(
      response,
      controller.consumeOutcome(),
      faultToken,
    );
  } catch (error) {
    controller.reset();
    throw error;
  }
}

async function runLocalTenantRootRefreshResumptionV1(
  env: LocalD1DevEnv,
  input: { readonly scheduledTimeMs: number | undefined },
): Promise<void> {
  const namespace = localTenantStorageNamespace(env);
  const bundle = await createCloudflareD1ConsoleOnlyServiceBundle({
    bindings: { consoleDatabase: env.CONSOLE_DB },
    route: { namespace },
    adapters: { ensureSchema: false },
  });
  const resumption = createD1TenantRootOperationResumptionStoreV1({
    database: env.CONSOLE_DB,
    namespace,
  });
  const pending = await resumption.listPending(1);
  const nowMs = input.scheduledTimeMs ?? Date.now();
  const pendingOperation = pending[0];
  if (pendingOperation) {
    const operation = pendingOperation;
    const audit = createConsoleTenantRootAuditWriterV1({
      audit: bundle.audit,
      actorType: operation.entry.triggerKind === 'scheduled' ? 'SYSTEM' : 'USER',
    });
    const operations = createD1TenantRootOperationStoreV1({
      database: env.CONSOLE_DB,
      namespace,
      orgId: operation.orgId,
      identityDigestB64u: operation.identityDigestB64u,
      custodyLineageB64u: operation.custodyLineageB64u,
    });
    await dispatchTenantRootRefreshOperationV1({
      dependencies: {
        router: env.MPC_ROUTER,
        internalServiceAuthSecret: localRouterAbInternalServiceAuthSecret(env),
        audit,
        operations,
      },
      entry: operation.entry,
      orgId: operation.orgId,
      identityDigestB64u: operation.identityDigestB64u,
      custodyLineageB64u: operation.custodyLineageB64u,
      stepUpMethod: null,
      nowMs,
    });
    return;
  }

  const scheduledIntent = await createTenantRootScheduledRotationIntentV1(
    {
      grants: createD1TenantRootScheduledActiveGrantReaderV1({
        database: env.CONSOLE_DB,
        namespace,
      }),
      state: createTenantRootSecurityStateReaderV1({
        activeRoots: new D1TenantRootActiveLineageResolverV1(
          env.CONSOLE_DB,
          localTenantStorageNamespace(env),
        ),
        router: env.MPC_ROUTER,
        internalServiceAuthSecret: localRouterAbInternalServiceAuthSecret(env),
      }),
      pending: resumption,
      operations: (scope) =>
        createD1TenantRootOperationStoreV1({
          database: env.CONSOLE_DB,
          namespace,
          ...scope,
        }),
    },
    { nowMs },
  );
  if (scheduledIntent.kind === 'created' || scheduledIntent.kind === 'retry') {
    const operation = scheduledIntent.operation;
    const operations = createD1TenantRootOperationStoreV1({
      database: env.CONSOLE_DB,
      namespace,
      orgId: operation.orgId,
      identityDigestB64u: operation.identityDigestB64u,
      custodyLineageB64u: operation.custodyLineageB64u,
    });
    await dispatchTenantRootRefreshOperationV1({
      dependencies: {
        router: env.MPC_ROUTER,
        internalServiceAuthSecret: localRouterAbInternalServiceAuthSecret(env),
        audit: createConsoleTenantRootAuditWriterV1({
          audit: bundle.audit,
          actorType: 'SYSTEM',
        }),
        operations,
      },
      entry: operation.entry,
      orgId: operation.orgId,
      identityDigestB64u: operation.identityDigestB64u,
      custodyLineageB64u: operation.custodyLineageB64u,
      stepUpMethod: null,
      nowMs,
    });
  }
}

async function scheduled(
  event: CfScheduledEvent,
  env: LocalD1DevEnv,
  _ctx: CfExecutionContext,
): Promise<void> {
  const runner: TenantRootRefreshResumptionRunner = runLocalTenantRootRefreshResumptionV1.bind(
    undefined,
    env,
  );
  await createCloudflareCron({
    tenantRootRefreshResumption: { runner },
  })(event);
}

export default { fetch, scheduled };
