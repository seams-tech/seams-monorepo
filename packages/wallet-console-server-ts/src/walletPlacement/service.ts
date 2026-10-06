import { authorizePresignSource, authorizePresignTransfer, parsePresignSourceRequest, parsePresignTransferRequest, recordPresignSnapshot } from './presignRelocationCommand';
import { authorizeEcdsaTransfer, parseEcdsaTransferRequest, recordEcdsaActivation, recordEcdsaSnapshot } from './ecdsaRelocationReceipt';
import { authorizeEd25519Transfer, parseEd25519TransferRequest, recordEd25519Activation, recordEd25519Snapshot } from './ed25519RelocationReceipt';
import { recordDeriverActivation, recordDeriverSnapshot, authorizeDeriverTransfer, parseDeriverTransferRequest } from './deriverRelocationReceipt';
import { authorizeDeriverSourceFence, parseDeriverRelocationRole } from './deriverRelocationCommand';
import { recordRouterRelocationReceipt, authorizeRouterExport, authorizeRouterDestination, recordRouterActivation, authorizeRouterCleanup } from './routerRelocationReceipt';
import { authorizeWalletRuntimeSourceCommand, parseWalletRuntimeSourceOperation } from './runtimeRelocationCommand';
import { WalletExecutionAuthority } from './executionAuthority';
import {
  WalletAuthorizationManifest,
  recordWalletAuthorizationManifest,
} from './authorizationManifest';
import { walletPlacementReadHome } from './placementRouting';
import { handleLinkedDeviceBootstrap } from './linkedDeviceBootstrap';
import { D1LinkedDeviceRequestProofNonceStoreV1 } from '@seams/wallet-server/cloud-host';
import { handleSyncChallengeCommand } from './syncChallenges';
import { claimPasskeyCredential } from './passkeyClaims';
import { consumeSharedRateLimit } from './rateLimitService';
import { handleRegistrationOfferCommand } from './registrationOfferService';
import { handleIdentityCommand } from './identityService';
import { D1WalletRoutes, WalletRouteLocator } from './walletRouteLocators';
import type { TenantRuntimeWriterV1 } from '../tenantDeployment/resourceVerification';
import { SessionLocator, D1WalletSessionLocators } from './sessionLocators';
import type { TenantDeploymentD1ResourcesV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';
import type { D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { D1WalletHomeDirectory } from './d1';
import { readWalletPlacementStatus } from './relocationStatus';
import { walletPlacementView, walletRelocationStatusView } from './relocationView';
import { relocationDigest, WalletRelocationLocator, WalletRelocationRequest } from './relocation';
import { readWalletRelocation } from './relocationStore';
import { WalletD1RelocationCommand, parseWalletRelocationCommandKind } from './relocationCommands';
import { WalletRelocationAttempt } from './relocationExecution';
import {
  RegistrationSetupAllocation,
  WalletHome,
  WalletHomeCatalog,
  WalletOwnershipKey,
  WalletPlacementError,
  type WalletRegion,
} from './home';

export const WALLET_HOME_SERVICE_ORIGIN = 'https://wallet-placement.internal';
export const WALLET_HOME_SERVICE_BASE_PATH = '/internal/wallet-placement/v1';

type WalletHomeServiceScope = {
  readonly namespace: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly environmentId: string;
};

function inScope(wallet: WalletOwnershipKey, scope: WalletHomeServiceScope): boolean {
  return (
    wallet.namespace === scope.namespace &&
    wallet.organizationId === scope.organizationId &&
    wallet.projectId === scope.projectId &&
    wallet.environmentId === scope.environmentId
  );
}

export function isWalletHomeServiceRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.origin === WALLET_HOME_SERVICE_ORIGIN &&
    url.pathname.startsWith(`${WALLET_HOME_SERVICE_BASE_PATH}/`)
  );
}

function record(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new WalletPlacementError('invalid_input', 'Wallet home request must be an object');
  }
  return raw as Record<string, unknown>;
}

