import type { ConsoleSessionRevocationStore } from '../../packages/console-server-ts/src/boundary/session';

class InMemoryConsoleSessionRevocationStore implements ConsoleSessionRevocationStore {
  private readonly expirations = new Map<string, number>();

  async revoke(input: {
    readonly tokenDigest: string;
    readonly expiresAtMs: number;
  }): Promise<void> {
    this.expirations.set(input.tokenDigest, input.expiresAtMs);
  }

  async isRevoked(tokenDigest: string, nowMs: number): Promise<boolean> {
    const expiresAtMs = this.expirations.get(tokenDigest);
    return expiresAtMs !== undefined && expiresAtMs > nowMs;
  }
}

export function createInMemoryConsoleSessionRevocationStore(): ConsoleSessionRevocationStore {
  return new InMemoryConsoleSessionRevocationStore();
}
