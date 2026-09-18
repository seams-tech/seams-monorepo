export type TenantDeploymentBindingRevision = `tdb_${string}`;
export type TenantDeploymentCutoverId = `tco_${string}`;

export type TenantDeploymentModeV1 =
  | {
      readonly kind: 'development_testnet_v1';
      readonly environment: 'development';
      readonly network: 'testnet';
    }
  | {
      readonly kind: 'production_mainnet_v1';
      readonly environment: 'production';
      readonly network: 'mainnet';
    };

export type TenantDeploymentJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly TenantDeploymentJsonValue[]
  | { readonly [key: string]: TenantDeploymentJsonValue };

export type PublishableCredentialQuotaPolicyV1 = {
  readonly rateLimitBucket: string;
  readonly quotaBucket: string;
  readonly riskPolicy: Readonly<Record<string, TenantDeploymentJsonValue>>;
  readonly paymentPolicy: Readonly<Record<string, TenantDeploymentJsonValue>>;
};

type TenantDeploymentBindingCommonV1 = {
  readonly kind: 'tenant_deployment_binding_v1';
  readonly schemaVersion: 1;
  readonly deploymentLane: string;
  readonly tenantRoot: {
    readonly identityDigestB64u: string;
    readonly custodyLineageId: string;
    readonly signingRootId: string;
    readonly signingRootVersion: string;
  };
  readonly surfaces: {
    readonly applicationOrigin: string;
    readonly hostedWalletOrigin: string;
    readonly gatewayOrigin: string;
    readonly relyingPartyId: string;
  };
  readonly runtimePolicyDigestB64u: string;
  readonly createdAtMs: number;
};

type TenantDeploymentTenantV1<TEnvironmentId extends string> = {
  readonly namespace: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly environmentId: TEnvironmentId;
};

type TenantDeploymentBrowserCredentialV1<
  TCredentialId extends `ak_${string}`,
  TPublishableKey extends `pk_${string}`,
> = {
  readonly credentialId: TCredentialId;
  readonly publishableKey: TPublishableKey;
  readonly expiresAtMs: number | null;
  readonly allowedOrigins: readonly [string, ...string[]];
  readonly quotaPolicy: PublishableCredentialQuotaPolicyV1;
};

export type TenantDeploymentBindingBodyV1 = TenantDeploymentBindingCommonV1 &
  (
    | {
        readonly mode: Extract<TenantDeploymentModeV1, { readonly environment: 'development' }>;
        readonly tenant: TenantDeploymentTenantV1<`${string}:dev`>;
        readonly browserCredential: TenantDeploymentBrowserCredentialV1<
          `ak_dev_${string}`,
          `pk_dev_${string}`
        >;
      }
    | {
        readonly mode: Extract<TenantDeploymentModeV1, { readonly environment: 'production' }>;
        readonly tenant: TenantDeploymentTenantV1<`${string}:prod`>;
        readonly browserCredential: TenantDeploymentBrowserCredentialV1<
          `ak_prod_${string}`,
          `pk_prod_${string}`
        >;
      }
  );

export type TenantDeploymentBindingV1 = TenantDeploymentBindingBodyV1 & {
  readonly revision: TenantDeploymentBindingRevision;
};

export type ActiveTenantDeploymentBindingV1 = {
  readonly kind: 'active_tenant_deployment_binding_v1';
  readonly deploymentLane: string;
  readonly revision: TenantDeploymentBindingRevision;
  readonly previousRevision: TenantDeploymentBindingRevision | null;
  readonly activationSequence: number;
  readonly activatedAtMs: number;
};

export type ActiveTenantRootReferenceV1 = {
  readonly identityDigestB64u: string;
  readonly custodyLineageId: string;
  readonly signingRootId: string;
  readonly signingRootVersion: string;
};

export type TenantDeploymentReadinessReceiptV1 = {
  readonly kind: 'tenant_deployment_readiness_receipt_v1';
  readonly bindingRevision: TenantDeploymentBindingRevision;
  readonly expectedActiveRevision: TenantDeploymentBindingRevision | null;
  readonly checkedAtMs: number;
  readonly expiresAtMs: number;
  readonly evidenceDigestB64u: string;
  readonly durableWalletCount: number;
  readonly inFlightCeremonyCount: number;
};

