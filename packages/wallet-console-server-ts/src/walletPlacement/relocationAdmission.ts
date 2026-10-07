import { isPlainObject, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type {
  TenantDeploymentResourceVerificationsV1,
  TenantRuntimeWriterV1,
} from '../tenantDeployment/resourceVerification';
import { WalletHomeCatalog, type WalletHome, type WalletOwnershipKey } from './home';
import {
  WalletRelocationRequest,
  WalletRelocationLocator,
  type WalletRelocation,
} from './relocation';
import type { WalletRelocationBindings } from './relocationParticipants';
import {
  GatewayRelocationOwnerApproval,
  hasFreshRelocationOwnerApproval,
} from './relocationOwnerApproval';
import { D1WalletRelocations, readWalletRelocation } from './relocationStore';
import { readWalletPlacementStatus } from './relocationStatus';
import { walletRelocationStatusView } from './relocationView';

export const WALLET_RELOCATION_ADMISSION_URL =
  'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-admit';

type Scope = Pick<
  WalletOwnershipKey,
  'namespace' | 'organizationId' | 'projectId' | 'environmentId'
>;

type Options = {
  readonly database: D1DatabaseLike;
  readonly catalog: WalletHomeCatalog;
  readonly scope: Scope;
  readonly writer: TenantRuntimeWriterV1;
  readonly deploymentLane: string;
  readonly bindings: WalletRelocationBindings;
  readonly verifyResources: (
    source: WalletHome,
    destination: WalletHome,
  ) => Promise<TenantDeploymentResourceVerificationsV1>;
  readonly clock: () => number;
};

export async function handleWalletRelocationAdmission(
  request: Request,
  options: Options,
): Promise<Response> {
  if (request.url !== WALLET_RELOCATION_ADMISSION_URL) return failure('not_found', 404);
  if (request.method !== 'POST') return failure('method_not_allowed', 405);
  let intent: WalletRelocationRequest;
  let digest: string;
  let existing: WalletRelocation | null;
  try {
    const raw: unknown = await request.json();
    if (
      !isPlainObject(raw) ||
      Object.keys(raw).length !== 6 ||
      typeof raw.requestDigest !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(raw.requestDigest)
    )
      return failure('invalid_input', 400);
    const region = raw.destinationRegion;
    if (region !== 'US' && region !== 'WEUR' && region !== 'APAC' && region !== 'OC')
      return failure('invalid_input', 400);
    const locator = WalletRelocationLocator.parse({ wallet: raw.wallet, moveId: raw.moveId });
    const scope = options.scope;
    if (
      locator.wallet.namespace !== scope.namespace ||
      locator.wallet.organizationId !== scope.organizationId ||
      locator.wallet.projectId !== scope.projectId ||
      locator.wallet.environmentId !== scope.environmentId
    )
      return failure('scope_conflict', 403);
    existing = await readWalletRelocation(options.database, locator);
    if (existing && existing.destination.region !== region) return failure('request_conflict', 409);
    intent = WalletRelocationRequest.parse({
      wallet: raw.wallet,
      moveId: raw.moveId,
      authorityId: raw.authorityId,
      expectedGeneration: raw.expectedGeneration,
      destination: existing ? existing.destination : options.catalog.select(region),
    });
    digest = await intent.digest();
    if (digest !== raw.requestDigest) return failure('request_conflict', 409);
  } catch {
    return failure('invalid_input', 400);
  }
  const wallet = intent.wallet;
  if (options.writer.role !== 'gateway') return failure('wallet_home_writer_unauthorized', 403);
  const journal = new D1WalletRelocations(options.database, options.catalog);
  if (existing) {
    if (!existing.matchesRequest(intent, digest)) return failure('request_conflict', 409);
    return json(walletRelocationStatusView(existing));
  }
  const placement = await readWalletPlacementStatus(options.database, wallet);
  if (placement.state === 'unavailable') return failure('not_found', 404);
  if (placement.state === 'moving') return failure('move_in_progress', 409);
  if (
    options.writer.resource.accountId !== placement.home.accountId ||
    options.writer.resource.databaseId !== placement.home.databaseId
  )
    return failure('wallet_home_writer_unauthorized', 403);
  if (placement.generation !== intent.expectedGeneration) return failure('stale_generation', 409);
  if (placement.home.matches(intent.destination)) return failure('destination_unchanged', 409);
  if (placement.nextMoveAtMs > options.clock()) return failure('cooldown', 409);
  try {
    const approval = new GatewayRelocationOwnerApproval(options.bindings.gateways);
    if (!(await hasFreshRelocationOwnerApproval(approval, intent, placement.home, options.clock)))
      return failure('owner_approval_required', 409);
    const proofs = await options.verifyResources(placement.home, intent.destination);
    const result = await journal.admit(
      intent,
      proofs,
      options.deploymentLane,
      options.bindings,
      options.clock,
    );
    if (!result.ok) return json(result, 409);
    if (result.disposition === 'unchanged') return failure('destination_unchanged', 409);
    return json(walletRelocationStatusView(result.move));
  } catch (error) {
    console.warn(
      'Wallet relocation preparation failed',
      error instanceof Error ? error.message : 'Unknown failure',
    );
    return failure('relocation_preparation_unavailable', 503);
  }
}

function failure(code: string, status: number): Response {
  return json({ ok: false, code }, status);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
