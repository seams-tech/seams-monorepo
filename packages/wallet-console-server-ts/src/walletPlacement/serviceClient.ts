import {
  parseLinkedDeviceSessionRecordV1,
  type LinkedDeviceBootstrapStore,
  type LinkedDeviceBootstrapResult,
  type LinkedDeviceSessionRecordV1,
} from '@seams/wallet-server/cloud-host';
import type { LinkedDeviceRequestProofNonceStoreV1 } from '@seams/wallet-server/cloud-host';
import type { SyncChallengeFailure } from '@seams/wallet-server/cloud-host';
import {
  parseWebAuthnSyncChallengeRecord,
  type WebAuthnSyncChallengeStore,
} from '@seams/wallet-server/cloud-host';
import type { PasskeyCredentialClaims } from '@seams/wallet-server/cloud-host';
import type { EmailOtpRateLimitCounter } from '@seams/wallet-server/cloud-host';
import type { RegistrationOfferCommand } from './registrationOfferService';
import type { IdentityCommand } from './identityService';
import type { IdentityStore } from '@seams/wallet-server/cloud-host';
import type { WalletLifecycleRoutingPublisher } from '@seams/wallet-server/cloud-host';
import type {
  WalletRecoveryRoutingPublication,
  WalletRecoveryRoutingPublisher,
} from '@seams/wallet-server/cloud-host';
import { WalletRouteLocator } from './walletRouteLocators';
import type {
  WalletSessionLocatorPublication,
  WalletSessionRoutingPublisher,
} from '@seams/wallet-server/cloud-host';
import { SessionLocator } from './sessionLocators';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import {
  RegistrationSetupAllocation,
  WalletHome,
  WalletHomeCatalog,
  WalletOwnershipKey,
  WalletPlacementError,
  parseWalletOwnershipGeneration,
  type WalletHomeAssignment,
  type WalletHomeReservation,
  type WalletRegion,
} from './home';
import { WALLET_HOME_SERVICE_BASE_PATH, WALLET_HOME_SERVICE_ORIGIN } from './service';

type WalletHomeServiceBinding = {
  fetch(request: Request): Promise<Response>;
};

type WalletHomeScope = {
  readonly namespace: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly environmentId: string;
};

type CompletionInput = {
  readonly wallet: WalletOwnershipKey;
  readonly home: WalletHome;
  readonly registrationId: string;
  readonly requestDigest: string;
  readonly outcome: 'established' | 'cancelled';
};

export type WalletHomeServiceReservationInput = {
  readonly ingressRegion: WalletRegion;
  readonly registrationId: string;
  readonly requestDigest: string;
  readonly proposedRegistrationAllocation: RegistrationSetupAllocation;
} & (
  | {
      readonly allocation: 'provided';
      readonly wallet: WalletOwnershipKey;
      readonly candidate?: never;
    }
  | {
      readonly allocation: 'server_allocated';
      readonly candidate: WalletOwnershipKey;
      readonly wallet?: never;
    }
);

function record(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new WalletPlacementError('invalid_record', 'Wallet home service response is invalid');
  }
  return raw as Record<string, unknown>;
}

function requiredString(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.trim() !== raw) {
    throw new WalletPlacementError('invalid_record', 'Wallet home service identity is invalid');
  }
  return raw;
}

function timestamp(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    throw new WalletPlacementError('invalid_record', 'Wallet home service timestamp is invalid');
  }
  return raw;
}

function parseAssignmentIdentities(value: Record<string, unknown>): {
  readonly wallet: WalletOwnershipKey;
  readonly home: WalletHome;
  readonly registrationAllocation: RegistrationSetupAllocation;
} {
  try {
    return {
      wallet: WalletOwnershipKey.parse(value.wallet),
      home: WalletHome.parse(value.home),
      registrationAllocation: RegistrationSetupAllocation.parse(value.registrationAllocation),
    };
  } catch {
    throw new WalletPlacementError('invalid_record', 'Wallet home service identity is invalid');
  }
}

function requireScope(wallet: WalletOwnershipKey, scope: WalletHomeScope): void {
  if (
    wallet.namespace !== scope.namespace ||
    wallet.organizationId !== scope.organizationId ||
    wallet.projectId !== scope.projectId ||
    wallet.environmentId !== scope.environmentId
  ) {
    throw new WalletPlacementError('scope_conflict', 'Wallet belongs to another tenant scope');
  }
}

