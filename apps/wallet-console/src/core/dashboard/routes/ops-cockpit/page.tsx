import React from 'react';
import { toast } from 'sonner';
import { t } from '@core/i18n';
import { useSiteRouter } from '@core/router/useSiteRouter';
import { GrainField, type GrainFieldName } from '@seams-internal/grain-field';
import { formatDashboardTimestamp } from '../../utils/timestamps';
import { KeyRoundIcon } from '../../icons/SidebarIcons';
import type { SidebarIconComponent } from '../../types';
import { useDashboardConsoleSession } from '../../consoleSession';
import {
  getDashboardOpsCockpitSummary,
  type DashboardOpsCockpitDeadLetterEntry,
  type DashboardOpsCockpitPendingApproval,
  type DashboardOpsCockpitSectionStatus,
  type DashboardOpsCockpitSummary,
} from './consoleOpsCockpitApi';
import { replayDashboardWebhookDelivery } from '../webhooks/consoleWebhooksApi';

type OpsCockpitData = {
  summary: DashboardOpsCockpitSummary | null;
  warnings: string[];
};

const OPS_COCKPIT_APPROVE_REASON = 'Approved from Ops Cockpit';
const OPS_COCKPIT_REJECT_REASON = 'Rejected from Ops Cockpit';

function formatTimestamp(value: string | null | undefined): string {
  return formatDashboardTimestamp(value, '—');
}

function formatApprovalLabel(value: string | null | undefined): string {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  if (normalized === 'KEY_EXPORT') return t('overviewApprovalKeyExport');
  if (normalized === 'POLICY_PUBLISH') return t('overviewApprovalPolicyPublish');
  if (!normalized) return t('overviewApprovalDefault');
  return normalized
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || t('auditUnknownError'));
}

function isPlatformSupportAccessMessage(message: string): boolean {
  return message.includes('platform.support access');
}

function toSectionWarning(label: string, status: DashboardOpsCockpitSectionStatus): string | null {
  if (status.state === 'ok') return null;
  /* Unconfigured queues hide their panels entirely; a warning would just
     re-surface the noise the hidden panel avoids. */
  if (status.state === 'not_configured') return null;
  const detail = status.message ? `: ${status.message}` : '';
  if (status.state === 'forbidden') return t('overviewWarningForbidden', { label, detail });
  return t('overviewWarningFailed', { label, detail });
}

const CORE_OVERVIEW_HERO_ACTIONS: readonly OpsCockpitQuickAction[] = [
  {
    title: t('overviewApiKeysTitle'),
    description: t('overviewApiKeysDescription'),
    path: '/dashboard/api-keys',
    icon: KeyRoundIcon,
    field: 'azure-coral',
  },
] as const;

export type OpsCockpitQuickAction = {
  title: string;
  description: string;
  path: string;
  icon: SidebarIconComponent;
  /* one of the front-page product fields, behind the white glyph */
  field: GrainFieldName;
};

export type OpsCockpitApprovalActions = {
  approve: (input: {
    approvalId: string;
    reason: string;
    mfaVerified: boolean;
  }) => Promise<{ status: string }>;
  reject: (input: { approvalId: string; reason: string }) => Promise<{ status: string }>;
};

type OpsCockpitPageProps = {
  approvalActions?: OpsCockpitApprovalActions;
  productQuickActions: readonly OpsCockpitQuickAction[];
  heroTitle: string;
  creditsDescription: string;
};

/* Fills `{name}` slots in a message with React nodes, so a sentence can carry
   <strong> and <code> parts while each language keeps its own word order. */
function renderMessage(
  template: string,
  slots: Readonly<Record<string, React.ReactNode>>,
): React.ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name !== undefined && name in slots ? (
      <React.Fragment key={index}>{slots[name]}</React.Fragment>
    ) : (
      part
    );
  });
}

