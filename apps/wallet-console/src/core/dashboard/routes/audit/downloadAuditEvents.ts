import type { DashboardConsoleAuditEvent } from './consoleAuditApi';

function csvCell(value: string): string {
  // Spreadsheet programs interpret formula prefixes even in quoted CSV cells.
  const text = /^\s*[=+@-]/u.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadAuditEvents(events: readonly DashboardConsoleAuditEvent[]): void {
  const rows = [
    [
      'ID',
      'Timestamp',
      'Organization',
      'Project',
      'Environment',
      'Actor',
      'Actor type',
      'Category',
      'Action',
      'Outcome',
      'Summary',
      'Policy',
      'Metadata',
    ],
  ];
  for (const event of events) {
    rows.push([
      event.id,
      event.createdAt,
      event.orgId,
      event.projectId || '',
      event.environmentId || '',
      event.actorUserId,
      event.actorType,
      event.category,
      event.action,
      event.outcome,
      event.summary,
      event.policyId || '',
      JSON.stringify(event.metadata),
    ]);
  }
  const csv = rows.map(formatCsvRow).join('\r\n') + '\r\n';
  const url = window.URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `audit-events-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.URL.revokeObjectURL(url);
  }
}

function formatCsvRow(row: readonly string[]): string {
  return row.map(csvCell).join(',');
}
