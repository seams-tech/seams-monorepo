#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'repository-split.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function parseArguments(argv) {
  const options = { output: '', sourceRevision: 'HEAD' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output') {
      options.output = path.resolve(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (argument === '--source-revision') {
      options.sourceRevision = argv[index + 1] || '';
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.output || !options.sourceRevision) {
    throw new Error(
      'Usage: extract-repositories.mjs --output <empty-directory> [--source-revision <commit>]',
    );
  }
  return options;
}

function gitOutput(argumentsList) {
  return execFileSync('git', argumentsList, {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function resolveExtractionSource(requestedRevision) {
  const sourceRevision = gitOutput(['rev-parse', '--verify', `${requestedRevision}^{commit}`]);
  const headRevision = gitOutput(['rev-parse', 'HEAD']);
  if (sourceRevision !== headRevision) {
    throw new Error('The extraction source must be the currently checked-out commit');
  }
  if (gitOutput(['status', '--porcelain', '--untracked-files=normal'])) {
    throw new Error('Commit or remove working-tree changes before repository extraction');
  }
  return sourceRevision;
}

function isPathWithin(relativePath, parentPath) {
  return relativePath === parentPath || relativePath.startsWith(`${parentPath}/`);
}

function listRepositoryFiles(sourcePaths, excludedPaths) {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--', ...sourcePaths], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return output
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) =>
      excludedPaths.every((excludedPath) => !isPathWithin(relativePath, excludedPath)),
    )
    .sort();
}

function copyRepositoryFiles(files, destination) {
  for (const relativePath of files) {
    const sourcePath = path.join(repoRoot, relativePath);
    const destinationPath = path.join(destination, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    const sourceStat = fs.lstatSync(sourcePath);
    if (sourceStat.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(sourcePath), destinationPath);
      continue;
    }
    fs.copyFileSync(sourcePath, destinationPath);
    fs.chmodSync(destinationPath, sourceStat.mode);
  }
}

function packageManagerVersion() {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  return rootPackage.packageManager;
}

function publicRootPackage() {
  return {
    name: 'seams-wallet',
    private: true,
    type: 'module',
    packageManager: packageManagerVersion(),
    scripts: {
      'build:wasm': 'pnpm -C packages/wallet build:wasm',
      'build:workers':
        'pnpm -C crates/router-ab-cloudflare build:signing-worker && pnpm -C crates/router-ab-cloudflare build:deriver-a && pnpm -C crates/router-ab-cloudflare build:deriver-b && pnpm -C crates/router-ab-cloudflare build:router && pnpm -C crates/router-ab-cloudflare build:tenant-root-control-plane',
      'build:packages':
        'pnpm -C packages/wallet-server build && pnpm -C packages/wallet-server package:cloudflare-runtime && pnpm -C packages/wallet build:sdk',
      build: 'pnpm run build:wasm && pnpm run build:workers && pnpm run build:packages',
      'build:docs': 'VITE_DOCS_BASE_PATH=/docs/ pnpm -C apps/docs build',
      'build:example': 'pnpm -C examples/seams-auth-menu build',
      'build:test-app': 'pnpm -C tests/intended-app build',
      'build:self-host':
        'pnpm -C examples/self-host-cloudflare-worker exec wrangler deploy --dry-run',
      'check:packed-wallet':
        'pnpm license:notices && node ./tests/scripts/check-packed-wallet-boundaries.mjs',
      'license:notices': 'node ./scripts/generate-wallet-third-party-notices.mjs',
      'router:deploy:dry-run':
        'node ./crates/router-ab-cloudflare/scripts/measure-startup-latencies.mjs --dry-run',
      'wallet-system:local': 'pnpm -C crates/router-ab-cloudflare dev:local-wallet-system',
      'test:intended': 'pnpm -C tests test:intended',
      'test:wallet-browser': 'pnpm -C tests test:wallet-browser',
      'type-check':
        'pnpm -C packages/wallet-server type-check && pnpm -C packages/wallet type-check && pnpm -C apps/docs type-check && pnpm -C tests/intended-app type-check && pnpm -C tests type-check:intended && pnpm -C tests type-check:wallet-state',
    },
  };
}

function publicTestPackage() {
  return {
    name: '@seams-wallet/tests',
    private: true,
    type: 'module',
    scripts: {
      'type-check:intended': 'tsc -p tsconfig.wallet-intended.json',
      'type-check:wallet-state': 'tsc -p tsconfig.wallet-typecheck.json',
      'test:intended':
        'pnpm run type-check:intended && node scripts/run-wallet-intended-isolated.mjs',
      'test:intended:representative':
        'pnpm run type-check:intended && node scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.registration.contract.test.ts',
      'test:intended:list': 'node scripts/run-wallet-intended-isolated.mjs --list-cases',
      'test:wallet-browser': 'playwright test -c playwright.wallet-browser.config.ts',
      'test:wallet-browser:representative':
        'playwright test -c playwright.wallet-browser.config.ts wallet-iframe/router.connectionClosed.test.ts lit-components/export-iframe-host.surface.test.ts',
      'test:wallet-unit':
        'playwright test -c playwright.wallet-browser.config.ts unit',
      'test:wallet-unit:representative':
        'playwright test -c playwright.wallet-browser.config.ts unit/configs.appearance.test.ts unit/domainIds.boundary.unit.test.ts unit/committedSignerPackages.unit.test.ts unit/authorizationOperationFingerprint.unit.test.ts',
    },
    devDependencies: {
      '@noble/ed25519': '^2.1.0',
      '@playwright/test': '^1.40.0',
      '@types/node': '^24.1.0',
      typescript: '^5.8.3',
      viem: '^2.38.6',
      vite: '^8.0.0',
    },
  };
}

function workspaceManifest(workspacePackages) {
  const lines = ['packages:'];
  for (const workspacePackage of workspacePackages) lines.push(`  - ${workspacePackage}`);
  lines.push(
    'nodeLinker: hoisted',
    'verifyDepsBeforeRun: false',
    'allowBuilds:',
    '  bufferutil: true',
    '  esbuild: true',
    '  sharp: true',
    '  utf-8-validate: true',
    '  workerd: true',
    '',
  );
  return lines.join('\n');
}

function repositoryReadme() {
  return [
    '# Seams Wallet',
    '',
    'Open-source browser and server Wallet SDKs, signer runtimes, Rust/Wasm',
    'implementation crates, documentation, examples, and recovery CLI.',
    '',
    'Published packages:',
    '',
    '- `@seams/wallet`',
    '- `@seams/wallet-server`',
    '- `@seams/wallet-cli`',
    '',
    'The TypeScript packages are MIT licensed. Rust crates and the recovery CLI',
    'are Apache-2.0 licensed. See `LICENSE-MIT` and `LICENSE-APACHE`.',
    '',
    'The hosted Seams Console, product sites, and deployment configuration live',
    'in the private `seams-tech/seams-monorepo` repository.',
    '',
    'After building the Worker artifacts, run the Console-free local Wallet backend with',
    '`pnpm wallet-system:local`. It starts the five isolated Router roles, bootstraps a',
    'local tenant root, migrates signer D1, and serves the Wallet Gateway at',
    '`http://127.0.0.1:4100`.',
    '',
  ].join('\n');
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeRootFiles(repository, destination, sourceRevision) {
  writeJson(path.join(destination, 'package.json'), publicRootPackage());
  fs.writeFileSync(
    path.join(destination, 'pnpm-workspace.yaml'),
    workspaceManifest(repository.workspacePackages),
  );
  fs.writeFileSync(path.join(destination, 'README.md'), repositoryReadme());
  fs.writeFileSync(path.join(destination, 'EXTRACTION_SOURCE'), `${sourceRevision}\n`);
  fs.copyFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), path.join(destination, 'pnpm-lock.yaml'));
  writeJson(path.join(destination, 'tests', 'package.json'), publicTestPackage());
}

function writeRepositoryLockfile(destination) {
  execFileSync(
    'pnpm',
    [
      'install',
      '--lockfile-only',
      '--ignore-scripts',
      '--no-frozen-lockfile',
      '--offline',
      '--trust-lockfile',
    ],
    {
      cwd: destination,
      stdio: 'inherit',
    },
  );
}

function assertDestinationIsNew(destination) {
  if (fs.existsSync(destination)) {
    throw new Error(`Refusing to overwrite existing extraction destination: ${destination}`);
  }
}

function materializeRepository(repositoryName, repository, outputRoot, sourceRevision) {
  const destination = path.join(outputRoot, repositoryName);
  assertDestinationIsNew(destination);
  fs.mkdirSync(destination, { recursive: true });
  const files = listRepositoryFiles(
    [...manifest.commonPaths, ...repository.sourcePaths],
    repository.excludePaths,
  );
  copyRepositoryFiles(files, destination);
  writeRootFiles(repository, destination, sourceRevision);
  writeRepositoryLockfile(destination);
  return { destination, fileCount: files.length };
}

const options = parseArguments(process.argv.slice(2));
const sourceRevision = resolveExtractionSource(options.sourceRevision);
if (fs.existsSync(options.output) && fs.readdirSync(options.output).length > 0) {
  throw new Error(`Extraction output must be empty: ${options.output}`);
}
fs.mkdirSync(options.output, { recursive: true });

for (const [repositoryName, repository] of Object.entries(manifest.repositories)) {
  const result = materializeRepository(repositoryName, repository, options.output, sourceRevision);
  console.log(`[repository-split] ${repositoryName}: ${result.fileCount} files`);
  console.log(`[repository-split] path: ${result.destination}`);
}