function OpsCockpitQueuePanel(props: {
  ariaLabel: string;
  title: string;
  badge: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { ariaLabel, title, badge, children } = props;
  return (
    <section className="dashboard-ops-cockpit-panel" aria-label={ariaLabel}>
      <div className="dashboard-ops-cockpit-panel__summary">
        <h3 className="dashboard-ops-cockpit-panel__title">{title}</h3>
        <span className="dashboard-ops-cockpit-panel__badge">{badge}</span>
      </div>
      <div className="dashboard-ops-cockpit-panel__body">{children}</div>
    </section>
  );
}

export function OpsCockpitPage({
  approvalActions,
  productQuickActions,
  heroTitle,
  creditsDescription,
}: OpsCockpitPageProps): React.JSX.Element {
  const session = useDashboardConsoleSession();
  const { linkProps } = useSiteRouter();

  const [loading, setLoading] = React.useState<boolean>(true);
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [approvingApprovalId, setApprovingApprovalId] = React.useState<string>('');
  const [rejectingApprovalId, setRejectingApprovalId] = React.useState<string>('');
  const [approvalMutationErrorMessage, setApprovalMutationErrorMessage] =
    React.useState<string>('');
  const [replayingDeadLetterId, setReplayingDeadLetterId] = React.useState<string>('');
  const [mutationErrorMessage, setMutationErrorMessage] = React.useState<string>('');
  const [data, setData] = React.useState<OpsCockpitData>({
    summary: null,
    warnings: [],
  });

  const loadOpsCockpit = React.useCallback(() => {
    if (!session.claims) {
      setLoading(false);
      setData({
        summary: null,
        warnings: [],
      });
      setErrorMessage(session.errorMessage || t('auditSessionUnavailable'));
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMessage('');

    (async () => {
      const summary = await getDashboardOpsCockpitSummary({ windowMinutes: 60 });
      const warnings = [
        toSectionWarning(t('overviewQueueApprovals'), summary.approvals.status),
        toSectionWarning(t('overviewQueueBillingFailures'), summary.billing.status),
        toSectionWarning(t('overviewQueueWebhookDeadLetters'), summary.webhooks.status),
      ].filter(
        (entry): entry is string => Boolean(entry) && !isPlatformSupportAccessMessage(entry || ''),
      );
      if (summary.webhooks.endpointCount > summary.webhooks.scannedEndpointCount) {
        warnings.push(
          t('overviewWebhookScanCapped', {
            scanned: summary.webhooks.scannedEndpointCount,
            total: summary.webhooks.endpointCount,
          }),
        );
      }

      if (cancelled) return;
      setData({
        summary,
        warnings,
      });
      setLoading(false);
    })().catch((error: unknown) => {
      if (cancelled) return;
      setLoading(false);
      setErrorMessage(toErrorMessage(error));
    });

    return () => {
      cancelled = true;
    };
  }, [session.claims, session.errorMessage]);

  React.useEffect(() => {
    if (session.loading) {
      setLoading(true);
      return;
    }
    const cleanup = loadOpsCockpit();
    return cleanup;
  }, [loadOpsCockpit, session.loading]);

  const onReplayDeadLetter = React.useCallback(
    async (entry: DashboardOpsCockpitDeadLetterEntry) => {
      if (!session.claims) {
        setMutationErrorMessage(session.errorMessage || t('auditSessionUnavailable'));
        return;
      }
      const deliveryId = String(entry.deadLetter.deliveryId || '').trim();
      if (!deliveryId) {
        setMutationErrorMessage(t('overviewReplayUnavailable'));
        return;
      }
      setReplayingDeadLetterId(entry.deadLetter.id);
      setMutationErrorMessage('');
      try {
        await replayDashboardWebhookDelivery({
          endpointId: entry.endpointId,
          deliveryId,
        });
        toast.success(t('overviewReplayQueued', { id: deliveryId }));
        loadOpsCockpit();
      } catch (error: unknown) {
        setMutationErrorMessage(toErrorMessage(error));
      } finally {
        setReplayingDeadLetterId('');
      }
    },
    [loadOpsCockpit, session.claims, session.errorMessage],
  );

  const onApprovePendingApproval = React.useCallback(
    async (entry: DashboardOpsCockpitPendingApproval) => {
      if (!session.claims) {
        setApprovalMutationErrorMessage(session.errorMessage || t('auditSessionUnavailable'));
        return;
      }
      if (entry.requireMfa) {
        setApprovalMutationErrorMessage(t('overviewApproveUnavailableMfa'));
        return;
      }
      const approvalId = String(entry.id || '').trim();
      if (!approvalId) {
        setApprovalMutationErrorMessage(t('overviewApprovalIdRequired'));
        return;
      }
      setApprovingApprovalId(approvalId);
      setApprovalMutationErrorMessage('');
      try {
        if (!approvalActions) throw new Error(t('overviewApprovalActionsUnavailable'));
        const updated = await approvalActions.approve({
          approvalId,
          reason: OPS_COCKPIT_APPROVE_REASON,
          mfaVerified: false,
        });
        toast.success(t('overviewApprovalNowStatus', { id: approvalId, status: updated.status }));
        loadOpsCockpit();
      } catch (error: unknown) {
        setApprovalMutationErrorMessage(toErrorMessage(error));
      } finally {
        setApprovingApprovalId('');
      }
    },
    [approvalActions, loadOpsCockpit, session.claims, session.errorMessage],
  );

  const onRejectPendingApproval = React.useCallback(
    async (entry: DashboardOpsCockpitPendingApproval) => {
      if (!session.claims) {
        setApprovalMutationErrorMessage(session.errorMessage || t('auditSessionUnavailable'));
        return;
      }
      const approvalId = String(entry.id || '').trim();
      if (!approvalId) {
        setApprovalMutationErrorMessage(t('overviewApprovalIdRequired'));
        return;
      }
      setRejectingApprovalId(approvalId);
      setApprovalMutationErrorMessage('');
      try {
        if (!approvalActions) throw new Error(t('overviewApprovalActionsUnavailable'));
        const updated = await approvalActions.reject({
          approvalId,
          reason: OPS_COCKPIT_REJECT_REASON,
        });
        toast.success(t('overviewApprovalNowStatus', { id: approvalId, status: updated.status }));
        loadOpsCockpit();
      } catch (error: unknown) {
        setApprovalMutationErrorMessage(toErrorMessage(error));
      } finally {
        setRejectingApprovalId('');
      }
    },
    [approvalActions, loadOpsCockpit, session.claims, session.errorMessage],
  );

  const summary = data.summary;
  const pendingApprovals = summary?.approvals.pending || [];
  const failedInvoices = summary?.billing.failedInvoices || [];
  const failedWebhooks = summary?.webhooks.deadLetters || [];
  const showWebhookQueue = summary?.webhooks.status.state !== 'not_configured';
  const showBillingQueue = summary?.billing.status.state !== 'not_configured';
  const summaryWarnings = data.warnings;
  const visibleErrorMessage = isPlatformSupportAccessMessage(errorMessage) ? '' : errorMessage;

  return (
    <div className="dashboard-view dashboard-ops-cockpit-view" aria-label={t('overviewPageLabel')}>
      <section className="dashboard-hero" aria-label={t('overviewQuickActionsLabel')}>
        <div className="dashboard-hero__primary">
          <h2 className="dashboard-hero__title">{heroTitle}</h2>
          <div className="dashboard-hero__cards">
            {[...CORE_OVERVIEW_HERO_ACTIONS, ...productQuickActions].map((action) => {
              const ActionIcon = action.icon;
              const navProps = linkProps(action.path);
              return (
                <a
                  key={action.path}
                  className="dashboard-hero__card"
                  href={navProps.href}
                  onClick={navProps.onClick}
                >
                  <span className="dashboard-hero__card-icon" aria-hidden="true">
                    <GrainField field={action.field} playing={false} />
                    <ActionIcon size={20} />
                  </span>
                  <span className="dashboard-hero__card-title">{action.title}</span>
                  <span className="dashboard-hero__card-description">{action.description}</span>
                </a>
              );
            })}
          </div>
          <a
            className="dashboard-hero__promo"
            href={linkProps('/dashboard/billing/account').href}
            onClick={linkProps('/dashboard/billing/account').onClick}
          >
            <GrainField field="teal-peach" />
            <span className="dashboard-hero__promo-copy">
              <span className="dashboard-hero__promo-title">{t('overviewCredits')}</span>
              <span className="dashboard-hero__promo-description">{creditsDescription}</span>
            </span>
            <span className="dashboard-pagination-button dashboard-pagination-button--primary">
              {t('overviewAddCredits')}
            </span>
          </a>
          <div className="dashboard-hero__status-grid">
            <section
              className="dashboard-hero__status-card"
              aria-label={t('overviewPendingApprovalsLabel')}
            >
              <h2>{t('overviewPendingApprovals')}</h2>
              {approvalMutationErrorMessage ? (
                <p className="dashboard-pagination-note">{approvalMutationErrorMessage}</p>
              ) : null}
              {pendingApprovals.length === 0 ? (
                <p className="dashboard-pagination-note">{t('overviewNoPendingApprovals')}</p>
              ) : (
                <ul className="dashboard-view-list">
                  {pendingApprovals.slice(0, 6).map((row) => (
                    <li key={row.id}>
                      <p>
                        {renderMessage(t('overviewApprovalLine'), {
                          operation: <strong>{formatApprovalLabel(row.operationType)}</strong>,
                          resource: (row.resourceType
                            ? formatApprovalLabel(row.resourceType)
                            : t('overviewApprovalResource')
                          ).toLowerCase(),
                          resourceId: <code>{row.resourceId || row.id}</code>,
                          user: <code>{row.requestedByUserId}</code>,
                          time: formatTimestamp(row.createdAt),
                        })}
                      </p>
                      {row.reason ? (
                        <p className="dashboard-pagination-note">
                          {t('overviewRequestedReason', { reason: row.reason })}
                        </p>
                      ) : null}
                      <p className="dashboard-pagination-note">
                        {row.requiredApprovals === 1
                          ? t('overviewApprovalsRequiredOne')
                          : t('overviewApprovalsRequiredMany', {
                              count: row.requiredApprovals,
                            })}{' '}
                        {row.requireMfa ? t('overviewMfaRequiredToApprove') : ''}
                      </p>
                      {row.requireMfa ? (
                        <p className="dashboard-pagination-note">
                          {t('overviewApproveUnavailableMfa')}
                        </p>
                      ) : null}
                      <p>
                        {!row.requireMfa ? (
                          <>
                            <button
                              type="button"
                              className="dashboard-inline-link"
                              onClick={() => onApprovePendingApproval(row)}
                              disabled={
                                approvingApprovalId === row.id || rejectingApprovalId === row.id
                              }
                            >
                              {approvingApprovalId === row.id
                                ? t('overviewApproving')
                                : t('overviewApprove')}
                            </button>{' '}
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="dashboard-inline-link dashboard-inline-link--danger"
                          onClick={() => onRejectPendingApproval(row)}
                          disabled={
                            approvingApprovalId === row.id || rejectingApprovalId === row.id
                          }
                        >
                          {rejectingApprovalId === row.id
                            ? t('overviewRejecting')
                            : t('overviewReject')}
                        </button>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {showBillingQueue ? (
              <OpsCockpitQueuePanel
                ariaLabel={t('overviewBillingSummaryLabel')}
                title={t('overviewFailedInvoices')}
                badge={`${failedInvoices.length}`}
              >
                {failedInvoices.length === 0 ? (
                  <p className="dashboard-pagination-note">{t('overviewNoFailedInvoices')}</p>
                ) : (
                  <ul className="dashboard-view-list">
                    {failedInvoices.slice(0, 6).map((row) => (
                      <li key={row.id}>
                        {renderMessage(t('overviewInvoiceLine'), {
                          id: <code>{row.id}</code>,
                          status: <strong>{row.status}</strong>,
                          date: formatTimestamp(row.dueAt),
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </OpsCockpitQueuePanel>
            ) : null}

            {showWebhookQueue ? (
              <OpsCockpitQueuePanel
                ariaLabel={t('overviewWebhookSummaryLabel')}
                title={t('overviewFailedWebhooks')}
                badge={`${failedWebhooks.length}`}
              >
                {mutationErrorMessage ? (
                  <p className="dashboard-pagination-note">{mutationErrorMessage}</p>
                ) : null}
                {failedWebhooks.length === 0 ? (
                  <p className="dashboard-pagination-note">{t('overviewNoDeadLetters')}</p>
                ) : (
                  <ul className="dashboard-view-list">
                    {failedWebhooks.slice(0, 8).map((entry) => (
                      <li key={entry.deadLetter.id}>
                        {renderMessage(t('overviewDeadLetterLine'), {
                          endpoint: <code>{entry.endpointId}</code>,
                          event: (
                            <code>{entry.deadLetter.eventType || entry.deadLetter.eventId}</code>
                          ),
                          attempts: <strong>{entry.deadLetter.failedAttempts}</strong>,
                          error: entry.deadLetter.lastErrorMessage || t('overviewNotAvailable'),
                          time: formatTimestamp(entry.deadLetter.movedToDlqAt),
                        })}{' '}
                        <button
                          type="button"
                          className="dashboard-inline-link"
                          onClick={() => onReplayDeadLetter(entry)}
                          disabled={
                            replayingDeadLetterId === entry.deadLetter.id ||
                            !String(entry.deadLetter.deliveryId || '').trim()
                          }
                        >
                          {replayingDeadLetterId === entry.deadLetter.id
                            ? t('overviewReplaying')
                            : t('overviewReplay')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </OpsCockpitQueuePanel>
            ) : null}
          </div>
        </div>
      </section>

      {loading || visibleErrorMessage || summaryWarnings.length > 0 ? (
        <section
          className="dashboard-view__section dashboard-ops-cockpit-summary--plain"
          aria-label={t('overviewSummaryLabel')}
        >
          {loading ? (
            <p className="dashboard-pagination-note">{t('overviewRefreshingQueues')}</p>
          ) : null}
          {visibleErrorMessage ? (
            <p className="dashboard-pagination-note">{visibleErrorMessage}</p>
          ) : null}
          {summaryWarnings.length > 0 ? (
            <div className="dashboard-view-grid">
              {summaryWarnings.map((warning) => (
                <p className="dashboard-pagination-note" key={warning}>
                  {warning}
                </p>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
