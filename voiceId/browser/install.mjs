#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = 'com.seams.voiceid.prototype';
const EXTENSION_ORIGIN = 'chrome-extension://ackhkimailmgolplljlhgoclgdjcgdba/';
const ROOT = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  assert.equal(process.platform, 'darwin', 'The VoiceID prototype requires macOS.');
  const args = process.argv.slice(2);
  assert(
    args.length === 3 &&
      (args[0] === 'install' || args[0] === 'remove') &&
      args[1] === '--user-data-dir' &&
      path.isAbsolute(args[2]),
    'Usage: node install.mjs install|remove --user-data-dir /absolute/browser-user-data-directory',
  );
  const profile = await fs.realpath(args[2]);
  const directory = path.join(profile, 'NativeMessagingHosts');
  const manifestPath = path.join(directory, `${HOST}.json`);
  const launcher = path.join(directory, `${HOST}.sh`);
  if (args[0] === 'remove') {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(manifest.name, HOST);
    assert.equal(manifest.path, launcher, 'The registered host belongs to another installation.');
    assert.deepEqual(manifest.allowed_origins, [EXTENSION_ORIGIN]);
    await fs.unlink(manifestPath);
    await fs.unlink(launcher);
    process.stdout.write(
      'VoiceID browser host registration removed. Enrollment remains in the local Keychain.\n',
    );
    return;
  }
  const binary = await fs.realpath(path.join(ROOT, 'bin/voiceid-host'));
  const models = await fs.realpath(path.join(ROOT, 'native-inputs.json'));
  await fs.access(binary, fs.constants.X_OK);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const script = `#!/bin/sh\nexec ${shellArgument(binary)} browser ${shellArgument(models)} '${HOST}' "$@"\n`;
  await fs.writeFile(launcher, script, { mode: 0o700 });
  await fs.chmod(launcher, 0o700);
  const manifest = {
    name: HOST,
    description: 'Seams local VoiceID prototype',
    path: launcher,
    type: 'stdio',
    allowed_origins: [EXTENSION_ORIGIN],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `Native host: ${manifestPath}\nLoad unpacked extension: ${path.join(ROOT, 'extension')}\n`,
  );
}

function shellArgument(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

await main();
