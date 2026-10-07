import { isPlainObject, queryD1All, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { WalletHome } from './home';
import { WalletRelocationRequest } from './relocation';
import { WalletRegionalDispatch } from './regionalDispatch';

const SCOPE = `namespace = ?1 AND organization_id = ?2 AND project_id = ?3
  AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6`;
const BASE = 'https://wallet-relocation.internal/internal/wallet-relocation/v1/authorization';

// The durable decision prevents a delayed admission from racing source release.
export class WalletRelocationCapacity {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly gateways: WalletRegionalDispatch,
  ) {}

  async check(
    request: WalletRelocationRequest,
    source: WalletHome,
    nowMs: number,
  ): Promise<boolean> {
    const identity = bindings(request);
    const requestJson = JSON.stringify(request);
    const sourceJson = JSON.stringify(source);
    await this.database
      .prepare(
        `INSERT INTO wallet_relocation_capacity
      (namespace, organization_id, project_id, environment_id, wallet_id, move_id,
       request_json, source_json, state, started_at_ms, expires_at_ms)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'checking', ?9, ?10)
      ON CONFLICT DO NOTHING`,
      )
      .bind(...identity, requestJson, sourceJson, nowMs, nowMs + 30_000)
      .run();
    const pending = await this.database
      .prepare(
        `SELECT 1 AS pending FROM wallet_relocation_capacity
      WHERE ${SCOPE} AND state = 'checking' AND request_json = ?7 AND source_json = ?8
        AND expires_at_ms > ?9`,
      )
      .bind(...identity, requestJson, sourceJson, nowMs)
      .first();
    if (!pending) return false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await this.call(source, request, 'block');
      if (response.status !== 200 && response.status !== 202) return false;
      const body: unknown = await response.json();
      if (!isPlainObject(body) || Object.keys(body).length !== 1) return false;
      if (response.status === 200) return body.kind === 'authorization_blocked';
      if (body.kind !== 'authorization_draining') return false;
      await new Promise<void>(waitForDrain);
    }
    return false;
  }

  async release(request: WalletRelocationRequest, source: WalletHome): Promise<void> {
    await this.database
      .prepare(
        `UPDATE wallet_relocation_capacity SET state = 'releasing'
      WHERE ${SCOPE} AND state = 'checking' AND request_json = ?7 AND source_json = ?8`,
      )
      .bind(...bindings(request), JSON.stringify(request), JSON.stringify(source))
      .run();
    const releasing = await this.database
      .prepare(
        `SELECT 1 AS releasing FROM wallet_relocation_capacity
      WHERE ${SCOPE} AND state = 'releasing' AND request_json = ?7 AND source_json = ?8`,
      )
      .bind(...bindings(request), JSON.stringify(request), JSON.stringify(source))
      .first();
    if (!releasing) return;
    const response = await this.call(source, request, 'release');
    if (!response.ok) return;
    await this.database
      .prepare(
        `UPDATE wallet_relocation_capacity SET state = 'released'
      WHERE ${SCOPE} AND state = 'releasing'`,
      )
      .bind(...bindings(request))
      .run();
  }

  async recover(namespace: string, nowMs: number): Promise<void> {
    const rows = await queryD1All(
      this.database,
      `SELECT request_json, source_json
      FROM wallet_relocation_capacity WHERE namespace = ?1
        AND (state = 'releasing' OR (state = 'checking' AND expires_at_ms <= ?2))
      ORDER BY started_at_ms LIMIT 4`,
      [namespace, nowMs],
    );
    for (const row of rows) {
      if (typeof row.request_json !== 'string' || typeof row.source_json !== 'string')
        throw new Error('Stored relocation capacity identity is invalid');
      await this.release(
        WalletRelocationRequest.parse(JSON.parse(row.request_json)),
        WalletHome.parse(JSON.parse(row.source_json)),
      );
    }
  }

  private async call(
    home: WalletHome,
    request: WalletRelocationRequest,
    operation: 'block' | 'release',
  ) {
    return this.gateways.forward(
      home,
      new Request(`${BASE}/${operation}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: {
            walletId: request.wallet.walletId,
            moveId: request.moveId,
            requestDigestHex: await request.digest(),
            sourceGeneration: request.expectedGeneration,
          },
        }),
      }),
    );
  }
}

function waitForDrain(resolve: () => void): void {
  setTimeout(resolve, 250);
}

function bindings(request: WalletRelocationRequest): readonly string[] {
  const wallet = request.wallet;
  return [
    wallet.namespace,
    wallet.organizationId,
    wallet.projectId,
    wallet.environmentId,
    wallet.walletId,
    request.moveId,
  ];
}