export type TenantDeploymentActivationReceiptV1 = {
  readonly kind: 'tenant_deployment_activation_receipt_v1';
  readonly bindingRevision: TenantDeploymentBindingRevision;
  readonly previousRevision: TenantDeploymentBindingRevision | null;
  readonly activationSequence: number;
  readonly activatedAtMs: number;
};

export type TenantDeploymentCutoverPhaseV1 =
  | 'planning'
  | 'tenant_root'
  | 'browser_credential'
  | 'readiness'
  | 'activation';

export type TenantDeploymentCutoverFailureV1 = {
  readonly code: string;
  readonly message: string;
};

export type TenantDeploymentTargetIdentityV1 = {
  readonly organizationId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly signingRootId: string;
  readonly signingRootVersion: string;
};

export type TenantDeploymentCutoverV1 =
  | {
      readonly kind: 'planning';
      readonly operationId: TenantDeploymentCutoverId;
      readonly deploymentLane: string;
      readonly targetIdentity: TenantDeploymentTargetIdentityV1;
      readonly expectedActiveRevision: TenantDeploymentBindingRevision | null;
    }
  | {
      readonly kind: 'awaiting_tenant_root';
      readonly operationId: TenantDeploymentCutoverId;
      readonly deploymentLane: string;
      readonly targetIdentity: TenantDeploymentTargetIdentityV1;
      readonly expectedActiveRevision: TenantDeploymentBindingRevision | null;
    }
  | {
      readonly kind: 'awaiting_browser_credential';
      readonly operationId: TenantDeploymentCutoverId;
      readonly deploymentLane: string;
      readonly targetIdentity: TenantDeploymentTargetIdentityV1;
      readonly activeTenantRoot: ActiveTenantRootReferenceV1;
      readonly expectedActiveRevision: TenantDeploymentBindingRevision | null;
    }
  | {
      readonly kind: 'ready';
      readonly operationId: TenantDeploymentCutoverId;
      readonly deploymentLane: string;
      readonly binding: TenantDeploymentBindingV1;
      readonly readinessReceipt: TenantDeploymentReadinessReceiptV1;
      readonly expectedActiveRevision: TenantDeploymentBindingRevision | null;
    }
  | {
      readonly kind: 'active';
      readonly operationId: TenantDeploymentCutoverId;
      readonly deploymentLane: string;
      readonly binding: TenantDeploymentBindingV1;
      readonly activationReceipt: TenantDeploymentActivationReceiptV1;
    }
  | {
      readonly kind: 'failed';
      readonly operationId: TenantDeploymentCutoverId;
      readonly deploymentLane: string;
      readonly failedPhase: TenantDeploymentCutoverPhaseV1;
      readonly failure: TenantDeploymentCutoverFailureV1;
    };

export type TenantDeploymentPublicProjectionV1 = {
  readonly kind: 'tenant_deployment_public_projection_v1';
  readonly revision: TenantDeploymentBindingRevision;
  readonly mode: TenantDeploymentModeV1;
  readonly environmentId: string;
  readonly publishableKey: `pk_${string}`;
  readonly allowedOrigins: readonly [string, ...string[]];
  readonly applicationOrigin: string;
  readonly hostedWalletOrigin: string;
  readonly gatewayOrigin: string;
  readonly relyingPartyId: string;
};

export type TenantDeploymentDecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

type JsonRecord = Record<string, unknown>;

const BINDING_BODY_KEYS = Object.freeze([
  'kind',
  'schemaVersion',
  'deploymentLane',
  'mode',
  'tenant',
  'tenantRoot',
  'browserCredential',
  'surfaces',
  'runtimePolicyDigestB64u',
  'createdAtMs',
]);

const BINDING_KEYS = Object.freeze([...BINDING_BODY_KEYS, 'revision']);

function record(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return null;
  return value;
}

function safePositiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function prefixedText<TPrefix extends string>(
  value: unknown,
  prefix: TPrefix,
): `${TPrefix}${string}` | null {
  const parsed = nonEmptyText(value);
  if (!parsed || !parsed.startsWith(prefix) || parsed.length === prefix.length) return null;
  return `${prefix}${parsed.slice(prefix.length)}`;
}

function suffixedText<TSuffix extends string>(
  value: unknown,
  suffix: TSuffix,
): `${string}${TSuffix}` | null {
  const parsed = nonEmptyText(value);
  if (!parsed || !parsed.endsWith(suffix) || parsed.length === suffix.length) return null;
  return `${parsed.slice(0, -suffix.length)}${suffix}`;
}

