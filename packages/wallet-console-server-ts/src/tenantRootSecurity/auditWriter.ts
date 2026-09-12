import {
  isConsoleAuditError,
  type ConsoleAuditActorType,
  type ConsoleAuditService,
} from '@seams-internal/console-server/audit/index';
import {
  checkTenantRootAuditEventRedactionV1,
  tenantRootAuditEventPersistenceIdV1,
  type TenantRootAuditEventV1,
  type TenantRootAuditWriterV1,
} from './audit';

/**
 * Writes tenant-root audit events through the console audit service.
 *
 * Every event passes the redaction check before it is written. That check is
 * the reason this adapter exists rather than a direct `appendEvent` call at
 * each site: one unredacted field written once is a disclosure that cannot be
 * taken back, so the check belongs where it cannot be skipped.
 *
 * A non-duplicate write failure throws. An operation that mutated a tenant
 * root and then lost its audit event is a worse outcome than one that reports
 * failure, so the caller decides what to do rather than the record being
 * dropped silently.
 */

/** Console audit category tenant-root events are recorded under. */
const TENANT_ROOT_AUDIT_CATEGORY_V1 = 'POLICY' as const;

/** Options for the console-backed tenant-root audit writer. */
export interface ConsoleTenantRootAuditWriterOptionsV1 {
  readonly audit: Pick<ConsoleAuditService, 'appendEvent'>;
  /** The principal class for the operation being recorded. */
  readonly actorType: ConsoleAuditActorType;
  /** Project and environment, when the operation is scoped to one. */
  readonly scope?: {
    readonly projectId?: string;
    readonly environmentId?: string;
  };
}

/**
 * Renders one event as its operator-facing summary.
 *
 * The summary carries identifiers and outcomes only; the redaction check has
 * already established that every field in the event is safe to record.
 */
function summarize(event: TenantRootAuditEventV1): string {
  const subject = event.role === null ? 'tenant root' : `tenant root ${event.role}`;
  const failure = event.failureCode === null ? '' : ` (${event.failureCode})`;
  return `${event.action} ${event.outcome} for ${subject} at revision ${event.lifecycleRevision}${failure}`;
}

function consoleAuditOutcomeV1(
  outcome: TenantRootAuditEventV1['outcome'],
): 'SUCCESS' | 'FAILURE' | 'PENDING' {
  switch (outcome) {
    case 'success':
      return 'SUCCESS';
    case 'failure':
      return 'FAILURE';
    case 'pending':
      return 'PENDING';
    default:
      return assertNeverTenantRootAuditOutcomeV1(outcome);
  }
}

function assertNeverTenantRootAuditOutcomeV1(value: never): never {
  throw new Error(`Unexpected tenant-root audit outcome: ${String(value)}`);
}

async function appendTenantRootAuditEventV1(
  audit: Pick<ConsoleAuditService, 'appendEvent'>,
  actorType: ConsoleAuditActorType,
  scope: ConsoleTenantRootAuditWriterOptionsV1['scope'],
  event: TenantRootAuditEventV1,
): Promise<void> {
  const persistenceId = tenantRootAuditEventPersistenceIdV1(event);
  try {
    await audit.appendEvent(
      {
        orgId: event.orgId,
        actorUserId: event.actorUserId,
        ...(scope?.projectId ? { projectId: scope.projectId } : {}),
        ...(scope?.environmentId ? { environmentId: scope.environmentId } : {}),
      },
      {
        ...(persistenceId === undefined ? {} : { id: persistenceId }),
        actorType,
        category: TENANT_ROOT_AUDIT_CATEGORY_V1,
        action: event.action,
        outcome: consoleAuditOutcomeV1(event.outcome),
        summary: summarize(event),
        // The redacted event is the metadata. Nothing is added here that the
        // redaction check did not already inspect.
        metadata: { ...event },
      },
    );
  } catch (error: unknown) {
    // A retry after a process crash can observe the row written by the prior
    // attempt. The deterministic ID makes that duplicate the same event.
    if (isConsoleAuditError(error) && error.code === 'event_already_exists') return;
    throw error;
  }
}

/** Creates the console-backed tenant-root audit writer. */
export function createConsoleTenantRootAuditWriterV1(
  options: ConsoleTenantRootAuditWriterOptionsV1,
): TenantRootAuditWriterV1 {
  return {
    async write(event: TenantRootAuditEventV1): Promise<void> {
      const redaction = checkTenantRootAuditEventRedactionV1(event);
      if (!redaction.ok) {
        throw new Error(
          `refusing to write an unredacted tenant-root audit event: ${JSON.stringify(
            redaction.errors,
          )}`,
        );
      }
      await appendTenantRootAuditEventV1(
        options.audit,
        options.actorType,
        options.scope,
        event,
      );
    },
  };
}
