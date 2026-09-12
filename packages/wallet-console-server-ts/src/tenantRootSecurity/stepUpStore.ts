import { queryD1One, type D1DatabaseLike, type D1Row } from '@seams/wallet-server/cloud-host';
import type { TenantRootStepUpReaderV1 } from './routeGuard';
import type { TenantRootStepUpMethodV1, TenantRootStepUpSessionRecordV1 } from './stepUp';

/**
 * D1-backed step-up records.
 *
 * The store returns what was recorded and nothing more. Whether that record is
 * *fresh enough* is decided by the operation reading it, so the freshness rule
 * lives in one place instead of being duplicated into a query and a check that
 * can drift apart.
 */

/** Options for the D1 step-up store. */
export interface D1TenantRootStepUpStoreOptionsV1 {
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

function toRecord(row: D1Row): TenantRootStepUpSessionRecordV1 | null {
  const parsedMethod = method(row.method);
  if (parsedMethod === null) return null;
  return {
    actorUserId: text(row.actor_user_id),
    sessionId: text(row.session_id),
    method: parsedMethod,
    verifiedAtMs: integer(row.verified_at_ms),
  };
}

/** Records one completed step-up for an actor. */
export interface TenantRootStepUpWriterV1 {
  recordStepUp(input: {
    readonly orgId: string;
    readonly actorUserId: string;
    readonly sessionId: string;
    readonly method: TenantRootStepUpMethodV1;
    readonly verifiedAtMs: number;
  }): Promise<void>;
}

/** Creates the D1-backed step-up reader and writer. */
export function createD1TenantRootStepUpStoreV1(
  options: D1TenantRootStepUpStoreOptionsV1,
): TenantRootStepUpReaderV1 & TenantRootStepUpWriterV1 {
  const { database, namespace } = options;
  return {
    async readStepUp(input) {
      const row = await queryD1One(
        database,
        `SELECT actor_user_id, session_id, method, verified_at_ms
         FROM tenant_root_step_up_records
         WHERE namespace = ?1 AND org_id = ?2 AND actor_user_id = ?3`,
        [namespace, input.orgId, input.actorUserId],
      );
      // An unreadable method is treated as no step-up at all rather than
      // guessed at: a row this build cannot interpret proves nothing.
      return row === null ? null : toRecord(row);
    },

    async recordStepUp(input) {
      // One current step-up per actor. A newer one replaces the previous
      // record rather than accumulating rows an operation might pick between.
      await database
        .prepare(
          `INSERT INTO tenant_root_step_up_records (
             namespace, org_id, actor_user_id, session_id, method,
             verified_at_ms, created_at_ms
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
           ON CONFLICT (namespace, org_id, actor_user_id) DO UPDATE SET
             session_id = excluded.session_id,
             method = excluded.method,
             verified_at_ms = excluded.verified_at_ms,
             created_at_ms = excluded.created_at_ms
           WHERE excluded.verified_at_ms >= tenant_root_step_up_records.verified_at_ms`,
        )
        .bind(
          namespace,
          input.orgId,
          input.actorUserId,
          input.sessionId,
          input.method,
          input.verifiedAtMs,
        )
        .run();
    },
  };
}
