import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

export async function restartLocalRoleWorkers(root) {
  const before = await readReadyReceipt(root);
  process.kill(before.supervisorPid, 'SIGUSR2');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await setTimeout(100);
    const after = await readReadyReceipt(root);
    if (after.generation === before.generation) continue;
    assert.equal(after.supervisorPid, before.supervisorPid);
    assert.equal(after.generation, before.generation + 1);
    assert.deepEqual(after.workers.map(workerRole).sort(), before.workers.map(workerRole).sort());
    const oldPids = new Set(before.workers.map(workerPid));
    for (const worker of after.workers) assert.ok(!oldPids.has(worker.pid));
    return { before, after };
  }
  throw new Error('Local role Workers did not publish their restart receipt');
}

async function readReadyReceipt(root) {
  const receipt = JSON.parse(await readFile(join(root, '.runtime/role-workers.ready'), 'utf8'));
  assert.equal(receipt.root, root);
  assert.ok(Number.isSafeInteger(receipt.supervisorPid) && receipt.supervisorPid > 0);
  assert.ok(Number.isSafeInteger(receipt.generation) && receipt.generation > 0);
  assert.deepEqual(receipt.workers.map(workerRole).sort(), [
    'deriver-a',
    'deriver-b',
    'router',
    'signing-worker',
    'tenant-root-control-plane',
  ]);
  for (const worker of receipt.workers)
    assert.ok(Number.isSafeInteger(worker.pid) && worker.pid > 0);
  return receipt;
}

function workerRole(worker) {
  return worker.role;
}

function workerPid(worker) {
  return worker.pid;
}
