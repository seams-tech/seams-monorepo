import { expect, test } from '@playwright/test';
import { base64UrlEncode } from '../../packages/shared-ts/src/utils/base64';
import { signTenantRootRestoreRoleImportGrantV1 } from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreGrantSigner';

const RUST_GRANT_B64U =
  'AAAALnNlYW1zL3RlbmFudC1yb290LXJlc3RvcmUtcm9sZS1pbXBvcnQtZ3JhbnQvdjEAAAAsdGVuYW50X3Jvb3RfcmVzdG9yZV9yb2xlX2ltcG9ydF9rZXlfaXNzdWVfdjEAAAAgEREREREREREREREREREREREREREREREREREREREREREAAAAgEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhIAAAAgExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMAAAAQFBQUFBQUFBQUFBQUFBQUFAAAABAVFRUVFRUVFRUVFRUVFRUVAAAAIBcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXAAAACWRlcml2ZXJfYQAAABRyZXN0b3JlLWltcG9ydC1rZXktMQAAAAgAAAAAAAAAAQAAACAWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFgAAAAgAAAAAAAAAZAAAAAgAAAAAAAAAyAAAABRyZXN0b3JlLWF1dGhvcml0eS12MQAAAEDugKpFRxCLWAYmZXZ5oD72m-FdEBCqDSBTfyuQSzB3T8HWUoyypQ4B_wGHjspZEhHenJEAldI8--S-9-9bp5UK';

const RUST_GRANT_DIGEST_B64U = 'DE5teSm7UzpyDeYX7jrAXY0FN9V1qWAVRb22pQr3RlI';

function repeatedBytes(length: number, value: number): string {
  return base64UrlEncode(new Uint8Array(length).fill(value));
}

function fixtureInput() {
  return {
    operationDigestB64u: repeatedBytes(32, 0x11),
    destinationIdentityDigestB64u: repeatedBytes(32, 0x12),
    destinationFingerprintB64u: repeatedBytes(32, 0x13),
    destinationLineageB64u: repeatedBytes(16, 0x14),
    restoreSessionIdB64u: repeatedBytes(16, 0x15),
    manifestDigestB64u: repeatedBytes(32, 0x17),
    role: 'deriver_a' as const,
    importKeyId: 'restore-import-key-1',
    generation: 1,
    nonceB64u: repeatedBytes(32, 0x16),
    issuedAtMs: 100,
    expiresAtMs: 200,
    grantKeyId: 'restore-authority-v1',
    signingSeedB64u: repeatedBytes(32, 0x71),
  };
}

test('matches the native restore role-import grant wire vector', async () => {
  const signed = await signTenantRootRestoreRoleImportGrantV1(fixtureInput());

  expect(signed.grantB64u).toBe(RUST_GRANT_B64U);
  expect(signed.grantDigestB64u).toBe(RUST_GRANT_DIGEST_B64U);
  expect(signed.operationDigestB64u).toBe(repeatedBytes(32, 0x11));
  expect(signed.destinationLineageB64u).toBe(repeatedBytes(16, 0x14));
  expect(signed.restoreSessionIdB64u).toBe(repeatedBytes(16, 0x15));
  expect(signed.role).toBe('deriver_a');
  expect(signed.generation).toBe(1);
});

test('refuses a UUID session id and invalid grant bindings before signing', async () => {
  await expect(
    signTenantRootRestoreRoleImportGrantV1({
      ...fixtureInput(),
      restoreSessionIdB64u: '00000000-0000-0000-0000-000000000000',
    }),
  ).rejects.toThrow('restoreSessionIdB64u is invalid');

  await expect(
    signTenantRootRestoreRoleImportGrantV1({
      ...fixtureInput(),
      nonceB64u: repeatedBytes(32, 0),
    }),
  ).rejects.toThrow('nonceB64u is invalid');

  await expect(
    signTenantRootRestoreRoleImportGrantV1({
      ...fixtureInput(),
      expiresAtMs: 300_101,
    }),
  ).rejects.toThrow('time window is invalid');
});
