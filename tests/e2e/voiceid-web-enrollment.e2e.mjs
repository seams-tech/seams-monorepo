#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'voiceId/engine/target/web-enrollment-journey');
const [wallet, archive] = process.argv.slice(2);
assert(wallet && archive && path.isAbsolute(wallet) && path.isAbsolute(archive));
const { chromium, expect } = createRequire(path.join(wallet, 'tests/package.json'))('@playwright/test');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "VoiceID user's web enrollment-"));
const relocated = path.join(temporary, 'Relocated VoiceID');
let browser;
let server;

try {
  const archiveName = path.basename(archive, '.tar.gz');
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', temporary]);
  await fs.rename(path.join(temporary, archiveName), relocated);
  await fs.writeFile(path.join(relocated, 'bin/voiceid-host'), fakeHost(), { mode: 0o700 });
  server = spawn(process.execPath, [path.join(relocated, 'enroll-web.mjs'), relocated], {
    cwd: temporary,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const address = await serverAddress(server);
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(address);
  await expect(page.getByRole('button', { name: 'Record sample 1' })).toBeEnabled();
  const blocked = await fetch(`${address}capture`, {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example', 'x-voiceid-action': 'enroll' },
  });
  assert.equal(blocked.status, 403);
  for (let sample = 1; sample <= 3; sample++) {
    await page.getByRole('button', { name: `Record sample ${sample}` }).click();
    if (sample < 3) {
      await expect(page.getByRole('button', { name: `Record sample ${sample + 1}` })).toBeEnabled();
    }
  }
  await expect(page.getByRole('status')).toContainText('Voice enrolled.');
  assert.equal(await fs.readFile(path.join(relocated, 'capture-events.txt'), 'utf8'), '1\n2\n3\n');
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'complete.png') });
  const report = {
    schemaVersion: 'voiceid_web_enrollment_journey_v1',
    status: 'passed',
    capture: 'controlled_host_boundary_without_microphone',
    browser: 'real_chromium',
    relocation: 'outside_checkouts_with_spaces_and_apostrophe',
    unrelatedOriginBlocked: true,
    separateRecordClicks: 3,
    nativeHostInputWrites: 3,
    audioTransferredToPage: false,
    archiveSha256: createHash('sha256').update(await fs.readFile(archive)).digest('hex'),
  };
  await fs.writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`VoiceID web enrollment journey passed: ${path.join(output, 'report.json')}\n`);
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill('SIGINT');
    await once(server, 'exit');
  }
  await fs.rm(temporary, { recursive: true, force: true });
}

async function serverAddress(child) {
  child.stdout.setEncoding('utf8');
  let pending = '';
  for await (const chunk of child.stdout) {
    pending += chunk;
    const match = /^Open (http:\/\/127\.0\.0\.1:\d+\/) to enroll your voice\./m.exec(pending);
    if (match) return match[1];
  }
  throw new Error('The relocated enrollment server did not provide an address.');
}

function fakeHost() {
  return `#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
const input = readline.createInterface({ input: process.stdin });
const lines = input[Symbol.asyncIterator]();
for (let sample = 1; sample <= 3; sample++) {
  console.log('Sample ' + sample + '/3: press Enter, then speak.');
  const next = await lines.next();
  if (next.done) throw new Error('Capture was not requested.');
  console.log('Listening…');
  await delay(200);
  fs.appendFileSync('capture-events.txt', sample + '\\n');
}
console.log('Voice enrolled. Run check to try a spoken command.');
`;
}