function selectedRegion(raw: unknown): WalletRegion {
  if (raw !== 'US' && raw !== 'WEUR' && raw !== 'APAC' && raw !== 'OC') {
    throw new WalletPlacementError('invalid_input', 'Wallet home region is invalid');
  }
  return raw;
}

function requiredString(raw: unknown, name: string): string {
  if (typeof raw !== 'string') {
    throw new WalletPlacementError('invalid_input', `${name} is required`);
  }
  return raw;
}

function completionOutcome(raw: unknown): 'established' | 'cancelled' {
  if (raw !== 'established' && raw !== 'cancelled') {
    throw new WalletPlacementError('invalid_input', 'Wallet home completion outcome is invalid');
  }
  return raw;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleWalletHomeServiceRequest(
  request: Request,
  options: {
    readonly database: D1DatabaseLike;
    readonly writer: TenantRuntimeWriterV1;
    readonly catalogJson: unknown;
    readonly admittedResources: TenantDeploymentD1ResourcesV1;
    readonly scope: WalletHomeServiceScope;
    readonly environmentKey: string;
    readonly deploymentLane: string;
  },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isWalletHomeServiceRequest(request)) return null;
  if (
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/device-bootstrap` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/device-proof-nonce` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/sync-challenge` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/claim-passkey` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/rate-limit` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/registration-offer` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/identity` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/find-route` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/publish-routes` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/publish-session` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/publish-exchanged-session` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/find` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/execution-authority` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/registration-execution-authority` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/placement-status` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/placement-route` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-status` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-replay` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-request` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-cleanup` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-activation` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-destination` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-export` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-receipt` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-runtime-source` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ecdsa-activation` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ed25519-activation` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ecdsa-receipt` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-presign-transfer` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-presign-source` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-presign-receipt` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ed25519-receipt` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ecdsa-transfer` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ed25519-transfer` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-deriver-source` &&
      url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-deriver-receipt` &&
      url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-deriver-activation` &&
      url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-deriver-transfer` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-command` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-authorization-manifest` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/find-by-ceremony` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/reserve` &&
    url.pathname !== `${WALLET_HOME_SERVICE_BASE_PATH}/complete`
  ) {
    return json({ ok: false, code: 'not_found' }, 404);
  }
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
  try {
    const body = record(await request.json().catch(() => null));
    if (
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-status` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-replay`
    ) {
      const replay = url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-replay`;
      if (
        replay &&
        (Object.keys(body).length !== 3 ||
          typeof body.requestDigest !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(body.requestDigest))
      ) {
        throw new WalletPlacementError('invalid_input', 'Relocation replay digest is invalid');
      }
      const locator = WalletRelocationLocator.parse(
        replay ? { wallet: body.wallet, moveId: body.moveId } : body,
      );
      if (!inScope(locator.wallet, options.scope)) {
        throw new WalletPlacementError('scope_conflict', 'Wallet belongs to another tenant scope');
      }
      const move = await readWalletRelocation(options.database, locator);
      if (move && replay && move.requestDigest !== body.requestDigest) {
        return json({ ok: false, code: 'request_conflict' }, 409);
      }
      return move
        ? json(walletRelocationStatusView(move))
        : json({ state: 'unavailable', code: 'not_found' }, 404);
    }
    if (
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/placement-status` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/placement-route` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-cleanup` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-activation` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-destination` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-export` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-receipt` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-runtime-source` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ecdsa-activation` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ed25519-activation` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ecdsa-receipt` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-presign-transfer` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-presign-source` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-presign-receipt` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ed25519-receipt` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ecdsa-transfer` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ed25519-transfer` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-deriver-source` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-deriver-receipt` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-deriver-activation` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-deriver-transfer` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-command` ||
      url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-authorization-manifest`
    ) {
      const wallet = WalletOwnershipKey.parse(body.wallet);
      if (!inScope(wallet, options.scope)) {
        throw new WalletPlacementError('scope_conflict', 'Wallet belongs to another tenant scope');
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/placement-route`) {
        if (Object.keys(body).length !== 1) {
          throw new WalletPlacementError('invalid_input', 'Placement route fields are invalid');
        }
        const home = walletPlacementReadHome(
          await readWalletPlacementStatus(options.database, wallet),
        );
        return json({ wallet, home });
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/placement-status`) {
        return json(walletPlacementView(await readWalletPlacementStatus(options.database, wallet)));
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-cleanup`) {
        if (Object.keys(body).length !== 2)
          throw new WalletPlacementError('invalid_input', 'Router cleanup fields are invalid');
        const result = await authorizeRouterCleanup(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt));
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-activation`) {
        if (Object.keys(body).length !== 3)
          throw new WalletPlacementError('invalid_input', 'Router activation fields are invalid');
        const result = await recordRouterActivation(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), body.receipt);
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-destination`) {
        if (Object.keys(body).length !== 3)
          throw new WalletPlacementError('invalid_input', 'Router destination fields are invalid');
        const result = await authorizeRouterDestination(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), body.operation);
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-export`) {
        if (Object.keys(body).length !== 4)
          throw new WalletPlacementError('invalid_input', 'Router export fields are invalid');
        const result = await authorizeRouterExport(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), body.recordIndex, body.segmentIndex);
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-router-receipt`) {
        if (Object.keys(body).length !== 3)
          throw new WalletPlacementError('invalid_input', 'Router receipt fields are invalid');
        const result = await recordRouterRelocationReceipt(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), body.receipt);
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ecdsa-activation`) {
        if (Object.keys(body).length !== 3) throw new WalletPlacementError('invalid_input', 'Ecdsa activation fields are invalid');
        const result = await recordEcdsaActivation(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), body.receipt);
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ecdsa-receipt`) {
        if (Object.keys(body).length !== 3) throw new WalletPlacementError('invalid_input', 'Ecdsa receipt fields are invalid');
        const result = await recordEcdsaSnapshot(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), body.receipt);
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ecdsa-transfer`) {
        if (Object.keys(body).length !== 3) throw new WalletPlacementError('invalid_input', 'Ecdsa transfer fields are invalid');
        const result = await authorizeEcdsaTransfer(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), parseEcdsaTransferRequest(body.request));
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ed25519-activation`) {
        if (Object.keys(body).length !== 3) throw new WalletPlacementError('invalid_input', 'Ed25519 activation fields are invalid');
        const result = await recordEd25519Activation(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), body.receipt);
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-presign-transfer`) {
        if (Object.keys(body).length !== 3) throw new WalletPlacementError('invalid_input', 'Presign transfer fields are invalid');
        const result = await authorizePresignTransfer(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), parsePresignTransferRequest(body.request));
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-presign-source`) {
        if (Object.keys(body).length !== 3) throw new WalletPlacementError('invalid_input', 'Presign source fields are invalid');
        const result = await authorizePresignSource(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), parsePresignSourceRequest(body.request));
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-presign-receipt`) {
        if (Object.keys(body).length !== 3) throw new WalletPlacementError('invalid_input', 'Presign receipt fields are invalid');
        const result = await recordPresignSnapshot(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), body.receipt);
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ed25519-receipt`) {
        if (Object.keys(body).length !== 3) throw new WalletPlacementError('invalid_input', 'Ed25519 receipt fields are invalid');
        const result = await recordEd25519Snapshot(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), body.receipt);
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-ed25519-transfer`) {
        if (Object.keys(body).length !== 3) throw new WalletPlacementError('invalid_input', 'Ed25519 transfer fields are invalid');
        const result = await authorizeEd25519Transfer(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), parseEd25519TransferRequest(body.request));
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-deriver-activation`) {
        if (Object.keys(body).length !== 4) throw new WalletPlacementError('invalid_input', 'Deriver activation fields are invalid');
        const result = await recordDeriverActivation(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), parseDeriverRelocationRole(body.role), body.receipt);
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-deriver-receipt`) {
        if (Object.keys(body).length !== 4) throw new WalletPlacementError('invalid_input', 'Deriver receipt fields are invalid');
        const result = await recordDeriverSnapshot(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), parseDeriverRelocationRole(body.role), body.receipt);
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-deriver-transfer`) {
        if (Object.keys(body).length !== 4) throw new WalletPlacementError('invalid_input', 'Deriver transfer fields are invalid');
        const result = await authorizeDeriverTransfer(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), parseDeriverRelocationRole(body.role), parseDeriverTransferRequest(body.request));
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-deriver-source`) {
        if (Object.keys(body).length !== 4)
          throw new WalletPlacementError('invalid_input', 'Deriver source command fields are invalid');
        const result = await authorizeDeriverSourceFence(options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt), parseDeriverRelocationRole(body.role),
          relocationDigest(body.cipherContextDigest));
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-runtime-source`) {
        if (Object.keys(body).length !== 3)
          throw new WalletPlacementError('invalid_input', 'Runtime source command fields are invalid');
        const result = await authorizeWalletRuntimeSourceCommand(
          options.database, wallet, options.writer,
          WalletRelocationAttempt.parse(body.attempt),
          parseWalletRuntimeSourceOperation(body.operation),
        );
        return json(result, result.ok ? 200 : 409);
      }
      if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-authorization-manifest`) {
        if (Object.keys(body).length !== 3)
          throw new WalletPlacementError(
            'invalid_input',
            'Authorization capture fields are invalid',
          );
        const attempt = WalletRelocationAttempt.parse(body.attempt);
        const authorized = await WalletD1RelocationCommand.authorize(
          options.database,
          wallet,
          options.writer,
          attempt,
          'freeze',
        );
        if (!authorized.ok) return json(authorized, 409);
        const manifest = await recordWalletAuthorizationManifest(
          options.database,
          authorized.command,
          attempt,
          WalletAuthorizationManifest.parse(body.manifest),
        );
        return json({ ok: true, manifest });
      }
      const outcome = await WalletD1RelocationCommand.authorize(
        options.database,
        wallet,
        options.writer,
        WalletRelocationAttempt.parse(body.attempt),
        parseWalletRelocationCommandKind(body.kind),
      );
      if (!outcome.ok) return json(outcome, 409);
      return json({ ok: true, command: outcome.command, digest: await outcome.command.digest() });
    }
    if (typeof options.catalogJson !== 'string' || options.catalogJson.length === 0) {
      return json({ ok: false, code: 'wallet_home_catalog_unavailable' }, 503);
    }
    const catalog = WalletHomeCatalog.parse(JSON.parse(options.catalogJson));
    if (!catalog.matchesResources(options.admittedResources)) {
      return json({ ok: false, code: 'wallet_home_resources_unverified' }, 503);
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/execution-authority`) {
      if (Object.keys(body).length !== 1)
        throw new WalletPlacementError('invalid_input', 'Execution authority fields are invalid');
      const wallet = WalletOwnershipKey.parse(body.wallet);
      if (!inScope(wallet, options.scope))
        throw new WalletPlacementError('scope_conflict', 'Wallet belongs to another tenant scope');
      const admitted = await WalletExecutionAuthority.admit(
        options.database,
        wallet,
        options.writer,
      );
      return json(admitted, admitted.ok ? 200 : 409);
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/relocation-request`) {
      if (Object.keys(body).length !== 5) {
        throw new WalletPlacementError('invalid_input', 'Relocation request fields are invalid');
      }
      const intent = WalletRelocationRequest.parse({
        wallet: body.wallet,
        moveId: body.moveId,
        destination: catalog.select(selectedRegion(body.destinationRegion)),
        expectedGeneration: body.expectedGeneration,
        authorityId: body.authorityId,
      });
      if (!inScope(intent.wallet, options.scope)) {
        throw new WalletPlacementError('scope_conflict', 'Wallet belongs to another tenant scope');
      }
      const placement = await readWalletPlacementStatus(options.database, intent.wallet);
      if (placement.state === 'unavailable') return json(walletPlacementView(placement), 404);
      if (placement.state === 'moving')
        return json({ ok: false, code: 'wallet_relocation_in_progress' }, 409);
      if (
        options.writer.role !== 'gateway' ||
        options.writer.resource.accountId !== placement.home.accountId ||
        options.writer.resource.databaseId !== placement.home.databaseId
      )
        return json({ ok: false, code: 'wallet_home_writer_unauthorized' }, 403);
      if (placement.generation !== intent.expectedGeneration)
        return json({ ok: false, code: 'generation_conflict' }, 409);
      if (placement.home.matches(intent.destination))
        return json({ kind: 'unchanged', placement: walletPlacementView(placement) });
      if (placement.nextMoveAtMs > Date.now())
        return json({ ok: false, code: 'cooldown', retryAtMs: placement.nextMoveAtMs }, 409);
      return json({
        kind: 'resolved',
        requestDigest: await intent.digest(),
        sourceGeneration: placement.generation,
        destinationRegion: intent.destination.region,
      });
    }
    const directory = new D1WalletHomeDirectory(options.database, catalog);
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/registration-execution-authority`) {
      if (
        Object.keys(body).length !== 3 ||
        typeof body.registrationId !== 'string' ||
        body.registrationId.length === 0 ||
        typeof body.requestDigest !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(body.requestDigest)
      )
        throw new WalletPlacementError(
          'invalid_input',
          'Registration execution fields are invalid',
        );
      const wallet = WalletOwnershipKey.parse(body.wallet);
      if (!inScope(wallet, options.scope))
        throw new WalletPlacementError('scope_conflict', 'Wallet belongs to another tenant scope');
      const assignment = await directory.find(wallet);
      if (
        !assignment ||
        assignment.state !== 'reserved' ||
        assignment.registrationId !== body.registrationId ||
        assignment.requestDigest !== body.requestDigest
      )
        return json({ ok: false, code: 'wallet_unavailable' }, 409);
      const admitted = WalletExecutionAuthority.admitRegistration(assignment, options.writer);
      return json(admitted, admitted.ok ? 200 : 409);
    }

    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/device-bootstrap`)
      return handleLinkedDeviceBootstrap(body, options.database, options.scope, options.writer);
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/device-proof-nonce`) {
      const nonces = new D1LinkedDeviceRequestProofNonceStoreV1({
        database: options.database,
        scope: {
          namespace: options.scope.namespace,
          orgId: options.scope.organizationId,
          projectId: options.scope.projectId,
          envId: options.scope.environmentId,
        },
      });
      return json(await nonces.consumeRequestProofNonceV1(body));
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/sync-challenge`)
      return handleSyncChallengeCommand(body, options.database, options.scope, options.writer);
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/rate-limit`)
      return await consumeSharedRateLimit(body, options.database, options.scope);
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/registration-offer`) {
      return await handleRegistrationOfferCommand(
        body,
        options.database,
        { ...options.scope, environmentKey: options.environmentKey },
        directory,
        options.writer,
      );
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/identity`) {
      return await handleIdentityCommand(body, options.database, options.scope);
    }
    const sessions = new D1WalletSessionLocators(options.database, options.scope, directory);
    const routes = new D1WalletRoutes(options.database, options.scope);
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/find-route`) {
      const locator = WalletRouteLocator.parse(body.locator);
      const assignment = await routes.find(locator);
      return assignment
        ? json({ ok: true, locator, assignment })
        : json({ ok: false, code: 'not_found' }, 404);
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/publish-exchanged-session`) {
      const exchange = SessionLocator.exchange(body.exchangeDigest);
      const credential = SessionLocator.credential(body.digest);
      await sessions.publishExchangedCredential({ exchange, credential, writer: options.writer });
      return json({ ok: true });
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/find-by-ceremony`) {
      const assignment = await directory.findByCeremony(
        options.scope.namespace,
        requiredString(body.ceremonyId, 'ceremonyId'),
      );
      return assignment && inScope(assignment.wallet, options.scope)
        ? json({ ok: true, assignment })
        : json({ ok: false, code: 'not_found' }, 404);
    }
    const wallet = WalletOwnershipKey.parse(body.wallet);
    if (!inScope(wallet, options.scope)) {
      throw new WalletPlacementError('scope_conflict', 'Wallet belongs to another tenant scope');
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/claim-passkey`) {
      const claimed = await claimPasskeyCredential({
        database: options.database,
        wallet,
        writer: options.writer,
        rpId: requiredString(body.rpId, 'rpId'),
        credentialIdB64u: requiredString(body.credentialIdB64u, 'credentialIdB64u'),
      });
      return claimed ? json({ ok: true }) : json({ ok: false, code: 'credential_conflict' }, 409);
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/publish-routes`) {
      if (!Array.isArray(body.locators) || body.locators.length < 1)
        throw new WalletPlacementError('invalid_input', 'Wallet route locators are required');
      const locators = body.locators.map(WalletRouteLocator.parse);
      const published = await routes.publish(wallet, locators, options.writer);
      return published ? json({ ok: true }) : json({ ok: false, code: 'locator_conflict' }, 409);
    }
    if (url.pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/publish-session`) {
      if (typeof body.expiresAtMs !== 'number')
        throw new WalletPlacementError('invalid_input', 'Session expiry is required');
      await sessions.publish({
        locator: SessionLocator.parse(body.locator),
        wallet,
        expiresAtMs: body.expiresAtMs,
        writer: options.writer,
      });
      return json({ ok: true });
    }
    switch (url.pathname) {
      case `${WALLET_HOME_SERVICE_BASE_PATH}/find`: {
        const assignment = await directory.find(wallet);
        return assignment
          ? json({ ok: true, assignment })
          : json({ ok: false, code: 'not_found' }, 404);
      }
      case `${WALLET_HOME_SERVICE_BASE_PATH}/reserve`: {
        let selection:
          | { readonly allocation: 'provided'; readonly wallet: WalletOwnershipKey }
          | { readonly allocation: 'server_allocated'; readonly candidate: WalletOwnershipKey };
        switch (body.allocation) {
          case 'provided':
            selection = { allocation: 'provided', wallet };
            break;
          case 'server_allocated':
            selection = { allocation: 'server_allocated', candidate: wallet };
            break;
          default:
            throw new WalletPlacementError('invalid_input', 'Wallet allocation branch is invalid');
        }
        const outcome = await directory.reserve({
          ...selection,
          proposedHome: catalog.select(selectedRegion(body.ingressRegion)),
          proposedRegistrationAllocation: RegistrationSetupAllocation.parse(
            body.registrationAllocation,
          ),
          registrationId: requiredString(body.registrationId, 'registrationId'),
          deploymentLane: options.deploymentLane,
          requestDigest: requiredString(body.requestDigest, 'requestDigest'),
          nowMs: Date.now(),
        });
        return json(outcome, outcome.ok ? 200 : 409);
      }
      case `${WALLET_HOME_SERVICE_BASE_PATH}/complete`: {
        const home = WalletHome.parse(body.home);
        if (
          home.accountId !== options.writer.resource.accountId ||
          home.databaseId !== options.writer.resource.databaseId
        ) {
          throw new WalletPlacementError(
            'scope_conflict',
            'Only the assigned home writer can complete registration',
          );
        }
        const assignment = await directory.complete({
          wallet,
          home,
          registrationId: requiredString(body.registrationId, 'registrationId'),
          requestDigest: requiredString(body.requestDigest, 'requestDigest'),
          outcome: completionOutcome(body.outcome),
          nowMs: Date.now(),
        });
        return json({ ok: true, assignment });
      }
      default:
        return json({ ok: false, code: 'not_found' }, 404);
    }
  } catch (error) {
    if (error instanceof WalletPlacementError) {
      let status = 409;
      if (error.code === 'invalid_input') status = 400;
      if (error.code === 'scope_conflict') status = 403;
      if (error.code === 'registration_paused' || error.code === 'wallet_relocation_in_progress') {
        status = 503;
      }
      return json({ ok: false, code: error.code }, status);
    }
    throw error;
  }
}
