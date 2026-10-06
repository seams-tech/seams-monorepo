import type { WalletRelocationBindings } from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocationParticipants';
import { WalletRelocationRequest } from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import { parseTenantRuntimeWriterV1, type TenantRuntimeWriterV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import { relocationWriterVersion } from './walletRelocationResources';
import { isPlainObject } from '@seams/wallet-server/cloud-host';
import { WalletRegionalDispatch } from '../../../packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
import { WalletRelocationPreparation } from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocationPreparation';

type Participants = Parameters<typeof WalletRelocationPreparation.prepare>[1];
type Command = Parameters<Participants['gateway']['prepare']>[0];

// This fixture exercises admission composition; public storage E2Es own the role stores.
class RuntimePreparationBinding {
  constructor(private readonly writer: TenantRuntimeWriterV1, private readonly failedParticipant: unknown) {}

  async fetch(input: Request): Promise<Response> {
    if (this.failedParticipant === 'walletRuntime') return new Response(null, { status: 409 });
    const request = WalletRelocationRequest.parse(await input.json());
    return Response.json({ kind: 'runtime_prepared', requestDigest: await request.digest(), writer: {
      role: this.writer.role,
      resource: this.writer.resource,
      versionId: this.failedParticipant === 'runtime_version_conflict' ? 'wrong-version' : this.writer.versionId,
    } });
  }
}

class PreparationRuntime {
  constructor(
    private readonly failedParticipant: unknown,
  ) {}

  async fetch(input: Request): Promise<Response> {
    if (this.failedParticipant === 'router') return new Response(null, { status: 503 });
    if (input.url !== 'https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/router-transfer' || input.method !== 'POST')
      return new Response(null, { status: 404 });
    const raw = await input.json();
    if (!isPlainObject(raw) || !isPlainObject(raw.request))
      return new Response(null, { status: 400 });
    const digest = await fixtureObjectDigest('seams/router/wallet-do/v2', [
      raw.request.owner, raw.request.destination_generation,
    ]);
    return Response.json({
      kind: 'prepared',
      request: raw.request,
      chunk_bytes: this.failedParticipant === 'router_conflicting_chunk' ? 2048 : 4096,
      destination_object: `router-wallet-${this.failedParticipant === 'router_object_conflict' ? '0'.repeat(64) : digest}`,
    });
  }
}

class SigningPreparationRuntime {
  constructor(private readonly failedParticipant: unknown) {}

  async fetch(input: Request): Promise<Response> {
    const body: unknown = await input.json();
    if (!isPlainObject(body) || input.method !== 'POST') return new Response(null, { status: 400 });
    let scope = body.scope;
    if (isPlainObject(body.source)) scope = body.source.scope;
    const digest = await fixtureObjectDigest('seams/signing-worker/wallet-do/v1', scope);
    const destinationObject = `signing-worker-wallet-${
      this.failedParticipant === 'signing_worker_wrong_wallet' ? '0'.repeat(64) : digest
    }`;
    if (input.url.endsWith('/ed25519-snapshot')) {
      return Response.json({ state: 'prepared', source: body.source, destination_object: destinationObject });
    }
    if (input.url.endsWith('/ecdsa-transfer')) {
      if (this.failedParticipant === 'signingWorker') return new Response(null, { status: 503 });
      return Response.json({
        kind: 'prepared', scope: body.scope, request: body.request, chunk_bytes: body.chunk_bytes,
        destination_object: this.failedParticipant === 'signing_worker_object_conflict'
          ? `signing-worker-wallet-${'b'.repeat(64)}` : destinationObject,
      });
    }
    return new Response(null, { status: 404 });
  }
}

class DeriverPreparationRuntime {
  constructor(
    private readonly side: 'source' | 'destination',
    private readonly failedParticipant: unknown,
  ) {}

  async fetch(input: Request): Promise<Response> {
    const body: unknown = await input.json();
    if (!isPlainObject(body) || input.method !== 'POST') return new Response(null, { status: 400 });
    if (input.url.endsWith('-context')) {
      if (this.side !== 'source') return new Response(null, { status: 409 });
      if (this.failedParticipant === 'deriver_context_unavailable') return new Response(null, { status: 503 });
      return Response.json({ kind: 'deriver_cipher_context', digest_hex: 'c'.repeat(64) });
    }
    if (this.side !== 'destination') return new Response(null, { status: 409 });
    let role = 'deriver-a';
    if (input.url.endsWith('/deriver-b-prepare')) role = 'deriver-b';
    else if (!input.url.endsWith('/deriver-a-prepare')) return new Response(null, { status: 404 });
    if ((role === 'deriver-a' && this.failedParticipant === 'deriverA') ||
        (role === 'deriver-b' && this.failedParticipant === 'deriverB')) {
      return new Response(null, { status: 409 });
    }
    if (body.cipher_context_digest_hex !== 'c'.repeat(64)) return new Response(null, { status: 409 });
    const encoded = new TextEncoder().encode(`seams/${role}/wallet-do/v1${JSON.stringify(body.owner)}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
    let hex = '';
    for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
    if (this.failedParticipant === 'deriver_context_conflict') body.cipher_context_digest_hex = 'd'.repeat(64);
    return Response.json({
      kind: 'prepared',
      request: body,
      destination_object: `${role}-wallet-${this.failedParticipant === 'deriver_object_conflict' ? '0'.repeat(64) : hex}`,
    });
  }
}

class PresignPreparationRuntime {
  constructor(
    private readonly side: 'source' | 'destination',
    private readonly failedParticipant: unknown,
  ) {}

  async fetch(input: Request): Promise<Response> {
    const body: unknown = await input.json();
    if (!isPlainObject(body) || input.method !== 'POST') return new Response(null, { status: 400 });
    if (input.url.endsWith('/presign-preparation-inventory') && this.side === 'source') {
      if (!isPlainObject(body.cursor)) return new Response(null, { status: 400 });
      if (this.failedParticipant === 'presign_inventory_unavailable') return new Response(null, { status: 503 });
      if (body.cursor.kind === 'start' || this.failedParticipant === 'presign_inventory_cycle') {
        return Response.json({ state: 'more', next_presign_session_id: 'session-a', sessions: [{
          presign_session_id: 'session-a', server_presignature_id: 'server-a', request_digest_hex: 'a'.repeat(64),
        }] });
      }
      return Response.json({ state: 'complete', sessions: [{
        presign_session_id: 'session-b', server_presignature_id: 'server-b', request_digest_hex: 'b'.repeat(64),
      }] });
    }
    if (input.url.endsWith('/presign-transfer') && this.side === 'destination') {
      if (!isPlainObject(body.command)) return new Response(null, { status: 400 });
      if (body.command.presign_session_id === 'session-b' && this.failedParticipant === 'presignSessions') {
        return new Response(null, { status: 409 });
      }
      if (this.failedParticipant === 'presign_receipt_conflict') body.command.server_presignature_id = 'wrong-server';
      return Response.json({ kind: 'prepared', command: body.command, chunk_bytes: body.chunk_bytes });
    }
    return new Response(null, { status: 404 });
  }
}

class GatewayPreparationBinding {
  constructor(private readonly failedParticipant: unknown) {}

  async fetch(input: Request): Promise<Response> {
    if (input.url.endsWith('/schema')) {
      return Response.json({ kind: 'authorization_schema', schemaDigestHex: 'a'.repeat(64) });
    }
    if (this.failedParticipant === 'gateway') return new Response(null, { status: 503 });
    const body: unknown = await input.json();
    if (!isPlainObject(body)) return new Response(null, { status: 400 });
    return Response.json({
      kind: 'authorization_reserved', source: body.source,
      schemaDigestHex: this.failedParticipant === 'gateway_schema_conflict' ? 'b'.repeat(64) : body.schemaDigestHex,
    });
  }
}

class RegionalPreparationRuntime {
  constructor(
    private readonly side: 'source' | 'destination',
    private readonly writer: TenantRuntimeWriterV1,
    private readonly failedParticipant: unknown,
  ) {}

  async fetch(input: Request): Promise<Response> {
    const path = new URL(input.url).pathname;
    if (path.endsWith('/prepare'))
      return new RuntimePreparationBinding(this.writer, this.failedParticipant).fetch(input);
    if (path.endsWith('/router-transfer')) return new PreparationRuntime(this.failedParticipant).fetch(input);
    if (path.includes('/deriver-')) return new DeriverPreparationRuntime(this.side, this.failedParticipant).fetch(input);
    if (path.includes('/presign-')) return new PresignPreparationRuntime(this.side, this.failedParticipant).fetch(input);
    return new SigningPreparationRuntime(this.failedParticipant).fetch(input);
  }
}

class PreparationGateway {
  constructor(
    private readonly approval: RelocationFixtureApprovalGateway,
    private readonly preparation: GatewayPreparationBinding,
  ) {}

  fetch(input: Request): Promise<Response> {
    if (input.url.endsWith('/owner-approval')) return this.approval.fetch(input);
    return this.preparation.fetch(input);
  }
}

export function relocationFixtureBindings(
  request: Command['request'],
  nowMs: number,
  failedParticipant: unknown,
  approvalMode: unknown,
): WalletRelocationBindings {
  const writer = parseTenantRuntimeWriterV1('walletRuntime',
    relocationWriterVersion(request.destination.databaseId, 'walletRuntime'),
    { accountId: request.destination.accountId, databaseId: request.destination.databaseId },
  );
  const gateway = new PreparationGateway(
    new RelocationFixtureApprovalGateway(nowMs, approvalMode, request),
    new GatewayPreparationBinding(failedParticipant),
  );
  const sourceRuntime = new RegionalPreparationRuntime('source', writer, failedParticipant);
  const destinationRuntime = new RegionalPreparationRuntime('destination', writer, failedParticipant);
  const runtimes = { US: sourceRuntime, WEUR: sourceRuntime, APAC: sourceRuntime, OC: sourceRuntime };
  runtimes[request.destination.region] = destinationRuntime;
  return {
    gateways: new WalletRegionalDispatch({
      WALLET_GATEWAY_US: gateway, WALLET_GATEWAY_WEUR: gateway,
      WALLET_GATEWAY_APAC: gateway, WALLET_GATEWAY_OC: gateway,
    }),
    runtimes,
  };
}

export function relocationFixtureClock(nowMs: number): number {
  return nowMs;
}

// The source proof is synthetic here; public Wallet E2Es own factor verification.
class RelocationFixtureApprovalGateway {
  private reads = 0;

  constructor(
    private readonly nowMs: number,
    private readonly mode: unknown,
    private readonly request: Command['request'],
  ) {}

  async fetch(input: Request): Promise<Response> {
    const body = await input.json();
    const expected = {
      walletId: this.request.wallet.walletId,
      moveId: this.request.moveId,
      requestDigest: await this.request.digest(),
      authorityId: this.request.authorityId,
      sourceGeneration: this.request.expectedGeneration,
    };
    if (
      input.url !== 'https://wallet-relocation.internal/internal/wallet-relocation/v1/authorization/owner-approval' ||
      input.method !== 'POST' ||
      JSON.stringify(body) !== JSON.stringify(expected)
    ) return new Response(null, { status: 400 });
    this.reads += 1;
    if (this.mode === 'denied' || (this.mode === 'revoked_during_preparation' && this.reads > 1)) {
      return Response.json({ kind: 'denied' });
    }
    return Response.json({
      kind: 'approved',
      requestDigest: expected.requestDigest,
      authorityId: expected.authorityId,
      sourceGeneration: expected.sourceGeneration,
      approvedAtMs: this.nowMs,
      expiresAtMs: this.mode === 'expired' ? this.nowMs : this.nowMs + 300_000,
    });
  }
}

async function fixtureObjectDigest(domain: string, identity: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(`${domain}${JSON.stringify(identity)}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export async function deriverSnapshotFixture(request: WalletRelocationRequest, role: 'deriverA' | 'deriverB', digest: string) {
  const owner = { org_id: request.wallet.organizationId, project_id: request.wallet.projectId,
    env_id: request.wallet.environmentId, wallet_id: request.wallet.walletId };
  const rolePath = role === 'deriverA' ? 'deriver-a' : 'deriver-b';
  return {
    source: { owner, move_id: request.moveId, request_digest_hex: await request.digest(),
      cipher_context_digest_hex: 'c'.repeat(64), source_generation: request.expectedGeneration,
      destination_generation: request.expectedGeneration + 1 },
    source_object: `${rolePath}-wallet-${await fixtureObjectDigest(`seams/${rolePath}/wallet-do/v1`, owner)}`,
    record_count: 1, segment_count: 2, digest_hex: digest,
  };
}

export function ed25519SnapshotFixture(request: WalletRelocationRequest, invalidatedAtMs: number, digest: string) {
  return {
    source: {
      scope: { org_id: request.wallet.organizationId, project_id: request.wallet.projectId,
        project_environment_id: request.wallet.environmentId, wallet_id: request.wallet.walletId },
      request: { move_id: request.moveId, source_generation: request.expectedGeneration, invalidated_at_ms: invalidatedAtMs },
    },
    record_count: 1, segment_count: 2, digest_hex: digest,
  };
}

export function ecdsaSnapshotFixture(request: WalletRelocationRequest, invalidatedAtMs: number, digest: string) {
  const source = ed25519SnapshotFixture(request, invalidatedAtMs, digest).source;
  return { scope: source.scope, request: source.request, record_count: 3, wallet_records_digest_hex: digest };
}

export function presignSnapshotFixture(request: WalletRelocationRequest, invalidatedAtMs: number, digest: string) {
  const source = ed25519SnapshotFixture(request, invalidatedAtMs, digest).source;
  return { command: { wallet_scope: source.scope,
    presign_session_id: 'linked-session', server_presignature_id: 'linked-server-presignature', request: source.request },
    record_count: 2, records_digest_hex: digest };
}

export async function routerSnapshotFixture(request: WalletRelocationRequest, digest: string) {
  return {
    request: {
      owner: { org_id: request.wallet.organizationId, project_id: request.wallet.projectId,
        env_id: request.wallet.environmentId, wallet_id: request.wallet.walletId },
      move_id: request.moveId, request_digest_hex: await request.digest(),
      source_generation: request.expectedGeneration, destination_generation: request.expectedGeneration + 1,
    },
    record_count: 1, records_digest_hex: digest,
  };
}
