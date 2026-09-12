import {
  queryD1All,
  queryD1One,
  type D1DatabaseLike,
  type D1Row,
} from '@seams/wallet-server/cloud-host';
import type { TenantRootStepUpMethodV1 } from './stepUp';

/**
 * D1-backed console WebAuthn credentials and ceremony challenges.
 *
 * The store holds what a ceremony needs to verify and nothing it can decide
 * for itself: whether an assertion is acceptable is the ceremony's judgement,
 * so this returns rows rather than verdicts.
 *
 * A challenge is consumed by reading it, not by a later delete. Taking it out
 * of the table in the same step that returns it is what makes a replay of the
 * same ceremony response fail rather than succeed twice.
 */

/** Which ceremony a challenge was issued for. */
export type ConsoleStepUpChallengePurposeV1 = 'registration' | 'assertion';

/** One registered console step-up credential. */
export interface ConsoleStepUpCredentialV1 {
  readonly credentialIdB64u: string;
  readonly publicKeyB64u: string;
  readonly counter: number;
  readonly method: TenantRootStepUpMethodV1;
}

/** One issued ceremony challenge, bound to the session that requested it. */
export interface ConsoleStepUpChallengeV1 {
  readonly challengeB64u: string;
  readonly sessionId: string;
  readonly expiresAtMs: number;
}

/** Reads and writes console step-up credentials and challenges. */
export interface ConsoleStepUpCredentialStoreV1 {
  listCredentials(input: {
    readonly orgId: string;
    readonly userId: string;
  }): Promise<readonly ConsoleStepUpCredentialV1[]>;

  findCredential(input: {
    readonly orgId: string;
    readonly userId: string;
    readonly credentialIdB64u: string;
  }): Promise<ConsoleStepUpCredentialV1 | null>;

  putCredential(input: {
    readonly orgId: string;
    readonly userId: string;
    readonly credential: ConsoleStepUpCredentialV1;
    readonly createdAtMs: number;
  }): Promise<void>;

  advanceCounter(input: {
    readonly orgId: string;
    readonly userId: string;
    readonly credentialIdB64u: string;
    readonly counter: number;
    readonly usedAtMs: number;
  }): Promise<void>;

  putChallenge(input: {
    readonly orgId: string;
    readonly userId: string;
    readonly purpose: ConsoleStepUpChallengePurposeV1;
    readonly challenge: ConsoleStepUpChallengeV1;
    readonly issuedAtMs: number;
  }): Promise<void>;

  /** Returns the live challenge and removes it, so it cannot be used twice. */
  takeChallenge(input: {
    readonly orgId: string;
    readonly userId: string;
    readonly purpose: ConsoleStepUpChallengePurposeV1;
  }): Promise<ConsoleStepUpChallengeV1 | null>;
}

