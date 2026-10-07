import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  GatewayBinding,
  RuntimeBinding,
  loadRelocationApi,
} from './relocation-directory-runtime.mjs';

export class BrowserWalletRelocation {
  ownerRequest = null;
  completedCleanups = [];

  constructor(options) {
    Object.assign(this, options);
  }

  observe(request) {
    if (request.headers().authorization?.startsWith('Bearer ')) {
      this.ownerRequest = request;
    }
  }

  async move(page, { sourceRegion, destinationRegion, expectedGeneration }) {
    const { scenario, root, candidate } = this;
    const api = await loadRelocationApi({ root, candidate, output: scenario.output });
    const directory = scenario.consoleService;
    directory.available = true;
    const { database, scope } = directory;
    const catalog = api.WalletHomeCatalog.parse(JSON.parse(directory.catalogJson));
    const placements = await database.prepare('SELECT wallet_id, region FROM wallet_homes').all();
    assert.equal(placements.results.length, 1);
    assert.equal(placements.results[0].region, sourceRegion);
    const wallet = api.WalletOwnershipKey.parse({
      ...scope,
      walletId: placements.results[0].wallet_id,
    });
    const source = scenario.gateways.get(sourceRegion);
    const signerScope = {
      namespace: scope.namespace,
      orgId: scope.organizationId,
      projectId: scope.projectId,
      envId: scope.environmentId,
    };
    const owner = await this.authenticateOwner(api, source.database, signerScope, wallet.walletId);
    const move = api.WalletRelocationRequest.parse({
      wallet,
      moveId: `wmove_${randomBytes(32).toString('base64url')}`,
      destination: catalog.select(destinationRegion),
      expectedGeneration,
      authorityId: owner.authorityId,
    });
    const headers = await this.ownerRequest.allHeaders();
    headers['content-type'] = 'application/json';
    const intent = {
      walletId: wallet.walletId,
      moveId: move.moveId,
      destinationRegion,
      expectedGeneration,
    };
    const faults = { activationReplyLost: false, cleanupFailed: false };
    const bindings = relocationBindings(api, scenario, signerScope, faults, this.completedCleanups);
    const verifier = new BrowserMoveResourceProofs(directory.api, scope.namespace);
    directory.relocationAdmission = { bindings, verifyResources: verifier.verify.bind(verifier) };
    const journal = new api.D1WalletRelocations(database, catalog);
    const preparationFailure = await page.evaluate(requestSdkMove, intent);
    assert.deepEqual(preparationFailure, { ok: false, code: 'transport_unavailable' });
    assert.equal(await journal.find(move), null);
    const unchanged = await database
      .prepare('SELECT region, placement_state FROM wallet_homes WHERE wallet_id = ?')
      .bind(wallet.walletId)
      .first();
    assert.equal(unchanged.region, sourceRegion);
    assert.equal(unchanged.placement_state, 'active');
    const retry = new Request('https://gateway.example.test/wallet/placement/v1/relocations', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...intent, sourceProof: null }),
    });
    const admittedResult = await page.evaluate(requestSdkMove, intent);
    assert.equal(admittedResult.ok, true, JSON.stringify(admittedResult));
    const admitted = admittedResult.status;
    const replayResponse = await source.handle(retry, 'ingress');
    assert.equal(replayResponse.status, 200);
    assert.deepEqual(await replayResponse.json(), admitted);
    assert.equal(verifier.calls, 2, 'Exact admission replay does not repeat provider verification');
    const sourceRecords = await authenticationRecords(source, wallet.walletId);
    await writeFile(
      resolve(scenario.output, 'public-admission.json'),
      JSON.stringify(
        {
          sdkPlacementMove: true,
          gatewayChallengeAndAdmissionRoutes: true,
          realBrowserPasskeyApproval: true,
          preparationFailureKeepsSourceActive: true,
          exactRetryUsesStoredApproval: true,
          admittedReplayDoesNotRepeatPreparation: true,
          resourceVerification:
            'Fresh local fixture proofs. Cloudflare provider verification is excluded.',
        },
        null,
        2,
      ),
    );
    const progress = [];
    let checkedFreeze = false;
    for (let step = 0; step < 256; step += 1) {
      const response = await api.handleWalletRelocationAdvance(
        new Request(api.WALLET_RELOCATION_ADVANCE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet,
            moveId: move.moveId,
            attemptId: `wattempt_${randomBytes(32).toString('base64url')}`,
          }),
        }),
        { database, catalog, bindings, scope, clock: Date.now },
      );
      const result = await response.json();
      progress.push({ status: response.status, result });
      await writeFile(
        resolve(scenario.output, 'browser-relocation-progress.json'),
        JSON.stringify(progress, null, 2),
      );
      assert.equal(response.status, 200, JSON.stringify(result));
      const current = await journal.find(move);
      if (current.progress.state === 'copying' && !checkedFreeze) {
        await assert.rejects(
          source.database
            .prepare(
              `UPDATE webauthn_authenticators SET counter = counter + 1
          WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ? AND user_id = ?`,
            )
            .bind(
              scope.namespace,
              scope.organizationId,
              scope.projectId,
              scope.environmentId,
              wallet.walletId,
            )
            .run(),
          /wallet_authorization_history_frozen/,
        );
        if (sourceRecords.linked_device_authority_installations.count > 0) {
          await assert.rejects(
            source.database
              .prepare(
                `
            UPDATE linked_device_authority_installations SET updated_at_ms = updated_at_ms
            WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
              AND wallet_id = ?`,
              )
              .bind(
                scope.namespace,
                scope.organizationId,
                scope.projectId,
                scope.environmentId,
                wallet.walletId,
              )
              .run(),
            /linked_device_relocation_fenced/,
          );
        }
        checkedFreeze = true;
      }
      if (current.progress.state === 'completed') {
        assert.equal(checkedFreeze, true);
        const destinationRecords = await authenticationRecords(
          scenario.gateways.get(destinationRegion),
          wallet.walletId,
        );
        assert.deepEqual(
          destinationRecords,
          sourceRecords,
          'Relocation must preserve authentication records exactly',
        );
        if (destinationRecords.linked_device_authority_installations.count > 0) {
          await assert.rejects(
            scenario.gateways
              .get(destinationRegion)
              .database.prepare(
                `
            UPDATE linked_device_authority_installations SET updated_at_ms = updated_at_ms
            WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
              AND wallet_id = ?`,
              )
              .bind(
                scope.namespace,
                scope.organizationId,
                scope.projectId,
                scope.environmentId,
                wallet.walletId,
              )
              .run(),
            /linked_device_relocation_fenced/,
          );
        }
        let priorCleanupRejections = 0;
        for (const cleanup of this.completedCleanups) {
          if (cleanup.region !== destinationRegion) continue;
          const replay = await cleanup.binding.fetch(cleanup.request.clone());
          assert.equal(replay.status, 403);
          assert.equal((await replay.json()).code, 'relocation_command_denied');
          priorCleanupRejections += 1;
        }
        assert.deepEqual(
          await authenticationRecords(scenario.gateways.get(destinationRegion), wallet.walletId),
          destinationRecords,
          'An old cleanup retry must preserve the returned wallet',
        );
        if (expectedGeneration > 1) assert.ok(priorCleanupRejections > 0);
        const cleaned = await authenticationRecords(source, wallet.walletId);
        for (const record of Object.values(cleaned)) assert.equal(record.count, 0);
        await writeFile(
          resolve(scenario.output, 'authentication-transfer.json'),
          JSON.stringify(
            {
              sourceRecords,
              destinationRecords,
              sourceAfterCleanup: cleaned,
              frozenCounterWriteRejected: checkedFreeze,
              linkedHistoryImmutable:
                destinationRecords.linked_device_authority_installations.count > 0,
              faults,
              priorCleanupRejections,
            },
            null,
            2,
          ),
        );
        assert.deepEqual(faults, { activationReplyLost: true, cleanupFailed: true });
        return {
          walletId: wallet.walletId,
          moveId: move.moveId,
          nextMoveAtMs: admitted.move.nextMoveAtMs,
        };
      }
      if (current.progress.execution.state === 'retry_wait') {
        if (current.progress.state === 'cleanup') {
          const placement = await database
            .prepare('SELECT placement_state FROM wallet_homes WHERE wallet_id = ?')
            .bind(wallet.walletId)
            .first();
          assert.equal(
            placement.placement_state,
            'active',
            'Cleanup failure must preserve destination availability',
          );
        }
        await delay(Math.max(0, current.progress.execution.retryAtMs - Date.now()));
        continue;
      }
      assert.ok(
        ['ready', 'running'].includes(current.progress.execution.state),
        JSON.stringify(result),
      );
    }
    assert.fail('Browser wallet relocation did not complete within 256 coordinator steps');
  }

  async authenticateOwner(api, database, scope, walletId) {
    assert.ok(this.ownerRequest, 'Capture the real browser owner session before relocation');
    const store = new api.CloudflareD1AuthorizationStore({
      database,
      namespace: scope.namespace,
      walletSignerScope: scope,
    });
    const authorizationSessions = new api.AuthorizationService({
      policy: api.capabilityPolicyPort,
      sessions: store,
      grants: store,
      evidence: store,
      authorizedOperations: store,
      audit: {},
    });
    const headers = await this.ownerRequest.allHeaders();
    const owner = await api.WalletRelocationOwnerRequest.authenticate({
      request: new Request('https://gateway.example.test/wallet/placement/v1/relocations', {
        method: 'POST',
        headers,
      }),
      walletId,
      tenantId: scope.orgId,
      scope,
      allowedOrigins: [api.parseSessionOrigin(headers.origin)],
      authorizationSessions,
      nowMs: Date.now(),
    });
    assert.ok(owner, 'The registered browser session must authenticate the relocation owner');
    return owner;
  }
}

