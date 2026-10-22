#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = 'com.seams.voiceid.prototype';
const EXTENSION_ID = 'ackhkimailmgolplljlhgoclgdjcgdba';
const ROOT = path.dirname(fileURLToPath(import.meta.url));

function shellArgument(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function install() {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args[0] !== '--models' ||
    args[2] !== '--profile' ||
    !path.isAbsolute(args[1]) ||
    !path.isAbsolute(args[3])
  ) {
    throw new Error(
      'Usage: node install.mjs --models /absolute/native-inputs.json --profile /absolute/Chrome-profile',
    );
  }
  if (process.platform !== 'darwin') throw new Error('The VoiceID prototype requires macOS.');
  const models = await fs.realpath(args[1]);
  const binary = await fs.realpath(path.join(ROOT, '../engine/target/release/voiceid-host'));
  const profile = args[3];
  const hostDirectory = path.join(profile, 'NativeMessagingHosts');
  const installation = path.join(ROOT, '../engine/target/browser-host');
  await fs.mkdir(hostDirectory, { recursive: true, mode: 0o700 });
  await fs.mkdir(installation, { recursive: true, mode: 0o700 });
  const launcher = path.join(installation, 'voiceid-browser-host');
  const script = `#!/bin/sh\nexec ${shellArgument(binary)} browser ${shellArgument(models)} '${HOST}' "$@"\n`;
  await fs.writeFile(launcher, script, { mode: 0o700 });
  await fs.chmod(launcher, 0o700);
  const manifest = {
    name: HOST,
    description: 'Seams local VoiceID prototype',
    path: launcher,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  };
  const manifestPath = path.join(hostDirectory, `${HOST}.json`);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `Native host: ${manifestPath}\nLoad unpacked extension: ${path.join(ROOT, 'extension')}\n`,
  );
}

await install();
