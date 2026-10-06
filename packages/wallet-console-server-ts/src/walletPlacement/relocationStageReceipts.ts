import { queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { WalletRelocationReceipt, type WalletRelocation } from './relocation';
import type { WalletRelocationAttempt } from './relocationExecution';

type Kind = WalletRelocationReceipt['kind'];

// Participant effects finish before their journal transition. Persist their exact
// aggregate receipt so retries preserve its timestamp and need no live source.
export class WalletRelocationStageReceipts {
  constructor(private readonly database: D1DatabaseLike) {}

  async read<K extends Kind>(move: WalletRelocation, kind: K): Promise<WalletRelocationReceipt<K> | null> {
    const row = await queryD1One(this.database, `SELECT receipt_json FROM wallet_relocation_stage_receipts
      WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
        AND wallet_id = ?5 AND move_id = ?6 AND kind = ?7`, [...identity(move), kind]);
    if (!row) return null;
    if (typeof row.receipt_json !== 'string') throw new Error('Stored relocation stage receipt is invalid');
    const receipt = WalletRelocationReceipt.parse(JSON.parse(row.receipt_json), kind);
    if (!receipt.matches(move)) throw new Error('Stored relocation stage receipt identity differs');
    return receipt;
  }

  async record<K extends Kind>(move: WalletRelocation, attempt: WalletRelocationAttempt, receipt: WalletRelocationReceipt<K>): Promise<WalletRelocationReceipt<K> | null> {
    if (!receipt.matches(move) || attempt.moveId !== move.moveId || !attempt.wallet.matches(move.wallet) ||
        attempt.phase !== phase(receipt.kind)) return null;
    await this.database.prepare(`INSERT INTO wallet_relocation_stage_receipts
      (namespace, organization_id, project_id, environment_id, wallet_id, move_id, kind, receipt_json)
      SELECT namespace, organization_id, project_id, environment_id, wallet_id, move_id, ?7, ?8
      FROM wallet_relocations WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3
        AND environment_id = ?4 AND wallet_id = ?5 AND move_id = ?6
        AND state = ?9 AND execution_state = 'running'
        AND execution_revision = ?10 AND execution_attempt_id = ?11
      ON CONFLICT DO NOTHING`).bind(...identity(move), receipt.kind, JSON.stringify(receipt),
        attempt.phase, attempt.revision, attempt.id).run();
    const stored = await this.read(move, receipt.kind);
    if (!stored || stored.manifestDigest !== receipt.manifestDigest ||
        JSON.stringify(stored.participants) !== JSON.stringify(receipt.participants)) return null;
    return stored;
  }
}

function identity(move: WalletRelocation): readonly string[] {
  const wallet = move.wallet;
  return [wallet.namespace, wallet.organizationId, wallet.projectId, wallet.environmentId, wallet.walletId, move.moveId];
}

function phase(kind: Kind): WalletRelocationAttempt['phase'] {
  switch (kind) {
    case 'source_fence': return 'freezing';
    case 'destination_verification': return 'copying';
    case 'destination_activation':
    case 'source_cleanup': return 'cutover';
    default: {
      const unexpected: never = kind;
      throw new Error(`Unknown relocation receipt kind: ${String(unexpected)}`);
    }
  }
}
