import React from 'react';
import { LoaderCircle } from 'lucide-react';

export function DashboardLoadingState({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="dashboard-loading-state" role="status">
      <span className="dashboard-loading-state__icon" aria-hidden="true">
        <LoaderCircle size={24} strokeWidth={1.5} />
      </span>
      <div className="dashboard-loading-state__copy">
        <h2>{title}</h2>
        <p>Please wait while we prepare your workspace.</p>
      </div>
    </div>
  );
}
