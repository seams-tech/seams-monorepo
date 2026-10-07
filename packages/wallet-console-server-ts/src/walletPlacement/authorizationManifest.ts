import type { WalletRelocationAttempt } from './relocationExecution';
import { isPlainObject, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { WalletPlacementError } from './home';
import type { WalletD1RelocationCommand } from './relocationCommands';

// Console preserves the source schema bytes; the destination validates its schema.
export class WalletAuthorizationManifest {
  readonly #validated = true;

  private constructor(
    readonly schemaJson: string,
    readonly chunkCount: number,
    readonly recordCount: number,
    readonly digestHex: string,
  ) {
    Object.freeze(this);
  }

  static parse(raw: unknown): WalletAuthorizationManifest {
    if (
      !isPlainObject(raw) ||
      Object.keys(raw).length !== 4 ||
      typeof raw.schemaJson !== 'string' ||
      new TextEncoder().encode(raw.schemaJson).byteLength > 131072 ||
      typeof raw.chunkCount !== 'number' ||
      !Number.isSafeInteger(raw.chunkCount) ||
      raw.chunkCount < 0 ||
      typeof raw.recordCount !== 'number' ||
      !Number.isSafeInteger(raw.recordCount) ||
      raw.recordCount < 0 ||
      raw.recordCount > raw.chunkCount ||
      (raw.recordCount === 0) !== (raw.chunkCount === 0) ||
      typeof raw.digestHex !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(raw.digestHex)
    )
      throw new WalletPlacementError('invalid_input', 'Authorization manifest is invalid');
    let schema: unknown;
    try {
      schema = JSON.parse(raw.schemaJson);
    } catch {
      throw new WalletPlacementError('invalid_input', 'Authorization manifest schema is invalid');
    }
    if (!Array.isArray(schema) || schema.length === 0)
      throw new WalletPlacementError('invalid_input', 'Authorization manifest schema is invalid');
    return new WalletAuthorizationManifest(
      raw.schemaJson,
      raw.chunkCount,
      raw.recordCount,
      raw.digestHex,
    );
  }

  encoded(): string {
    if (!this.#validated) throw new Error('Authorization manifest is unvalidated');
    return JSON.stringify(this);
  }
}

export async function recordWalletAuthorizationManifest(
  database: D1DatabaseLike,
  command: WalletD1RelocationCommand,
  attempt: WalletRelocationAttempt,
  manifest: WalletAuthorizationManifest,
): Promise<WalletAuthorizationManifest> {
  if (command.operation.kind !== 'freeze' || command.participant !== 'gateway')
    throw new WalletPlacementError(
      'invalid_input',
      'Authorization capture requires a Gateway freeze command',
    );
  const wallet = command.wallet;
  const identity = [
    wallet.namespace,
    wallet.organizationId,
    wallet.projectId,
    wallet.environmentId,
    wallet.walletId,
    command.moveId,
    command.requestDigest,
    command.generation,
  ];
  await database
    .prepare(
      `UPDATE wallet_relocations SET authorization_manifest_json = ?9
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6 AND request_digest = ?7 AND source_generation = ?8
      AND state = 'freezing' AND execution_state = 'running'
      AND execution_revision = ?10 AND execution_attempt_id = ?11
      AND (authorization_manifest_json IS NULL OR authorization_manifest_json = ?9)`,
    )
    .bind(...identity, manifest.encoded(), attempt.revision, attempt.id)
    .run();
  const row = await database
    .prepare(
      `SELECT authorization_manifest_json FROM wallet_relocations
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6 AND request_digest = ?7 AND source_generation = ?8`,
    )
    .bind(...identity)
    .first<{ authorization_manifest_json: string | null }>();
  if (row?.authorization_manifest_json !== manifest.encoded())
    throw new WalletPlacementError(
      'invalid_record',
      'Authorization manifest conflicts with the captured source',
    );
  return manifest;
}
