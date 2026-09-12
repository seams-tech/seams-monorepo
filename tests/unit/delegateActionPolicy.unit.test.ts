import { expect, test } from '@playwright/test';
import { enforceDelegatePolicy, type RelayedSignedDelegate } from '@server/delegateAction';

type RelayedNearAction = RelayedSignedDelegate['delegateAction']['actions'][number];

function buildRelayedSignedDelegate(actions: RelayedNearAction[]): RelayedSignedDelegate {
  return {
    delegateAction: {
      senderId: 'alice.testnet',
      receiverId: 'contract.testnet',
      actions,
      nonce: 1,
      maxBlockHeight: 10,
      publicKey: { keyType: 0, keyData: [1, 2, 3] },
    },
    signature: { keyType: 0, signatureData: [4, 5, 6] },
  };
}

test('delegate policy evaluates the normalized relay action union', async () => {
  const signedDelegate = buildRelayedSignedDelegate([
    {
      functionCall: {
        methodName: 'ping',
        args: [123, 125],
        gas: 30_000_000_000_000,
        deposit: '3',
      },
    },
    { transfer: { deposit: '4' } },
  ]);

  await expect(
    enforceDelegatePolicy({
      hash: 'hash-1',
      signedDelegate,
      policy: {
        allowedReceivers: ['contract.testnet'],
        allowedMethods: ['ping'],
        maxTotalDepositYocto: '7',
      },
    }),
  ).resolves.toBeUndefined();

  await expect(
    enforceDelegatePolicy({
      hash: 'hash-1',
      signedDelegate,
      policy: { allowedMethods: ['other'] },
    }),
  ).rejects.toMatchObject({ code: 'method_not_allowed' });

  await expect(
    enforceDelegatePolicy({
      hash: 'hash-1',
      signedDelegate,
      policy: { maxTotalDepositYocto: '6' },
    }),
  ).rejects.toMatchObject({ code: 'deposit_exceeds_limit' });
});
