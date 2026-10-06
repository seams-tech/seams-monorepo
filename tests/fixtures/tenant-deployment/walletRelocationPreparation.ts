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

export function relocationPreparationParticipants(
  request: Command['request'],
  nowMs: number,
  failedParticipant: unknown,
): Participants {
  const participant = new PreparedParticipant(nowMs, failedParticipant);
  return {
    gateway: participant,
    walletRuntime: participant,
    router: new RouterRelocationPreparation(
      request.destination,
      new PreparationRuntime(request, failedParticipant),
      relocationFixtureClock.bind(null, nowMs),
    ),
    deriverA: participant,
    deriverB: participant,
    signingWorker: participant,
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
