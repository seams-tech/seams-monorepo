import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  GatewayBinding,
  RuntimeBinding,
  loadRelocationApi,
} from './relocation-directory-runtime.mjs';

export class BrowserWalletRelocation {
  ownerRequest = null;

  constructor(options) {
    Object.assign(this, options);
  }

  observe(request) {
    if (request.headers().authorization?.startsWith('Bearer ')) {
      this.ownerRequest = request;
    }
  }

  async moveToApac(page) {
    const { scenario, root, candidate } = this;
    const api = await loadRelocationApi({ root, candidate, output: scenario.output });
    const directory = scenario.consoleService;
    directory.available = true;
    const { database, scope } = directory;
    const catalog = api.WalletHomeCatalog.parse(JSON.parse(directory.catalogJson));
    const placements = await database.prepare('SELECT wallet_id, region FROM wallet_homes').all();
    assert.equal(placements.results.length, 1);
    assert.equal(placements.results[0].region, 'US');
    const wallet = api.WalletOwnershipKey.parse({
      ...scope,
      walletId: placements.results[0].wallet_id,
    });
    const source = scenario.gateways.get('US');
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
      destination: catalog.select('APAC'),
      expectedGeneration: 1,
      authorityId: owner.authorityId,
    });
    const headers = await this.ownerRequest.allHeaders();
    headers['content-type'] = 'application/json';
    const intent = {
      walletId: wallet.walletId,
      moveId: move.moveId,
      destinationRegion: 'APAC',
      expectedGeneration: 1,
    };
    const bindings = relocationBindings(api, scenario, signerScope);
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
    assert.equal(unchanged.region, 'US');
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
    for (let step = 0; step < 128; step += 1) {
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
        checkedFreeze = true;
      }
      if (current.progress.state === 'completed') {
        assert.equal(checkedFreeze, true);
        const destinationRecords = await authenticationRecords(
          scenario.gateways.get('APAC'),
          wallet.walletId,
        );
        assert.deepEqual(
          destinationRecords,
          sourceRecords,
          'Relocation must preserve authentication records exactly',
        );
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
            },
            null,
            2,
          ),
        );
        return { walletId: wallet.walletId, moveId: move.moveId };
      }
      assert.ok(
        ['ready', 'running'].includes(current.progress.execution.state),
        JSON.stringify(result),
      );
    }
    assert.fail('Browser wallet relocation did not complete within 128 coordinator steps');
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

function relocationBindings(api, scenario, scope) {
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
    gateways[`WALLET_GATEWAY_${region}`] = new GatewayBinding(
      new api.WalletAuthorizationRelocationRoutes({
        database: gateway.database,
        scope,
        directory: new api.WalletPlacementConsoleBinding(scenario.consoleService, gatewayWriter),
      }),
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
