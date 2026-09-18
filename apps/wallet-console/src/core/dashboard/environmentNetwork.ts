import type { ConsoleNetwork } from '@core/runtime';

export function networkForConsoleEnvironmentId(environmentId: string): ConsoleNetwork | null {
  const normalized = environmentId.trim().toLowerCase();
  if (normalized.endsWith(':prod')) return 'mainnet';
  if (normalized.endsWith(':dev') || normalized.endsWith(':staging')) return 'testnet';
  return null;
}