function canonicalOrigin(value: unknown): string | null {
  const parsed = nonEmptyText(value);
  if (!parsed) return null;
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    return null;
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    return null;
  }
  return url.origin;
}

function parseMode(value: unknown): TenantDeploymentModeV1 | null {
  const input = record(value);
  if (!input || !exactKeys(input, ['kind', 'environment', 'network'])) return null;
  switch (input.kind) {
    case 'development_testnet_v1':
      return input.environment === 'development' && input.network === 'testnet'
        ? { kind: 'development_testnet_v1', environment: 'development', network: 'testnet' }
        : null;
    case 'production_mainnet_v1':
      return input.environment === 'production' && input.network === 'mainnet'
        ? { kind: 'production_mainnet_v1', environment: 'production', network: 'mainnet' }
        : null;
    default:
      return null;
  }
}

function parseJsonValue(value: unknown): TenantDeploymentJsonValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const output: TenantDeploymentJsonValue[] = [];
    for (const entry of value) {
      const parsed = parseJsonValue(entry);
      if (parsed === undefined) return undefined;
      output.push(parsed);
    }
    return output;
  }
  const input = record(value);
  if (!input) return undefined;
  const output: Record<string, TenantDeploymentJsonValue> = {};
  for (const [key, entry] of Object.entries(input)) {
    const parsed = parseJsonValue(entry);
    if (!key || parsed === undefined) return undefined;
    output[key] = parsed;
  }
  return output;
}

function parseJsonObject(
  value: unknown,
): Readonly<Record<string, TenantDeploymentJsonValue>> | null {
  const input = record(value);
  if (!input) return null;
  const output: Record<string, TenantDeploymentJsonValue> = {};
  for (const [key, entry] of Object.entries(input)) {
    const parsed = parseJsonValue(entry);
    if (!key || parsed === undefined) return null;
    output[key] = parsed;
  }
  return output;
}

function parseQuotaPolicy(value: unknown): PublishableCredentialQuotaPolicyV1 | null {
  const input = record(value);
  if (
    !input ||
    !exactKeys(input, ['rateLimitBucket', 'quotaBucket', 'riskPolicy', 'paymentPolicy'])
  ) {
    return null;
  }
  const rateLimitBucket = nonEmptyText(input.rateLimitBucket);
  const quotaBucket = nonEmptyText(input.quotaBucket);
  const riskPolicy = parseJsonObject(input.riskPolicy);
  const paymentPolicy = parseJsonObject(input.paymentPolicy);
  if (!rateLimitBucket || !quotaBucket || !riskPolicy || !paymentPolicy) return null;
  return { rateLimitBucket, quotaBucket, riskPolicy, paymentPolicy };
}

function parseOrigins(value: unknown): readonly [string, ...string[]] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const normalized: string[] = [];
  for (const entry of value) {
    const origin = canonicalOrigin(entry);
    if (!origin) return null;
    normalized.push(origin);
  }
  const canonical = [...new Set(normalized)].sort(compareCodeUnits);
  if (
    canonical.length !== value.length ||
    canonical.some((origin, index) => origin !== value[index])
  ) {
    return null;
  }
  const [first, ...rest] = canonical;
  return first ? [first, ...rest] : null;
}

