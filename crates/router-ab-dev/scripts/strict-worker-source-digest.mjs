import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

export function strictWorkerSourceDigest(repoRoot) {
  const workerRoot = join(repoRoot, 'crates/router-ab-cloudflare');
  const metadata = JSON.parse(execFileSync('cargo', [
    'metadata', '--format-version', '1', '--locked', '--offline',
    '--manifest-path', join(workerRoot, 'Cargo.toml'),
    '--filter-platform', 'wasm32-unknown-unknown', '--features', 'workers-rs',
  ], { cwd: workerRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  const dependencies = new Set();
  const pending = [metadata.resolve.root];
  while (pending.length > 0) {
    const id = pending.pop();
    if (dependencies.has(id)) continue;
    dependencies.add(id);
    for (const dependency of nodes.get(id).deps) {
      if (dependency.dep_kinds.some(kind => kind.kind !== 'dev')) {
        pending.push(dependency.pkg);
      }
    }
  }

  const inputs = new Set([
    join(workerRoot, 'Cargo.lock'),
    join(workerRoot, 'scripts/build-strict-worker.sh'),
  ]);
  for (const pkg of metadata.packages) {
    if (pkg.source !== null || !dependencies.has(pkg.id)) continue;
    const root = dirname(pkg.manifest_path);
    inputs.add(pkg.manifest_path);
    collectFiles(join(root, 'src'), inputs);
    // The Yao protocol embeds circuit schedules directly into the Workers.
    collectFiles(join(root, 'artifacts'), inputs);
    for (const target of pkg.targets) {
      if (target.kind.includes('custom-build')) inputs.add(target.src_path);
    }
    addCargoConfig(root, inputs);
  }
  addCargoConfig(repoRoot, inputs);
  for (const name of ['rust-toolchain', 'rust-toolchain.toml']) {
    const path = join(repoRoot, name);
    if (existsSync(path)) inputs.add(path);
  }
  const digest = createHash('sha256');
  for (const path of [...inputs].sort()) {
    digest.update(relative(repoRoot, path));
    digest.update('\0');
    digest.update(readFileSync(path));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function collectFiles(root, inputs) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) collectFiles(path, inputs);
    else if (entry.isFile()) inputs.add(path);
  }
}

function addCargoConfig(root, inputs) {
  for (const name of ['config', 'config.toml']) {
    const path = join(root, '.cargo', name);
    if (existsSync(path)) inputs.add(path);
  }
}
