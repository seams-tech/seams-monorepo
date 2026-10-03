import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import {
  RegistrationSetupAllocation,
  WalletHome,
  WalletHomeCatalog,
  WalletOwnershipKey,
  WalletPlacementError,
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

function assignmentFromResponse(
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
  const common = {
    wallet,
    home,
    registrationId,
    requestDigest,
    allocation,
    registrationAllocation,
    reservedAtMs,
  };
  switch (value.state) {
    case 'reserved':
      if ('completedAtMs' in value) break;
      return { ...common, state: 'reserved' };
    case 'established':
    case 'cancelled': {
      const completedAtMs = timestamp(value.completedAtMs);
      if (completedAtMs < reservedAtMs) break;
      return { ...common, state: value.state, completedAtMs };
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

export class WalletHomeServiceClient {
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
