import { consoleLocale, t, type MessageKey } from '@core/i18n';
import type { DashboardTableTone } from '@core/dashboard/components/DashboardTable';

/* Wire statuses arrive as SCREAMING_SNAKE enums. Rendering them raw is what
   makes a table read like a database dump, so every surface routes them
   through here: one tone map, one label case. */

const SUCCESS_STATUSES = new Set([
  'ACTIVE',
  'HEALTHY',
  'DELIVERED',
  'ENABLED',
  'PUBLISHED',
  'RESOLVED',
  'ACCEPTED',
  'COMPLETED',
  'APPROVED',
]);

const WARNING_STATUSES = new Set([
  'DEGRADED',
  'PAUSED',
  'RETRYING',
  'PENDING',
  'SUSPENDED',
  'DRAFT',
  'EXPIRED',
  'WARN',
  'UNKNOWN',
]);

const DANGER_STATUSES = new Set([
  'FAILING',
  'FAILED',
  'REVOKED',
  'FROZEN',
  'REMOVED',
  'ARCHIVED',
  'DECLINED',
  'DISABLED',
  'ERROR',
  'FATAL',
  'DEAD_LETTER',
]);

export function dashboardStatusTone(raw: string): DashboardTableTone {
  const key = String(raw || '')
    .trim()
    .toUpperCase();
  if (SUCCESS_STATUSES.has(key)) return 'success';
  if (WARNING_STATUSES.has(key)) return 'warning';
  if (DANGER_STATUSES.has(key)) return 'danger';
  return 'neutral';
}

const STATUS_MESSAGE_KEYS: Readonly<Record<string, MessageKey>> = {
  ACTIVE: 'commonStatusActive',
  HEALTHY: 'commonStatusHealthy',
  DELIVERED: 'commonStatusDelivered',
  ENABLED: 'commonStatusEnabled',
  PUBLISHED: 'commonStatusPublished',
  RESOLVED: 'commonStatusResolved',
  ACCEPTED: 'commonStatusAccepted',
  COMPLETED: 'commonStatusCompleted',
  APPROVED: 'commonStatusApproved',
  DEGRADED: 'commonStatusDegraded',
  PAUSED: 'commonStatusPaused',
  RETRYING: 'commonStatusRetrying',
  PENDING: 'commonStatusPending',
  SUSPENDED: 'commonStatusSuspended',
  DRAFT: 'commonStatusDraft',
  EXPIRED: 'commonStatusExpired',
  WARN: 'commonStatusWarn',
  UNKNOWN: 'commonStatusUnknown',
  FAILING: 'commonStatusFailing',
  FAILED: 'commonStatusFailed',
  REVOKED: 'commonStatusRevoked',
  FROZEN: 'commonStatusFrozen',
  REMOVED: 'commonStatusRemoved',
  ARCHIVED: 'commonStatusArchived',
  DECLINED: 'commonStatusDeclined',
  DISABLED: 'commonStatusDisabled',
  ERROR: 'commonStatusError',
  FATAL: 'commonStatusFatal',
  DEAD_LETTER: 'commonStatusDeadLetter',
  INFO: 'commonStatusInfo',
  SUCCESS: 'commonStatusSuccess',
  SUCCEEDED: 'commonStatusSucceeded',
  OPEN: 'commonStatusOpen',
  CLOSED: 'commonStatusClosed',
  INVITED: 'commonStatusInvited',
  INACTIVE: 'commonStatusInactive',
  PROCESSING: 'commonStatusProcessing',
  QUEUED: 'commonStatusQueued',
  RUNNING: 'commonStatusRunning',
  REJECTED: 'commonStatusRejected',
  PAID: 'commonStatusPaid',
  UNPAID: 'commonStatusUnpaid',
  PAST_DUE: 'commonStatusPastDue',
  CANCELED: 'commonStatusCanceled',
  CANCELLED: 'commonStatusCancelled',
  TRIALING: 'commonStatusTrialing',
};

/* English keeps the capitalisation rules below. Other languages look the known
   wire statuses up by name and fall back to the English rules for the rest. */
function translatedStatusLabel(value: string): string {
  if (consoleLocale === 'en') return '';
  const key = STATUS_MESSAGE_KEYS[value.toUpperCase().replace(/[\s-]+/g, '_')];
  return key ? t(key) : '';
}

/** `DEAD_LETTER` -> `Dead letter`, `active` -> `Active`, `Healthy` -> `Healthy`. */
export function dashboardStatusLabel(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  // Only flatten case for wire enums; a label that already carries mixed case
  // was written by a human and keeps its own capitalisation.
  const translated = translatedStatusLabel(value);
  if (translated) return translated;
  const normalized = value === value.toUpperCase() ? value.toLowerCase() : value;
  const words = normalized.split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return '';
  const [first, ...rest] = words;
  return [`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest].join(' ');
}

/** Placeholder for an absent value. An em dash reads as "none", `-` as a typo. */
export const DASHBOARD_EMPTY_VALUE = '—';
