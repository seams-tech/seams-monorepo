import { estimate, USER_STEPS, MIN_PER_DAY, MAX_PER_DAY } from '@/pages/pricing/estimate';
import { CONTACT_LINK_TARGET } from './contactLink';

type CalculatorInputs = { readonly users: number; readonly perDay: number };

export type ContactPricingContext = {
  readonly plan: 'enterprise';
  readonly source: 'pricing_card' | 'pricing_calculator';
  readonly estimate: CalculatorInputs | null;
};

export function enterpriseContactHref(inputs: CalculatorInputs | null): string {
  const params = new URLSearchParams({
    plan: 'enterprise',
    src: inputs ? 'pricing_calculator' : 'pricing_card',
  });
  if (inputs) {
    params.set('users', String(inputs.users));
    params.set('per_day', String(inputs.perDay));
  }
  return `${CONTACT_LINK_TARGET}?${params}`;
}

export function readContactPricingContext(hash: string): ContactPricingContext | null {
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  if (params.getAll('plan').length !== 1 || params.get('plan') !== 'enterprise') return null;
  const source = params.get('src');
  if (
    params.getAll('src').length !== 1 ||
    (source !== 'pricing_card' && source !== 'pricing_calculator')
  )
    return null;
  const usersText = params.get('users') ?? '';
  const perDayText = params.get('per_day') ?? '';
  const users = Number(usersText);
  const perDay = Number(perDayText);
  const validEstimate =
    source === 'pricing_calculator' &&
    params.getAll('users').length === 1 &&
    params.getAll('per_day').length === 1 &&
    /^\d+$/.test(usersText) &&
    /^\d+$/.test(perDayText) &&
    USER_STEPS.includes(users) &&
    Number.isInteger(perDay) &&
    perDay >= MIN_PER_DAY &&
    perDay <= MAX_PER_DAY;
  return { plan: 'enterprise', source, estimate: validEstimate ? { users, perDay } : null };
}

/** USD amounts are recomputed here. URL prices and free text are never used. */
export function contactPricingLines(context: ContactPricingContext): string[] {
  const lines = ['Plan: Enterprise', `Source: ${context.source}`];
  if (!context.estimate) return lines;
  const { users, perDay } = context.estimate;
  lines.push(
    `Monthly active users: ${users.toLocaleString('en-US')}`,
    `Signatures per user per day: ${perDay}`,
    `Growth estimate: USD ${estimate('growth', users, perDay).total.toFixed(2)}/month`,
    `Pro estimate: USD ${estimate('pro', users, perDay).total.toFixed(2)}/month`,
    `Enterprise floor: USD ${estimate('enterprise', users, perDay).total.toFixed(2)}/month`,
    'Estimate uses 30 days. Enterprise terms require an agreement.',
  );
  return lines;
}
