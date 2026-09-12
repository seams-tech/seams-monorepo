import React from 'react';
import { ChevronDownIcon } from '../icons/SidebarIcons';

export function DashboardExpander(props: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details className="dashboard-expander">
      <summary className="dashboard-expander__trigger">
        <span>{props.title}</span>
        <ChevronDownIcon size={16} strokeWidth={1.75} className="dashboard-expander__chevron" />
      </summary>
      <div className="dashboard-expander__content">{props.children}</div>
    </details>
  );
}
