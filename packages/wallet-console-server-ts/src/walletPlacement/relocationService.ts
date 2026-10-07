import { readStoredCustodyNamespaces } from '../tenantDeployment/custodyResourceVerification';
import { CustodyTargetInspector } from './custodyTargets';
import { base64UrlEncode, isPlainObject, queryD1All, queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { parseTenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletHomeCatalog, WalletPlacementError, type WalletHome, type WalletOwnershipKey } from './home';
import { WalletRelocationLocator, WalletRelocationRequest, WalletRelocation } from './relocation';
import { relocationAttemptId } from './relocationExecution';
import { D1WalletRelocations, readWalletRelocation } from './relocationStore';
import { WalletRelocationCoordinator } from './relocationCoordinator';
import type { WalletRelocationBindings } from './relocationParticipants';
import { WalletAuthorizationRelocation } from './authorizationRelocation';
import { PresignRelocationPreparation } from './presignPreparation';
import { RuntimeRelocationFreeze } from './runtimeRelocationFreeze';
import { RuntimeRelocationTransfer } from './runtimeRelocationTransfer';
import { WalletRelocationSourceFreeze } from './relocationSourceFreeze';
import { WalletRelocationTransfer } from './relocationTransfer';
import { WalletRelocationActivation } from './relocationActivation';
import { WalletRelocationCleanup } from './relocationCleanup';
import { walletRelocationStatusView } from './relocationView';
import { WalletRelocationDriver } from './relocationDriver';

export const WALLET_RELOCATION_ADVANCE_URL = 'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-advance';
type Scope = Pick<WalletOwnershipKey, 'namespace' | 'organizationId' | 'projectId' | 'environmentId'>;

type ExecutionOptions = {
  readonly database: D1DatabaseLike;
  readonly catalog: WalletHomeCatalog;
  readonly bindings: WalletRelocationBindings;
  readonly clock: () => number;
};

// The Console host authenticates the service binding and resolves its tenant scope.
// This endpoint can advance only a move already admitted with fresh owner approval.
export async function handleWalletRelocationAdvance(request: Request, options: ExecutionOptions & { readonly scope: Scope }): Promise<Response> {
  if (request.url !== WALLET_RELOCATION_ADVANCE_URL) return json({ ok: false, code: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
  let locator: WalletRelocationLocator;
  let attemptId: string;
  try {
    const body: unknown = await request.json();
    if (!isPlainObject(body) || Object.keys(body).length !== 3)
      throw new WalletPlacementError('invalid_input', 'Relocation advance fields are invalid');
    locator = WalletRelocationLocator.parse({ wallet: body.wallet, moveId: body.moveId });
    attemptId = relocationAttemptId(body.attemptId);
  } catch {
    return json({ ok: false, code: 'invalid_input' }, 400);
  }
  const wallet = locator.wallet;
  const scope = options.scope;
  if (wallet.namespace !== scope.namespace || wallet.organizationId !== scope.organizationId ||
      wallet.projectId !== scope.projectId || wallet.environmentId !== scope.environmentId)
    return json({ ok: false, code: 'scope_conflict' }, 403);
  const move = await readWalletRelocation(options.database, locator);
  if (!move) return json({ ok: false, code: 'not_found' }, 404);
  if (move.progress.state === 'completed') return json(walletRelocationStatusView(move));
  const driver = await WalletRelocationDriver.claim(options.database, move, options.clock);
  if (!driver) return json(walletRelocationStatusView(move));
  try {
    return await advanceMove(move, attemptId, options);
  } finally {
    await driver.release();
  }
}

async function advanceMove(move: WalletRelocation, attemptId: string, options: ExecutionOptions): Promise<Response> {
  if (move.progress.state === 'completed') return json(walletRelocationStatusView(move));
  const coordinator = await createCoordinator(move, options);
  if (!coordinator) return json({ ok: false, code: 'authority_unavailable' }, 503);
  const intent = WalletRelocationRequest.parse({ wallet: move.wallet, moveId: move.moveId,
    destination: move.destination, expectedGeneration: move.sourceGeneration, authorityId: move.authorityId });
  const result = await coordinator.advance(intent, attemptId);
  if (!result.ok) return json(result, 409);
  return json(walletRelocationStatusView(result.move));
}

async function createCoordinator(move: WalletRelocation, options: ExecutionOptions): Promise<WalletRelocationCoordinator | null> {
  const sourceWriters = await storedWriters(options.database, move, move.source);
  const destinationWriters = await storedWriters(options.database, move, move.destination);
  if (!sourceWriters || !destinationWriters) return null;
  const source = options.bindings.runtimes[move.source.region];
  const destination = options.bindings.runtimes[move.destination.region];
  const authorization = new WalletAuthorizationRelocation(options.database, options.bindings.gateways);
  const wallet = move.wallet;
  const stored = await queryD1One(options.database, `SELECT preparation_json FROM wallet_relocations
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6`, [wallet.namespace, wallet.organizationId,
    wallet.projectId, wallet.environmentId, wallet.walletId, move.moveId]);
  const custody = readStoredCustodyNamespaces(stored?.preparation_json);
  if (!custody) return null;
  const targets = new CustodyTargetInspector(move.source, move.destination, custody, source, destination);
  const presign = new PresignRelocationPreparation(move.destination, source, destination, options.clock, targets);
  const freeze = new WalletRelocationSourceFreeze(options.database, authorization,
    new RuntimeRelocationFreeze(options.database, source, presign), sourceWriters.gateway, options.clock);
  const transfer = new WalletRelocationTransfer(options.database, authorization,
    new RuntimeRelocationTransfer(source, destination), sourceWriters.gateway, destinationWriters.gateway, options.clock);
  const activation = new WalletRelocationActivation(options.database, authorization, destination, destinationWriters.gateway, options.clock);
  const cleanup = new WalletRelocationCleanup(options.database, authorization, source,
    sourceWriters.gateway, sourceWriters.runtime, options.clock);
  return new WalletRelocationCoordinator(new D1WalletRelocations(options.database, options.catalog), {
    freeze: freeze.freeze.bind(freeze), transfer: transfer.transfer.bind(transfer),
    activate: activation.activate.bind(activation), cleanup: cleanup.cleanup.bind(cleanup),
  }, options.clock);
}

// The admitted request stays alive through activation. Cron only resumes interrupted work.
export async function runWalletRelocation(
  options: ExecutionOptions,
  until: 'activation' | 'cleanup',
  initial: WalletRelocation,
): Promise<void> {
  if (initial.progress.state === 'completed') return;
  const driver = await WalletRelocationDriver.claim(options.database, initial, options.clock);
  if (!driver) return;
  try {
    await driveWalletRelocation(options, until, initial, driver);
  } finally {
    await driver.release();
  }
}

async function driveWalletRelocation(
  options: ExecutionOptions,
  until: 'activation' | 'cleanup',
  initial: WalletRelocation,
  driver: WalletRelocationDriver,
): Promise<void> {
  const coordinator = await createCoordinator(initial, options);
  if (!coordinator) return;
  const intent = WalletRelocationRequest.parse({ wallet: initial.wallet, moveId: initial.moveId,
    destination: initial.destination, expectedGeneration: initial.sourceGeneration, authorityId: initial.authorityId });
  let move = initial;
  for (let step = 0; step < 256; step += 1) {
    if (!driver.held) return;
    if (move.progress.state === 'completed') return;
    if (until === 'activation' && move.progress.state === 'cutover' && move.progress.activation.state === 'activated') return;
    if (move.progress.execution.state === 'blocked' ||
        (move.progress.execution.state === 'retry_wait' && move.progress.execution.retryAtMs > options.clock())) return;
    const attemptId = `wattempt_${base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))}`;
    const result = await coordinator.advance(intent, attemptId);
    if (!result.ok) return;
    move = result.move;
  }
}

// The existing Console cron retries admitted work without browser polling.
// Each selected move advances continuously until complete or waiting for recovery.
export async function resumeWalletRelocations(options: ExecutionOptions & { readonly namespace: string }): Promise<void> {
  const nowMs = options.clock();
  const rows = await queryD1All(options.database, `SELECT move.* FROM wallet_relocations AS move
    LEFT JOIN wallet_relocation_dispatch AS dispatch
      USING (namespace, organization_id, project_id, environment_id, wallet_id, move_id)
    WHERE namespace = ?1 AND state != 'completed'
      AND (dispatch.driver_id IS NULL OR dispatch.driver_expires_at_ms <= ?2) AND (
      execution_state IN ('ready', 'running') OR
      (execution_state = 'retry_wait' AND execution_retry_at_ms <= ?2))
    ORDER BY COALESCE(dispatch.dispatched_at_ms, 0), admitted_at_ms, move_id LIMIT 4`, [options.namespace, nowMs]);
  for (const row of rows) {
    try {
      const move = WalletRelocation.fromRow(row);
      await runWalletRelocation(options, 'cleanup', move);
    } catch (error) {
      console.error('Wallet relocation resumption failed', { moveId: row.move_id, error });
    }
  }
}

async function storedWriters(database: D1DatabaseLike, move: WalletRelocation, home: WalletHome) {
  const wallet = move.wallet;
  const rows = await queryD1All(database, `SELECT
      json_extract(proof.value, '$.authority.gateway.versionId') AS gateway_version,
      json_extract(proof.value, '$.authority.walletRuntime.versionId') AS runtime_version
    FROM wallet_relocations, json_each(resource_verifications_json) AS proof
    WHERE namespace = ?1 AND organization_id = ?2 AND project_id = ?3 AND environment_id = ?4
      AND wallet_id = ?5 AND move_id = ?6
      AND json_extract(proof.value, '$.authority.kind') = 'cloudflare'
      AND json_extract(proof.value, '$.resource.accountId') = ?7
      AND json_extract(proof.value, '$.resource.databaseId') = ?8`,
  [wallet.namespace, wallet.organizationId, wallet.projectId, wallet.environmentId, wallet.walletId,
    move.moveId, home.accountId, home.databaseId]);
  if (rows.length !== 1) return null;
  const row = rows[0];
  const resource = { accountId: home.accountId, databaseId: home.databaseId };
  return {
    gateway: parseTenantRuntimeWriterV1('gateway', row.gateway_version, resource),
    runtime: parseTenantRuntimeWriterV1('walletRuntime', row.runtime_version, resource),
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
