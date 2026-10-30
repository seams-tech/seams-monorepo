import type { D1DatabaseLike } from './d1';
import type { ConsoleSessionRevocationStore } from './session';

class D1ConsoleSessionRevocationStore implements ConsoleSessionRevocationStore {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly namespace: string,
  ) {}

  async revoke(record: {
    readonly tokenDigest: string;
    readonly expiresAtMs: number;
  }): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO console_session_revocations (namespace, token_digest, expires_at_ms)
         VALUES (?1, ?2, ?3)
         ON CONFLICT (namespace, token_digest)
         DO UPDATE SET expires_at_ms = excluded.expires_at_ms`,
      )
      .bind(this.namespace, record.tokenDigest, record.expiresAtMs)
      .run();
    await this.database
      .prepare(
        `DELETE FROM console_session_revocations
         WHERE namespace = ?1 AND expires_at_ms <= ?2`,
      )
      .bind(this.namespace, Date.now())
      .run();
  }

  async isRevoked(tokenDigest: string, nowMs: number): Promise<boolean> {
    const row = await this.database
      .prepare(
        `SELECT 1 AS revoked FROM console_session_revocations
         WHERE namespace = ?1 AND token_digest = ?2 AND expires_at_ms > ?3`,
      )
      .bind(this.namespace, tokenDigest, nowMs)
      .first();
    return row !== null;
  }
}

export function createD1ConsoleSessionRevocationStore(input: {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
}): ConsoleSessionRevocationStore {
  const namespace = input.namespace.trim();
  if (!namespace) throw new Error('Console session revocation namespace is required');
  return new D1ConsoleSessionRevocationStore(input.database, namespace);
}
