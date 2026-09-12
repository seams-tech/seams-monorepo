import { expect, test } from '@playwright/test';
import { decodeExportConfirmRequest } from '@/core/signingEngine/uiConfirm/exportConfirmRequest';
import { UserConfirmationType } from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import { parseUserConfirmWorkerResponse } from '@/core/types/secure-confirm-worker';

function exportRequest() {
  return {
    requestId: 'export-request',
    type: UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI,
    summary: {
      operation: 'Export Private Key',
      accountId: 'alice.testnet',
      publicKey: 'public-key',
      warning: 'Keep this key private.',
    },
    payload: {
      subject: { kind: 'near_wallet', nearAccountId: 'alice.testnet' },
      viewerSessionId: 'viewer-1',
      publicKey: 'public-key',
      privateKey: 'private-key',
      keys: [
        { scheme: 'ed25519', label: 'NEAR', publicKey: 'public-key', privateKey: 'private-key' },
      ],
      guidance: { title: 'Save your key', steps: ['Store securely'] },
      variant: 'drawer',
      theme: 'dark',
      loading: false,
    },
  };
}

test('worker replies require a single success or failure branch', () => {
  expect(
    parseUserConfirmWorkerResponse({ id: 'request', success: true, data: { kind: 'completed' } }),
  ).toEqual({ id: 'request', success: true, data: { kind: 'completed' } });
  expect(
    parseUserConfirmWorkerResponse({ id: 'request', success: false, error: 'failed' }),
  ).toEqual({ id: 'request', success: false, error: 'failed' });
  expect(parseUserConfirmWorkerResponse({ success: true })).toBeNull();
  expect(parseUserConfirmWorkerResponse({ success: true, data: {}, error: 'failed' })).toBeNull();
  expect(parseUserConfirmWorkerResponse({ success: false, data: {}, error: 'failed' })).toBeNull();
  expect(parseUserConfirmWorkerResponse({ success: false })).toBeNull();
});

test('decodes the complete export viewer payload without sharing nested mutable data', () => {
  const input = exportRequest();
  const request = decodeExportConfirmRequest(input);
  expect(request).toMatchObject(input);
  input.payload.keys[0].privateKey = 'changed';
  input.payload.guidance.steps[0] = 'changed';
  if (request.type !== UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI)
    throw new Error('Wrong branch');
  expect(request.payload.keys?.[0].privateKey).toBe('private-key');
  expect(request.payload.guidance?.steps).toEqual(['Store securely']);
});

test('decodes a credential request and requires its credential identity', () => {
  const base = exportRequest();
  const request = {
    ...base,
    type: UserConfirmationType.AUTHORIZE_KEY_EXPORT,
    payload: {
      subject: base.payload.subject,
      publicKey: 'public-key',
      credentialIdB64u: 'credential',
      challengeB64u: 'challenge',
    },
  };
  expect(decodeExportConfirmRequest(request)).toMatchObject(request);
  expect(() =>
    decodeExportConfirmRequest({
      ...request,
      payload: { ...request.payload, credentialIdB64u: undefined },
    }),
  ).toThrow('credentialIdB64u');
});

test('rejects unsupported requests, contradictory subjects, invalid nested values, and wire callbacks', () => {
  const request = exportRequest();
  expect(() => decodeExportConfirmRequest({ ...request, payload: { ...request.payload, prfOutput: 'secret' } })).toThrow('forbidden signing secret');
  expect(() =>
    decodeExportConfirmRequest({ ...request, type: UserConfirmationType.SIGN_TRANSACTION }),
  ).toThrow('unsupported request type');
  expect(() =>
    decodeExportConfirmRequest({
      ...request,
      payload: { ...request.payload, subject: { ...request.payload.subject, walletId: 'wallet' } },
    }),
  ).toThrow('subject');
  expect(() =>
    decodeExportConfirmRequest({
      ...request,
      payload: { ...request.payload, keys: [{ ...request.payload.keys[0], privateKey: 42 }] },
    }),
  ).toThrow('privateKey');
  expect(() =>
    decodeExportConfirmRequest({
      ...request,
      payload: { ...request.payload, onLifecycle: 'unexpected' },
    }),
  ).toThrow('callbacks');
});
