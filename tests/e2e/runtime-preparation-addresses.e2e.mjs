import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const root = resolve(import.meta.dirname, '../..');
const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
await mkdir(resolve(root, '.artifacts/r155d-addresses'), { recursive: true });
const outfile = resolve(root, '.artifacts/r155d-addresses/runtime-preparation.cjs');
await build({
  stdin: {
    contents: `export { verifyRuntimePreparation } from './tests/relayer/runtime-preparation.scenario'; export { WalletRelocationRequest } from './packages/wallet-console-server-ts/src/walletPlacement/relocation';`,
    resolveDir: root,
    loader: 'ts',
  },
  loader: { '.wasm': 'binary' },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'cjs',
  outfile,
  tsconfig: resolve(root, 'packages/wallet-console-server-ts/tsconfig.json'),
  alias: {
    '@seams/wallet-server/cloud-host': resolve(candidate, 'src/cloud-host.ts'),
    '@shared': resolve(candidate, '../shared-ts/src'),
  },
  define: {
    'import.meta.url': JSON.stringify(
      pathToFileURL(resolve(root, 'tests/relayer/runtime-preparation.scenario.ts')).href,
    ),
  },
});
const api = createRequire(import.meta.url)(outfile);
const topology = new Miniflare({
  modules: true,
  script: 'export default {fetch(){ return new Response(null); }}',
  d1Databases: { DB: 'address-runtime' },
});
try {
  const database = await topology.getD1Database('DB');
  const move = api.WalletRelocationRequest.parse({
    wallet: {
      namespace: 'shared',
      organizationId: 'owner',
      projectId: 'project',
      environmentId: 'test',
      walletId: 'traveller',
    },
    destination: {
      region: 'OC',
      accountId: '0123456789abcdef0123456789abcdef',
      databaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    },
    expectedGeneration: 1,
    moveId: `wmove_${'m'.repeat(43)}`,
    authorityId: 'wallet-authority:traveller',
  });
  const result = await api.verifyRuntimePreparation(database, move);
  await writeFile(
    resolve(root, '.artifacts/r155d-addresses/runtime-preparation.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await topology.dispose();
}
