// Namespace and organization come from the authenticated Console context.
export interface ConsoleWalletKey {
  readonly id: string;
  readonly projectId: string;
  readonly environmentId: string;
}

export function consoleWalletKeyString(wallet: ConsoleWalletKey): string {
  return JSON.stringify([wallet.projectId, wallet.environmentId, wallet.id]);
}
