import { useSiteRouter } from '@core/router/useSiteRouter';
import React from 'react';
import { t } from '@core/i18n';
import { toast } from 'sonner';
import { formatDashboardTimestamp } from '../../utils/timestamps';
import type {
  ConsoleWebhookEventCategory,
  WebhookEventCategoryOption,
} from './webhookEventCatalog';
import {
  DashboardTable,
  DashboardTableActionButton,
  DashboardTableBadge,
  DashboardTableActionGroup,
  DashboardTableActionMenu,
  DashboardTableCell,
  DashboardTableHeader,
  DashboardTableHeaderCell,
  DashboardTableRow,
  DashboardTableState,
  DashboardTableStatus,
  dashboardTableColumns,
  useDashboardTablePagination,
} from '../../components/DashboardTable';
import {
  DASHBOARD_EMPTY_VALUE,
  dashboardStatusLabel,
  dashboardStatusTone,
} from '../../utils/statusTone';
import { WebhookIcon } from '../../icons/SidebarIcons';
import { DashboardPageActions } from '../../components/DashboardPageActions';
import { useDashboardConsoleSession } from '../../consoleSession';
import { useDashboardCreateIntent } from '../../utils/routeCreateIntent';
import { CreateWebhookEndpointModal } from './CreateWebhookEndpointModal';
import { WebhookSecretRevealModal, type WebhookSecretReveal } from './WebhookSecretRevealModal';
import { WebhooksGetStarted } from './WebhooksGetStarted';
import {
  createDashboardWebhookEndpoint,
  deleteDashboardWebhookEndpoint,
  listDashboardWebhookDeliveries,
  rotateDashboardWebhookSecret,
  listDashboardWebhookEndpoints,
  replayDashboardWebhookDelivery,
  sendDashboardWebhookTestEvent,
  updateDashboardWebhookEndpoint,
  type DashboardConsoleWebhookDelivery,
  type DashboardConsoleWebhookEndpoint,
} from './consoleWebhooksApi';
import { DashboardTableSkeletonRows } from '../../components/DashboardSkeleton';

const WEBHOOK_ENDPOINTS_TABLE_COLUMNS = dashboardTableColumns(2.5, 0.7, 0.9, 1.8);
const WEBHOOK_DELIVERIES_TABLE_COLUMNS = dashboardTableColumns(1.9, 0.8, 0.65, 0.6, 0.9, 0.6);

function assertNeverTestResult(result: never): never {
  throw new Error(`Unexpected test delivery result: ${result}`);
}

async function sendTestEvent(input: {
  endpointId: string;
  setTestingEndpointId: (value: string) => void;
  selectEndpoint: (value: string) => void;
  refreshDeliveries: () => void;
}): Promise<void> {
  input.setTestingEndpointId(input.endpointId);
  input.selectEndpoint(input.endpointId);
  try {
    const result = await sendDashboardWebhookTestEvent(input.endpointId);
    switch (result) {
      case 'succeeded':
        toast.success(t('webhooksTestDelivered'));
        break;
      case 'failed':
        toast.error(t('webhooksTestFailed'));
        break;
      default:
        assertNeverTestResult(result);
    }
    input.refreshDeliveries();
  } catch (error: unknown) {
    toast.error(error instanceof Error ? error.message : t('webhooksTestCouldNotSend'));
  } finally {
    input.setTestingEndpointId('');
  }
}

function formatTimestamp(value: string | null): string {
  return formatDashboardTimestamp(value, '—');
}

function readWebhooksRouteSelection(): {
  endpointId: string;
  deliveryId: string;
} {
  if (typeof window === 'undefined') {
    return {
      endpointId: '',
      deliveryId: '',
    };
  }
  const searchParams = new URLSearchParams(window.location.search);
  return {
    endpointId: String(searchParams.get('endpointId') || '').trim(),
    deliveryId: String(searchParams.get('deliveryId') || '').trim(),
  };
}

function nextDeliveryRefresh(value: number): number {
  return value + 1;
}