async function authenticationRecords(gateway, walletId) {
  const records = {};
  const scope = gateway.scope;
  for (const [table, column] of [
    ['wallets', 'wallet_id'],
    ['wallet_signers', 'wallet_id'],
    ['wallet_recovery_code_locators', 'wallet_id'],
    ['linked_device_sessions', "json_extract(record_json, '$.claimTranscript.value.walletId')"],
    ['linked_device_authority_installations', 'wallet_id'],
    ['linked_device_wallet_session_credential_deliveries_v1', 'wallet_id'],
    ['webauthn_credential_bindings', 'user_id'],
    ['webauthn_authenticators', 'user_id'],
    ['router_ab_yao_versioned_json_records', "json_extract(record_json, '$.walletId')"],
  ]) {
    const filter =
      table === 'router_ab_yao_versioned_json_records'
        ? " AND (substr(record_key, 1, 17) = 'passkey-envelope:' OR substr(record_key, 1, 28) = 'passkey-credential-activity:')"
        : '';
    const { results } = await gateway.database
      .prepare(
        `SELECT * FROM ${table} WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ? AND ${column} = ?${filter}`,
      )
      .bind(scope.namespace, scope.organizationId, scope.projectId, scope.environmentId, walletId)
      .all();
    const rows = [];
    for (const record of results) rows.push(JSON.stringify(record));
    rows.sort();
    records[table] = {
      count: rows.length,
      sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    };
  }
  return records;
}

