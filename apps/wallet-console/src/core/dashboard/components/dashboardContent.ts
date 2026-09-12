import type { DashboardRoute } from '../types';

export type DashboardChecklistCard = {
  title: string;
  items: readonly string[];
};

type CardDashboardRoute = Exclude<
  DashboardRoute,
  | '/dashboard/onboarding'
  | '/dashboard/account-settings'
  | '/dashboard/billing/account'
  | '/dashboard/invoices'
  | '/platform/billing'
  | '/dashboard/team-members'
  | '/dashboard/audit'
  | '/dashboard/overview'
  | '/dashboard/observability'
>;

export const DASHBOARD_CARD_PAGE_CONTENT = {
  '/dashboard/api-keys': [
    {
      title: 'Credential modes',
      items: [
        'Create server-side `secret_key` credentials with scoped relay permissions.',
        'Create browser-safe `publishable_key` credentials with allowed-origin and managed-broker policy fields.',
        'Credential values are visible once at creation or rotation and never retrievable later.',
      ],
    },
    {
      title: 'Usage and anomaly monitoring',
      items: [
        'Last-used timestamp and endpoint distribution for `secret_key` traffic.',
        'Allowed-origin, quota-bucket, and rate-bucket visibility for `publishable_key` records.',
        'Audit logging for create/revoke/rotate actions across both credential kinds.',
      ],
    },
  ],
  '/dashboard/webhooks': [
    {
      title: 'Endpoint and signing setup',
      items: [
        'Register endpoints with event categories.',
        'Signed payloads with rotating secrets.',
        'Event categories: wallet, policy, auth, tx lifecycle, session.',
      ],
    },
    {
      title: 'Delivery operations',
      items: [
        'Backoff retries and dead-letter queue handling.',
        'Delivery logs with request and response metadata.',
        'Replay actions for failed webhook deliveries.',
      ],
    },
  ],
} as const satisfies Record<CardDashboardRoute, readonly DashboardChecklistCard[]>;

export function getDashboardChecklistCards(
  route: CardDashboardRoute,
): readonly DashboardChecklistCard[] {
  return DASHBOARD_CARD_PAGE_CONTENT[route];
}