export function assignmentFromResponse(
  raw: unknown,
  scope: WalletHomeScope,
  catalog: WalletHomeCatalog,
): WalletHomeAssignment {
  const value = record(raw);
  const { wallet, home, registrationAllocation } = parseAssignmentIdentities(value);
  try {
    requireScope(wallet, scope);
  } catch {
    throw new WalletPlacementError('invalid_record', 'Wallet home service returned another tenant');
  }
  if (!catalog.admits(home)) {
    throw new WalletPlacementError(
      'invalid_record',
      'Wallet home service returned another resource',
    );
  }
  const registrationId = requiredString(value.registrationId);
  const requestDigest = value.requestDigest;
  if (typeof requestDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(requestDigest)) {
    throw new WalletPlacementError('invalid_record', 'Wallet home service digest is invalid');
  }
  if (value.allocation !== 'provided' && value.allocation !== 'server_allocated') {
    throw new WalletPlacementError('invalid_record', 'Wallet home service allocation is invalid');
  }
  const allocation: WalletHomeAssignment['allocation'] = value.allocation;
  const reservedAtMs = timestamp(value.reservedAtMs);
  const ownershipGeneration = parseWalletOwnershipGeneration(value.ownershipGeneration);
  switch (value.state) {
    case 'reserved':
      if ('completedAtMs' in value) break;
      return {
        state: 'reserved',
        wallet,
        home,
        ownershipGeneration,
        registrationId,
        requestDigest,
        allocation,
        registrationAllocation,
        reservedAtMs,
      };
    case 'established':
    case 'cancelled': {
      const completedAtMs = timestamp(value.completedAtMs);
      if (completedAtMs < reservedAtMs) break;
      return {
        state: value.state,
        wallet,
        home,
        ownershipGeneration,
        registrationId,
        requestDigest,
        allocation,
        registrationAllocation,
        reservedAtMs,
        completedAtMs,
      };
    }
  }
  throw new WalletPlacementError('invalid_record', 'Wallet home service lifecycle is invalid');
}

function reservationFromResponse(
  raw: unknown,
  scope: WalletHomeScope,
  catalog: WalletHomeCatalog,
): WalletHomeReservation {
  const value = record(raw);
  if (value.ok === true) {
    if (value.disposition !== 'reserved' && value.disposition !== 'reused') {
      throw new WalletPlacementError('invalid_record', 'Wallet reservation disposition is invalid');
    }
    return {
      ok: true,
      disposition: value.disposition,
      assignment: assignmentFromResponse(value.assignment, scope, catalog),
    };
  }
  if (value.ok === false) {
    if (value.code === 'ceremony_conflict') {
      return { ok: false, code: value.code };
    }
    if (
      value.code === 'wallet_conflict' ||
      value.code === 'registration_conflict' ||
      value.code === 'request_conflict' ||
      value.code === 'registration_cancelled'
    ) {
      return {
        ok: false,
        code: value.code,
        assignment: assignmentFromResponse(value.assignment, scope, catalog),
      };
    }
  }
  throw new WalletPlacementError('invalid_record', 'Wallet reservation response is invalid');
}

