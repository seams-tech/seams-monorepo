import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { WalletRelocation } from './relocation';

const LEASE_MS = 120_000;
const RENEW_MS = 30_000;
const SCOPE = `namespace = ?1 AND organization_id = ?2 AND project_id = ?3
  AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6`;

// This lease suppresses duplicate drivers. Participant receipts still make interrupted work repeatable.
export class WalletRelocationDriver {
  private state: 'held' | 'lost' | 'released' = 'held';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private renewal: Promise<void> = Promise.resolve();

  private constructor(
    private readonly database: D1DatabaseLike,
    private readonly identity: readonly string[],
    private readonly id: string,
    private readonly clock: () => number,
    private expiresAtMs: number,
  ) {
    this.scheduleRenewal();
  }

  static async claim(
    database: D1DatabaseLike,
    move: WalletRelocation,
    clock: () => number,
  ): Promise<WalletRelocationDriver | null> {
    const wallet = move.wallet;
    const identity = [
      wallet.namespace,
      wallet.organizationId,
      wallet.projectId,
      wallet.environmentId,
      wallet.walletId,
      move.moveId,
    ];
    const id = crypto.randomUUID();
    const nowMs = clock();
    const claimed = await database
      .prepare(
        `INSERT INTO wallet_relocation_dispatch
      (namespace, organization_id, project_id, environment_id, wallet_id, move_id,
       dispatched_at_ms, driver_id, driver_expires_at_ms)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT DO UPDATE SET dispatched_at_ms = excluded.dispatched_at_ms,
        driver_id = excluded.driver_id, driver_expires_at_ms = excluded.driver_expires_at_ms
      WHERE wallet_relocation_dispatch.driver_id IS NULL
        OR wallet_relocation_dispatch.driver_expires_at_ms <= ?7
      RETURNING driver_id`,
      )
      .bind(...identity, nowMs, id, nowMs + LEASE_MS)
      .first();
    return claimed
      ? new WalletRelocationDriver(database, identity, id, clock, nowMs + LEASE_MS)
      : null;
  }

  get held(): boolean {
    return this.state === 'held' && this.clock() < this.expiresAtMs;
  }

  async release(): Promise<void> {
    this.state = 'released';
    if (this.timer !== null) clearTimeout(this.timer);
    await this.renewal;
    await this.database
      .prepare(
        `UPDATE wallet_relocation_dispatch
      SET driver_id = NULL, driver_expires_at_ms = NULL
      WHERE ${SCOPE} AND driver_id = ?7`,
      )
      .bind(...this.identity, this.id)
      .run();
  }

  private scheduleRenewal(): void {
    if (this.state === 'held') this.timer = setTimeout(this.startRenewal.bind(this), RENEW_MS);
  }

  private startRenewal(): void {
    this.renewal = this.renew();
  }

  private async renew(): Promise<void> {
    try {
      const nowMs = this.clock();
      const renewed = await this.database
        .prepare(
          `UPDATE wallet_relocation_dispatch
        SET driver_expires_at_ms = ?9 WHERE ${SCOPE}
          AND driver_id = ?7 AND driver_expires_at_ms > ?8
        RETURNING driver_id`,
        )
        .bind(...this.identity, this.id, nowMs, nowMs + LEASE_MS)
        .first();
      if (this.state === 'held' && !renewed) this.state = 'lost';
      if (renewed) this.expiresAtMs = nowMs + LEASE_MS;
    } catch {
      if (this.state === 'held') this.state = 'lost';
    }
    this.scheduleRenewal();
  }
}
