import { chromium } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';

export async function browserTargetRegistration(api, preparation) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route('https://wallet.test/**', serveCeremony);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await page.goto('https://wallet.test/registration');
    const options = preparation.passkeyCreationOptions;
    const webauthnRegistration = await page.evaluate(createBrowserCredential, {
      options,
      challengeBytes: [...Buffer.from(options.challengeB64u, 'base64url')],
      userIdBytes: [...Buffer.from(options.user.idB64u, 'base64url')],
    });
    const recipient = generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' }).x;
    return api.buildLinkedDeviceTargetCredentialRegistrationV1({
      linkSessionId: preparation.linkSessionId,
      walletId: preparation.walletId,
      enrollmentId: preparation.enrollmentId,
      deviceId: preparation.deviceId,
      walletAuthMethodId: preparation.walletAuthMethodId,
      targetPreparationDigestB64u:
        await api.computeLinkedDeviceTargetPreparationDigestV1(preparation),
      targetFactor: { kind: 'passkey_prf' },
      webauthnRegistration,
      ordinarySignerMaterialRecipientRequests: [
        {
          kind: 'ordinary_ed25519_signer_material_recipient_request_v1',
          keyFamily: 'ed25519',
          walletKeyId: preparation.ordinarySignerMaterialRecipientRequirements[0].walletKeyId,
          recipientPublicKeyB64u: recipient,
        },
      ],
      registeredAtMs: Date.now(),
    });
  } finally {
    await browser.close();
  }
}
async function serveCeremony(route) {
  await route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Regional WebAuthn registration</title>',
  });
}
async function createBrowserCredential({ options, challengeBytes, userIdBytes }) {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: new Uint8Array(challengeBytes),
      rp: { id: options.rpId, name: 'Regional wallet' },
      user: {
        id: new Uint8Array(userIdBytes),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams,
      authenticatorSelection: options.authenticatorSelection,
      attestation: options.attestation,
      timeout: options.timeoutMs,
    },
  });
  return {
    kind: 'linked_device_webauthn_registration_v1',
    credentialIdB64u: credential.id,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientDataJsonB64u: btoa(
      String.fromCharCode(...new Uint8Array(credential.response.clientDataJSON)),
    )
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, ''),
    attestationObjectB64u: btoa(
      String.fromCharCode(...new Uint8Array(credential.response.attestationObject)),
    )
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, ''),
    transports: credential.response.getTransports(),
  };
}
