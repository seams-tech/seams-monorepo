#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const revision = '90b43017241f81189453d326d05948f388b34652';
const expectedPatchHash = '6c42d06498ffdc42cef489aaef17dee52a0dbe67c543cc0bd30b035122e3f4a0';
const privateVersion = 'celld 0.6.2-seams.1';
const patchPath = fileURLToPath(new URL('./cross-script-objects.patch', import.meta.url));

function capture(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, RUST_LOG: 'error' },
  }).trim();
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function main() {
  const [upstreamArgument, outputArgument, profile = 'release', ...extra] = process.argv.slice(2);
  if (
    !upstreamArgument ||
    !outputArgument ||
    extra.length ||
    !['dev', 'release'].includes(profile)
  ) {
    throw new Error(
      'Usage: node deployment/celld/build.mjs <upstream-checkout> <new-output-directory> [dev|release]',
    );
  }
  const upstream = resolve(upstreamArgument);
  const output = resolve(outputArgument);
  const source = join(output, 'source');
  const patchHash = sha256(patchPath);
  if (patchHash !== expectedPatchHash)
    throw new Error('Patch hash differs from the reviewed patch');
  const sourceRevision = capture('git', ['rev-parse', `${revision}^{commit}`], upstream);
  if (sourceRevision !== revision)
    throw new Error('Upstream source revision differs from the pinned revision');
  const rustc = capture('rustc', ['--version'], upstream);
  const cargo = capture('cargo', ['--version'], upstream);

  // Extract committed source so edits in the supplied checkout cannot enter the build.
  mkdirSync(output);
  mkdirSync(source);
  const archive = join(output, 'upstream.tar');
  run('git', ['archive', '--format=tar', `--output=${archive}`, revision], upstream);
  run('tar', ['-xf', archive, '-C', source], output);
  run('git', ['apply', '--check', patchPath], source);
  run('git', ['apply', patchPath], source);
  const buildArgs = ['build', '--locked', '-p', 'celld', '--bin', 'celld'];
  if (profile === 'release') buildArgs.push('--release');
  run('cargo', buildArgs, source);

  const target = process.env.CARGO_TARGET_DIR
    ? resolve(source, process.env.CARGO_TARGET_DIR)
    : join(source, 'target');
  const executable = join(output, 'celld');
  copyFileSync(join(target, profile === 'dev' ? 'debug' : 'release', 'celld'), executable);
  const version = capture(executable, ['--version'], output);
  const expectedVersion = profile === 'dev' ? `${privateVersion} (debug)` : privateVersion;
  if (version !== expectedVersion) throw new Error(`Unexpected runtime version: ${version}`);
  const evidence = {
    sourceRevision,
    patchSha256: patchHash,
    sourceArchiveSha256: sha256(archive),
    executableSha256: sha256(executable),
    version,
    profile,
    platform: process.platform,
    architecture: process.arch,
    rustc,
    cargo,
    buildCommand: ['cargo', ...buildArgs],
  };
  writeFileSync(join(output, 'runtime-build.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Built ${version}: ${executable}`);
  console.log('Run the binding acceptance test before using this candidate.');
}

main();
