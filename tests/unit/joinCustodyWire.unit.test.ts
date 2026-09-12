import { expect, test } from '@playwright/test';
import { joinCustodyWireFromEnvelopeRecord } from '../../packages/wallet/src/core/signingEngine/walletCustody/joinCustodyWire';
import { rawPasskeyCustodyEnvelope } from './helpers/passkeyCustodyEnvelope.fixtures';

/**
 * The projection a cold unlock hands to the wasm boundary.
 *
 * `JoinCustodyWireV1` parses with `deny_unknown_fields`, so the exact key set
 * is the contract — an extra field is a parse failure at the boundary and a
 * missing one is a decrypt failure that reads like a bad passkey. Both tests
 * below pin key sets on purpose; loosening them to `toMatchObject` would let
 * either regression through.
 */

function envelopeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return rawPasskeyCustodyEnvelope({
    envelopeId: 'envelope-1',
    walletId: 'alice.testnet',
    envelopeRevision: 3,
    createdAtMs: 1,
    updatedAtMs: 2,
    ...overrides,
  });
}

test('the wire carries exactly the five fields the wasm boundary declares', () => {
  const result = joinCustodyWireFromEnvelopeRecord(envelopeRecord());
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const wire = JSON.parse(result.custodyJson);
  // deny_unknown_fields: anything extra here fails to parse in wasm.
  expect(Object.keys(wire).sort()).toEqual([
    'aadHashB64u',
    'ciphertextDigestB64u',
    'envelopeBinding',
    'nonceB64u',
    'sealedCustodySecretB64u',
  ]);
});

test('envelopeBinding is the composite, not the record binding', () => {
  const result = joinCustodyWireFromEnvelopeRecord(envelopeRecord());
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const wire = JSON.parse(result.custodyJson);
  // The values the envelope was sealed against. Sending the inner binding
  // alone would decrypt against the wrong AAD and read as a bad passkey.
  expect(Object.keys(wire.envelopeBinding).sort()).toEqual([
    'binding',
    'envelopeId',
    'envelopeRevision',
    'factor',
    'ownership',
    'walletId',
  ]);
  expect(wire.envelopeBinding.envelopeRevision).toBe(3);
  expect(wire.envelopeBinding.walletId).toBe('alice.testnet');
  expect(wire.envelopeBinding.ownership).toBe('unbound');
});

test('a non-active envelope is refused, and says which state', () => {
  for (const lifecycle of [
    { state: 'revoked', activatedAtMs: 1, revokedAtMs: 2 },
    { state: 'retired', activatedAtMs: 1, retiredAtMs: 2 },
  ] as const) {
    const result = joinCustodyWireFromEnvelopeRecord(envelopeRecord({ lifecycle }));
    expect(result.ok).toBe(false);
    if (result.ok) continue;
    // The caller has to be able to tell the user which one happened.
    expect(result.reason).toContain(lifecycle.state);
  }
});

test('a missing revision is refused rather than defaulted', () => {
  // The revision is part of the AAD: defaulting it produces a wire that fails
  // to decrypt instead of failing here.
  const result = joinCustodyWireFromEnvelopeRecord(envelopeRecord({ envelopeRevision: undefined }));
  expect(result).toMatchObject({ ok: false });
});

test('sealed material is required in full', () => {
  for (const field of [
    'nonceB64u',
    'sealedCustodySecretB64u',
    'aadHashB64u',
    'ciphertextDigestB64u',
  ]) {
    const result = joinCustodyWireFromEnvelopeRecord(envelopeRecord({ [field]: '' }));
    expect(result.ok, `${field} must be required`).toBe(false);
  }
});
