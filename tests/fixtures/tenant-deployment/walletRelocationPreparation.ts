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

export function relocationPreparationParticipants(
  nowMs: number,
  failedParticipant: unknown,
): Participants {
  const participant = new PreparedParticipant(nowMs, failedParticipant);
  return {
    gateway: participant,
    walletRuntime: participant,
    router: participant,
    deriverA: participant,
    deriverB: participant,
    signingWorker: participant,
    presignSessions: participant,
  };
}

export function relocationFixtureClock(nowMs: number): number {
  return nowMs;
}
