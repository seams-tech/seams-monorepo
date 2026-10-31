import type { ConsoleAuditService } from '../audit/service';
import { ConsoleAuditError } from '../audit/errors';

export interface ConsoleFunnelIntent {
  readonly plan: 'free' | 'growth' | 'pro';
  readonly src: 'pricing_card';
  readonly projectId: string;
}

/** Parse the optional attribution at the HTTP boundary. It grants no authority. */
export function parseConsoleFunnelIntent(raw: unknown): ConsoleFunnelIntent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const plan = Reflect.get(raw, 'plan');
  const src = Reflect.get(raw, 'src');
  const projectId = Reflect.get(raw, 'projectId');
  if (Object.keys(raw).some(isUnknownIntentField)) return null;
  if (plan !== 'free' && plan !== 'growth' && plan !== 'pro') return null;
  if (
    src !== 'pricing_card' ||
    typeof projectId !== 'string' ||
    !/^proj_[a-f0-9]{32}$/.test(projectId)
  )
    return null;
  return { plan, src, projectId };
}

function isUnknownIntentField(field: string): boolean {
  return field !== 'plan' && field !== 'src' && field !== 'projectId';
}

export type ConsoleFunnelActor =
  | { readonly kind: 'visitor'; readonly userId?: never; readonly orgId?: never }
  | { readonly kind: 'account'; readonly userId: string; readonly orgId: string | null };

export type ConsoleFunnelStep =
  | 'console_login_view'
  | 'console_identity_created'
  | 'console_signin_existing'
  | 'plan_ready'
  | 'growth_continue_free'
  | 'card_setup_canceled';

/** Stable audit IDs count a completed step once across reloads and request retries. */
export async function recordConsoleFunnelStep(
  audit: ConsoleAuditService,
  actor: ConsoleFunnelActor,
  intent: ConsoleFunnelIntent,
  step: ConsoleFunnelStep,
  provider: 'google' | 'github' | null,
): Promise<boolean> {
  const userId = actor.kind === 'account' ? actor.userId : 'anonymous';
  const key = step === 'console_identity_created' ? userId : `${intent.projectId}:${userId}`;
  try {
    await audit.appendEvent(
      {
        orgId: actor.kind === 'account' ? (actor.orgId ?? 'console-funnel') : 'console-funnel',
        actorUserId: userId,
      },
      {
        id: `funnel:${step}:${key}`,
        category: 'SYSTEM',
        action: step,
        outcome: 'SUCCESS',
        summary: step,
        metadata: { plan: intent.plan, src: intent.src, intentId: intent.projectId, provider },
      },
    );
    return true;
  } catch (error) {
    if (error instanceof ConsoleAuditError && error.code === 'event_already_exists') return false;
    throw error;
  }
}
