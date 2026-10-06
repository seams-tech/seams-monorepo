import { DeriverRelocationPreparation } from '../../../packages/wallet-console-server-ts/src/walletPlacement/deriverPreparation';
import { GatewayRelocationPreparation } from '../../../packages/wallet-console-server-ts/src/walletPlacement/gatewayPreparation';
import type { WalletHome } from '../../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { isPlainObject } from '@seams/wallet-server/cloud-host';
import { SigningWorkerRelocationPreparation } from '../../../packages/wallet-console-server-ts/src/walletPlacement/signingWorkerPreparation';
import { RouterRelocationPreparation } from '../../../packages/wallet-console-server-ts/src/walletPlacement/routerPreparation';
import { GatewayRelocationOwnerApproval } from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocationOwnerApproval';
import { WalletRegionalDispatch } from '../../../packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
import { WalletRelocationPreparation } from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocationPreparation';

type Participants = Parameters<typeof WalletRelocationPreparation.prepare>[1];
type Command = Parameters<Participants['gateway']['prepare']>[0];

// This fixture exercises admission composition; it does not prepare real regional stores.
class PreparedParticipant {
  constructor(
    private readonly nowMs: number,
    private readonly failedParticipant: unknown,
  ) {}

  async prepare(command: Command): Promise<unknown> {
    if (command.participant === this.failedParticipant) {
      return { kind: 'unavailable' };
    }
    return {
      kind: 'prepared',
      admission: 'closed',
      participant: command.participant,
      requestDigest: command.requestDigest,
      destinationGeneration: command.destinationGeneration,
      physicalResource: `${command.request.destination.databaseId}/${command.participant}/${command.destinationGeneration}`,
      evidenceDigest: command.requestDigest,
      preparedAtMs: this.nowMs,
      expiresAtMs: this.nowMs + 300_000,
    };
  }
}

class PreparationRuntime {
  constructor(
    private readonly request: Command['request'],
    private readonly failedParticipant: unknown,
  ) {}

  async fetch(input: Request): Promise<Response> {
    if (this.failedParticipant === 'router') return new Response(null, { status: 503 });
    if (input.url !== 'https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/router-transfer' || input.method !== 'POST')
      return new Response(null, { status: 404 });
    const raw = await input.json();
    if (!raw || typeof raw !== 'object' || !('request' in raw))
      return new Response(null, { status: 400 });
    return Response.json({
      kind: 'prepared',
      request: raw.request,
      chunk_bytes: this.failedParticipant === 'router_conflicting_chunk' ? 2048 : 4096,
      destination_object: `${this.request.destination.databaseId}/router/${this.request.expectedGeneration + 1}`,
    });
  }
}

class SigningPreparationRuntime {
  constructor(private readonly failedParticipant: unknown) {}

  async fetch(input: Request): Promise<Response> {
    const body: unknown = await input.json();
    if (!isPlainObject(body) || input.method !== 'POST') return new Response(null, { status: 400 });
    const destinationObject = `signing-worker-wallet-${'a'.repeat(64)}`;
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

export function relocationPreparationParticipants(
  request: Command['request'],
  source: WalletHome,
  nowMs: number,
  failedParticipant: unknown,
): Participants {
  const participant = new PreparedParticipant(nowMs, failedParticipant);
  const gateway = new GatewayPreparationBinding(failedParticipant);
  return {
    gateway: new GatewayRelocationPreparation(source, request.destination, new WalletRegionalDispatch({
      WALLET_GATEWAY_US: gateway, WALLET_GATEWAY_WEUR: gateway,
      WALLET_GATEWAY_APAC: gateway, WALLET_GATEWAY_OC: gateway,
    }), relocationFixtureClock.bind(null, nowMs)),
    walletRuntime: participant,
    router: new RouterRelocationPreparation(
      request.destination,
      new PreparationRuntime(request, failedParticipant),
      relocationFixtureClock.bind(null, nowMs),
    ),
    deriverA: new DeriverRelocationPreparation(
      'deriverA', request.destination,
      new DeriverPreparationRuntime('source', failedParticipant),
      new DeriverPreparationRuntime('destination', failedParticipant),
      relocationFixtureClock.bind(null, nowMs),
    ),
    deriverB: new DeriverRelocationPreparation(
      'deriverB', request.destination,
      new DeriverPreparationRuntime('source', failedParticipant),
      new DeriverPreparationRuntime('destination', failedParticipant),
      relocationFixtureClock.bind(null, nowMs),
    ),
    signingWorker: new SigningWorkerRelocationPreparation(
      request.destination,
      new SigningPreparationRuntime(failedParticipant),
      relocationFixtureClock.bind(null, nowMs),
    ),
    presignSessions: participant,
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

export function relocationFixtureOwnerApproval(
  request: Command['request'],
  nowMs: number,
  mode: unknown,
): GatewayRelocationOwnerApproval {
  const gateway = new RelocationFixtureApprovalGateway(nowMs, mode, request);
  return new GatewayRelocationOwnerApproval(new WalletRegionalDispatch({
    WALLET_GATEWAY_US: gateway,
    WALLET_GATEWAY_WEUR: gateway,
    WALLET_GATEWAY_APAC: gateway,
    WALLET_GATEWAY_OC: gateway,
  }));
}
