import React from 'react';
import type { PlatformServiceIdV1 } from '@seams-internal/console-shared/accountPlatform';
import { assertNever } from '@seams-internal/console-shared/accountPlatform/boundary';
import {
  DashboardTable,
  DashboardTableCell,
  DashboardTableHeader,
  DashboardTableHeaderCell,
  DashboardTableIntro,
  DashboardTableRow,
  DashboardTableState,
  dashboardTableColumns,
} from '../../components/DashboardTable';
import {
  formatUsdMinor,
  type DashboardBillingCostsState,
  type DashboardBillingUsageCharges,
} from './consoleBillingApi';
import { BillingMetricsGrid } from './billingShared';
import { DashboardPageSkeleton } from '../../components/DashboardSkeleton';
import { platformConsoleHref } from '../../consoleNavigation';
import { platformServiceLabel } from '../services/serviceProjects';

interface BillingCostGroup {
  readonly id: string;
  readonly label: string;
  amountMinor: number;
}

interface BillingCostBreakdown {
  readonly totalMinor: number;
  readonly projects: readonly BillingCostGroup[];
  readonly services: readonly BillingCostGroup[];
  readonly meters: readonly BillingCostGroup[];
}

const COST_COLUMNS = dashboardTableColumns('2fr', '1fr');
const HISTORICAL_LABEL = 'Historical unattributed organization charges';

function selectUsageCostMonth(event: React.ChangeEvent<HTMLInputElement>): void {
  const periodMonthUtc = event.currentTarget.value;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodMonthUtc)) return;
  const target = new URL(window.location.href);
  target.searchParams.set('periodMonthUtc', periodMonthUtc);
  target.hash = 'billing-usage-costs';
  window.location.assign(target);
}

function addCostGroup(
  groups: Map<string, BillingCostGroup>,
  id: string,
  label: string,
  amountMinor: number,
): void {
  const existing = groups.get(id);
  if (existing) {
    existing.amountMinor += amountMinor;
    return;
  }
  groups.set(id, { id, label, amountMinor });
}

function compareCostGroups(left: BillingCostGroup, right: BillingCostGroup): number {
  return left.label.localeCompare(right.label);
}

/** Keeps the charges attributed to one service; historical charges have no service. */
function scopedCharges(
  data: DashboardBillingUsageCharges,
  serviceId: PlatformServiceIdV1 | undefined,
): DashboardBillingUsageCharges['charges'] {
  if (!serviceId) return data.charges;
  return data.charges.filter(
    (charge) => charge.kind === 'instance' && charge.attribution.serviceId === serviceId,
  );
}

function buildCostBreakdown(
  charges: DashboardBillingUsageCharges['charges'],
): BillingCostBreakdown {
  const projects = new Map<string, BillingCostGroup>();
  const services = new Map<string, BillingCostGroup>();
  const meters = new Map<string, BillingCostGroup>();
  let totalMinor = 0;
  for (const charge of charges) {
    totalMinor += charge.amountMinor;
    switch (charge.kind) {
      case 'instance':
        addCostGroup(
          projects,
          `instance:${charge.attribution.scope.projectId}`,
          charge.attribution.scope.projectId,
          charge.amountMinor,
        );
        addCostGroup(
          services,
          `instance:${charge.attribution.serviceId}`,
          charge.attribution.serviceId,
          charge.amountMinor,
        );
        addCostGroup(meters, `instance:${charge.meterId}`, charge.meterId, charge.amountMinor);
        break;
      case 'historical_organization':
        addCostGroup(projects, 'historical_organization', HISTORICAL_LABEL, charge.amountMinor);
        addCostGroup(services, 'historical_organization', HISTORICAL_LABEL, charge.amountMinor);
        addCostGroup(meters, 'historical_organization', HISTORICAL_LABEL, charge.amountMinor);
        break;
      default:
        assertNever(charge);
    }
  }
  return {
    totalMinor,
    projects: Array.from(projects.values()).sort(compareCostGroups),
    services: Array.from(services.values()).sort(compareCostGroups),
    meters: Array.from(meters.values()).sort(compareCostGroups),
  };
}