/** Options for the D1 console step-up credential store. */
export interface D1ConsoleStepUpCredentialStoreOptionsV1 {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function integer(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function method(value: unknown): TenantRootStepUpMethodV1 | null {
  const parsed = text(value);
  return parsed === 'webauthn_platform_v1' || parsed === 'webauthn_cross_platform_v1'
    ? parsed
    : null;
}

function toCredential(row: D1Row): ConsoleStepUpCredentialV1 | null {
  const parsedMethod = method(row.method);
  // A credential whose method this build cannot interpret proves nothing, so
  // it is dropped rather than guessed at.
  if (parsedMethod === null) return null;
  return {
    credentialIdB64u: text(row.credential_id_b64u),
    publicKeyB64u: text(row.public_key_b64u),
    counter: integer(row.counter),
    method: parsedMethod,
  };
}

/** Creates the D1-backed console step-up credential store. */
export function createD1ConsoleStepUpCredentialStoreV1(
  options: D1ConsoleStepUpCredentialStoreOptionsV1,
): ConsoleStepUpCredentialStoreV1 {
  const { database, namespace } = options;
  return {
    async listCredentials(input) {
      const rows = await queryD1All(
        database,
        `SELECT credential_id_b64u, public_key_b64u, counter, method
           FROM console_step_up_credentials
          WHERE namespace = ?1 AND org_id = ?2 AND user_id = ?3
          ORDER BY created_at_ms ASC`,
        [namespace, input.orgId, input.userId],
      );
      return rows
        .map(toCredential)
        .filter((credential): credential is ConsoleStepUpCredentialV1 => credential !== null);
    },

    async findCredential(input) {
      const row = await queryD1One(
        database,
        `SELECT credential_id_b64u, public_key_b64u, counter, method
           FROM console_step_up_credentials
          WHERE namespace = ?1 AND org_id = ?2 AND user_id = ?3
            AND credential_id_b64u = ?4`,
        [namespace, input.orgId, input.userId, input.credentialIdB64u],
      );
      return row === null ? null : toCredential(row);
    },

    async putCredential(input) {
      // A credential id is registered once. Re-registering the same id keeps
      // the original counter rather than resetting it, which would erase the
      // cloned-authenticator signal.
      await database
        .prepare(
          `INSERT INTO console_step_up_credentials (
             namespace, org_id, user_id, credential_id_b64u, public_key_b64u,
             counter, method, created_at_ms, last_used_at_ms
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)
           ON CONFLICT (namespace, org_id, user_id, credential_id_b64u) DO NOTHING`,
        )
        .bind(
          namespace,
          input.orgId,
          input.userId,
          input.credential.credentialIdB64u,
          input.credential.publicKeyB64u,
          input.credential.counter,
          input.credential.method,
          input.createdAtMs,
        )
        .run();
    },

    async advanceCounter(input) {
      // Only forward. A replayed assertion carries a counter that is not
      // greater, and must not rewrite the stored one.
      await database
        .prepare(
          `UPDATE console_step_up_credentials
              SET counter = ?5, last_used_at_ms = ?6
            WHERE namespace = ?1 AND org_id = ?2 AND user_id = ?3
              AND credential_id_b64u = ?4
              AND ?5 >= counter`,
        )
        .bind(
          namespace,
          input.orgId,
          input.userId,
          input.credentialIdB64u,
          input.counter,
          input.usedAtMs,
        )
        .run();
    },

    async putChallenge(input) {
      await database
        .prepare(
          `INSERT INTO console_step_up_challenges (
             namespace, org_id, user_id, purpose, challenge_b64u, session_id,
             issued_at_ms, expires_at_ms
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT (namespace, org_id, user_id, purpose) DO UPDATE SET
             challenge_b64u = excluded.challenge_b64u,
             session_id = excluded.session_id,
             issued_at_ms = excluded.issued_at_ms,
             expires_at_ms = excluded.expires_at_ms`,
        )
        .bind(
          namespace,
          input.orgId,
          input.userId,
          input.purpose,
          input.challenge.challengeB64u,
          input.challenge.sessionId,
          input.issuedAtMs,
          input.challenge.expiresAtMs,
        )
        .run();
    },

    async takeChallenge(input) {
      const row = await queryD1One(
        database,
        `SELECT challenge_b64u, session_id, expires_at_ms
           FROM console_step_up_challenges
          WHERE namespace = ?1 AND org_id = ?2 AND user_id = ?3 AND purpose = ?4`,
        [namespace, input.orgId, input.userId, input.purpose],
      );
      if (row === null) return null;
      // Removed whether or not the caller goes on to accept it: a challenge
      // that has been handed out once is spent.
      await database
        .prepare(
          `DELETE FROM console_step_up_challenges
            WHERE namespace = ?1 AND org_id = ?2 AND user_id = ?3 AND purpose = ?4`,
        )
        .bind(namespace, input.orgId, input.userId, input.purpose)
        .run();
      return {
        challengeB64u: text(row.challenge_b64u),
        sessionId: text(row.session_id),
        expiresAtMs: integer(row.expires_at_ms),
      };
    },
  };
}
