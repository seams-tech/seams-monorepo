import { isPlainObject, queryD1All, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { parseTenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { WalletHomeCatalog, WalletPlacementError, type WalletHome, type WalletOwnershipKey } from './home';
import { WalletRelocationLocator, WalletRelocationRequest, type WalletRelocation } from './relocation';
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

export const WALLET_RELOCATION_ADVANCE_URL = 'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-advance';
type Scope = Pick<WalletOwnershipKey, 'namespace' | 'organizationId' | 'projectId' | 'environmentId'>;

// The Console host authenticates the service binding and resolves its tenant scope.
// This endpoint can advance only a move already admitted with fresh owner approval.
export async function handleWalletRelocationAdvance(request: Request, options: {
  readonly database: D1DatabaseLike;
  readonly catalog: WalletHomeCatalog;
  readonly scope: Scope;
  readonly bindings: WalletRelocationBindings;
  readonly clock: () => number;
}): Promise<Response> {
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
  const intent = WalletRelocationRequest.parse({ wallet: move.wallet, moveId: move.moveId,
    destination: move.destination, expectedGeneration: move.sourceGeneration, authorityId: move.authorityId });
  const sourceWriters = await storedWriters(options.database, move, move.source);
  const destinationWriters = await storedWriters(options.database, move, move.destination);
  if (!sourceWriters || !destinationWriters) return json({ ok: false, code: 'authority_unavailable' }, 503);
  const source = options.bindings.runtimes[move.source.region];
  const destination = options.bindings.runtimes[move.destination.region];
  const authorization = new WalletAuthorizationRelocation(options.database, options.bindings.gateways);
  const presign = new PresignRelocationPreparation(move.destination, source, destination, options.clock);
  const freeze = new WalletRelocationSourceFreeze(options.database, authorization,
    new RuntimeRelocationFreeze(options.database, source, presign), sourceWriters.gateway, options.clock);
  const transfer = new WalletRelocationTransfer(options.database, authorization,
    new RuntimeRelocationTransfer(source, destination), sourceWriters.gateway, destinationWriters.gateway, options.clock);
  const activation = new WalletRelocationActivation(options.database, authorization, destination, destinationWriters.gateway, options.clock);
  const cleanup = new WalletRelocationCleanup(options.database, authorization, source,
    sourceWriters.gateway, sourceWriters.runtime, options.clock);
  const coordinator = new WalletRelocationCoordinator(new D1WalletRelocations(options.database, options.catalog), {
    freeze: freeze.freeze.bind(freeze), transfer: transfer.transfer.bind(transfer),
    activate: activation.activate.bind(activation), cleanup: cleanup.cleanup.bind(cleanup),
  }, options.clock);
  const result = await coordinator.advance(intent, attemptId);
  if (!result.ok) return json(result, 409);
  return json(walletRelocationStatusView(result.move));
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
