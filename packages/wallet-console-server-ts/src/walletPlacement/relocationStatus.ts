import { queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  WalletHome,
  WalletOwnershipKey,
  WalletPlacementError,
  parseWalletOwnershipGeneration,
} from './home';
import { WALLET_RELOCATION_COOLDOWN_MS, WalletRelocation } from './relocation';

// Status is an observation. Writers still need their local admission and commit fences.
export type WalletPlacementStatus =
  | {
      readonly state: 'settled';
      readonly home: WalletHome;
      readonly generation: number;
      readonly nextMoveAtMs: number;
      readonly move?: never;
      readonly code?: never;
    }
  | {
      readonly state: 'moving';
      readonly move: WalletRelocation;
      readonly home?: never;
      readonly generation?: never;
      readonly nextMoveAtMs?: never;
      readonly code?: never;
    }
  | {
      readonly state: 'unavailable';
      readonly code: 'not_found' | 'wallet_not_established';
      readonly home?: never;
      readonly generation?: never;
      readonly nextMoveAtMs?: never;
      readonly move?: never;
    };

export async function readWalletPlacementStatus(
  database: D1DatabaseLike,
  wallet: WalletOwnershipKey,
): Promise<WalletPlacementStatus> {
  // Read the home and latest journal in one snapshot, including across cutover.
  const row = await queryD1One(
    database,
    `SELECT home.state AS home_state, home.placement_state AS home_placement_state,
      home.region AS home_region, home.account_id AS home_account_id,
      home.database_id AS home_database_id, home.ownership_generation AS home_generation,
      move.*
    FROM wallet_homes home LEFT JOIN wallet_relocations move
      ON move.namespace = home.namespace AND move.organization_id = home.organization_id
      AND move.project_id = home.project_id AND move.environment_id = home.environment_id
      AND move.wallet_id = home.wallet_id
    WHERE home.namespace = ?1 AND home.organization_id = ?2 AND home.project_id = ?3
      AND home.environment_id = ?4 AND home.wallet_id = ?5
    ORDER BY move.source_generation DESC LIMIT 1`,
    [
      wallet.namespace,
      wallet.organizationId,
      wallet.projectId,
      wallet.environmentId,
      wallet.walletId,
    ],
  );
  if (!row) return { state: 'unavailable', code: 'not_found' };
  if (row.home_state === 'reserved' || row.home_state === 'cancelled') {
    return { state: 'unavailable', code: 'wallet_not_established' };
  }
  if (row.home_state !== 'established') {
    throw new WalletPlacementError('invalid_record', 'Wallet registration state is invalid');
  }
  const home = WalletHome.parse({
    region: row.home_region,
    accountId: row.home_account_id,
    databaseId: row.home_database_id,
  });
  const generation = parseWalletOwnershipGeneration(row.home_generation);
  if (row.move_id === null) {
    if (row.home_placement_state !== 'active' || generation !== 1) {
      throw new WalletPlacementError('invalid_record', 'Wallet placement lacks its relocation');
    }
    return { state: 'settled', home, generation, nextMoveAtMs: 0 };
  }
  const move = WalletRelocation.fromRow(row);
  const progress = move.progress;
  const switched = progress.state === 'cutover' || progress.state === 'completed';
  const activated =
    progress.state === 'completed' ||
    (progress.state === 'cutover' && progress.activation.state === 'activated');
  if (
    !move.wallet.matches(wallet) ||
    !home.matches(switched ? move.destination : move.source) ||
    generation !== (switched ? move.destinationGeneration : move.sourceGeneration) ||
    row.home_placement_state !== (activated ? 'active' : 'paused')
  ) {
    throw new WalletPlacementError('invalid_record', 'Wallet placement and relocation disagree');
  }
  if (progress.state === 'completed') {
    return {
      state: 'settled',
      home,
      generation,
      nextMoveAtMs: move.admittedAtMs + WALLET_RELOCATION_COOLDOWN_MS,
    };
  }
  return { state: 'moving', move };
}
