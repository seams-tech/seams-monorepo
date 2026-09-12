import { expect, test } from '@playwright/test';
import { base64UrlEncode } from '../../packages/shared-ts/src/utils/base64';
import {
  signTenantRootRestoreRefreshGrantV1,
  type TenantRootRestoreRefreshGrantSigningInputV1,
} from '../../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreRefreshGrantSigner';

const RUST_GRANT_B64U =
  'AAAAKnNlYW1zL3RlbmFudC1yb290LXJlc3RvcmUtcmVmcmVzaC1ncmFudC92MQAAAB50ZW5hbnRfcm9vdF9yZXN0b3JlX3JlZnJlc2hfdjEAAAAgEREREREREREREREREREREREREREREREREREREREREREAAAAgEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhIAAAAgExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMAAAAQFBQUFBQUFBQUFBQUFBQUFAAAABAVFRUVFRUVFRUVFRUVFRUVAAAAIBYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWAAAAIBcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXAAAAIBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYAAAAIBkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZAAAACAAAAAAAAABkAAAACAAAAAAAAADIAAAAHHJlc3RvcmUtcmVmcmVzaC1hdXRob3JpdHktdjEAAABADfRv2c4iFrKA8tywxpRyCNCr_Kr876sfQlH1x2ycWoZXFui3MHmde-rwMJ_ffbBu1VVL81mQoIEXNAAhW-fBBQ';

const RUST_GRANT_DIGEST_B64U = 'zhMhf1osZoFWRln44K5caX_f2-XzMzl4SicouV1rHeY';

function repeatedBytes(length: number, value: number): string {
  return base64UrlEncode(new Uint8Array(length).fill(value));
}

function fixtureInput(): TenantRootRestoreRefreshGrantSigningInputV1 {
  return {
    operationDigestB64u: repeatedBytes(32, 0x11),
    destinationIdentityDigestB64u: repeatedBytes(32, 0x12),
    destinationFingerprintB64u: repeatedBytes(32, 0x13),
    destinationLineageB64u: repeatedBytes(16, 0x14),
    restoreSessionIdB64u: repeatedBytes(16, 0x15),
    manifestDigestB64u: repeatedBytes(32, 0x16),
    deriverAAcceptanceReceiptDigestB64u: repeatedBytes(32, 0x17),
    deriverBAcceptanceReceiptDigestB64u: repeatedBytes(32, 0x18),
    nonceB64u: repeatedBytes(32, 0x19),
    issuedAtMs: 100,
    expiresAtMs: 200,
    grantKeyId: 'restore-refresh-authority-v1',
    signingSeedB64u: repeatedBytes(32, 0x71),
  };
}

test('matches the native restore refresh grant wire vector', async () => {
  const signed = await signTenantRootRestoreRefreshGrantV1(fixtureInput());

  expect(signed.grantB64u).toBe(RUST_GRANT_B64U);
  expect(signed.grantDigestB64u).toBe(RUST_GRANT_DIGEST_B64U);
  expect(signed.operationDigestB64u).toBe(repeatedBytes(32, 0x11));
  expect(signed.destinationLineageB64u).toBe(repeatedBytes(16, 0x14));
  expect(signed.restoreSessionIdB64u).toBe(repeatedBytes(16, 0x15));
  expect(signed.manifestDigestB64u).toBe(repeatedBytes(32, 0x16));
  expect(signed.deriverAAcceptanceReceiptDigestB64u).toBe(repeatedBytes(32, 0x17));
  expect(signed.deriverBAcceptanceReceiptDigestB64u).toBe(repeatedBytes(32, 0x18));
});

test('rejects zero or duplicate security bindings before signing', async () => {
  await expect(
    signTenantRootRestoreRefreshGrantV1({
      ...fixtureInput(),
      manifestDigestB64u: repeatedBytes(32, 0),
    }),
  ).rejects.toThrow('manifestDigestB64u is invalid');

  await expect(
    signTenantRootRestoreRefreshGrantV1({
      ...fixtureInput(),
      deriverBAcceptanceReceiptDigestB64u: repeatedBytes(32, 0x17),
    }),
  ).rejects.toThrow('receipt digests must differ');

  await expect(
    signTenantRootRestoreRefreshGrantV1({
      ...fixtureInput(),
      expiresAtMs: 300_101,
    }),
  ).rejects.toThrow('time window is invalid');
});