function relocationBindings(api, scenario, scope, faults, completedCleanups) {
  const gateways = {};
  const runtimes = {};
  for (const [region, gateway] of scenario.gateways) {
    const home = gateway.catalog.select(region);
    const resource = { accountId: home.accountId, databaseId: home.databaseId };
    const writer = api.parseTenantRuntimeWriterV1(
      'walletRuntime',
      api.relocationWriterVersion(home.databaseId, 'walletRuntime'),
      resource,
    );
    const gatewayWriter = api.parseTenantRuntimeWriterV1('gateway', home.databaseId, resource);
    gateways[`WALLET_GATEWAY_${region}`] = new RelocationGatewayFaults(
      new GatewayBinding(
        new api.WalletAuthorizationRelocationRoutes({
          database: gateway.database,
          scope,
          directory: new api.WalletPlacementConsoleBinding(scenario.consoleService, gatewayWriter),
        }),
      ),
      faults,
      completedCleanups,
      region,
    );
    runtimes[region] = new RuntimeBinding(api, gateway.database, scope.namespace, writer, {
      ...gateway.environment,
      WALLET_CONSOLE: new api.WalletPlacementConsoleBinding(scenario.consoleService, writer),
      CF_VERSION_METADATA: { id: writer.versionId },
      SEAMS_D1_HOME_ACCOUNT_ID: home.accountId,
      SEAMS_D1_HOME_DATABASE_ID: home.databaseId,
    });
  }
  return { gateways: new api.WalletRegionalDispatch(gateways), runtimes };
}

async function requestSdkMove(request) {
  if (!window.__seamsIntendedE2EMoveWallet) throw new Error('SDK move helper is unavailable');
  return window.__seamsIntendedE2EMoveWallet(request);
}

class BrowserMoveResourceProofs {
  calls = 0;
  constructor(api, namespace) {
    Object.assign(this, { api, namespace });
  }
  async verify(source, destination) {
    this.calls += 1;
    if (this.calls === 1) throw new Error('Injected resource verification outage');
    return [
      this.api.relocationResourceVerification(source, this.namespace, Date.now()),
      this.api.relocationResourceVerification(destination, this.namespace, Date.now()),
    ];
  }
}

class RelocationGatewayFaults {
  constructor(binding, faults, completedCleanups, region) {
    Object.assign(this, { binding, faults, completedCleanups, region });
  }

  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname.endsWith('/authorization/cleanup') && !this.faults.cleanupFailed) {
      this.faults.cleanupFailed = true;
      return new Response('Injected cleanup outage', { status: 503 });
    }
    const cleanupRequest = pathname.endsWith('/authorization/cleanup') ? request.clone() : null;
    const response = await this.binding.fetch(request);
    if (cleanupRequest && response.status === 200) {
      const result = await response.clone().json();
      assert.equal(result.progress.state, 'cleaned');
      this.completedCleanups.push({
        binding: this.binding,
        region: this.region,
        request: cleanupRequest,
      });
    }
    if (
      pathname.endsWith('/authorization/activate') &&
      response.ok &&
      !this.faults.activationReplyLost
    ) {
      this.faults.activationReplyLost = true;
      return new Response('Injected lost activation acknowledgement', { status: 503 });
    }
    return response;
  }
}
