import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRelocationDirectoryRuntime } from '../helpers/relocation-directory-runtime.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRelocationCustodyWorkers } from '../helpers/relocation-custody-workers.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = resolve(candidate, '../..');
const output = resolve(import.meta.dirname, '../../.artifacts/r155b/composed-relocation');
const custody = await createRelocationCustodyWorkers(publicRoot);
try {
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, 'custody-topology.json'),
    JSON.stringify(
      {
        scope:
          'Real Cloudflare Rust Workers with separate regional wallet object namespaces and SigningWorker D1. Shared tenant-root authority. Source NEAR registration completed. No directory-coordinated relocation or destination signing yet.',
        objects: custody.objects,
        registrationReceiptSha256: createHash('sha256')
          .update(JSON.stringify(custody.registration.publicReceipt))
          .digest('hex'),
        sourceRegistrationCompleted: true,
        directoryCoordinatorConnected: false,
        destinationSigningVerified: false,
      },
      null,
      2,
    ),
  );
  await verifyCoordinatorBindings(custody);
  console.log(`Relocation custody topology passed: ${output}`);
} finally {
  await custody.topology.dispose();
}

async function verifyCoordinatorBindings(custody) {
  const context = await createRelocationDirectoryRuntime({
    root: resolve(import.meta.dirname, '../..'),
    candidate,
    custody,
    output,
  });
  try {
    const { api, database, catalog, wallet, bindings } = context;
    const now = Date.now();
    const directory = new api.D1WalletHomeDirectory(database, catalog);
    const registrationId = `wreg_${randomBytes(32).toString('base64url')}`;
    const requestDigest = createHash('sha256').update(registrationId).digest('hex');
    const reservation = await directory.reserve({
      allocation: 'provided',
      wallet,
      proposedHome: catalog.select('WEUR'),
      registrationId,
      deploymentLane: 'test',
      requestDigest,
      proposedRegistrationAllocation: api.RegistrationSetupAllocation.parse({
        ceremonyId: `wrc_${randomBytes(32).toString('base64url')}`,
        preparationId: 'regprep_composed',
        walletAuthorityId: 'wallet-authority:composed',
        deviceId: 'device:composed',
        walletAuthMethodId: 'wallet-auth-method:composed',
      }),
      nowMs: now,
    });
    assert.equal(reservation.ok, true);
    await directory.complete({
      wallet,
      home: catalog.select('WEUR'),
      registrationId,
      requestDigest,
      outcome: 'established',
      nowMs: now + 1,
    });
    const move = api.WalletRelocationRequest.parse({
      wallet,
      moveId: `wmove_${randomBytes(32).toString('base64url')}`,
      destination: catalog.select('APAC'),
      expectedGeneration: 1,
      authorityId: 'wallet-authority:composed',
    });
    const verifications = [
      api.relocationResourceVerification(catalog.select('WEUR'), wallet.namespace, now),
      api.relocationResourceVerification(catalog.select('APAC'), wallet.namespace, now),
    ];
    const journal = new api.D1WalletRelocations(database, catalog);
    const admission = await journal.admit(move, verifications, 'test', bindings, Date.now);
    assert.deepEqual(admission, { ok: false, code: 'owner_approval_required' });
    const response = await bindings.runtimes.WEUR.fetch(
      new Request(
        'https://wallet-runtime.internal/internal/wallet-runtime/v1/relocation/router-freeze',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet,
            attempt: {
              wallet,
              moveId: move.moveId,
              phase: 'freezing',
              id: `wattempt_${randomBytes(32).toString('base64url')}`,
              revision: 1,
              run: 1,
              number: 1,
              startedAtMs: now,
            },
          }),
        },
      ),
    );
    assert.equal(response.status, 409, await response.clone().text());
    assert.equal(bindings.runtimes.WEUR.env.MPC_ROUTER.calls, 0);
    assert.ok(context.directory.requests.some(isSourceAdmission));
    await writeFile(
      resolve(output, 'coordinator-bindings.json'),
      JSON.stringify(
        {
          realDirectoryAndRuntimeHandlers: true,
          unapprovedMoveRejected: true,
          unadmittedSourceCommandStatus: response.status,
          custodyCallsBeforeAdmission: bindings.runtimes.WEUR.env.MPC_ROUTER.calls,
          directoryPaths: context.directory.requests,
          scope:
            'Real journal, Gateway approval reader, Runtime admission and native custody bindings. Owner approval and successful move remain to implement in this scenario.',
        },
        null,
        2,
      ),
    );
  } finally {
    await context.storage.dispose();
  }
}

function isSourceAdmission(path) {
  return path.endsWith('/relocation-runtime-source');
}
