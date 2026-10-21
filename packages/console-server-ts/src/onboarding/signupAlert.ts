import type { D1DatabaseLike, D1PreparedStatementLike } from '../boundary';
import { createConsoleEmailOutboxInsertStatement } from '../email/d1';
import { buildTeamSignupAlertEmailV1 } from '../email/templates';

export interface ConsoleTeamSignupAlert {
  readonly orgId: string;
  readonly userId: string;
  readonly accountEmail: string;
  readonly accountDisplayName: string;
  readonly organizationName: string;
}

export interface ConsoleTeamSignupAlertPort {
  enqueue(alert: ConsoleTeamSignupAlert): Promise<void>;
}

export interface D1ConsoleTeamSignupAlertOptions {
  readonly database: D1DatabaseLike;
  readonly namespace: string;
  /** The platform support addresses; each gets one alert per new account. */
  readonly recipients: readonly string[];
  readonly now?: () => Date;
}

class D1ConsoleTeamSignupAlert implements ConsoleTeamSignupAlertPort {
  readonly #database: D1DatabaseLike;
  readonly #namespace: string;
  readonly #recipients: readonly string[];
  readonly #now: () => Date;

  constructor(options: D1ConsoleTeamSignupAlertOptions) {
    this.#database = options.database;
    this.#namespace = requiredText(options.namespace, 'namespace');
    this.#recipients = options.recipients.map(requiredEmail);
    this.#now = options.now || defaultNow;
  }

  async enqueue(alert: ConsoleTeamSignupAlert): Promise<void> {
    const userId = requiredText(alert.userId, 'userId');
    const now = this.#now();
    const template = buildTeamSignupAlertEmailV1({
      accountEmail: alert.accountEmail,
      accountDisplayName: alert.accountDisplayName,
      organizationName: alert.organizationName,
      signedUpAt: now.toISOString(),
    });
    const statements: D1PreparedStatementLike[] = [];
    for (const recipient of this.#recipients) {
      const dedupeKey = `team-signup-alert:${userId}:${recipient}`;
      statements.push(
        await createConsoleEmailOutboxInsertStatement({
          database: this.#database,
          namespace: this.#namespace,
          conflictPolicy: 'IGNORE_DEDUPE',
          email: {
            outboxId: dedupeKey,
            dedupeKey,
            orgId: requiredText(alert.orgId, 'orgId'),
            recipient: { email: recipient, displayName: 'Seams team' },
            template,
            createdAt: now,
            availableAt: now,
          },
        }),
      );
    }
    if (statements.length > 0) await this.#database.batch(statements);
  }
}

/** Returns null when no support address is configured, so callers skip the alert. */
export function createD1ConsoleTeamSignupAlert(
  options: D1ConsoleTeamSignupAlertOptions,
): ConsoleTeamSignupAlertPort | null {
  if (options.recipients.length === 0) return null;
  return new D1ConsoleTeamSignupAlert(options);
}

function requiredText(value: string, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function requiredEmail(value: string): string {
  const normalized = requiredText(value, 'recipient').toLowerCase();
  if (!normalized.includes('@')) throw new Error('recipient must be an email address');
  return normalized;
}

function defaultNow(): Date {
  return new Date();
}
