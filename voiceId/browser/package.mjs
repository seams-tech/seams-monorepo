#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(ROOT, '../engine');

async function main() {
  assert(
    process.platform === 'darwin' && process.arch === 'arm64',
    'Build on Apple Silicon macOS.',
  );
  const args = process.argv.slice(2);
  assert(
    args.length === 4 && args[0] === '--models' && args[2] === '--output',
    'Usage: node package.mjs --models /absolute/native-inputs.json --output /absolute/new-directory',
  );
  assert(path.isAbsolute(args[1]) && path.isAbsolute(args[3]), 'Use absolute paths.');
  await fs.access(path.join(process.cwd(), 'wasm/near_signer/Cargo.toml'));
  const inputPath = await fs.realpath(args[1]);
  const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  assert.equal(input.schemaVersion, 'voiceid_native_journey_input_v1');
  assert(Number.isFinite(input.speakerAcceptSimilarity));
  assert(Number.isSafeInteger(input.speakerMinimumSamples) && input.speakerMinimumSamples > 0);
  assert(Number.isFinite(input.speakerMinimumRms) && input.speakerMinimumRms > 0);
  const source = path.dirname(inputPath);
  const output = args[3];
  const metadata = JSON.parse(
    execFileSync(
      'cargo',
      [
        'metadata',
        '--offline',
        '--locked',
        '--format-version',
        '1',
        '--filter-platform',
        'aarch64-apple-darwin',
        '--manifest-path',
        path.join(ENGINE, 'Cargo.toml'),
      ],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    ),
  );
  await fs.mkdir(output, { mode: 0o700 });
  const moonshineLibrary = await copyLibrary(
    output,
    source,
    input.moonshineLibrary,
    'lib/libmoonshine.dylib',
  );
  const onnxRuntimeLibrary = await copyLibrary(
    output,
    source,
    input.onnxRuntimeLibrary,
    'lib/libonnxruntime.1.23.2.dylib',
  );
  const speakerModel = await copyLibrary(output, source, input.speakerModel, 'models/ecapa.onnx');
  const manifest = JSON.parse(
    await fs.readFile(path.resolve(ROOT, '../verifier-spike/model-manifest.json'), 'utf8'),
  );
  const tiny = manifest.artifacts.find(isTiny);
  assert(tiny, 'The pinned Tiny model is missing.');
  for (const file of tiny.files) {
    const relative = safeRelative(path.posix.join(tiny.relativePath, safeRelative(file.path)));
    const bytes = await verifiedBytes(
      path.resolve(source, input.modelDirectory, relative),
      file.sha256,
    );
    assert.equal(bytes.length, file.bytes);
    await write(output, path.posix.join('models', relative), bytes);
  }
  const runtime = {
    schemaVersion: input.schemaVersion,
    modelDirectory: 'models',
    moonshineLibrary,
    onnxRuntimeLibrary,
    speakerModel,
    speakerAcceptSimilarity: input.speakerAcceptSimilarity,
    speakerMinimumSamples: input.speakerMinimumSamples,
    speakerMinimumRms: input.speakerMinimumRms,
  };
  await write(output, 'native-inputs.json', `${JSON.stringify(runtime, null, 2)}\n`);
  await copy(output, 'bin/voiceid-host', path.join(ENGINE, 'target/release/voiceid-host'));
  await fs.chmod(path.join(output, 'bin/voiceid-host'), 0o700);
  await copy(
    output,
    'lib/libvoiceid_engine.dylib',
    path.join(ENGINE, 'target/release/libvoiceid_engine.dylib'),
  );
  const library = path.join(output, 'lib/libvoiceid_engine.dylib');
  execFileSync('/usr/bin/install_name_tool', ['-id', '@rpath/libvoiceid_engine.dylib', library]);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', library], { stdio: 'pipe' });
  await copy(output, 'include/voiceid.h', path.join(ENGINE, 'include/voiceid.h'));
  for (const file of [
    'install.mjs',
    'enroll-web.mjs',
    'enroll-web.html',
    'SETUP.txt',
    'extension/manifest.json',
    'extension/bridge.js',
  ]) {
    await copy(output, file, path.join(ROOT, file));
  }
  const sitePackages = path.resolve(source, path.dirname(input.moonshineLibrary.path), '..');
  await copy(
    output,
    'licenses/Moonshine-LICENSE.txt',
    path.join(sitePackages, 'moonshine_voice-0.1.5.dist-info/licenses/LICENSE'),
  );
  await copy(
    output,
    'licenses/ONNX-Runtime-LICENSE.txt',
    path.join(sitePackages, 'onnxruntime/LICENSE'),
  );
  await copy(
    output,
    'licenses/ONNX-Runtime-ThirdPartyNotices.txt',
    path.join(sitePackages, 'onnxruntime/ThirdPartyNotices.txt'),
  );
  await copy(output, 'licenses/ECAPA-Apache-2.0.txt', path.join(ROOT, 'licenses/Apache-2.0.txt'));
  await rustNotices(output, metadata);
  const archive = `${output}.tar.gz`;
  const reserved = await fs.open(archive, 'wx', 0o600);
  await reserved.close();
  execFileSync(
    '/usr/bin/tar',
    ['-czf', archive, '-C', path.dirname(output), path.basename(output)],
    { env: { ...process.env, COPYFILE_DISABLE: '1' } },
  );
  const archiveSha256 = digest(await fs.readFile(archive));
  await fs.writeFile(`${archive}.sha256`, `${archiveSha256}  ${path.basename(archive)}\n`, {
    flag: 'wx',
  });
  process.stdout.write(
    `${JSON.stringify({ output, archive, archiveSha256, nativeHostSha256: digest(await fs.readFile(path.join(output, 'bin/voiceid-host'))), runtimeMetadataKeys: Object.keys(runtime) })}\n`,
  );
}