export class WalletHomeServiceClient
  implements
    WalletSessionRoutingPublisher,
    WalletRecoveryRoutingPublisher,
    WalletLifecycleRoutingPublisher,
    IdentityStore
{
  constructor(
    private readonly service: WalletHomeServiceBinding,
    private readonly writer: TenantRuntimeWriterV1,
    private readonly scope: WalletHomeScope,
    private readonly catalog: WalletHomeCatalog,
  ) {}

  private async post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const response = await this.service.fetch(
      new Request(`${WALLET_HOME_SERVICE_ORIGIN}${WALLET_HOME_SERVICE_BASE_PATH}/${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-seams-writer-role': this.writer.role,
          'x-seams-writer-version': this.writer.versionId,
          'x-seams-writer-account': this.writer.resource.accountId,
          'x-seams-writer-database': this.writer.resource.databaseId,
        },
        body: JSON.stringify(body),
      }),
    );
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new WalletPlacementError('invalid_record', 'Wallet home service response is not JSON');
    }
    return { status: response.status, body: responseBody };
  }

  linkedDeviceBootstrap(): LinkedDeviceBootstrapStore {
    return {
      read: this.readDeviceBootstrap.bind(this),
      create: this.writeDeviceBootstrap.bind(this, 'create'),
      claim: this.writeDeviceBootstrap.bind(this, 'claim'),
      finish: this.writeDeviceBootstrap.bind(this, 'finish'),
    };
  }
  private readDeviceBootstrap(linkSessionId: Parameters<LinkedDeviceBootstrapStore['read']>[0]) {
    return this.deviceBootstrapCommand({ operation: 'read', linkSessionId });
  }
  private writeDeviceBootstrap(
    operation: 'create' | 'claim' | 'finish',
    record: LinkedDeviceSessionRecordV1,
  ) {
    return this.deviceBootstrapCommand({ operation, linkSessionId: record.linkSessionId, record });
  }
  private async deviceBootstrapCommand(
    input:
      | { operation: 'read'; linkSessionId: string }
      | {
          operation: 'create' | 'claim' | 'finish';
          linkSessionId: string;
          record: LinkedDeviceSessionRecordV1;
        },
  ): Promise<LinkedDeviceBootstrapResult> {
    try {
      const response = await this.post('device-bootstrap', input);
      if (response.status === 409) return { ok: false, code: 'home_conflict' };
      const body = response.body;
      if (
        response.status !== 200 ||
        !body ||
        typeof body !== 'object' ||
        !('ok' in body) ||
        body.ok !== true ||
        !('record' in body)
      )
        return { ok: false, code: 'home_unavailable' };
      if (body.record === null) return { ok: true, record: null };
      const record = parseLinkedDeviceSessionRecordV1(body.record);
      if (record.linkSessionId !== input.linkSessionId)
        return { ok: false, code: 'home_unavailable' };
      return { ok: true, record };
    } catch {
      return { ok: false, code: 'home_unavailable' };
    }
  }

  linkedDeviceProofNonces(): LinkedDeviceRequestProofNonceStoreV1 {
    return { consumeRequestProofNonceV1: this.consumeDeviceProofNonce.bind(this) };
  }

  private async consumeDeviceProofNonce(
    input: Parameters<LinkedDeviceRequestProofNonceStoreV1['consumeRequestProofNonceV1']>[0],
  ): ReturnType<LinkedDeviceRequestProofNonceStoreV1['consumeRequestProofNonceV1']> {
    try {
      const response = await this.post('device-proof-nonce', input);
      if (response.status !== 200) return { outcome: 'unavailable' };
      const body = response.body;
      if (
        body &&
        typeof body === 'object' &&
        'outcome' in body &&
        (body.outcome === 'consumed' || body.outcome === 'already_used')
      ) {
        return { outcome: body.outcome };
      }
    } catch {
      return { outcome: 'unavailable' };
    }
    return { outcome: 'unavailable' };
  }

  syncChallenges(): WebAuthnSyncChallengeStore {
    return {
      create: this.createSyncChallenge.bind(this),
      consume: this.consumeSyncChallenge.bind(this),
    };
  }

  private async createSyncChallenge(
    input: Parameters<WebAuthnSyncChallengeStore['create']>[0],
  ): ReturnType<WebAuthnSyncChallengeStore['create']> {
    const result = await this.syncChallengeCommand({ operation: 'create', record: input });
    return result.ok ? { ok: true } : result;
  }

  private async consumeSyncChallenge(
    input: Parameters<WebAuthnSyncChallengeStore['consume']>[0],
  ): ReturnType<WebAuthnSyncChallengeStore['consume']> {
    const result = await this.syncChallengeCommand({ operation: 'consume', ...input });
    if (!result.ok) return result;
    if (result.body.record === null) return { ok: true, record: null };
    const challenge = parseWebAuthnSyncChallengeRecord(result.body.record);
    if (!challenge || challenge.challengeId !== input.challengeId)
      return {
        ok: false,
        code: 'wallet_home_unavailable',
        message: 'Invalid shared sync challenge response',
      };
    return { ok: true, record: challenge };
  }

  async findSyncHome(input: Parameters<WebAuthnSyncChallengeStore['consume']>[0]) {
    const result = await this.syncChallengeCommand({ operation: 'find', ...input });
    if (!result.ok) throw new Error(result.message);
    return result.body.assignment === null
      ? null
      : assignmentFromResponse(result.body.assignment, this.scope, this.catalog);
  }

  private async syncChallengeCommand(
    input: Record<string, unknown>,
  ): Promise<{ readonly ok: true; readonly body: Record<string, unknown> } | SyncChallengeFailure> {
    try {
      const response = await this.post('sync-challenge', input);
      const body = record(response.body);
      if (response.status === 200 && body.ok === true) return { ok: true, body };
      if (response.status === 409)
        return {
          ok: false,
          code: 'wallet_home_conflict',
          message: 'Sync challenge conflicts with shared authority',
        };
    } catch {
      // A transport or malformed-response failure cannot fall back to a local challenge.
    }
    return {
      ok: false,
      code: 'wallet_home_unavailable',
      message: 'Shared sync challenge authority is unavailable',
    };
  }

  async claim(input: Parameters<PasskeyCredentialClaims['claim']>[0]): Promise<boolean> {
    const response = await this.post('claim-passkey', {
      wallet: WalletOwnershipKey.parse({ ...this.scope, walletId: input.walletId }),
      rpId: input.rpId,
      credentialIdB64u: input.credentialIdB64u,
    });
    const body = record(response.body);
    if (response.status === 409 && body.code === 'credential_conflict') return false;
    if (response.status !== 200 || body.ok !== true)
      throw new Error(`Passkey ownership unavailable: HTTP ${response.status}`);
    return true;
  }

  rateLimitCounter(): EmailOtpRateLimitCounter {
    return { consume: this.consumeRateLimit.bind(this) };
  }

  private async consumeRateLimit(
    input: Parameters<EmailOtpRateLimitCounter['consume']>[0],
  ): ReturnType<EmailOtpRateLimitCounter['consume']> {
    const response = await this.post('rate-limit', input);
    if (response.status !== 200)
      throw new Error(`Shared rate limit unavailable: HTTP ${response.status}`);
    const body = record(response.body);
    if (body.ok === true) return { ok: true };
    if (
      body.ok !== false ||
      body.code !== 'rate_limited' ||
      typeof body.message !== 'string' ||
      typeof body.retryAfterMs !== 'number' ||
      !Number.isFinite(body.retryAfterMs) ||
      body.retryAfterMs < 0 ||
      typeof body.resetAtMs !== 'number' ||
      !Number.isSafeInteger(body.resetAtMs) ||
      body.resetAtMs <= 0
    )
      throw new Error('Invalid shared rate-limit response');
    return {
      ok: false,
      code: 'rate_limited',
      message: body.message,
      retryAfterMs: body.retryAfterMs,
      resetAtMs: body.resetAtMs,
    };
  }

  async registrationOffer(command: RegistrationOfferCommand): Promise<Record<string, unknown>> {
    const response = await this.post('registration-offer', command);
    if (response.status !== 200)
      throw new Error(`Shared registration offer request failed: HTTP ${response.status}`);
    return record(response.body);
  }

  async getUserIdBySubject(subject: string): Promise<string | null> {
    const body = await this.identityCommand({ operation: 'find', subject });
    if (body.ok !== true) throw new Error('Shared identity lookup failed');
    return body.userId === null ? null : requiredString(body.userId);
  }

  async listSubjectsByUserId(userId: string): Promise<string[]> {
    const body = await this.identityCommand({ operation: 'list', userId });
    if (body.ok !== true || !Array.isArray(body.subjects))
      throw new Error('Shared identity list failed');
    return body.subjects.map(requiredString);
  }

  async linkSubjectToUserId(input: Parameters<IdentityStore['linkSubjectToUserId']>[0]) {
    const body = await this.identityCommand({
      operation: 'link',
      userId: input.userId,
      subject: input.subject,
      allowMoveIfSoleIdentity: input.allowMoveIfSoleIdentity ?? false,
    });
    return identityMutationResult(body);
  }

  async unlinkSubjectFromUserId(input: Parameters<IdentityStore['unlinkSubjectFromUserId']>[0]) {
    return identityMutationResult(
      await this.identityCommand({
        operation: 'unlink',
        userId: input.userId,
        subject: input.subject,
      }),
    );
  }

  async deleteSubjectLinkForDevCleanup(
    input: Parameters<IdentityStore['deleteSubjectLinkForDevCleanup']>[0],
  ) {
    return identityMutationResult(
      await this.identityCommand({
        operation: 'delete',
        userId: input.userId,
        subject: input.subject,
      }),
    );
  }

  private async identityCommand(command: IdentityCommand): Promise<Record<string, unknown>> {
    const response = await this.post('identity', command);
    if (response.status !== 200)
      throw new Error(`Shared identity request failed: HTTP ${response.status}`);
    return record(response.body);
  }

  async publishRecovery(
    input: WalletRecoveryRoutingPublication,
  ): ReturnType<WalletRecoveryRoutingPublisher['publishRecovery']> {
    const locators: WalletRouteLocator[] = [];
    switch (input.kind) {
      case 'codes':
        for (const value of input.locators)
          locators.push(WalletRouteLocator.parse({ kind: 'code', value }));
        break;
      case 'operation':
        locators.push(WalletRouteLocator.parse({ kind: 'operation', value: input.operationId }));
        break;
      default:
        return assertNeverRecoveryPublication(input);
    }
    return this.publishRoutes(input.walletId, locators);
  }

  async publishLifecycle(
    input: Parameters<WalletLifecycleRoutingPublisher['publishLifecycle']>[0],
  ) {
    return this.publishRoutes(input.walletId, [WalletRouteLocator.parse(input.locator)]);
  }

  private async publishRoutes(
    walletId: Parameters<WalletLifecycleRoutingPublisher['publishLifecycle']>[0]['walletId'],
    locators: readonly WalletRouteLocator[],
  ): ReturnType<WalletLifecycleRoutingPublisher['publishLifecycle']> {
    if (locators.length === 0) return { ok: true };
    const response = await this.post('publish-routes', {
      wallet: WalletOwnershipKey.parse({ ...this.scope, walletId }),
      locators,
    });
    const body = record(response.body);
    if (response.status === 409 && body.ok === false && body.code === 'locator_conflict')
      return { ok: false, code: 'locator_conflict' };
    if (response.status !== 200 || body.ok !== true)
      throw new Error(`Wallet routing publication failed: HTTP ${response.status}`);
    return { ok: true };
  }

  async findRoute(locator: WalletRouteLocator): Promise<WalletHomeAssignment | null> {
    const response = await this.post('find-route', { locator });
    const body = record(response.body);
    if (response.status === 404 && body.ok === false && body.code === 'not_found') return null;
    if (response.status !== 200 || body.ok !== true)
      throw new Error(`Wallet route lookup failed: HTTP ${response.status}`);
    if (!WalletRouteLocator.parse(body.locator).matches(locator))
      throw new WalletPlacementError(
        'invalid_record',
        'Wallet route lookup returned another locator',
      );
    return assignmentFromResponse(body.assignment, this.scope, this.catalog);
  }

  async publish(input: WalletSessionLocatorPublication): Promise<void> {
    let response;
    if (input.kind === 'exchanged_credential') {
      response = await this.post('publish-exchanged-session', {
        digest: input.digest,
        exchangeDigest: input.exchangeDigest,
      });
    } else {
      response = await this.post('publish-session', {
        wallet: WalletOwnershipKey.parse({ ...this.scope, walletId: input.walletId }),
        locator: SessionLocator.parse({ kind: input.kind, digest: input.digest }),
        expiresAtMs: input.expiresAtMs,
      });
    }
    if (response.status !== 200 || record(response.body).ok !== true) {
      throw new Error(`Session routing publication failed: HTTP ${response.status}`);
    }
  }

  async findSession(locator: SessionLocator): Promise<WalletHomeAssignment | null> {
    const response = await this.post('find-session', { locator });
    const body = record(response.body);
    if (response.status === 404 && body.ok === false && body.code === 'not_found') return null;
    if (response.status !== 200 || body.ok !== true)
      throw new Error(`Session home lookup failed: HTTP ${response.status}`);
    const confirmed = SessionLocator.parse(body.locator);
    if (!confirmed.matches(locator)) {
      throw new WalletPlacementError(
        'invalid_record',
        'Session home lookup returned another locator',
      );
    }
    return assignmentFromResponse(body.assignment, this.scope, this.catalog);
  }

  async placementReadHome(wallet: WalletOwnershipKey): Promise<WalletHome | null> {
    requireScope(wallet, this.scope);
    const response = await this.post('placement-route', { wallet });
    if (response.status !== 200) {
      throw new WalletPlacementError('invalid_record', 'Placement routing is unavailable');
    }
    const body = record(response.body);
    if (Object.keys(body).length !== 2 || !WalletOwnershipKey.parse(body.wallet).matches(wallet)) {
      throw new WalletPlacementError('invalid_record', 'Placement route returned another wallet');
    }
    return body.home === null ? null : WalletHome.parse(body.home);
  }

  async find(wallet: WalletOwnershipKey): Promise<WalletHomeAssignment | null> {
    requireScope(wallet, this.scope);
    const response = await this.post('find', { wallet });
    if (response.status === 404) {
      const body = record(response.body);
      if (body.ok === false && body.code === 'not_found') return null;
      throw new WalletPlacementError('invalid_record', 'Wallet home lookup absence is invalid');
    }
    if (response.status !== 200)
      throw new Error(`Wallet home lookup failed: HTTP ${response.status}`);
    const body = record(response.body);
    if (body.ok !== true) {
      throw new WalletPlacementError('invalid_record', 'Wallet home lookup response is invalid');
    }
    const assignment = assignmentFromResponse(body.assignment, this.scope, this.catalog);
    if (!assignment.wallet.matches(wallet)) {
      throw new WalletPlacementError(
        'invalid_record',
        'Wallet home lookup returned another wallet',
      );
    }
    return assignment;
  }

  async findByCeremony(ceremonyId: string): Promise<WalletHomeAssignment | null> {
    const response = await this.post('find-by-ceremony', { ceremonyId });
    if (response.status === 404) {
      const body = record(response.body);
      if (body.ok === false && body.code === 'not_found') return null;
      throw new WalletPlacementError('invalid_record', 'Wallet ceremony lookup absence is invalid');
    }
    if (response.status !== 200) {
      throw new Error(`Wallet ceremony home lookup failed: HTTP ${response.status}`);
    }
    const body = record(response.body);
    if (body.ok !== true) {
      throw new WalletPlacementError(
        'invalid_record',
        'Wallet ceremony lookup response is invalid',
      );
    }
    const assignment = assignmentFromResponse(body.assignment, this.scope, this.catalog);
    if (assignment.registrationAllocation.ceremonyId !== ceremonyId) {
      throw new WalletPlacementError(
        'invalid_record',
        'Wallet ceremony lookup returned another ceremony',
      );
    }
    return assignment;
  }

  async reserve(input: WalletHomeServiceReservationInput): Promise<WalletHomeReservation> {
    this.catalog.select(input.ingressRegion);
    const wallet = input.allocation === 'provided' ? input.wallet : input.candidate;
    requireScope(wallet, this.scope);
    const response = await this.post('reserve', {
      wallet,
      allocation: input.allocation,
      ingressRegion: input.ingressRegion,
      registrationId: input.registrationId,
      requestDigest: input.requestDigest,
      registrationAllocation: input.proposedRegistrationAllocation,
    });
    if (response.status !== 200 && response.status !== 409) {
      throw new Error(`Wallet home reservation failed: HTTP ${response.status}`);
    }
    const result = reservationFromResponse(response.body, this.scope, this.catalog);
    if (result.ok !== (response.status === 200)) {
      throw new WalletPlacementError('invalid_record', 'Wallet home reservation status is invalid');
    }
    if (result.ok) {
      const assignment = result.assignment;
      if (
        assignment.registrationId !== input.registrationId ||
        assignment.requestDigest !== input.requestDigest ||
        assignment.allocation !== input.allocation ||
        (input.allocation === 'provided' && !assignment.wallet.matches(input.wallet))
      ) {
        throw new WalletPlacementError(
          'invalid_record',
          'Wallet home reservation returned another operation',
        );
      }
    }
    return result;
  }

  async complete(input: CompletionInput): Promise<WalletHomeAssignment> {
    requireScope(input.wallet, this.scope);
    if (!this.catalog.admits(input.home)) {
      throw new WalletPlacementError('invalid_input', 'Wallet home resource is not admitted');
    }
    const response = await this.post('complete', input);
    if (response.status !== 200) {
      throw new Error(`Wallet home completion failed: HTTP ${response.status}`);
    }
    const body = record(response.body);
    if (body.ok !== true) {
      throw new WalletPlacementError(
        'invalid_record',
        'Wallet home completion response is invalid',
      );
    }
    const assignment = assignmentFromResponse(body.assignment, this.scope, this.catalog);
    if (
      !assignment.wallet.matches(input.wallet) ||
      !assignment.home.matches(input.home) ||
      assignment.registrationId !== input.registrationId ||
      assignment.requestDigest !== input.requestDigest ||
      assignment.state !== input.outcome
    ) {
      throw new WalletPlacementError(
        'invalid_record',
        'Wallet home completion returned another operation',
      );
    }
    return assignment;
  }
}

function assertNeverRecoveryPublication(value: never): never {
  throw new Error(`Unexpected recovery routing publication: ${String(value)}`);
}

function identityMutationResult(
  body: Record<string, unknown>,
): Awaited<ReturnType<IdentityStore['linkSubjectToUserId']>> {
  if (body.ok === true) {
    if ('movedFromUserId' in body)
      return { ok: true, movedFromUserId: requiredString(body.movedFromUserId) };
    return { ok: true };
  }
  if (body.ok === false)
    return { ok: false, code: requiredString(body.code), message: requiredString(body.message) };
  throw new Error('Shared identity mutation response is invalid');
}
