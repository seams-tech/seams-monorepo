import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { strictWorkerSourceDigest } from '../../crates/router-ab-dev/scripts/strict-worker-source-digest.mjs';

function write(root: string, path: string, contents: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function createCrate(root: string, name: string, extra: string): void {
  write(root, `crates/${name}/Cargo.toml`, `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n${extra}`);
  write(root, `crates/${name}/src/lib.rs`, 'pub fn example() {}');
}

test('Worker freshness follows build dependencies and excludes unrelated edits', () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-freshness-'));
  try {
    createCrate(root, 'router-ab-cloudflare', '[features]\nworkers-rs = []\n[dependencies]\nshared = { path = "../shared" }\n[dev-dependencies]\nfixture = { path = "../fixture" }\n');
    createCrate(root, 'shared', '');
    createCrate(root, 'fixture', '');
    createCrate(root, 'seams-cli', '');
    write(root, 'crates/router-ab-cloudflare/scripts/build-strict-worker.sh', '# build');
    execFileSync('cargo', ['generate-lockfile', '--offline', '--manifest-path', join(root, 'crates/router-ab-cloudflare/Cargo.toml')]);
    const original = strictWorkerSourceDigest(root);
    write(root, 'apps/console/page.tsx', 'frontend edit');
    write(root, 'crates/seams-cli/src/lib.rs', 'CLI edit');
    write(root, 'crates/fixture/src/lib.rs', 'dev dependency edit');
    write(root, 'crates/shared/tests/example.rs', 'test edit');
    expect(strictWorkerSourceDigest(root)).toBe(original);

    write(root, 'crates/shared/src/lib.rs', 'pub fn changed() {}');
    const changedSource = strictWorkerSourceDigest(root);
    expect(changedSource).not.toBe(original);
    write(root, 'crates/shared/artifacts/circuit.bin', 'embedded input');
    const changedArtifact = strictWorkerSourceDigest(root);
    expect(changedArtifact).not.toBe(changedSource);
    write(root, 'crates/router-ab-cloudflare/scripts/build-strict-worker.sh', '# changed build');
    expect(strictWorkerSourceDigest(root)).not.toBe(changedArtifact);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
