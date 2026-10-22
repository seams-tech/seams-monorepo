import {
  buildConsoleAcceptHeaders,
  buildConsoleJsonHeaders,
  consoleErrorMessage,
  parseConsoleJson,
  requireConsoleBaseUrl,
} from '../../consoleHttp';

export type DashboardFreePlanLimit = 'active_users' | 'signatures';

export type DashboardFreePlanBanner =
  | { readonly kind: 'card_due'; readonly deadlineAt: string }
  | { readonly kind: 'card_required' }
  | {
      readonly kind: 'free_limit_warning';
      readonly limit: DashboardFreePlanLimit;
      readonly cardOnFile: boolean;
    }
  | { readonly kind: 'free_limit_reached'; readonly limit: DashboardFreePlanLimit }
  | { readonly kind: 'growth_move'; readonly startedAt: string; readonly monthlyBaseMinor: number };

export type DashboardPaymentCard =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'usable' | 'expired' | 'removed';
      readonly brand: string;
      readonly last4: string;
      readonly expMonth: number;
      readonly expYear: number;
    };

/** The paid plans that an owner starts from the Console with a verified card. */
export type DashboardSelfServePlan = 'growth' | 'pro';

export interface DashboardBillingPlan {
  readonly plan: 'free' | DashboardSelfServePlan | 'enterprise';
  readonly cardDeadlineAt: string | null;
  readonly planStartedAt: string | null;
  readonly productionState: 'active' | 'card_required' | 'free_limit_reached';
  readonly card: DashboardPaymentCard;
  readonly usage: {
    readonly monthUtc: string;
    readonly productionActiveUsers: number;
    readonly productionSignatures: number;
    readonly limits: {
      readonly productionActiveUsers: number;
      readonly productionSignatures: number;
    };
  };
  readonly banners: readonly DashboardFreePlanBanner[];
}

export function dashboardPlanName(plan: DashboardBillingPlan['plan']): string {
  switch (plan) {
    case 'free':
      return 'Free';
    case 'growth':
      return 'Growth';
    case 'pro':
      return 'Pro';
    case 'enterprise':
      return 'Enterprise';
  }
}

export class DashboardFreePlanApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DashboardFreePlanApiError';
  }
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function limit(value: unknown): DashboardFreePlanLimit | null {
  return value === 'active_users' || value === 'signatures' ? value : null;
}

function decodeBanner(raw: unknown): DashboardFreePlanBanner | null {
  const value = record(raw);
  if (!value) return null;
  switch (value.kind) {
    case 'card_due': {
      const deadlineAt = text(value.deadlineAt);
      return deadlineAt ? { kind: 'card_due', deadlineAt } : null;
    }
    case 'card_required':
      return { kind: 'card_required' };
    case 'free_limit_warning': {
      const reached = limit(value.limit);
      return reached && typeof value.cardOnFile === 'boolean'
        ? { kind: 'free_limit_warning', limit: reached, cardOnFile: value.cardOnFile }
        : null;
    }
    case 'free_limit_reached': {
      const reached = limit(value.limit);
      return reached ? { kind: 'free_limit_reached', limit: reached } : null;
    }
    case 'growth_move': {
      const startedAt = text(value.startedAt);
      const monthlyBaseMinor = count(value.monthlyBaseMinor);
      return startedAt && monthlyBaseMinor !== null
        ? { kind: 'growth_move', startedAt, monthlyBaseMinor }
        : null;
    }
    default:
      return null;
  }
}

function decodeCard(raw: unknown): DashboardPaymentCard | null {
  const value = record(raw);
  if (!value) return null;
  if (value.kind === 'none') return { kind: 'none' };
  if (value.kind !== 'usable' && value.kind !== 'expired' && value.kind !== 'removed') return null;
  const brand = text(value.brand);
  const last4 = text(value.last4);
  const expMonth = count(value.expMonth);
  const expYear = count(value.expYear);
  if (!brand || !last4 || expMonth === null || expYear === null) return null;
  return { kind: value.kind, brand, last4, expMonth, expYear };
}