async function readEndpointDeliveries(
  endpointId: string,
): Promise<DashboardConsoleWebhookDelivery[]> {
  let cursor: string | undefined;
  const deliveries: DashboardConsoleWebhookDelivery[] = [];
  do {
    const page = await listDashboardWebhookDeliveries({ endpointId, limit: 100, cursor });
    deliveries.push(...page.deliveries);
    cursor = page.nextCursor;
  } while (cursor);
  return deliveries;
}

export function WebhooksPage({
  eventCategoryOptions,
}: {
  eventCategoryOptions: readonly WebhookEventCategoryOption[];
}): React.JSX.Element {
  const { go } = useSiteRouter();
  const [deliveryRefresh, refreshDeliveries] = React.useReducer(nextDeliveryRefresh, 0);
  const session = useDashboardConsoleSession();
  const [endpoints, setEndpoints] = React.useState<DashboardConsoleWebhookEndpoint[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [mutationError, setMutationError] = React.useState<string>('');
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState<boolean>(false);
  const [creating, setCreating] = React.useState<boolean>(false);
  const [busyEndpointId, setBusyEndpointId] = React.useState<string>('');
  const [testingEndpointId, setTestingEndpointId] = React.useState('');
  const [secretReveal, setSecretReveal] = React.useState<WebhookSecretReveal | null>(null);
  const [selectedEndpointId, setSelectedEndpointId] = React.useState<string>('');
  const [requestedEndpointId, setRequestedEndpointId] = React.useState<string>(
    () => readWebhooksRouteSelection().endpointId,
  );
  const [requestedDeliveryId, setRequestedDeliveryId] = React.useState<string>(
    () => readWebhooksRouteSelection().deliveryId,
  );

  const [deliveries, setDeliveries] = React.useState<DashboardConsoleWebhookDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = React.useState<boolean>(false);
  const [deliveriesError, setDeliveriesError] = React.useState<string>('');
  const [replayingDeliveryId, setReplayingDeliveryId] = React.useState<string>('');
  const endpointsPagination = useDashboardTablePagination(endpoints, {
    disabled: session.loading || loading,
    itemLabel: t('webhooksItemEndpointSingular'),
    itemLabelPlural: t('webhooksItemEndpointPlural'),
  });
  const selectedEndpoint = React.useMemo(
    () => endpoints.find((entry) => entry.id === selectedEndpointId) || null,
    [endpoints, selectedEndpointId],
  );
  const deliveriesPagination = useDashboardTablePagination(deliveries, {
    disabled: deliveriesLoading,
    itemLabel: t('webhooksItemDeliverySingular'),
    itemLabelPlural: t('webhooksItemDeliveryPlural'),
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncRequestedRouteSelection = () => {
      const nextSelection = readWebhooksRouteSelection();
      setRequestedEndpointId(nextSelection.endpointId);
      setRequestedDeliveryId(nextSelection.deliveryId);
    };
    window.addEventListener('popstate', syncRequestedRouteSelection);
    window.addEventListener('site:navigate', syncRequestedRouteSelection as EventListener);
    return () => {
      window.removeEventListener('popstate', syncRequestedRouteSelection);
      window.removeEventListener('site:navigate', syncRequestedRouteSelection as EventListener);
    };
  }, []);

  const loadEndpoints = React.useCallback(() => {
    if (!session.claims) {
      setLoading(false);
      setEndpoints([]);
      setSelectedEndpointId('');
      setErrorMessage(session.errorMessage || t('webhooksSessionUnavailable'));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMessage('');
    listDashboardWebhookEndpoints()
      .then((rows) => {
        if (cancelled) return;
        const next = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setEndpoints(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setEndpoints([]);
        setSelectedEndpointId('');
        setErrorMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
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
    const cleanup = loadEndpoints();
    return cleanup;
  }, [loadEndpoints, session.loading]);

  React.useEffect(() => {
    if (endpoints.length === 0) {
      setSelectedEndpointId('');
      return;
    }
    if (requestedEndpointId && endpoints.some((entry) => entry.id === requestedEndpointId)) {
      if (selectedEndpointId !== requestedEndpointId) {
        setSelectedEndpointId(requestedEndpointId);
      }
      return;
    }
    if (selectedEndpointId && endpoints.some((entry) => entry.id === selectedEndpointId)) return;
    setSelectedEndpointId(endpoints[0]?.id || '');
  }, [endpoints, requestedEndpointId, selectedEndpointId]);

  React.useEffect(() => {
    let cancelled = false;
    setDeliveries([]);
    setDeliveriesError('');
    if (!selectedEndpointId || !session.claims) {
      setDeliveriesLoading(false);
      return;
    }
    setDeliveriesLoading(true);
    readEndpointDeliveries(selectedEndpointId)
      .then((rows) => {
        if (!cancelled) setDeliveries(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDeliveriesError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setDeliveriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deliveryRefresh, selectedEndpointId, session.claims]);

  React.useEffect(() => {
    const deliveryId = String(requestedDeliveryId || '').trim();
    if (!selectedEndpointId || !deliveryId || deliveries.length === 0) return;
    const deliveryIndex = deliveries.findIndex((entry) => entry.id === deliveryId);
    if (deliveryIndex < 0) return;
    const targetPage = Math.floor(deliveryIndex / deliveriesPagination.rowsPerPage) + 1;
    if (deliveriesPagination.page !== targetPage) {
      deliveriesPagination.setPage(targetPage);
    }
  }, [deliveries, deliveriesPagination, requestedDeliveryId, selectedEndpointId]);

  const onOpenCreateModal = React.useCallback(() => {
    setIsCreateModalOpen(true);
    setMutationError('');
  }, []);

  const onCloseCreateModal = React.useCallback(() => {
    if (creating) return;
    setIsCreateModalOpen(false);
    setMutationError('');
  }, [creating]);

  /* The rail's "+" deep-links into this dialog once the session can create. */
  useDashboardCreateIntent(
    '/dashboard/webhooks',
    !session.loading && Boolean(session.claims),
    onOpenCreateModal,
  );

  const onCloseSecretReveal = React.useCallback(() => setSecretReveal(null), []);

  const onCreateEndpoint = React.useCallback(
    async (input: { url: string; eventCategories: ConsoleWebhookEventCategory[] }) => {
      if (!session.claims) {
        setMutationError(session.errorMessage || t('webhooksSessionUnavailable'));
        return;
      }
      setCreating(true);
      setMutationError('');
      try {
        const { endpoint, signingSecret } = await createDashboardWebhookEndpoint({
          url: input.url,
          eventCategories: input.eventCategories,
          status: 'ACTIVE',
        });
        setIsCreateModalOpen(false);
        loadEndpoints();
        go(`/dashboard/webhooks?endpointId=${encodeURIComponent(endpoint.id)}`);
        setSecretReveal({
          endpointId: endpoint.id,
          endpointUrl: endpoint.url,
          signingSecret,
          secretVersion: endpoint.secretVersion,
          reason: 'created',
        });
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setCreating(false);
      }
    },
    [go, loadEndpoints, session.claims, session.errorMessage],
  );

  const onToggleEndpointStatus = React.useCallback(
    async (endpoint: DashboardConsoleWebhookEndpoint) => {
      if (!session.claims) {
        setMutationError(session.errorMessage || t('webhooksSessionUnavailable'));
        return;
      }
      setBusyEndpointId(endpoint.id);
      setMutationError('');
      try {
        await updateDashboardWebhookEndpoint({
          endpointId: endpoint.id,
          status: endpoint.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
        });
        loadEndpoints();
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyEndpointId('');
      }
    },
    [loadEndpoints, session.claims, session.errorMessage],
  );

  const onRotateSecret = React.useCallback(
    async (endpoint: DashboardConsoleWebhookEndpoint) => {
      if (!session.claims) {
        setMutationError(session.errorMessage || t('webhooksSessionUnavailable'));
        return;
      }
      /* Rotation invalidates the secret the customer's handler is verifying
         with, so it asks first — unlike Disable, it cannot be undone. */
      if (!window.confirm(t('webhooksRotateConfirm', { url: endpoint.url }))) {
        return;
      }
      setBusyEndpointId(endpoint.id);
      setMutationError('');
      try {
        const rotated = await rotateDashboardWebhookSecret({ endpointId: endpoint.id });
        loadEndpoints();
        setSecretReveal({
          endpointId: rotated.endpoint.id,
          endpointUrl: rotated.endpoint.url,
          signingSecret: rotated.signingSecret,
          secretVersion: rotated.endpoint.secretVersion,
          reason: 'rotated',
        });
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyEndpointId('');
      }
    },
    [loadEndpoints, session.claims, session.errorMessage],
  );

  const onDeleteEndpoint = React.useCallback(
    async (endpointId: string) => {
      if (!session.claims) {
        setMutationError(session.errorMessage || t('webhooksSessionUnavailable'));
        return;
      }
      if (!window.confirm(t('webhooksDeleteConfirm', { id: endpointId }))) return;
      setBusyEndpointId(endpointId);
      setMutationError('');
      try {
        await deleteDashboardWebhookEndpoint({ endpointId });
        if (selectedEndpointId === endpointId) {
          setSelectedEndpointId('');
        }
        loadEndpoints();
      } catch (error: unknown) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyEndpointId('');
      }
    },
    [loadEndpoints, selectedEndpointId, session.claims, session.errorMessage],
  );

  const onReplayDelivery = React.useCallback(
    async (endpointId: string, deliveryId: string) => {
      if (!session.claims) {
        setDeliveriesError(session.errorMessage || t('webhooksSessionUnavailable'));
        return;
      }
      setReplayingDeliveryId(deliveryId);
      setDeliveriesError('');
      try {
        await replayDashboardWebhookDelivery({ endpointId, deliveryId });
        refreshDeliveries();
      } catch (error: unknown) {
        setDeliveriesError(error instanceof Error ? error.message : String(error));
      } finally {
        setReplayingDeliveryId('');
      }
    },
    [session.claims, session.errorMessage],
  );

  /* With no endpoints there is nothing to page through, so the route drops the
     table and header action entirely and shows the walkthrough, whose own
     button is then the single call to action on the page. */
  const showGetStarted =
    !session.loading &&
    !loading &&
    Boolean(session.claims) &&
    !errorMessage &&
    endpoints.length === 0;

  return (
    <div className="dashboard-view" aria-label={t('webhooksPageAria')}>
      {showGetStarted ? null : (
        <DashboardPageActions>
          <button
            type="button"
            className="dashboard-pagination-button dashboard-pagination-button--primary"
            onClick={onOpenCreateModal}
            disabled={creating || session.loading || !session.claims}
          >
            {t('webhooksAddEndpoint')}
          </button>
        </DashboardPageActions>
      )}

      {mutationError && !isCreateModalOpen ? (
        <p className="dashboard-form-alert" role="alert">
          {mutationError}
        </p>
      ) : null}

      {errorMessage && !loading && !session.loading ? (
        <section className="dashboard-view__section" aria-label={t('webhooksStatusAria')}>
          <p className="dashboard-pagination-note">
            {t('webhooksEndpointsUnavailable', { reason: errorMessage })}
          </p>
        </section>
      ) : showGetStarted ? (
        <WebhooksGetStarted onAddEndpoint={onOpenCreateModal} disabled={creating} />
      ) : (
        <DashboardTable
          ariaLabel={t('webhooksEndpointsTableAria')}
          columns={WEBHOOK_ENDPOINTS_TABLE_COLUMNS}
          pagination={endpointsPagination.pagination}
        >
          <DashboardTableHeader>
            <DashboardTableHeaderCell>{t('webhooksColEndpoint')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('webhooksColStatus')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('webhooksColUpdated')}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>{t('webhooksColActions')}</DashboardTableHeaderCell>
          </DashboardTableHeader>
          {session.loading || loading ? (
            <DashboardTableSkeletonRows label={t('webhooksLoadingEndpoints')} columns={4} />
          ) : !session.claims ? (
            <DashboardTableState>
              {t('webhooksUnavailableSession', {
                reason: session.errorMessage || t('webhooksUnauthorized'),
              })}
            </DashboardTableState>
          ) : endpoints.length === 0 ? (
            <DashboardTableState>{t('webhooksEmpty')}</DashboardTableState>
          ) : (
            <>
              {endpointsPagination.rows.map((endpoint) => (
                <DashboardTableRow key={endpoint.id}>
                  <DashboardTableCell
                    title={`${endpoint.url} · ${endpoint.id}`}
                    className="dashboard-data-table__cell--lead"
                  >
                    <div className="dashboard-lead">
                      <span className="dashboard-lead__icon" aria-hidden="true">
                        <WebhookIcon size={16} />
                      </span>
                      <span className="dashboard-lead__copy">
                        <span className="dashboard-lead__title">
                          <button
                            type="button"
                            className="dashboard-inline-link"
                            onClick={() =>
                              go(
                                `/dashboard/webhooks?endpointId=${encodeURIComponent(endpoint.id)}`,
                              )
                            }
                          >
                            {endpoint.url}
                          </button>
                        </span>
                        <span className="dashboard-lead__sub">
                          {endpoint.id}
                          {endpoint.eventCategories.length > 0
                            ? ` · ${endpoint.eventCategories.join(', ')}`
                            : ''}
                        </span>
                      </span>
                    </div>
                  </DashboardTableCell>
                  <DashboardTableCell>
                    <DashboardTableStatus tone={dashboardStatusTone(endpoint.status)}>
                      {dashboardStatusLabel(endpoint.status)}
                    </DashboardTableStatus>
                  </DashboardTableCell>
                  <DashboardTableCell truncate>
                    {formatTimestamp(endpoint.updatedAt)}
                  </DashboardTableCell>
                  <DashboardTableCell>
                    <DashboardTableActionGroup>
                      <DashboardTableActionButton
                        onClick={sendTestEvent.bind(null, {
                          endpointId: endpoint.id,
                          setTestingEndpointId,
                          selectEndpoint: setSelectedEndpointId,
                          refreshDeliveries,
                        })}
                        disabled={
                          endpoint.status !== 'ACTIVE' ||
                          testingEndpointId !== '' ||
                          busyEndpointId === endpoint.id
                        }
                      >
                        {testingEndpointId === endpoint.id
                          ? t('webhooksSending')
                          : t('webhooksSendTestEvent')}
                      </DashboardTableActionButton>
                      <DashboardTableActionButton
                        onClick={() => onToggleEndpointStatus(endpoint)}
                        disabled={
                          busyEndpointId === endpoint.id || testingEndpointId === endpoint.id
                        }
                      >
                        {endpoint.status === 'ACTIVE' ? t('webhooksDisable') : t('webhooksEnable')}
                      </DashboardTableActionButton>
                      <DashboardTableActionMenu
                        ariaLabel={t('webhooksMoreActionsFor', { url: endpoint.url })}
                        items={[
                          {
                            label: t('webhooksRotateSecret'),
                            onSelect: () => onRotateSecret(endpoint),
                            disabled:
                              busyEndpointId === endpoint.id || testingEndpointId === endpoint.id,
                          },
                          {
                            label: t('webhooksDelete'),
                            onSelect: () => onDeleteEndpoint(endpoint.id),
                            tone: 'danger' as const,
                            disabled:
                              busyEndpointId === endpoint.id || testingEndpointId === endpoint.id,
                          },
                        ]}
                      />
                    </DashboardTableActionGroup>
                  </DashboardTableCell>
                </DashboardTableRow>
              ))}
            </>
          )}
        </DashboardTable>
      )}

      <WebhookSecretRevealModal reveal={secretReveal} onRequestClose={onCloseSecretReveal} />

      <CreateWebhookEndpointModal
        isOpen={isCreateModalOpen}
        submitting={creating}
        errorMessage={mutationError}
        eventCategoryOptions={eventCategoryOptions}
        onRequestClose={onCloseCreateModal}
        onSubmit={(input) => {
          void onCreateEndpoint(input);
        }}
      />

      {selectedEndpointId && !errorMessage ? (
        <section
          className="dashboard-view__section dashboard-view__section--plain"
          aria-label={t('webhooksDeliveriesAria')}
        >
          <div className="dashboard-section-toolbar">
            <div className="dashboard-section-toolbar__copy">
              <h2>{t('webhooksDeliveries')}</h2>
              <p className="dashboard-pagination-note">
                {t('webhooksEndpointPre')}
                <code>{selectedEndpointId}</code>
                {selectedEndpoint
                  ? ` · ${t('webhooksSigningSecretSummary', {
                      version: selectedEndpoint.secretVersion,
                      preview: selectedEndpoint.secretPreview || '',
                    })}`
                  : ''}
              </p>
            </div>
          </div>
          <DashboardTable
            ariaLabel={t('webhooksDeliveriesTableAria')}
            columns={WEBHOOK_DELIVERIES_TABLE_COLUMNS}
            pagination={deliveriesPagination.pagination}
          >
            <DashboardTableHeader>
              <DashboardTableHeaderCell>{t('webhooksColEvent')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('webhooksColStatus')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell className="dashboard-data-table__header-cell--end">
                {t('webhooksColAttempts')}
              </DashboardTableHeaderCell>
              <DashboardTableHeaderCell className="dashboard-data-table__header-cell--end">
                {t('webhooksColResponse')}
              </DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('webhooksColLastAttempt')}</DashboardTableHeaderCell>
              <DashboardTableHeaderCell>{t('webhooksColAction')}</DashboardTableHeaderCell>
            </DashboardTableHeader>
            {deliveriesLoading ? (
              <DashboardTableState>
                {t('webhooksLoadingDeliveries', { id: selectedEndpointId })}
              </DashboardTableState>
            ) : deliveriesError ? (
              <DashboardTableState>
                {t('webhooksDeliveriesUnavailable', { reason: deliveriesError })}
              </DashboardTableState>
            ) : deliveries.length === 0 ? (
              <DashboardTableState>{t('webhooksDeliveriesEmpty')}</DashboardTableState>
            ) : (
              <>
                {deliveriesPagination.rows.map((delivery) => (
                  <DashboardTableRow key={delivery.id}>
                    <DashboardTableCell
                      title={`${delivery.eventType} · ${delivery.id} · ${delivery.eventId}`}
                      className="dashboard-data-table__cell--lead"
                    >
                      <span className="dashboard-lead__copy">
                        <span className="dashboard-lead__title">
                          <span className="dashboard-data-table__summary">
                            {delivery.eventType || DASHBOARD_EMPTY_VALUE}
                          </span>
                          {delivery.id === requestedDeliveryId ? (
                            <DashboardTableBadge tone="warning">
                              {t('webhooksOpenedFromAudit')}
                            </DashboardTableBadge>
                          ) : null}
                        </span>
                        <span className="dashboard-lead__sub">
                          {delivery.id}
                          {delivery.eventId ? ` · ${delivery.eventId}` : ''}
                        </span>
                      </span>
                    </DashboardTableCell>
                    <DashboardTableCell>
                      <DashboardTableStatus tone={dashboardStatusTone(delivery.status)}>
                        {dashboardStatusLabel(delivery.status)}
                      </DashboardTableStatus>
                    </DashboardTableCell>
                    <DashboardTableCell align="end" className="dashboard-data-table__cell--nowrap">
                      {delivery.attemptCount}
                      {delivery.replayCount > 0 ? (
                        <span className="dashboard-data-table__inline-note">
                          {' '}
                          ·{' '}
                          {t(
                            delivery.replayCount === 1
                              ? 'webhooksReplayCountOne'
                              : 'webhooksReplayCountMany',
                            { count: delivery.replayCount },
                          )}
                        </span>
                      ) : null}
                    </DashboardTableCell>
                    <DashboardTableCell title={delivery.errorMessage || ''} align="end">
                      {delivery.responseStatus != null
                        ? String(delivery.responseStatus)
                        : DASHBOARD_EMPTY_VALUE}
                    </DashboardTableCell>
                    <DashboardTableCell truncate>
                      {formatTimestamp(delivery.lastAttemptAt || delivery.deliveredAt)}
                    </DashboardTableCell>
                    <DashboardTableCell>
                      <DashboardTableActionButton
                        onClick={() => onReplayDelivery(delivery.endpointId, delivery.id)}
                        disabled={replayingDeliveryId === delivery.id}
                      >
                        {replayingDeliveryId === delivery.id
                          ? t('webhooksReplaying')
                          : t('webhooksReplay')}
                      </DashboardTableActionButton>
                    </DashboardTableCell>
                  </DashboardTableRow>
                ))}
              </>
            )}
          </DashboardTable>
        </section>
      ) : null}
    </div>
  );
}

export default WebhooksPage;
