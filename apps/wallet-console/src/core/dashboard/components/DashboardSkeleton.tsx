import React from 'react';
import clsx from 'clsx';
import { DashboardTableCell, DashboardTableRow } from './DashboardTable';

/* Bar widths cycle through this list so placeholder rows read as text of
   uneven length instead of a striped block. */
const SKELETON_WIDTHS = ['72%', '48%', '60%', '38%', '56%', '66%', '44%', '52%'] as const;

function skeletonWidth(index: number): string {
  return SKELETON_WIDTHS[index % SKELETON_WIDTHS.length]!;
}

export function DashboardSkeletonBar(props: {
  width?: string;
  size?: 'text' | 'label' | 'value';
  className?: string;
}): React.JSX.Element {
  const { width = '100%', size = 'text', className } = props;
  return (
    <span
      className={clsx('dashboard-skeleton', `dashboard-skeleton--${size}`, className)}
      style={{ width }}
      aria-hidden="true"
    />
  );
}

/* Stands in for a page while its first data loads: a metric strip and a
   table card in the shape of the page that follows. The label is read out;
   the bars are not. */
export function DashboardPageSkeleton(props: {
  label: string;
  metrics?: number;
  rows?: number;
  columns?: number;
}): React.JSX.Element {
  const { label, metrics = 3, rows = 4, columns = 4 } = props;
  return (
    <div className="dashboard-page-skeleton" role="status" aria-busy="true">
      <span className="dashboard-visually-hidden">{label}</span>
      {metrics > 0 ? (
        <div
          className="dashboard-page-skeleton__metrics"
          style={{ '--dashboard-skeleton-metrics': metrics } as React.CSSProperties}
        >
          {Array.from({ length: metrics }, (_, index) => (
            <div className="dashboard-page-skeleton__metric" key={index}>
              <DashboardSkeletonBar size="label" width="42%" />
              <DashboardSkeletonBar size="value" width={skeletonWidth(index + 2)} />
              <DashboardSkeletonBar width="70%" />
            </div>
          ))}
        </div>
      ) : null}
      {rows > 0 ? (
        <div
          className="dashboard-page-skeleton__table"
          style={{ '--dashboard-skeleton-columns': columns } as React.CSSProperties}
        >
          <div className="dashboard-page-skeleton__row dashboard-page-skeleton__row--header">
            {Array.from({ length: columns }, (_, column) => (
              <DashboardSkeletonBar size="label" width="46%" key={column} />
            ))}
          </div>
          {Array.from({ length: rows }, (_, row) => (
            <div className="dashboard-page-skeleton__row" key={row}>
              {Array.from({ length: columns }, (_, column) => (
                <DashboardSkeletonBar width={skeletonWidth(row * 3 + column)} key={column} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* Placeholder rows inside a DashboardTable whose header is already drawn, so
   the columns stay put when the data arrives. */
export function DashboardTableSkeletonRows(props: {
  label: string;
  columns: number;
  rows?: number;
}): React.JSX.Element {
  const { label, columns, rows = 3 } = props;
  return (
    <div className="dashboard-table-skeleton" role="status" aria-busy="true">
      <span className="dashboard-visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <DashboardTableRow key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <DashboardTableCell key={column}>
              <DashboardSkeletonBar width={skeletonWidth(row * 3 + column)} />
            </DashboardTableCell>
          ))}
        </DashboardTableRow>
      ))}
    </div>
  );
}