function isTiny(artifact) {
  return artifact.id === 'moonshine-streaming-tiny-native-quantized';
}
function safeRelative(value) {
  assert(typeof value === 'string' && value.length > 0 && !path.posix.isAbsolute(value));
  assert(value.split('/').every(isNormalComponent), 'Asset paths must stay inside the package.');
  return value;
}
function isNormalComponent(value) {
  return value !== '' && value !== '.' && value !== '..';
}
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
async function verifiedBytes(file, expected) {
  const stat = await fs.lstat(file);
  assert(
    stat.isFile() && stat.size > 0 && stat.size <= 128 * 1024 * 1024,
    'Expected a bounded regular model file.',
  );
  const bytes = await fs.readFile(file);
  assert.equal(digest(bytes), expected, `Artifact checksum failed: ${path.basename(file)}`);
  return bytes;
}
async function copyLibrary(output, source, input, relative) {
  assert(
    input &&
      typeof input.path === 'string' &&
      Array.isArray(input.sha256) &&
      input.sha256.length === 32,
  );
  for (const byte of input.sha256) assert(Number.isInteger(byte) && byte >= 0 && byte <= 255);
  const bytes = await verifiedBytes(
    path.resolve(source, input.path),
    Buffer.from(input.sha256).toString('hex'),
  );
  await write(output, relative, bytes);
  return { path: relative, sha256: input.sha256 };
}
async function write(output, relative, bytes) {
  const file = path.join(output, safeRelative(relative));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes, { mode: 0o600 });
}
async function copy(output, relative, source) {
  await write(output, relative, await fs.readFile(source));
}
function packageId(node) {
  return node.id;
}
function isNotice(file) {
  return /^(licen[sc]e|notice|copying)([._-]|$)/i.test(file);
}

async function rustNotices(output, metadata) {
  const used = new Set(metadata.resolve.nodes.map(packageId));
  const notices = [
    'Seams VoiceID: proprietary internal prototype. No distribution permission is granted.',
    'Moonshine Tiny Streaming: MIT. https://github.com/moonshine-ai/moonshine/tree/v0.1.5',
    'ONNX Runtime 1.23.2: MIT. https://github.com/microsoft/onnxruntime/tree/v1.23.2',
    'SpeechBrain ECAPA VoxCeleb model and export: Apache-2.0.',
    'https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb/tree/0f99f2d0ebe89ac095bcc5903c4dd8f72b367286',
    '',
    'Rust dependencies:',
  ];
  for (const dependency of metadata.packages) {
    if (!used.has(dependency.id) || dependency.name === 'voiceid-engine') continue;
    assert(dependency.license, `Missing dependency license: ${dependency.name}`);
    notices.push(
      `${dependency.name} ${dependency.version}: ${dependency.license}. ${dependency.repository || dependency.source || ''}`,
    );
    let directory = path.dirname(dependency.manifest_path);
    let files = (await fs.readdir(directory)).filter(isNotice);
    if (files.length === 0) {
      directory = path.join(ROOT, 'licenses/rust', `${dependency.name}-${dependency.version}`);
      files = await fs.readdir(directory);
    }
    for (const file of files) {
      await copy(
        output,
        `licenses/rust/${dependency.name}-${dependency.version}/${file}`,
        path.join(directory, file),
      );
    }
  }
  await write(output, 'NOTICE.txt', `${notices.join('\n')}\n`);
}

await main();
