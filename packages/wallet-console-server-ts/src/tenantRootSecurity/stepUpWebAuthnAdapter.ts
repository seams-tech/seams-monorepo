import type { TenantRootStepUpMethodV1 } from './stepUp';
import type {
  ConsoleStepUpCeremonyOptionsV1,
  ConsoleStepUpAssertionResultV1,
  ConsoleStepUpRegistrationResultV1,
  ConsoleWebAuthnPortV1,
} from './stepUpCeremony';
import type { ConsoleStepUpCredentialV1 } from './stepUpCredentialStore';

/**
 * The `@simplewebauthn/server` adapter behind the console step-up port.
 *
 * The library is imported dynamically, as it is in the wallet server, because
 * a Worker build must not fail to start when the module is unavailable — the
 * ceremony reports `unsupported_runtime` instead, and every mutation keeps
 * failing closed.
 *
 * Verification results are narrowed by hand rather than trusted as typed: a
 * verifier that returns an unexpected shape is treated as a failed ceremony,
 * not as a success with missing fields.
 */

/** Relying-party settings for one console deployment. */
export interface ConsoleWebAuthnRelyingPartyV1 {
  /** The console origin's hostname, e.g. `console.seams.example`. */
  readonly rpId: string;
  /** Human-readable relying party name shown by the authenticator. */
  readonly rpName: string;
  /** The exact origin assertions must come from. */
  readonly expectedOrigin: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function counter(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Maps the authenticator attachment onto the two methods the step-up record
 * accepts. An attachment the build does not recognise is treated as
 * cross-platform, which is the weaker of the two claims.
 */
function methodFor(attachment: unknown): TenantRootStepUpMethodV1 {
  return attachment === 'platform' ? 'webauthn_platform_v1' : 'webauthn_cross_platform_v1';
}

async function loadSimpleWebAuthnServer(): Promise<UnknownRecord | null> {
  try {
    return asRecord(await import('@simplewebauthn/server'));
  } catch {
    return null;
  }
}

/** Creates the production WebAuthn port for the console step-up ceremony. */
export function createConsoleWebAuthnPortV1(
  relyingParty: ConsoleWebAuthnRelyingPartyV1,
): ConsoleWebAuthnPortV1 {
  async function call(name: string, argument: UnknownRecord): Promise<unknown> {
    const module = await loadSimpleWebAuthnServer();
    const operation = module?.[name];
    if (typeof operation !== 'function') {
      throw new Error(`WebAuthn ${name} is unavailable in this runtime`);
    }
    return (operation as (input: UnknownRecord) => unknown)(argument);
  }

  function optionsFrom(value: unknown): ConsoleStepUpCeremonyOptionsV1 {
    const options = asRecord(value);
    const challengeB64u = text(options?.challenge);
    if (options === null || challengeB64u === null) {
      throw new Error('WebAuthn options did not carry a challenge');
    }
    return { challengeB64u, optionsJson: JSON.stringify(options) };
  }

  return {
    async registrationOptions(input) {
      return optionsFrom(
        await call('generateRegistrationOptions', {
          rpName: relyingParty.rpName,
          rpID: relyingParty.rpId,
          userName: input.userName,
          userID: new TextEncoder().encode(input.userId),
          // Offering an already-registered credential again would let the user
          // create a duplicate they cannot distinguish.
          excludeCredentials: input.existing.map((credential) => ({
            id: credential.credentialIdB64u,
          })),
          authenticatorSelection: { userVerification: 'required' },
        }),
      );
    },

    async verifyRegistration(input): Promise<ConsoleStepUpRegistrationResultV1 | null> {
      const response = asRecord(JSON.parse(input.responseJson) as unknown);
      if (response === null) return null;
      const verification = asRecord(
        await call('verifyRegistrationResponse', {
          response,
          expectedChallenge: input.expectedChallengeB64u,
          expectedOrigin: relyingParty.expectedOrigin,
          expectedRPID: relyingParty.rpId,
          requireUserVerification: true,
        }),
      );
      if (verification?.verified !== true) return null;

      const info = asRecord(verification.registrationInfo);
      const credential = asRecord(info?.credential);
      const credentialIdB64u = text(credential?.id);
      const publicKey = credential?.publicKey;
      if (credentialIdB64u === null || !(publicKey instanceof Uint8Array)) return null;

      return {
        credentialIdB64u,
        publicKeyB64u: base64Url(publicKey),
        counter: counter(credential?.counter),
        method: methodFor(response.authenticatorAttachment),
      };
    },

    async authenticationOptions(input) {
      return optionsFrom(
        await call('generateAuthenticationOptions', {
          rpID: relyingParty.rpId,
          allowCredentials: input.existing.map((credential: ConsoleStepUpCredentialV1) => ({
            id: credential.credentialIdB64u,
          })),
          userVerification: 'required',
        }),
      );
    },

    async verifyAssertion(input): Promise<ConsoleStepUpAssertionResultV1 | null> {
      const response = asRecord(JSON.parse(input.responseJson) as unknown);
      if (response === null) return null;
      const verification = asRecord(
        await call('verifyAuthenticationResponse', {
          response,
          expectedChallenge: input.expectedChallengeB64u,
          expectedOrigin: relyingParty.expectedOrigin,
          expectedRPID: relyingParty.rpId,
          credential: {
            id: input.credential.credentialIdB64u,
            publicKey: decodeBase64Url(input.credential.publicKeyB64u),
            counter: input.credential.counter,
          },
          requireUserVerification: true,
        }),
      );
      if (verification?.verified !== true) return null;

      const info = asRecord(verification.authenticationInfo);
      if (info === null) return null;
      return {
        credentialIdB64u: input.credential.credentialIdB64u,
        counter: counter(info.newCounter),
      };
    },
  };
}
