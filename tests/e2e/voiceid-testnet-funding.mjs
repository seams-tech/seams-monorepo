import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RPC = 'https://rpc.testnet.fastnear.com';
const DEPOSIT = '50000000000000000000000';

export async function fundVoiceIdTestnetWallet(walletRoot, receiverId) {
  assert.match(receiverId, /^[a-f0-9]{64}$/, 'Expected the disposable wallet implicit account');
  const signerDirectory = path.join(walletRoot, 'wasm/near_signer/pkg');
  const signer = await import(
    pathToFileURL(path.join(signerDirectory, 'wasm_signer_worker.js')).href
  );
  signer.initSync({
    module: await readFile(path.join(signerDirectory, 'wasm_signer_worker_bg.wasm')),
  });
  const { base58Encode } = await import(
    pathToFileURL(path.join(walletRoot, 'packages/shared-ts/src/utils/encoders.ts')).href
  );
  const keys = generateKeyPairSync('ed25519');
  const publicJwk = keys.publicKey.export({ format: 'jwk' });
  assert.equal(typeof publicJwk.x, 'string');
  const publicKey = `ed25519:${base58Encode(Buffer.from(publicJwk.x, 'base64url'))}`;
  const accountId = `voiceid-${randomUUID()}.testnet`;
  const response = await fetch('https://helper.testnet.near.org/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
    signal: AbortSignal.timeout(60_000),
  });
  const created = await response.json();
  assert(response.ok, `Testnet faucet refused account creation: HTTP ${response.status}`);
  assert(Object.hasOwn(created.status, 'SuccessValue'), 'Testnet faucet account creation failed');
  const beneficiaryId = created.transaction.signer_id;
  assert(beneficiaryId === 'testnet' || beneficiaryId.endsWith('.testnet'));
  const funder = { accountId, publicKey, privateKey: keys.privateKey, signer };
  let funding;
  let refund;
  try {
    const creationFinality = await nearRpc('tx', {
      tx_hash: created.transaction.hash,
      sender_account_id: beneficiaryId,
      wait_until: 'FINAL',
    });
    assert.equal(creationFinality.final_execution_status, 'FINAL');
    assert(Object.hasOwn(creationFinality.status, 'SuccessValue'));
    funding = await send(funder, receiverId, [{ action_type: 'Transfer', deposit: DEPOSIT }]);
  } finally {
    refund = await send(funder, accountId, [
      { action_type: 'DeleteAccount', beneficiary_id: beneficiaryId },
    ]);
  }
  return {
    source: 'official_testnet_faucet',
    funderAccountId: accountId,
    accountId: receiverId,
    amountYocto: DEPOSIT,
    fundingTransactionHash: funding.transaction.hash,
    funderDeleted: true,
    refundBeneficiary: beneficiaryId,
    refundTransactionHash: refund.transaction.hash,
    funderPrivateKeyPersisted: false,
  };
}

async function send(funder, receiverId, actions) {
  const access = await nearRpc('query', {
    request_type: 'view_access_key',
    finality: 'final',
    account_id: funder.accountId,
    public_key: funder.publicKey,
  });
  assert(
    Number.isSafeInteger(access.nonce) && access.nonce >= 0,
    `Invalid testnet access key: ${JSON.stringify(access)}`,
  );
  const unsigned = funder.signer.threshold_ed25519_build_near_tx_unsigned_borsh({
    txSigningRequests: [{ nearAccountId: funder.accountId, receiverId, actions }],
    transactionContext: {
      nearPublicKeyStr: funder.publicKey,
      nextNonce: (BigInt(access.nonce) + 1n).toString(),
      txBlockHash: access.block_hash,
    },
  });
  assert.equal(unsigned.length, 1);
  const transaction = unsigned[0];
  const signature = sign(
    null,
    Buffer.from(transaction.signingDigestB64u, 'base64url'),
    funder.privateKey,
  );
  const signed = funder.signer.threshold_ed25519_finalize_near_tx_from_signature({
    unsignedTransactionBorshB64u: transaction.unsignedTransactionBorshB64u,
    signingDigestB64u: transaction.signingDigestB64u,
    signatureB64u: signature.toString('base64url'),
    expectedNearAccountId: funder.accountId,
    expectedSignerPublicKey: funder.publicKey,
  });
  const outcome = await nearRpc('send_tx', {
    signed_tx_base64: Buffer.from(signed.signedTransactionBorshB64u, 'base64url').toString(
      'base64',
    ),
    wait_until: 'FINAL',
  });
  assert.equal(outcome.final_execution_status, 'FINAL');
  assert(Object.hasOwn(outcome.status, 'SuccessValue'), 'Testnet funding transaction failed');
  assert.equal(outcome.transaction.hash, signed.transactionHash);
  return outcome;
}

export async function nearRpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  assert(response.ok, `NEAR testnet RPC failed: HTTP ${response.status}`);
  const message = await response.json();
  if (message.error) throw new Error(`NEAR testnet RPC: ${JSON.stringify(message.error)}`);
  return message.result;
}