function parseBindingBodyRecord(input: JsonRecord): TenantDeploymentBindingBodyV1 | null {
  if (!exactKeys(input, BINDING_BODY_KEYS)) return null;
  if (input.kind !== 'tenant_deployment_binding_v1' || input.schemaVersion !== 1) return null;
  const deploymentLane = nonEmptyText(input.deploymentLane);
  const mode = parseMode(input.mode);
  const tenant = record(input.tenant);
  const tenantRoot = record(input.tenantRoot);
  const browserCredential = record(input.browserCredential);
  const surfaces = record(input.surfaces);
  const runtimePolicyDigestB64u = nonEmptyText(input.runtimePolicyDigestB64u);
  const createdAtMs = safePositiveInteger(input.createdAtMs);
  if (
    !deploymentLane ||
    !mode ||
    !tenant ||
    !tenantRoot ||
    !browserCredential ||
    !surfaces ||
    !runtimePolicyDigestB64u ||
    !createdAtMs
  ) {
    return null;
  }
  if (!exactKeys(tenant, ['namespace', 'organizationId', 'projectId', 'environmentId']))
    return null;
  if (
    !exactKeys(tenantRoot, [
      'identityDigestB64u',
      'custodyLineageId',
      'signingRootId',
      'signingRootVersion',
    ])
  ) {
    return null;
  }
  if (
    !exactKeys(browserCredential, [
      'credentialId',
      'publishableKey',
      'expiresAtMs',
      'allowedOrigins',
      'quotaPolicy',
    ])
  ) {
    return null;
  }
  if (
    !exactKeys(surfaces, [
      'applicationOrigin',
      'hostedWalletOrigin',
      'gatewayOrigin',
      'relyingPartyId',
    ])
  ) {
    return null;
  }
  const namespace = nonEmptyText(tenant.namespace);
  const organizationId = nonEmptyText(tenant.organizationId);
  const projectId = nonEmptyText(tenant.projectId);
  const identityDigestB64u = nonEmptyText(tenantRoot.identityDigestB64u);
  const custodyLineageId = nonEmptyText(tenantRoot.custodyLineageId);
  const signingRootId = nonEmptyText(tenantRoot.signingRootId);
  const signingRootVersion = nonEmptyText(tenantRoot.signingRootVersion);
  const expiresAtMs =
    browserCredential.expiresAtMs === null
      ? null
      : (safePositiveInteger(browserCredential.expiresAtMs) ?? undefined);
  const allowedOrigins = parseOrigins(browserCredential.allowedOrigins);
  const quotaPolicy = parseQuotaPolicy(browserCredential.quotaPolicy);
  const applicationOrigin = canonicalOrigin(surfaces.applicationOrigin);
  const hostedWalletOrigin = canonicalOrigin(surfaces.hostedWalletOrigin);
  const gatewayOrigin = canonicalOrigin(surfaces.gatewayOrigin);
  const relyingPartyId = nonEmptyText(surfaces.relyingPartyId);
  if (
    !namespace ||
    !organizationId ||
    !projectId ||
    !identityDigestB64u ||
    !custodyLineageId ||
    !signingRootId ||
    !signingRootVersion ||
    expiresAtMs === undefined ||
    !allowedOrigins ||
    !quotaPolicy ||
    !applicationOrigin ||
    !hostedWalletOrigin ||
    !gatewayOrigin ||
    !relyingPartyId
  ) {
    return null;
  }
  if (!allowedOrigins.includes(applicationOrigin) || !allowedOrigins.includes(hostedWalletOrigin)) {
    return null;
  }
  if (new URL(hostedWalletOrigin).hostname !== relyingPartyId) return null;
  switch (mode.kind) {
    case 'development_testnet_v1': {
      const environmentId = suffixedText(tenant.environmentId, ':dev');
      const credentialId = prefixedText(browserCredential.credentialId, 'ak_dev_');
      const publishableKey = prefixedText(browserCredential.publishableKey, 'pk_dev_');
      if (!environmentId || !credentialId || !publishableKey) return null;
      return {
        kind: 'tenant_deployment_binding_v1',
        schemaVersion: 1,
        deploymentLane,
        mode,
        tenant: { namespace, organizationId, projectId, environmentId },
        tenantRoot: { identityDigestB64u, custodyLineageId, signingRootId, signingRootVersion },
        browserCredential: {
          credentialId,
          publishableKey,
          expiresAtMs,
          allowedOrigins,
          quotaPolicy,
        },
        surfaces: { applicationOrigin, hostedWalletOrigin, gatewayOrigin, relyingPartyId },
        runtimePolicyDigestB64u,
        createdAtMs,
      };
    }
    case 'production_mainnet_v1': {
      const environmentId = suffixedText(tenant.environmentId, ':prod');
      const credentialId = prefixedText(browserCredential.credentialId, 'ak_prod_');
      const publishableKey = prefixedText(browserCredential.publishableKey, 'pk_prod_');
      if (!environmentId || !credentialId || !publishableKey) return null;
      return {
        kind: 'tenant_deployment_binding_v1',
        schemaVersion: 1,
        deploymentLane,
        mode,
        tenant: { namespace, organizationId, projectId, environmentId },
        tenantRoot: { identityDigestB64u, custodyLineageId, signingRootId, signingRootVersion },
        browserCredential: {
          credentialId,
          publishableKey,
          expiresAtMs,
          allowedOrigins,
          quotaPolicy,
        },
        surfaces: { applicationOrigin, hostedWalletOrigin, gatewayOrigin, relyingPartyId },
        runtimePolicyDigestB64u,
        createdAtMs,
      };
    }
  }
}