export function decodeDashboardBillingPlan(raw: unknown): DashboardBillingPlan | null {
  const value = record(raw);
  const usage = record(value?.usage);
  const limits = record(usage?.limits);
  if (!value || !usage || !limits) return null;
  const plan = value.plan;
  const productionState = value.productionState;
  const card = decodeCard(value.card);
  const monthUtc = text(usage.monthUtc);
  const productionActiveUsers = count(usage.productionActiveUsers);
  const productionSignatures = count(usage.productionSignatures);
  const activeUserLimit = count(limits.productionActiveUsers);
  const signatureLimit = count(limits.productionSignatures);
  if (
    (plan !== 'free' && plan !== 'growth' && plan !== 'pro' && plan !== 'enterprise') ||
    (productionState !== 'active' &&
      productionState !== 'card_required' &&
      productionState !== 'free_limit_reached') ||
    !card ||
    !monthUtc ||
    productionActiveUsers === null ||
    productionSignatures === null ||
    activeUserLimit === null ||
    signatureLimit === null ||
    !Array.isArray(value.banners)
  ) {
    return null;
  }
  const banners: DashboardFreePlanBanner[] = [];
  for (const entry of value.banners) {
    const banner = decodeBanner(entry);
    if (banner) banners.push(banner);
  }
  return {
    plan,
    cardDeadlineAt: text(value.cardDeadlineAt),
    planStartedAt: text(value.planStartedAt),
    productionState,
    card,
    usage: {
      monthUtc,
      productionActiveUsers,
      productionSignatures,
      limits: { productionActiveUsers: activeUserLimit, productionSignatures: signatureLimit },
    },
    banners,
  };
}

async function request(path: string, init: RequestInit): Promise<UnknownRecord> {
  const response = await fetch(`${requireConsoleBaseUrl()}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
  });
  const body = record(await parseConsoleJson(response));
  if (!response.ok || body?.ok !== true) {
    throw new DashboardFreePlanApiError(
      consoleErrorMessage(response, body, 'Billing plan request failed'),
      text(body?.code) ?? 'internal',
      response.status,
    );
  }
  return body;
}

/** Returns null when the organization has no billing account yet. */
export async function getDashboardBillingPlan(): Promise<DashboardBillingPlan | null> {
  try {
    const body = await request('/console/billing/plan', {
      method: 'GET',
      headers: buildConsoleAcceptHeaders(),
    });
    const plan = decodeDashboardBillingPlan(body.plan);
    if (!plan) throw new Error('Billing plan response was invalid');
    return plan;
  } catch (error) {
    if (error instanceof DashboardFreePlanApiError && error.code === 'billing_account_missing')
      return null;
    throw error;
  }
}

/** With `startPlan`, the card that Stripe verifies also starts that plan. */
export async function startDashboardCardSetup(
  startPlan: DashboardSelfServePlan | null = null,
): Promise<string> {
  const body = await request('/console/billing/card-setup', {
    method: 'POST',
    headers: buildConsoleJsonHeaders(),
    body: JSON.stringify(startPlan ? { startPlan } : {}),
  });
  const url = text(record(body.cardSetup)?.url);
  if (!url) throw new Error('Card setup response was invalid');
  return url;
}

export async function reconcileDashboardCardSetup(
  checkoutSessionId: string,
): Promise<{ readonly verified: boolean; readonly plan: DashboardBillingPlan | null }> {
  const body = await request('/console/billing/card-setup/reconcile', {
    method: 'POST',
    headers: buildConsoleJsonHeaders(),
    body: JSON.stringify({ checkoutSessionId }),
  });
  return { verified: body.verified === true, plan: decodeDashboardBillingPlan(body.plan) };
}

/** Starts a paid plan with the usable card on file. */
export async function startDashboardPlan(
  plan: DashboardSelfServePlan,
): Promise<DashboardBillingPlan> {
  const body = await request('/console/billing/plan/start', {
    method: 'POST',
    headers: buildConsoleJsonHeaders(),
    body: JSON.stringify({ plan }),
  });
  const started = decodeDashboardBillingPlan(body.plan);
  if (!started) throw new Error('Plan start response was invalid');
  return started;
}