function renderCostGroup(group: BillingCostGroup): React.JSX.Element {
  return (
    <DashboardTableRow key={group.id}>
      <DashboardTableCell title={group.label} truncate={false}>
        {group.label}
      </DashboardTableCell>
      <DashboardTableCell align="end">{formatUsdMinor(group.amountMinor)}</DashboardTableCell>
    </DashboardTableRow>
  );
}

function BillingCostTable(props: {
  readonly dimension: 'project' | 'service' | 'meter';
  readonly groups: readonly BillingCostGroup[];
}): React.JSX.Element {
  return (
    <DashboardTable ariaLabel={`Usage cost by ${props.dimension}`} columns={COST_COLUMNS}>
      <DashboardTableIntro>
        <h3 className="dashboard-billing-table__title">By {props.dimension}</h3>
      </DashboardTableIntro>
      {props.groups.length === 0 ? (
        <DashboardTableState>No usage costs were posted in this period.</DashboardTableState>
      ) : (
        <>
          <DashboardTableHeader>
            <DashboardTableHeaderCell>{props.dimension}</DashboardTableHeaderCell>
            <DashboardTableHeaderCell>Posted usage cost</DashboardTableHeaderCell>
          </DashboardTableHeader>
          {props.groups.map(renderCostGroup)}
        </>
      )}
    </DashboardTable>
  );
}

/** With `serviceId`, only that service's attributed usage is shown. */
export function BillingUsageCostsSection(props: {
  readonly organizationId: string;
  readonly state: DashboardBillingCostsState;
  readonly serviceId?: PlatformServiceIdV1;
}): React.JSX.Element {
  const { state, organizationId, serviceId } = props;
  const serviceLabel = serviceId ? platformServiceLabel(serviceId) : null;
  if (state.kind === 'unavailable' || state.organizationId !== organizationId) {
    return (
      <p className="dashboard-pagination-note">
        Usage costs are unavailable for this organization.
      </p>
    );
  }
  switch (state.kind) {
    case 'loading':
      return <DashboardPageSkeleton label="Loading usage costs" metrics={0} rows={3} columns={4} />;
    case 'failed':
      return (
        <p className="dashboard-pagination-note" role="alert">
          Usage costs unavailable: {state.message}
        </p>
      );
    case 'ready': {
      if (state.data.organizationId !== organizationId) {
        return (
          <p className="dashboard-pagination-note" role="alert">
            Usage costs did not match this organization.
          </p>
        );
      }
      const costs = buildCostBreakdown(scopedCharges(state.data, serviceId));
      return (
        <section
          id="billing-usage-costs"
          className="dashboard-view__section dashboard-view__section--plain"
          aria-label={serviceLabel ? `${serviceLabel} usage costs` : 'Organization usage costs'}
        >
          <h2>{serviceLabel ? `${serviceLabel} usage costs` : 'Usage costs'}</h2>
          <label className="dashboard-form-field">
            <span>Usage cost month (UTC)</span>
            <input
              type="month"
              className="dashboard-input"
              value={state.data.periodMonthUtc}
              onChange={selectUsageCostMonth}
            />
          </label>
          <p className="dashboard-pagination-note">
            Posted service usage for {state.data.periodMonthUtc} (UTC). Payments, refunds, disputes,
            and manual adjustments remain in account activity.
          </p>
          <BillingMetricsGrid
            ariaLabel="Posted usage total"
            metrics={[
              {
                label: 'Posted usage cost',
                value: formatUsdMinor(costs.totalMinor),
                hint: `${serviceLabel ?? 'Organization'} total for ${state.data.periodMonthUtc}`,
              },
            ]}
          />
          {serviceLabel ? (
            <p className="dashboard-pagination-note">
              Only {serviceLabel} usage is shown. Usage of other products and historical
              organization charges are in{' '}
              <a href={platformConsoleHref('/dashboard/billing/account')}>Platform Console</a>.
            </p>
          ) : (
            <p className="dashboard-pagination-note">
              Project, service, and meter IDs identify attributable costs. Historical charges
              without source evidence remain organization charges.
            </p>
          )}
          <div className="dashboard-view-grid">
            <BillingCostTable dimension="project" groups={costs.projects} />
            {serviceLabel ? null : <BillingCostTable dimension="service" groups={costs.services} />}
            <BillingCostTable dimension="meter" groups={costs.meters} />
          </div>
        </section>
      );
    }
    default:
      return assertNever(state);
  }
}