export function decodeTenantDeploymentBindingBodyV1(
  value: unknown,
): TenantDeploymentDecodeResult<TenantDeploymentBindingBodyV1> {
  const input = record(value);
  const parsed = input ? parseBindingBodyRecord(input) : null;
  return parsed
    ? { ok: true, value: parsed }
    : { ok: false, message: 'tenant deployment binding body is invalid' };
}

export function encodeTenantDeploymentJsonValueV1(value: TenantDeploymentJsonValue): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(encodeTenantDeploymentJsonValueV1).join(',')}]`;
  const entries = Object.entries(value).sort(([left], [right]) => compareCodeUnits(left, right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${encodeTenantDeploymentJsonValueV1(entry)}`).join(',')}}`;
}

function bindingBodyJsonValue(body: TenantDeploymentBindingBodyV1): TenantDeploymentJsonValue {
  return {
    kind: body.kind,
    schemaVersion: body.schemaVersion,
    deploymentLane: body.deploymentLane,
    mode: body.mode,
    tenant: body.tenant,
    tenantRoot: body.tenantRoot,
    browserCredential: body.browserCredential,
    surfaces: body.surfaces,
    runtimePolicyDigestB64u: body.runtimePolicyDigestB64u,
    createdAtMs: body.createdAtMs,
  };
}

export function encodeTenantDeploymentBindingBodyV1(body: TenantDeploymentBindingBodyV1): string {
  return encodeTenantDeploymentJsonValueV1(bindingBodyJsonValue(body));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export async function tenantDeploymentBindingRevisionV1(
  body: TenantDeploymentBindingBodyV1,
): Promise<TenantDeploymentBindingRevision> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto subtle API is required for tenant deployment bindings');
  const digest = await subtle.digest(
    'SHA-256',
    new TextEncoder().encode(encodeTenantDeploymentBindingBodyV1(body)),
  );
  return `tdb_${base64Url(new Uint8Array(digest))}`;
}

export async function buildTenantDeploymentBindingV1(
  value: unknown,
): Promise<TenantDeploymentDecodeResult<TenantDeploymentBindingV1>> {
  const decoded = decodeTenantDeploymentBindingBodyV1(value);
  if (!decoded.ok) return decoded;
  return {
    ok: true,
    value: { ...decoded.value, revision: await tenantDeploymentBindingRevisionV1(decoded.value) },
  };
}

export async function decodeTenantDeploymentBindingV1(
  value: unknown,
): Promise<TenantDeploymentDecodeResult<TenantDeploymentBindingV1>> {
  const input = record(value);
  if (!input || !exactKeys(input, BINDING_KEYS)) {
    return { ok: false, message: 'tenant deployment binding is invalid' };
  }
  const revision = prefixedText(input.revision, 'tdb_');
  const bodyInput: JsonRecord = {};
  for (const key of BINDING_BODY_KEYS) bodyInput[key] = input[key];
  const decoded = decodeTenantDeploymentBindingBodyV1(bodyInput);
  if (!revision || !decoded.ok) {
    return { ok: false, message: 'tenant deployment binding is invalid' };
  }
  const expected = await tenantDeploymentBindingRevisionV1(decoded.value);
  if (revision !== expected) {
    return { ok: false, message: 'tenant deployment binding revision does not match its body' };
  }
  return { ok: true, value: { ...decoded.value, revision } };
}

function parseRevision(value: unknown): TenantDeploymentBindingRevision | null {
  return prefixedText(value, 'tdb_');
}

function parseNullableRevision(value: unknown): TenantDeploymentBindingRevision | null | undefined {
  return value === null ? null : (parseRevision(value) ?? undefined);
}

function parseCutoverIdentity(input: JsonRecord): TenantDeploymentTargetIdentityV1 | null {
  if (
    !exactKeys(input, [
      'organizationId',
      'projectId',
      'environmentId',
      'signingRootId',
      'signingRootVersion',
    ])
  )
    return null;
  const organizationId = nonEmptyText(input.organizationId);
  const projectId = nonEmptyText(input.projectId);
  const environmentId = nonEmptyText(input.environmentId);
  const signingRootId = nonEmptyText(input.signingRootId);
  const signingRootVersion = nonEmptyText(input.signingRootVersion);
  return organizationId && projectId && environmentId && signingRootId && signingRootVersion
    ? { organizationId, projectId, environmentId, signingRootId, signingRootVersion }
    : null;
}

function parseRootReference(input: JsonRecord): ActiveTenantRootReferenceV1 | null {
  if (
    !exactKeys(input, [
      'identityDigestB64u',
      'custodyLineageId',
      'signingRootId',
      'signingRootVersion',
    ])
  )
    return null;
  const identityDigestB64u = nonEmptyText(input.identityDigestB64u);
  const custodyLineageId = nonEmptyText(input.custodyLineageId);
  const signingRootId = nonEmptyText(input.signingRootId);
  const signingRootVersion = nonEmptyText(input.signingRootVersion);
  return identityDigestB64u && custodyLineageId && signingRootId && signingRootVersion
    ? { identityDigestB64u, custodyLineageId, signingRootId, signingRootVersion }
    : null;
}

function parseReadinessReceipt(input: JsonRecord): TenantDeploymentReadinessReceiptV1 | null {
  if (
    !exactKeys(input, [
      'kind',
      'bindingRevision',
      'expectedActiveRevision',
      'checkedAtMs',
      'expiresAtMs',
      'evidenceDigestB64u',
      'durableWalletCount',
      'inFlightCeremonyCount',
    ])
  )
    return null;
  const bindingRevision = parseRevision(input.bindingRevision);
  const expectedActiveRevision = parseNullableRevision(input.expectedActiveRevision);
  const checkedAtMs = safePositiveInteger(input.checkedAtMs);
  const expiresAtMs = safePositiveInteger(input.expiresAtMs);
  const evidenceDigestB64u = nonEmptyText(input.evidenceDigestB64u);
  const durableWalletCount =
    Number.isSafeInteger(input.durableWalletCount) && Number(input.durableWalletCount) >= 0
      ? Number(input.durableWalletCount)
      : null;
  const inFlightCeremonyCount =
    Number.isSafeInteger(input.inFlightCeremonyCount) && Number(input.inFlightCeremonyCount) >= 0
      ? Number(input.inFlightCeremonyCount)
      : null;
  return input.kind === 'tenant_deployment_readiness_receipt_v1' &&
    bindingRevision &&
    expectedActiveRevision !== undefined &&
    checkedAtMs &&
    expiresAtMs &&
    expiresAtMs > checkedAtMs &&
    evidenceDigestB64u &&
    durableWalletCount !== null &&
    inFlightCeremonyCount !== null
    ? {
        kind: 'tenant_deployment_readiness_receipt_v1',
        bindingRevision,
        expectedActiveRevision,
        checkedAtMs,
        expiresAtMs,
        evidenceDigestB64u,
        durableWalletCount,
        inFlightCeremonyCount,
      }
    : null;
}

function parseActivationReceipt(input: JsonRecord): TenantDeploymentActivationReceiptV1 | null {
  if (
    !exactKeys(input, [
      'kind',
      'bindingRevision',
      'previousRevision',
      'activationSequence',
      'activatedAtMs',
    ])
  )
    return null;
  const bindingRevision = parseRevision(input.bindingRevision);
  const previousRevision = parseNullableRevision(input.previousRevision);
  const activationSequence = safePositiveInteger(input.activationSequence);
  const activatedAtMs = safePositiveInteger(input.activatedAtMs);
  return input.kind === 'tenant_deployment_activation_receipt_v1' &&
    bindingRevision &&
    previousRevision !== undefined &&
    activationSequence &&
    activatedAtMs
    ? {
        kind: 'tenant_deployment_activation_receipt_v1',
        bindingRevision,
        previousRevision,
        activationSequence,
        activatedAtMs,
      }
    : null;
}

function parseCutoverPhase(value: unknown): TenantDeploymentCutoverPhaseV1 | null {
  switch (value) {
    case 'planning':
    case 'tenant_root':
    case 'browser_credential':
    case 'readiness':
    case 'activation':
      return value;
    default:
      return null;
  }
}

export async function decodeTenantDeploymentCutoverV1(
  value: unknown,
): Promise<TenantDeploymentDecodeResult<TenantDeploymentCutoverV1>> {
  const input = record(value);
  const operationId = input ? prefixedText(input.operationId, 'tco_') : null;
  const deploymentLane = input ? nonEmptyText(input.deploymentLane) : null;
  if (!input || !operationId || !deploymentLane)
    return { ok: false, message: 'tenant deployment cutover is invalid' };
  const invalid = (): TenantDeploymentDecodeResult<TenantDeploymentCutoverV1> => ({
    ok: false,
    message: 'tenant deployment cutover is invalid',
  });
  switch (input.kind) {
    case 'planning': {
      if (
        !exactKeys(input, [
          'kind',
          'operationId',
          'deploymentLane',
          'targetIdentity',
          'expectedActiveRevision',
        ])
      )
        return invalid();
      const targetIdentityInput = record(input.targetIdentity);
      const targetIdentity = targetIdentityInput ? parseCutoverIdentity(targetIdentityInput) : null;
      const expectedActiveRevision = parseNullableRevision(input.expectedActiveRevision);
      return targetIdentity && expectedActiveRevision !== undefined
        ? {
            ok: true,
            value: {
              kind: 'planning',
              operationId,
              deploymentLane,
              targetIdentity,
              expectedActiveRevision,
            },
          }
        : invalid();
    }
    case 'awaiting_tenant_root': {
      if (
        !exactKeys(input, [
          'kind',
          'operationId',
          'deploymentLane',
          'targetIdentity',
          'expectedActiveRevision',
        ])
      )
        return invalid();
      const targetIdentityInput = record(input.targetIdentity);
      const targetIdentity = targetIdentityInput ? parseCutoverIdentity(targetIdentityInput) : null;
      const expectedActiveRevision = parseNullableRevision(input.expectedActiveRevision);
      return targetIdentity && expectedActiveRevision !== undefined
        ? {
            ok: true,
            value: {
              kind: 'awaiting_tenant_root',
              operationId,
              deploymentLane,
              targetIdentity,
              expectedActiveRevision,
            },
          }
        : invalid();
    }
    case 'awaiting_browser_credential': {
      if (
        !exactKeys(input, [
          'kind',
          'operationId',
          'deploymentLane',
          'targetIdentity',
          'activeTenantRoot',
          'expectedActiveRevision',
        ])
      )
        return invalid();
      const targetIdentityInput = record(input.targetIdentity);
      const targetIdentity = targetIdentityInput ? parseCutoverIdentity(targetIdentityInput) : null;
      const rootInput = record(input.activeTenantRoot);
      const activeTenantRoot = rootInput ? parseRootReference(rootInput) : null;
      const expectedActiveRevision = parseNullableRevision(input.expectedActiveRevision);
      return targetIdentity && activeTenantRoot && expectedActiveRevision !== undefined
        ? {
            ok: true,
            value: {
              kind: 'awaiting_browser_credential',
              operationId,
              deploymentLane,
              targetIdentity,
              activeTenantRoot,
              expectedActiveRevision,
            },
          }
        : invalid();
    }
    case 'ready': {
      if (
        !exactKeys(input, [
          'kind',
          'operationId',
          'deploymentLane',
          'binding',
          'readinessReceipt',
          'expectedActiveRevision',
        ])
      )
        return invalid();
      const binding = await decodeTenantDeploymentBindingV1(input.binding);
      const receiptInput = record(input.readinessReceipt);
      const readinessReceipt = receiptInput ? parseReadinessReceipt(receiptInput) : null;
      const expectedActiveRevision = parseNullableRevision(input.expectedActiveRevision);
      return binding.ok &&
        readinessReceipt &&
        readinessReceipt.bindingRevision === binding.value.revision &&
        readinessReceipt.expectedActiveRevision === expectedActiveRevision &&
        binding.value.deploymentLane === deploymentLane &&
        expectedActiveRevision !== undefined
        ? {
            ok: true,
            value: {
              kind: 'ready',
              operationId,
              deploymentLane,
              binding: binding.value,
              readinessReceipt,
              expectedActiveRevision,
            },
          }
        : invalid();
    }
    case 'active': {
      if (
        !exactKeys(input, ['kind', 'operationId', 'deploymentLane', 'binding', 'activationReceipt'])
      )
        return invalid();
      const binding = await decodeTenantDeploymentBindingV1(input.binding);
      const receiptInput = record(input.activationReceipt);
      const activationReceipt = receiptInput ? parseActivationReceipt(receiptInput) : null;
      return binding.ok &&
        activationReceipt &&
        activationReceipt.bindingRevision === binding.value.revision &&
        binding.value.deploymentLane === deploymentLane
        ? {
            ok: true,
            value: {
              kind: 'active',
              operationId,
              deploymentLane,
              binding: binding.value,
              activationReceipt,
            },
          }
        : invalid();
    }
    case 'failed': {
      if (!exactKeys(input, ['kind', 'operationId', 'deploymentLane', 'failedPhase', 'failure']))
        return invalid();
      const failure = record(input.failure);
      const code =
        failure && exactKeys(failure, ['code', 'message']) ? nonEmptyText(failure.code) : null;
      const message = failure ? nonEmptyText(failure.message) : null;
      const failedPhase = parseCutoverPhase(input.failedPhase);
      return failedPhase && code && message
        ? {
            ok: true,
            value: {
              kind: 'failed',
              operationId,
              deploymentLane,
              failedPhase,
              failure: { code, message },
            },
          }
        : invalid();
    }
    default:
      return invalid();
  }
}

export function tenantDeploymentPublicProjectionV1(
  binding: TenantDeploymentBindingV1,
): TenantDeploymentPublicProjectionV1 {
  return {
    kind: 'tenant_deployment_public_projection_v1',
    revision: binding.revision,
    mode: binding.mode,
    environmentId: binding.tenant.environmentId,
    publishableKey: binding.browserCredential.publishableKey,
    allowedOrigins: binding.browserCredential.allowedOrigins,
    applicationOrigin: binding.surfaces.applicationOrigin,
    hostedWalletOrigin: binding.surfaces.hostedWalletOrigin,
    gatewayOrigin: binding.surfaces.gatewayOrigin,
    relyingPartyId: binding.surfaces.relyingPartyId,
  };
}

export function decodeTenantDeploymentPublicProjectionV1(
  value: unknown,
): TenantDeploymentDecodeResult<TenantDeploymentPublicProjectionV1> {
  const input = record(value);
  if (
    !input ||
    !exactKeys(input, [
      'kind',
      'revision',
      'mode',
      'environmentId',
      'publishableKey',
      'allowedOrigins',
      'applicationOrigin',
      'hostedWalletOrigin',
      'gatewayOrigin',
      'relyingPartyId',
    ])
  )
    return { ok: false, message: 'tenant deployment public projection is invalid' };
  const revision = parseRevision(input.revision);
  const mode = parseMode(input.mode);
  const environmentId = nonEmptyText(input.environmentId);
  const publishableKey = prefixedText(input.publishableKey, 'pk_');
  const allowedOrigins = parseOrigins(input.allowedOrigins);
  const applicationOrigin = canonicalOrigin(input.applicationOrigin);
  const hostedWalletOrigin = canonicalOrigin(input.hostedWalletOrigin);
  const gatewayOrigin = canonicalOrigin(input.gatewayOrigin);
  const relyingPartyId = nonEmptyText(input.relyingPartyId);
  if (
    !revision ||
    !mode ||
    !environmentId ||
    !publishableKey ||
    !allowedOrigins ||
    !applicationOrigin ||
    !hostedWalletOrigin ||
    !gatewayOrigin ||
    !relyingPartyId ||
    !allowedOrigins.includes(applicationOrigin) ||
    !allowedOrigins.includes(hostedWalletOrigin) ||
    new URL(hostedWalletOrigin).hostname !== relyingPartyId ||
    (mode.kind === 'development_testnet_v1' &&
      (!environmentId.endsWith(':dev') || !publishableKey.startsWith('pk_dev_'))) ||
    (mode.kind === 'production_mainnet_v1' &&
      (!environmentId.endsWith(':prod') || !publishableKey.startsWith('pk_prod_')))
  ) {
    return { ok: false, message: 'tenant deployment public projection is invalid' };
  }
  return {
    ok: true,
    value: {
      kind: 'tenant_deployment_public_projection_v1',
      revision,
      mode,
      environmentId,
      publishableKey,
      allowedOrigins,
      applicationOrigin,
      hostedWalletOrigin,
      gatewayOrigin,
      relyingPartyId,
    },
  };
}
