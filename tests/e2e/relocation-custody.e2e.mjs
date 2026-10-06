import { createRelocationBrowserSession } from '../helpers/relocation-browser-session.mjs';
import {
  prepareSigningBeforeMove,
  finalizeWhileMoveWaits,
  verifySigningReplayAfterMove,
} from '../helpers/relocation-signing-race.mjs';
import { approveRelocationOwner } from '../helpers/relocation-owner-approval.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRelocationDirectoryRuntime } from '../helpers/relocation-directory-runtime.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRelocationCustodyWorkers } from '../helpers/relocation-custody-workers.mjs';

const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
if (!candidate) throw new Error('SEAMS_WALLET_SERVER_CANDIDATE is required');
const publicRoot = resolve(candidate, '../..');
const output = resolve(import.meta.dirname, '../../.artifacts/r155b/composed-relocation');
const custody = await createRelocationCustodyWorkers(publicRoot);
try {
  await mkdir(output, { recursive: true });
  await verifyCoordinatorBindings(custody);
  await writeFile(
    resolve(output, 'custody-topology.json'),
    JSON.stringify(
      {
        scope:
          'Real Cloudflare Rust Workers with separate regional wallet object namespaces and SigningWorker D1. Shared tenant-root authority. Source NEAR registration acknowledged. Directory-coordinated relocation, source cleanup, and destination signing verified locally.',
        objects: custody.objects,
        registrationReceiptSha256: createHash('sha256')
          .update(JSON.stringify(custody.registration.publicReceipt))
          .digest('hex'),
        sourceRegistrationCompleted: true,
        directoryCoordinatorConnected: true,
        destinationSigningVerified: true,
      },
      null,
      2,
    ),
  );
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
  let browserSession = null;
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
    const owner = await approveRelocationOwner(context, move, candidate);
    browserSession = await createRelocationBrowserSession({ candidate, output, owner });
    const pendingSignature = await prepareSigningBeforeMove(custody, publicRoot);
    const approved = await journal.admit(move, verifications, 'test', bindings, Date.now);
    assert.equal(approved.ok, true, JSON.stringify(approved));
    const first = await advanceOnce(context, move);
    const paused = await journal.find(move);
    assert.equal(paused.progress.state, 'freezing');
    assert.equal(paused.progress.execution.state, 'running');
    assert.deepEqual(await browserSession.observe(first.result), {
      state: 'moving',
      authentication: 'authenticated',
      lockRequests: 0,
    });
    const settlement = bindings.runtimes.WEUR.observations.find(isPendingEd25519Settlement);
    assert.ok(settlement, 'A real unfinished NEAR round must block source settlement');
    const recovered = await finalizeWhileMoveWaits(pendingSignature);
    const completed = await advanceRelocation(context, journal, move, [first]);
    assert.deepEqual(await browserSession.observe(completed), {
      state: 'completed',
      authentication: 'signed_out',
      lockRequests: 1,
    });
    assert.deepEqual(await browserSession.observe(completed), {
      state: 'completed',
      authentication: 'signed_out',
      lockRequests: 1,
    });
    await browserSession.verifyReload();
    const stale = await verifySigningReplayAfterMove(
      pendingSignature,
      custody,
      recovered.signature,
    );
    await writeFile(
      resolve(output, 'signing-race.json'),
      JSON.stringify(
        {
          sourceWaitedForPendingRound: true,
          pendingRounds: settlement.pendingRounds,
          signatureSha256Hex: recovered.signatureSha256Hex,
          lostFinalizeReplyRecoveredBeforeCutover:
            recovered.lostFinalizeReplyRecoveredBeforeCutover,
          ...stale,
          scope:
            'Native signing prepared before move admission. Finalize reply lost after commit and recovered while source was still freezing. Exact terminal result replayed at destination after completed move; changed finalization rejected. Does not cover SDK session reconciliation after cutover.',
        },
        null,
        2,
      ),
    );
    const { verifyEd25519DestinationSigning } = await import(
      pathToFileURL(
        resolve(publicRoot, 'crates/router-ab-cloudflare/scripts/ed25519-signing-evidence.mjs'),
      )
    );
    const signed = await verifyEd25519DestinationSigning({
      topology: custody.topology,
      routerName: 'destination-router',
      activation: custody.registration.result.result.result,
      identity: custody.fixture.tenant_root_creation.identity,
      clientRecipientSeed: custody.fixture.activation.client_recipient_seed,
      destinationName: 'destination-signing-worker',
      ownershipGeneration: 2,
      credential: 'private-d1-gateway-router-auth',
      repoRoot: publicRoot,
      scope: JSON.parse(custody.registration.delivery).scope,
    });
    await writeFile(
      resolve(output, 'destination-signing.json'),
      JSON.stringify(
        {
          signatureSha256Hex: signed.signatureSha256Hex,
          staleGenerationRejected: signed.staleGenerationRejected,
          prepareReplayAfterEviction: signed.prepareReplayAfterEviction,
          finalizeReplayAfterEviction: signed.finalizeReplayAfterEviction,
        },
        null,
        2,
      ),
    );
    await writeFile(
      resolve(output, 'coordinator-bindings.json'),
      JSON.stringify(
        {
          realDirectoryAndRuntimeHandlers: true,
          unapprovedMoveRejected: true,
          ownerApprovedMoveCompleted: true,
          destinationSignatureVerified: true,
          unadmittedSourceCommandStatus: response.status,
          custodyCallsBeforeAdmission: 0,
          directoryPaths: context.directory.requests,
          scope:
            'Real journal, WebAuthn owner approval, Runtime admission, independent custody namespaces, completed move, and destination native NEAR signing. This is local composition evidence, not hosted SDK acceptance.',
        },
        null,
        2,
      ),
    );
  } finally {
    if (browserSession) await browserSession.close();
    await context.storage.dispose();
  }
}

function isSourceAdmission(path) {
  return path.endsWith('/relocation-runtime-source');
}

async function advanceRelocation(context, journal, move, observations) {
  for (let step = 0; step < 128; step += 1) {
    const { status, result: body } = await advanceOnce(context, move);
    observations.push({ status, result: body });
    await writeFile(
      resolve(output, 'coordinator-progress.json'),
      JSON.stringify(observations, null, 2),
    );
    assert.equal(status, 200, JSON.stringify(body));
    const current = await journal.find(move);
    if (current.progress.state === 'completed') return body;
    assert.ok(
      ['ready', 'running'].includes(current.progress.execution.state),
      JSON.stringify(body),
    );
  }
  assert.fail('Relocation did not complete within 128 coordinator steps');
}

async function advanceOnce(context, move) {
  const response = await context.api.handleWalletRelocationAdvance(
    new Request(context.api.WALLET_RELOCATION_ADVANCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet: context.wallet,
        moveId: move.moveId,
        attemptId: `wattempt_${randomBytes(32).toString('base64url')}`,
      }),
    }),
    {
      database: context.database,
      catalog: context.catalog,
      bindings: context.bindings,
      scope: context.scope,
      clock: Date.now,
    },
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return { status: response.status, result: body };
}

function isPendingEd25519Settlement(observation) {
  return (
    observation.path.endsWith('/ed25519-settle') &&
    observation.state === 'draining' &&
    observation.pendingRounds === 1
  );
}
