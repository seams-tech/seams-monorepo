import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Freeze the approved SDK preview for marketing use without a prerelease SDK dependency.
if (!process.argv[2]) throw new Error('Pass the absolute path to the built wallet repository.');
const walletRoot = resolve(process.argv[2]);
const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(siteRoot, 'src/public/transaction-mocks');
const require = createRequire(resolve(walletRoot, 'package.json'));
const { build } = require('esbuild');
const entry = resolve(walletRoot, 'tests/browser-app/receipt-preview.js');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: walletRoot, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: walletRoot, encoding: 'utf8' }).trim().length > 0;
await mkdir(output, { recursive: true });
await build({
  stdin: {
    contents: `${await readFile(entry, 'utf8')}
const requestedExample = new URLSearchParams(location.search).get('example');
if (['transfer', 'evm', 'near'].includes(requestedExample)) {
  document.querySelector('[data-example="' + requestedExample + '"]').click();
}
if (new URLSearchParams(location.search).get('theme') === 'dark') toggleTheme();
const requestedStage = new URLSearchParams(location.search).get('stage');
if (['signing', 'broadcasting', 'confirmed'].includes(requestedStage)) showStage(requestedStage);
`,
    resolveDir: dirname(entry),
    sourcefile: 'transaction-mock.js',
  },
  bundle: true,
  format: 'iife',
  minify: true,
  outfile: resolve(output, 'mock.js'),
  banner: { js: `/* UI-only snapshot of seams-wallet ${revision}${dirty ? ' + working-tree changes' : ''}. Simulated transactions only. */` },
});
const html = (await readFile(resolve(dirname(entry), 'receipt-preview.html'), 'utf8'))
  .replace('/packages/wallet/dist/esm/sdk/wallet-ui.css', './wallet-ui.css')
  .replace('./receipt-preview.js', './mock.js')
  .replace('<script type="module"', '<script defer')
  .replace('Transaction component · SDK preview', 'Transaction demo')
  .replace('<meta charset="utf-8" />', `<meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'" />`);
await writeFile(resolve(output, 'index.html'), html);
await copyFile(resolve(walletRoot, 'packages/wallet/dist/esm/sdk/wallet-ui.css'), resolve(output, 'wallet-ui.css'));
console.log(`Saved transaction mocks from ${revision}`);
