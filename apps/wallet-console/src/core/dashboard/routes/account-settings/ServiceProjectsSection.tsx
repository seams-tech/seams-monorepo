import React from 'react';
import { t } from '@core/i18n';
import type { PlatformServiceIdV1 } from '@seams-internal/console-shared/accountPlatform';
import { assertNever } from '@seams-internal/console-shared/accountPlatform/boundary';
import {
  DashboardTable,
  DashboardTableBadge,
  DashboardTableCell,
  DashboardTableHeader,
  DashboardTableHeaderCell,
  DashboardTableRow,
  DashboardTableState,
  dashboardTableColumns,
} from '../../components/DashboardTable';
import { platformConsoleHref } from '../../consoleNavigation';
import { formatDashboardTimestamp } from '../../utils/timestamps';
import {
  listServiceProjects,
  platformServiceLabel,
  type ServiceProject,
} from '../services/serviceProjects';

const SERVICE_PROJECT_COLUMNS = dashboardTableColumns(1.6, 0.9, 1);

type ServiceProjectsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly projects: readonly ServiceProject[] }
  | { readonly kind: 'failed'; readonly message: string };

function statusBadge(status: ServiceProject['status']): React.JSX.Element {
  switch (status.kind) {
    case 'active':
      return (
        <DashboardTableBadge tone="success">{t('accountServiceStatusActive')}</DashboardTableBadge>
      );
    case 'provisioning':
      return (
        <DashboardTableBadge tone="warning">
          {t('accountServiceStatusProvisioning')}
        </DashboardTableBadge>
      );
    case 'disabled':
      return <DashboardTableBadge>{t('accountServiceStatusDisabled')}</DashboardTableBadge>;
    case 'failed':
      return (
        <DashboardTableBadge tone="danger">{t('accountServiceStatusFailed')}</DashboardTableBadge>
      );
    default:
      return assertNever(status);
  }
}

/** The current organization's projects that run one service. */
export function ServiceProjectsSection(props: {
  readonly organizationId: string;
  readonly serviceId: PlatformServiceIdV1;
}): React.JSX.Element {
  const { organizationId, serviceId } = props;
  const label = platformServiceLabel(serviceId);
  const [state, setState] = React.useState<ServiceProjectsState>({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    listServiceProjects(organizationId, serviceId)
      .then((projects) => {
        if (!cancelled) setState({ kind: 'ready', projects });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, serviceId]);

  return (
    <section className="dashboard-account-panel dashboard-account-panel--organizations">
      <div className="dashboard-section-toolbar dashboard-account-section-header">
        <div className="dashboard-section-toolbar__copy">
          <h2>{t('accountServiceProjectsTitle', { label })}</h2>
          <p className="dashboard-pagination-note">
            {t('accountServiceProjectsHelp', { label })}
            <a href={platformConsoleHref('/dashboard/account-settings')}>Platform Console</a>
            {t('accountServiceProjectsHelpEnd')}
          </p>
        </div>
      </div>
      <DashboardTable
        ariaLabel={t('accountServiceProjectsTitle', { label })}
        columns={SERVICE_PROJECT_COLUMNS}
      >
        <DashboardTableHeader>
          <DashboardTableHeaderCell>{t('accountColProject')}</DashboardTableHeaderCell>
          <DashboardTableHeaderCell>{label}</DashboardTableHeaderCell>
          <DashboardTableHeaderCell>{t('accountColCreated')}</DashboardTableHeaderCell>
        </DashboardTableHeader>
        {state.kind === 'loading' ? (
          <DashboardTableState>{t('accountServiceProjectsLoading', { label })}</DashboardTableState>
        ) : state.kind === 'failed' ? (
          <DashboardTableState>
            {t('accountServiceProjectsUnavailable', {
              label,
              message: state.message,
            })}
          </DashboardTableState>
        ) : state.projects.length === 0 ? (
          <DashboardTableState>{t('accountServiceProjectsEmpty', { label })}</DashboardTableState>
        ) : (
          state.projects.map(({ project, status }) => (
            <DashboardTableRow key={project.id}>
              <DashboardTableCell>
                <strong className="dashboard-data-table__summary">{project.name}</strong>
                <span className="dashboard-pagination-note">{project.slug || project.id}</span>
              </DashboardTableCell>
              <DashboardTableCell>{statusBadge(status)}</DashboardTableCell>
              <DashboardTableCell>
                {formatDashboardTimestamp(project.createdAt, '—')}
              </DashboardTableCell>
            </DashboardTableRow>
          ))
        )}
      </DashboardTable>
    </section>
  );
}
