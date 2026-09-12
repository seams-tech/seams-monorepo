import { expect, test } from '@playwright/test';
import { TouchIdPrompt } from '@/core/signingEngine/stepUpConfirmation/passkeyPrompt/touchIdPrompt';

class RejectingCredentials {
  authentication: CredentialRequestOptions | undefined;
  registration: CredentialCreationOptions | undefined;
  readonly rejection = new DOMException('RP rejected by browser', 'SecurityError');

  async get(options: CredentialRequestOptions): Promise<never> {
    this.authentication = options;
    throw this.rejection;
  }

  async create(options: CredentialCreationOptions): Promise<never> {
    this.registration = options;
    throw this.rejection;
  }
}

test('passes explicit RP IDs to WebAuthn and preserves browser rejection', async () => {
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  const credentials = new RejectingCredentials();
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: Object.assign(new EventTarget(), {
      location: { hostname: 'sign.seams.sh' },
    }) },
    document: { configurable: true, value: new EventTarget() },
    navigator: { configurable: true, value: { credentials } },
  });
  try {
    for (const override of ['pokopia.sign.seams.sh', 'wallet.pokopia.com', 'seams.sh', undefined]) {
      const prompt = new TouchIdPrompt(override);
      const expectedRpId = override ?? 'sign.seams.sh';
      const challengeB64u = Buffer.alloc(32, 1).toString('base64url');
      expect(prompt.getRpId()).toBe(expectedRpId);
      await expect(prompt.getAuthenticationCredentialsSerializedForChallengeB64u({
        subjectId: 'wallet_alice',
        challengeB64u,
      })).rejects.toBe(credentials.rejection);
      expect(credentials.authentication?.publicKey?.rpId).toBe(expectedRpId);
      expect(credentials.authentication?.publicKey?.allowCredentials).toBeUndefined();

      await expect(prompt.generateRegistrationCredentialsInternal({
        kind: 'wallet_registration',
        walletId: 'wallet_alice',
        intendedUserName: 'wallet_alice',
        challengeB64u,
        prompt: {
          kind: 'immediate',
          requestId: `rp-id-test-${expectedRpId}`,
          cancellation: { kind: 'none' },
        },
      })).rejects.toBe(credentials.rejection);
      expect(credentials.registration?.publicKey?.rp.id).toBe(expectedRpId);
    }
  } finally {
    for (const key of ['window', 'document', 'navigator']) {
      const descriptor = previous[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
