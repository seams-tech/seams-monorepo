import { isPlainObject } from '@seams/wallet-server/cloud-host';

const PREFIX = 'wallet_console_binding_';

function appendDuration(headers: Headers, name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
  headers.append('Server-Timing', `${PREFIX}${name};dur=${value.toFixed(3)}`);
}

export function appendTenantDeploymentD1Timing(
  headers: Headers,
  elapsedMs: number,
  rawMeta: unknown,
): void {
  appendDuration(headers, 'd1', elapsedMs);
  const meta = isPlainObject(rawMeta) ? rawMeta : {};
  const timings = isPlainObject(meta.timings) ? meta.timings : {};
  appendDuration(headers, 'sql', timings.sql_duration_ms ?? meta.duration);
  if (typeof meta.served_by_region === 'string' && /^[A-Z]{2,8}$/.test(meta.served_by_region)) {
    headers.append('Server-Timing', `${PREFIX}region;desc="${meta.served_by_region}"`);
  }
  if (typeof meta.served_by_primary === 'boolean') {
    headers.append('Server-Timing', `${PREFIX}primary;desc="${meta.served_by_primary}"`);
  }
}

export function forwardTenantDeploymentD1Timing(source: Headers, target: Headers): void {
  for (const entry of (source.get('Server-Timing') ?? '').split(',')) {
    const metric = entry.trim();
    if (
      /^wallet_console_binding_(?:d1|sql);dur=\d+(?:\.\d+)?$/.test(metric) ||
      /^wallet_console_binding_region;desc="[A-Z]{2,8}"$/.test(metric) ||
      /^wallet_console_binding_primary;desc="(?:true|false)"$/.test(metric)
    ) {
      target.append('Server-Timing', metric);
    }
  }
}
