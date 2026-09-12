import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

for (const mode of ['stale', 'fresh', 'cancel', 'still-stale', 'forbidden', 'changed-set'] as const) {
test(`recovery artifact download: ${mode}`, async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: `import { downloadRecoveryArtifact } from './apps/wallet-console/src/products/wallet/derivation-root/consoleDerivationRootApi'; window.downloadArtifact = downloadRecoveryArtifact;`,
      resolveDir: root,
    },
    bundle: true, write: false, format: 'iife',
    alias: { '@core/dashboard/consoleHttp': path.join(root, 'apps/wallet-console/src/core/dashboard/consoleHttp.ts') },
    plugins: [{
      name: 'console-http',
      setup(builder) {
        builder.onResolve({ filter: /^@core\/runtime$/ }, () => ({ path: 'runtime', namespace: 'stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
          export const getActiveFrontendDeployment = () => ({ consoleBaseUrl: 'http://localhost:4004' });
        ` }));
      },
    }],
  });
  let verified = mode === 'fresh' || mode === 'changed-set';
  const requests: string[] = [];
  await page.route('**/console/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    requests.push(pathname);
    if (pathname.endsWith('/options')) {
      await route.fulfill({ json: { ok: true, options: '{}' } });
    } else if (pathname.endsWith('/verify')) {
      verified = true;
      await route.fulfill({ json: { ok: true } });
    } else if (mode === 'forbidden') {
      await route.fulfill({ status: 403, json: { ok: false, code: 'forbidden' } });
    } else {
      await route.fulfill(verified && mode !== 'still-stale'
        ? { json: { ok: true, artifactB64u: 'AQID', contentDigestB64u: 'digest', recoverySetId: mode === 'changed-set' ? 'new-set' : 'set' } }
        : { status: 403, json: { ok: false, code: 'step_up_required', error: { kind: 'stale' } } });
    }
  });
  await page.goto('http://localhost:4004');
  await page.evaluate(`window.cancelPasskey = ${mode === 'cancel'}`);
  await page.evaluate(`
    window.passkeyPrompts = 0;
    window.PublicKeyCredential = class {
      id = 'credential';
      static parseRequestOptionsFromJSON(value) { return value; }
      toJSON() { return {}; }
    };
    Object.defineProperty(navigator, 'credentials', { value: {
      async get() { window.passkeyPrompts++; return window.cancelPasskey ? null : new PublicKeyCredential(); }
    }});
  `);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(`(async () => {
    try {
    const a = await window.downloadArtifact({ artifact: 'deriver_a_package', environmentKey: 'dev', recoverySetId: 'set' });
    await window.downloadArtifact({ artifact: 'deriver_b_package', environmentKey: 'dev', recoverySetId: 'set' });
    return { bytes: Array.from(a.bytes) };
    } catch (error) { return { error: error.message }; }
  })()`);
  if (mode === 'stale' || mode === 'fresh') {
    expect(result).toEqual({ bytes: [1, 2, 3] });
  } else {
    expect(result.error).toMatch(mode === 'cancel' ? /cancelled/ : mode === 'changed-set' ? /changed during download/ : /403/);
  }
  const expectedPrompts = ['stale', 'cancel', 'still-stale'].includes(mode) ? 1 : 0;
  expect(await page.evaluate('window.passkeyPrompts')).toBe(expectedPrompts);
  const packageRequests = requests.filter(request => request.endsWith('/package'));
  expect(packageRequests).toHaveLength(mode === 'stale' ? 3 : mode === 'fresh' || mode === 'still-stale' ? 2 : 1);
});
}
