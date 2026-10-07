import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

export async function createRelocationBrowserSession({ candidate, output, owner }) {
  const publicRoot = resolve(candidate, '../..');
  const result = await build({
    bundle: true,
    format: 'iife',
    globalName: 'relocationSdk',
    platform: 'browser',
    write: false,
    tsconfig: resolve(publicRoot, 'packages/wallet/tsconfig.json'),
    stdin: {
      resolveDir: publicRoot,
      contents: `
      export { IndexedDBManager, walletSessionAuthorizations } from './packages/wallet/src/core/indexedDB';
      export { reconcileWalletPlacementSession } from './packages/wallet/src/SeamsWeb/walletIframe/host/reconcileWalletPlacement';
      export { parseWalletMoveStatus } from './packages/wallet/src/SeamsWeb/publicApi/placement';
    `,
    },
  });
  const bundle = result.outputFiles[0].text;
  await writeFile(resolve(output, 'browser-session.js'), bundle);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://wallet.example.test/**', serveWalletPage);
    await page.goto('https://wallet.example.test/');
    await page.addScriptTag({ content: bundle });
    await page.addScriptTag({
      content: `globalThis.readRelocationAuthentication = ${readAuthentication.toString()}; globalThis.lockRelocationWallet = ${lockWallet.toString()};`,
    });
    await page.evaluate(installOwnerSession, owner);
    return new BrowserRelocationSession(browser, page, bundle, owner, output);
  } catch (error) {
    await browser.close();
    throw error;
  }
}

class BrowserRelocationSession {
  observations = [];
  constructor(browser, page, bundle, owner, output) {
    Object.assign(this, { browser, page, bundle, owner, output });
  }
  async observe(status) {
    const observation = await this.page.evaluate(observeMove, status);
    this.observations.push(observation);
    return observation;
  }
  async verifyReload() {
    await this.page.reload();
    await this.page.addScriptTag({ content: this.bundle });
    const rejected = await this.page.evaluate(rejectOldCredential, this.owner);
    assert.equal(rejected, true);
    await writeFile(
      resolve(this.output, 'browser-session.json'),
      JSON.stringify(
        {
          observations: this.observations,
          reloadPreservedGenerationFence: rejected,
          scope:
            'Chromium IndexedDB with the real issued session and registered authority. Production SDK reconciles actual coordinator responses. Session installation uses production persistence directly. Excludes iframe transport, browser registration, Gateway status HTTP routing and fresh unlock after move.',
        },
        null,
        2,
      ),
    );
  }
  close() {
    return this.browser.close();
  }
}

async function serveWalletPage(route) {
  await route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Wallet relocation acceptance</title>',
  });
}

async function installOwnerSession(owner) {
  await relocationSdk.IndexedDBManager.persistFoundingWalletAuthority({
    authority: owner.authority,
    authMethod: owner.authMethod,
  });
  await relocationSdk.walletSessionAuthorizations.writeExactWithOperationCredential({
    record: owner.activeWalletSession,
    operationCredential: owner.operationCredential,
  });
  globalThis.relocationOwner = owner;
  globalThis.relocationAuthentication = {
    kind: 'authenticated',
    walletId: owner.authority.walletId,
    authMethod: 'passkey',
  };
  globalThis.relocationLocks = 0;
}

function readAuthentication() {
  return globalThis.relocationAuthentication;
}

async function lockWallet() {
  await relocationSdk.walletSessionAuthorizations.retireExactActiveForWallet({
    walletId: globalThis.relocationOwner.authority.walletId,
    reason: 'wallet_locked',
    retiredAtMs: Date.now(),
  });
  globalThis.relocationAuthentication = { kind: 'signed_out' };
  globalThis.relocationLocks += 1;
}

async function observeMove(status) {
  const placement = relocationSdk.parseWalletMoveStatus(
    status,
    status.moveId ?? status.move.moveId,
  );
  await relocationSdk.reconcileWalletPlacementSession(
    {
      readAuthentication: globalThis.readRelocationAuthentication,
      lockWallet: globalThis.lockRelocationWallet,
    },
    globalThis.relocationOwner.authority.walletId,
    placement,
  );
  return {
    state: placement.state,
    authentication: globalThis.relocationAuthentication.kind,
    lockRequests: globalThis.relocationLocks,
  };
}

async function rejectOldCredential(owner) {
  try {
    await relocationSdk.walletSessionAuthorizations.writeExactWithOperationCredential({
      record: owner.activeWalletSession,
      operationCredential: owner.operationCredential,
    });
    return false;
  } catch (error) {
    if (!error.message.includes('obsolete ownership generation')) throw error;
    return true;
  }
}
