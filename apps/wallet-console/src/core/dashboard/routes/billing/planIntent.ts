import { deriveDashboardOrganizationSlug } from '../../utils/organizationIdentity';
import {
  createInitialOrganization,
  readUnscopedConsoleSession,
} from '../onboarding/initialOrganizationApi';
import {
  createDashboardOnboardingOrganization,
  createDashboardOnboardingProject,
  getDashboardOnboardingState,
} from '../onboarding/consoleOnboardingApi';
import type { DashboardSelfServePlan } from './freePlanApi';

/**
 * The plan a visitor picked on the pricing page. It only routes the visitor: a plan
 * starts on the server only from a verified card. It lives in sessionStorage, so it
 * survives the Google popup and the GitHub redirect in the same tab
 * (docs/feat-6-pricing-conversion-funnel.md, "Plan intent").
 */
const PLAN_INTENT_STORAGE_KEY = 'seams.console.pendingPlanIntent';
const PLAN_INTENT_MAX_AGE_MS = 60 * 60 * 1000;

export const DEFAULT_PLAN_ORGANIZATION_NAME = 'My organization';
export const DEFAULT_PLAN_PROJECT_NAME = 'My first app';

export type DashboardPlanChoice = 'free' | DashboardSelfServePlan;

export interface DashboardPlanIntent {
  readonly plan: DashboardPlanChoice;
  readonly src: 'pricing_card';
  readonly savedAtMs: number;
  /** Made once, so a retry or a reload creates no second project. */
  readonly projectId: string;
}

export function isDashboardPlanChoice(value: unknown): value is DashboardPlanChoice {
  return value === 'free' || value === 'growth' || value === 'pro';
}

function objectField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Reflect.get(value, key);
}

function parseIntent(value: unknown, nowMs: number): DashboardPlanIntent | null {
  const plan = objectField(value, 'plan');
  const src = objectField(value, 'src');
  const savedAtMs = objectField(value, 'savedAtMs');
  const projectId = objectField(value, 'projectId');
  if (!isDashboardPlanChoice(plan) || src !== 'pricing_card') return null;
  if (typeof savedAtMs !== 'number' || nowMs - savedAtMs > PLAN_INTENT_MAX_AGE_MS) return null;
  if (typeof projectId !== 'string' || !/^proj_[a-f0-9]{32}$/.test(projectId)) return null;
  return { plan, src, savedAtMs, projectId };
}

export function readPendingDashboardPlanIntent(): DashboardPlanIntent | null {
  try {
    const saved = window.sessionStorage.getItem(PLAN_INTENT_STORAGE_KEY);
    return saved ? parseIntent(JSON.parse(saved), Date.now()) : null;
  } catch {
    return null;
  }
}

export function clearPendingDashboardPlanIntent(): void {
  try {
    window.sessionStorage.removeItem(PLAN_INTENT_STORAGE_KEY);
  } catch {
    // Storage can be unavailable; an intent that cannot be read routes nothing.
  }
}

/** Keeps `plan` and `src` from the login URL and removes them, as for an invitation. */
export function captureDashboardPlanIntentLink(): DashboardPlanIntent | null {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('plan') && !url.searchParams.has('src')) {
    return readPendingDashboardPlanIntent();
  }
  const plan = url.searchParams.get('plan');
  const src = url.searchParams.get('src');
  url.searchParams.delete('plan');
  url.searchParams.delete('src');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  if (!isDashboardPlanChoice(plan) || src !== 'pricing_card') {
    return readPendingDashboardPlanIntent();
  }
  const intent: DashboardPlanIntent = {
    plan,
    src,
    savedAtMs: Date.now(),
    projectId: `proj_${crypto.randomUUID().replaceAll('-', '')}`,
  };
  try {
    window.sessionStorage.setItem(PLAN_INTENT_STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Without storage the intent still routes this page load.
  }
  return intent;
}

/**
 * Creates the organization and the first project with default names, so a visitor who
 * picked a plan reaches it without the onboarding form. Each step resumes from the
 * saved records, and the owner renames both later.
 */
export async function prepareDashboardAccountForPlan(
  intent: DashboardPlanIntent,
  consoleBaseUrl: string,
): Promise<void> {
  if (await readUnscopedConsoleSession(consoleBaseUrl).catch(() => false)) {
    await createInitialOrganization(
      DEFAULT_PLAN_ORGANIZATION_NAME,
      deriveDashboardOrganizationSlug(DEFAULT_PLAN_ORGANIZATION_NAME),
    );
  }
  const state = await getDashboardOnboardingState();
  if (state.currentStep === 'organization') {
    await createDashboardOnboardingOrganization({
      org: { name: DEFAULT_PLAN_ORGANIZATION_NAME },
    });
  }
  if (!state.hasProject) {
    await createDashboardOnboardingProject({
      project: { id: intent.projectId, name: DEFAULT_PLAN_PROJECT_NAME },
    });
  }
}
